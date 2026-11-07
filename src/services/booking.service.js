// SERVICE BOOKINGS: buyers book logistics providers' services (transport, warehousing, equipment hire).
//
//   GET  /listings/:id/booking-form     (public) what to fill in, rules, booked-dates calendar
//   POST /me/bookings/quote             price + availability for the details entered (nothing saved)
//   POST /me/bookings                   book and pay -> an ORDER (kind "booking") with one seller order,
//                                       one line and the booking details (AFA-BKG-000001)
//   GET  /me/bookings, /me/bookings/:id My Bookings
//   POST /me/bookings/:id/confirm-done  "Service Done" -> Completed (provider's payout released)
//
// Price = rate x billable quantity (see config/bookings.js), + VAT when the category has VAT.
// The listing row is locked while booking, so two buyers can't take the same dates / space.
// Payment, cancelling, claims and refunds use the normal order endpoints (/me/orders/:orderId/...).
const { Op } = require('sequelize');
const models = require('../models');
const ApiError = require('../utils/ApiError');
const settings = require('./setting.service');
const addressService = require('./address.service');
const directory = require('./userDirectory');
const { baseShape, listingInclude } = require('./listing.service');
const { sellerShape } = require('./marketplace.service');
const { assertMethodAvailable, deadlineFor } = require('./checkout.service');
const { listingIsVat } = require('./vatHold.service');
const orderService = require('./order.service');
const { applyStatus } = require('./sellerOrder.service');
const orderNotify = require('./orderNotify.service');
const reviews = require('./review.service');
const { round2, num, money, recordHistory, bookingShape } = require('./orderShared');
const { USER_STATUS } = require('../utils/constants');
const { VAT_STATUS } = require('../config/vat');
const { LISTING_STATUS, SERVICE_RATE_UNITS, SERVICE_AVAILABILITY, CAPACITY_UNITS, MIN_BOOKING_UNITS } = require('../config/listingOptions');
const { PAYMENT_METHODS, SELLER_ORDER_STATUS, orderNumber, sellerOrderNumber } = require('../config/orders');
const B = require('../config/bookings');

const { sequelize, Order, SellerOrder, OrderItem, Listing, Location, User, Booking } = models;
const R = B.BOOKING_RULES;

const fail = (status, message, code, field) => new ApiError(status, message, { code, errors: field ? [{ field, message }] : undefined });
const invalid = (errors) => new ApiError(422, 'Validation failed', { code: 'VALIDATION_ERROR', errors });
const bookingNotFound = () => new ApiError(404, 'Booking not found', { code: 'BOOKING_NOT_FOUND' });

// ---------- the service ----------
const sellerInclude = () => ({ model: User, as: 'seller', attributes: ['id', 'status', 'userType', 'vatStatus'] });

function isBookable(l) {
  return Boolean(
    l &&
      !l.deletedAt &&
      l.kind === 'service' &&
      l.status === LISTING_STATUS.ACTIVE &&
      !l.vatHold &&
      l.category &&
      l.category.isActive &&
      (!l.subCategory || l.subCategory.isActive) &&
      l.seller &&
      l.seller.status === USER_STATUS.APPROVED
  );
}

async function loadService(listingId, { transaction, lock = false } = {}) {
  if (lock) await Listing.findByPk(listingId, { transaction, lock: transaction.LOCK.UPDATE, attributes: ['id'] });
  const l = await Listing.findByPk(listingId, { include: [...listingInclude(), sellerInclude()], transaction });
  if (!isBookable(l)) throw fail(404, 'This service is not available on the marketplace', 'SERVICE_NOT_AVAILABLE');
  if (!B.RATE_RULES[l.priceUnit]) {
    throw fail(409, 'This service cannot be booked online until the provider fixes its rate', 'RATE_NOT_BOOKABLE');
  }
  return l;
}

// Why the service can't be booked right now (availability set by the provider), or null
const unavailableReason = (l) =>
  l.availability && l.availability !== 'available' ? `This service is "${SERVICE_AVAILABILITY[l.availability] || l.availability}" right now` : null;

// ---------- the booking form: which fields the buyer fills in ----------
function formOf(l) {
  const rule = B.RATE_RULES[l.priceUnit];
  const { type, factors } = rule;
  const capacity = num(l.capacity);
  const isTonKm = l.priceUnit === 'ton_km';
  // Load: in the vehicle's capacity unit; per ton per km in tons (or kg if the capacity is in kg)
  const loadUnit = type !== 'transport' ? null : isTonKm ? (l.capacityUnit === 'kg' ? 'kg' : 'ton') : capacity ? l.capacityUnit : null;
  const timeFactor = factors.find((f) => ['days', 'weeks', 'months'].includes(f));
  const need = (yes, required = true) => (yes ? (required ? 'required' : 'optional') : 'no');
  return {
    bookingType: type,
    bookingTypeLabel: B.BOOKING_TYPES[type],
    rateUnit: l.priceUnit,
    rateUnitLabel: SERVICE_RATE_UNITS[l.priceUnit],
    billUnit: rule.billUnit,
    fields: {
      startDate: 'required',
      // time / storage: the end date sets the length; count: optional (several days); transport: one day
      endDate: type === 'time' ? need(l.priceUnit !== 'hour') : type === 'storage' ? 'required' : type === 'count' ? 'optional' : 'no',
      startTime: 'optional',
      pickupAddress: need(type === 'transport'),
      dropoffAddress: need(type === 'transport'),
      serviceAddress: need(type === 'time' || type === 'count'),
      distanceKm: need(factors.includes('distanceKm')),
      loadAmount: need(Boolean(loadUnit)),
      spaceAmount: need(factors.includes('space') || type === 'storage'),
      quantity: need(factors.includes('quantity')),
      hours: need(factors.includes('hours')),
      note: 'optional',
    },
    labels: {
      quantity: rule.quantityLabel || null,
      timeUnit: timeFactor || null,
    },
    loadUnit,
    loadUnitLabel: loadUnit ? CAPACITY_UNITS[loadUnit] || loadUnit : null,
    spaceUnit: rule.spaceUnit || null,
    spaceUnitLabel: rule.spaceUnit ? B.SPACE_UNIT_LABELS[rule.spaceUnit] : null,
    capacity,
    capacityUnit: l.capacityUnit || null,
    capacityUnitLabel: l.capacityUnit ? CAPACITY_UNITS[l.capacityUnit] || l.capacityUnit : null,
    unitsAvailable: l.unitsAvailable || 1,
    minBooking: l.minBooking === null || l.minBooking === undefined ? null : { amount: num(l.minBooking), unit: l.minBookingUnit, unitLabel: MIN_BOOKING_UNITS[l.minBookingUnit] || l.minBookingUnit },
    advanceNotice: l.advanceNotice ? { amount: l.advanceNotice, unit: l.advanceNoticeUnit } : null,
    coverageRegionIds: l.coverageRegionIds || [],
    timeRules: 'Days count both the start and end date. A week is 7 days and a month is 30 days, rounded up.',
  };
}

// ---------- addresses ----------
//   { addressId }  one of the buyer's saved addresses
//   { addressLine, regionId, landmark?, contactName?, phone? }  typed in
async function resolveAddress(user, input, field, { transaction } = {}) {
  if (!input) return null;
  if (input.addressId) {
    const a = await addressService.getOne(user, input.addressId); // 404 if not the buyer's
    return {
      addressId: a.id,
      contactName: a.contactName || null,
      phone: a.phone || null,
      addressLine: a.addressLine || null,
      landmark: a.landmark || null,
      region: a.region || null,
      fullAddress: a.fullAddress,
    };
  }
  const region = await Location.findOne({ where: { id: input.regionId, type: 'region', isActive: true }, attributes: ['id', 'name'], transaction });
  if (!region) throw invalid([{ field: `${field}.regionId`, message: 'Choose a valid region' }]);
  return {
    addressId: null,
    contactName: input.contactName || null,
    phone: input.phone || null,
    addressLine: input.addressLine,
    landmark: input.landmark || null,
    region: { id: region.id, name: region.name },
    fullAddress: [input.addressLine, input.landmark, region.name, 'Eswatini'].filter(Boolean).join(', '),
  };
}

async function resolveAddresses(user, data, opts) {
  const [pickup, dropoff, service] = await Promise.all([
    resolveAddress(user, data.pickupAddress, 'pickupAddress', opts),
    resolveAddress(user, data.dropoffAddress, 'dropoffAddress', opts),
    resolveAddress(user, data.serviceAddress, 'serviceAddress', opts),
  ]);
  return { pickup, dropoff, service };
}

// ---------- price ----------
// Returns everything about the booking except availability. Throws 422 with the fields to fix.
function compute(l, data, addresses, { vatRate, now = new Date() }) {
  const form = formOf(l);
  const rule = B.RATE_RULES[l.priceUnit];
  const f = form.fields;
  const errors = [];
  const missing = (field, label) => errors.push({ field, message: `${label} is required for this service` });

  // dates
  const startDate = data.startDate;
  let endDate = f.endDate === 'no' ? startDate : data.endDate || (f.endDate === 'required' ? null : startDate);
  if (!startDate) missing('startDate', 'Start date');
  if (f.endDate === 'required' && !data.endDate) missing('endDate', 'End date');
  if (f.endDate === 'no' && data.endDate && data.endDate !== startDate) {
    errors.push({ field: 'endDate', message: 'This service is booked for one day: leave the end date empty' });
  }
  if (startDate && endDate && endDate < startDate) errors.push({ field: 'endDate', message: 'The end date must be on or after the start date' });
  // what else the form needs
  [
    ['pickupAddress', 'Pickup address', addresses.pickup],
    ['dropoffAddress', 'Drop-off address', addresses.dropoff],
    ['serviceAddress', 'Service address (where the service is needed)', addresses.service],
  ].forEach(([key, label, value]) => {
    if (f[key] === 'required' && !value) missing(key, label);
    if (f[key] === 'no' && value) errors.push({ field: key, message: `${label} is not needed for this service` });
  });
  [
    ['distanceKm', 'Distance (km)'],
    ['loadAmount', `Load (${form.loadUnitLabel || ''})`.replace(' ()', '')],
    ['spaceAmount', `Space (${form.spaceUnitLabel || ''})`.replace(' ()', '')],
    ['quantity', form.labels.quantity || 'Quantity'],
    ['hours', 'Number of hours'],
  ].forEach(([key, label]) => {
    if (f[key] === 'required' && (data[key] === undefined || data[key] === null)) missing(key, label);
  });
  if (errors.length) throw invalid(errors);
  if (!endDate) endDate = startDate;

  // date rules
  const days = B.daysBetween(startDate, endDate);
  if (days > R.maxDays) throw invalid([{ field: 'endDate', message: `A booking can be at most ${R.maxDays} days` }]);
  if (startDate > B.addDaysYmd(B.todayYmd(now), R.maxDaysAhead)) {
    throw invalid([{ field: 'startDate', message: `Bookings can start at most ${R.maxDaysAhead} days from today` }]);
  }
  const earliest = B.earliestStart(l, now);
  if (startDate < earliest) {
    throw fail(422, `The provider needs advance notice: the earliest start date is ${earliest}`, 'START_TOO_SOON', 'startDate');
  }

  // load against the vehicle's capacity
  const capacity = num(l.capacity);
  const load = data.loadAmount === undefined || data.loadAmount === null ? null : num(data.loadAmount);
  if (form.loadUnit && load !== null && capacity && l.capacityUnit === form.loadUnit && load > capacity) {
    throw fail(
      422,
      `This vehicle carries up to ${capacity} ${form.capacityUnitLabel}. Book a bigger vehicle or split the load into more bookings.`,
      'LOAD_OVER_CAPACITY',
      'loadAmount'
    );
  }
  const space = data.spaceAmount === undefined || data.spaceAmount === null ? null : num(data.spaceAmount);
  if (space !== null && capacity && space > capacity) {
    throw fail(422, `This storage holds up to ${capacity} ${form.capacityUnitLabel}`, 'SPACE_OVER_CAPACITY', 'spaceAmount');
  }

  // coverage: transport from / to a covered region; other services at a covered region
  const covered = (l.coverageRegionIds || []).map(Number);
  const inCoverage = (a) => a && a.region && covered.includes(Number(a.region.id));
  if (covered.length) {
    if (rule.type === 'transport' && !inCoverage(addresses.pickup) && !inCoverage(addresses.dropoff)) {
      throw fail(422, 'The provider does not cover the pickup or drop-off region', 'OUTSIDE_COVERAGE', 'pickupAddress');
    }
    if (addresses.service && !inCoverage(addresses.service)) {
      throw fail(422, 'The provider does not cover the region of the service address', 'OUTSIDE_COVERAGE', 'serviceAddress');
    }
  }

  // the factors: what the buyer entered, then the minimum booking
  const tons = form.loadUnit === 'kg' ? round2((load || 0) / 1000) : load;
  const entered = {
    distanceKm: num(data.distanceKm),
    tons,
    quantity: num(data.quantity),
    hours: num(data.hours),
    days,
    weeks: Math.ceil(days / 7),
    months: Math.ceil(days / 30),
    space,
  };
  const units = { distanceKm: 'km', tons: 'ton', quantity: rule.billUnit, hours: 'hour', days: 'day', weeks: 'week', months: 'month', space: rule.spaceUnit };
  const billed = Object.fromEntries(rule.factors.map((k) => [k, entered[k]]));

  let minimumApplied = false;
  let minimumNote = null;
  const minAmount = num(l.minBooking);
  if (minAmount && l.minBookingUnit) {
    const unit = l.minBookingUnit;
    let target = unit === l.priceUnit && rule.factors.length === 1 ? rule.factors[0] : B.MIN_BOOKING_FACTOR[unit];
    if (target === 'tons' && !rule.factors.includes('tons') && l.priceUnit === 'ton') target = 'quantity';
    let minimum = null;
    if (target === 'time') {
      const timeKey = rule.factors.find((k) => ['days', 'weeks', 'months'].includes(k));
      if (timeKey) {
        const minDays = minAmount * B.DAYS_PER[unit];
        minimum = timeKey === 'days' ? minDays : Math.ceil(minDays / B.DAYS_PER[units[timeKey]]);
        target = timeKey;
      }
    } else if (target && rule.factors.includes(target)) minimum = minAmount;
    if (minimum !== null && rule.factors.includes(target)) {
      if (billed[target] < minimum) {
        billed[target] = minimum;
        minimumApplied = true;
      }
      minimumNote = `Minimum booking: ${minAmount} ${MIN_BOOKING_UNITS[unit] || unit}`;
    } else {
      minimumNote = `Minimum booking: ${minAmount} ${MIN_BOOKING_UNITS[unit] || unit} (agreed with the provider)`;
    }
  }

  const breakdown = rule.factors.map((k) => ({
    key: k,
    label: k === 'space' ? `Space (${B.SPACE_UNIT_LABELS[rule.spaceUnit]})` : B.FACTOR_LABELS[k],
    entered: entered[k],
    billed: billed[k],
    unit: units[k],
  }));
  const billableQuantity = round2(rule.factors.reduce((p, k) => p * billed[k], 1));
  if (!(billableQuantity > 0)) throw invalid([{ field: rule.factors[0], message: 'The booking must be more than zero' }]);

  const rate = num(l.price);
  const subtotal = round2(rate * billableQuantity);
  const isVatApplicable = listingIsVat(l.category, l.subCategory);
  const vatAmount = isVatApplicable ? round2((subtotal * vatRate) / 100) : 0;
  const total = round2(subtotal + vatAmount);

  return {
    form,
    bookingType: rule.type,
    startDate,
    endDate,
    startTime: data.startTime || null,
    days,
    inputs: {
      distanceKm: entered.distanceKm,
      loadAmount: load,
      loadUnit: form.loadUnit,
      spaceAmount: space,
      spaceUnit: rule.spaceUnit || null,
      quantity: entered.quantity,
      hours: entered.hours,
    },
    breakdown,
    billableQuantity,
    billUnit: rule.billUnit,
    minimumApplied,
    minimumNote,
    rate,
    subtotal,
    isVatApplicable,
    vatRate: num(vatRate),
    vatAmount,
    total,
    addresses,
    labels: {
      rate: `${money(rate)} ${SERVICE_RATE_UNITS[l.priceUnit]}`,
      calculation: `${breakdown.map((b) => `${b.billed} ${b.unit}`).join(' x ')} x ${money(rate)} = ${money(subtotal)}`,
      subtotal: money(subtotal),
      vatTitle: `VAT (${num(vatRate)}%)`,
      vat: money(vatAmount),
      total: money(total),
    },
  };
}

// ---------- availability ----------
// Bookings of this service that still hold their dates (not cancelled, checkout not expired)
async function holdingBookings(listingId, from, to, { transaction } = {}) {
  const rows = await Booking.findAll({
    where: { listingId, startDate: { [Op.lte]: to }, endDate: { [Op.gte]: from } },
    attributes: ['id', 'orderId', 'sellerOrderId', 'startDate', 'endDate', 'spaceAmount'],
    transaction,
  });
  if (!rows.length) return [];
  const [sos, orders] = await Promise.all([
    SellerOrder.findAll({ where: { id: rows.map((r) => r.sellerOrderId), status: { [Op.in]: B.HOLDING_STATUSES } }, attributes: ['id'], transaction }),
    Order.findAll({ where: { id: rows.map((r) => r.orderId), status: { [Op.in]: B.HOLDING_ORDER_STATUSES } }, attributes: ['id'], transaction }),
  ]);
  const soOk = new Set(sos.map((s) => s.id));
  const orderOk = new Set(orders.map((o) => o.id));
  return rows.filter((r) => soOk.has(r.sellerOrderId) && orderOk.has(r.orderId));
}

// One row per day: units booked / left, or space used / left (storage with a capacity)
function calendarDays(l, from, to, holding) {
  const rule = B.RATE_RULES[l.priceUnit];
  const bySpace = rule && rule.type === 'storage' && num(l.capacity) > 0;
  const capacity = num(l.capacity);
  const units = l.unitsAvailable || 1;
  const out = [];
  for (let d = from; d <= to; d = B.addDaysYmd(d, 1)) {
    const on = holding.filter((b) => b.startDate <= d && b.endDate >= d);
    if (bySpace) {
      const used = round2(on.reduce((s, b) => s + num(b.spaceAmount || 0), 0));
      out.push({ date: d, bookings: on.length, spaceUsed: used, spaceLeft: round2(Math.max(0, capacity - used)), free: used < capacity });
    } else {
      out.push({ date: d, bookings: on.length, unitsLeft: Math.max(0, units - on.length), free: on.length < units });
    }
  }
  return { bySpace, days: out };
}

async function assertAvailable(l, c, { transaction } = {}) {
  const holding = await holdingBookings(l.id, c.startDate, c.endDate, { transaction });
  const { bySpace, days } = calendarDays(l, c.startDate, c.endDate, holding);
  if (bySpace) {
    const short = days.filter((d) => d.spaceLeft < c.inputs.spaceAmount);
    if (short.length) {
      const least = Math.min(...short.map((d) => d.spaceLeft));
      throw new ApiError(409, `Not enough space on these dates: only ${least} ${c.form.spaceUnitLabel} free on ${short[0].date}`, {
        code: 'SPACE_NOT_AVAILABLE',
        errors: [{ field: 'spaceAmount', message: `Not enough free space on: ${short.map((d) => d.date).join(', ')}` }],
      });
    }
    return;
  }
  const full = days.filter((d) => !d.free).map((d) => d.date);
  if (full.length) {
    throw new ApiError(409, `This service is already booked on ${full.slice(0, 5).join(', ')}${full.length > 5 ? '...' : ''}. Please choose other dates.`, {
      code: 'NOT_AVAILABLE_ON_DATES',
      errors: [{ field: 'startDate', message: `Already booked on: ${full.join(', ')}` }],
    });
  }
}

// ======================= PUBLIC =======================

// GET /listings/:id/booking-form?from=&to=
async function bookingForm(listingId, query = {}) {
  const l = await loadService(listingId);
  const today = B.todayYmd();
  const from = query.from && query.from > today ? query.from : today;
  let to = query.to || B.addDaysYmd(from, R.calendarDefaultDays - 1);
  if (to < from) to = from;
  if (B.daysBetween(from, to) > R.calendarMaxDays) to = B.addDaysYmd(from, R.calendarMaxDays - 1);
  const [holding, dirs] = await Promise.all([holdingBookings(l.id, from, to), directory.findMany([l.userId])]);
  const reason = unavailableReason(l);
  const listing = baseShape(l);
  return {
    listing: {
      id: listing.id,
      name: listing.name,
      coverPhotoUrl: listing.coverPhotoUrl || null,
      category: listing.category || null,
      rate: num(l.price),
      rateLabel: `${money(l.price)} ${SERVICE_RATE_UNITS[l.priceUnit]}`,
      isVatApplicable: listingIsVat(l.category, l.subCategory),
      availability: l.availability,
      availabilityLabel: SERVICE_AVAILABILITY[l.availability] || l.availability,
    },
    provider: sellerShape(l.userId, dirs.get(l.userId)),
    bookable: !reason,
    reasonNotBookable: reason,
    earliestStartDate: B.earliestStart(l),
    latestStartDate: B.addDaysYmd(today, R.maxDaysAhead),
    maxDays: R.maxDays,
    ...formOf(l),
    calendar: { from, to, ...calendarDays(l, from, to, holding) },
    cancellationRule: `Free cancellation (full refund) until ${R.freeCancelHours} hours before the start. After that, the provider must agree.`,
    afterServiceRule: `When the provider marks the service as done, confirm it or report a problem within ${R.claimWindowHours / 24} days.`,
  };
}

// ======================= BUYER =======================

// POST /me/bookings/quote   (same body as booking, nothing is saved)
async function quote(user, data) {
  const l = await loadService(data.listingId);
  const addresses = await resolveAddresses(user, data);
  const c = compute(l, data, addresses, { vatRate: await settings.get('vat_rate') });
  const reason = unavailableReason(l);
  let available = !reason;
  let availabilityProblem = reason;
  if (available) {
    try {
      await assertAvailable(l, c);
    } catch (err) {
      if (!['NOT_AVAILABLE_ON_DATES', 'SPACE_NOT_AVAILABLE'].includes(err.code)) throw err;
      available = false;
      availabilityProblem = err.message;
    }
  }
  const { form, addresses: a, ...rest } = c;
  return {
    listingId: l.id,
    ...rest,
    pickupAddress: a.pickup,
    dropoffAddress: a.dropoff,
    serviceAddress: a.service,
    available,
    availabilityProblem,
    canBook: available,
  };
}

// POST /me/bookings   header Idempotency-Key (recommended)
//   { listingId, startDate, endDate?, startTime?, distanceKm?, loadAmount?, spaceAmount?, quantity?, hours?,
//     pickupAddress?, dropoffAddress?, serviceAddress?, note?, paymentMethod, acceptTerms: true, expectedTotal? }
// Returns { orderId, bookingId, created }
async function place(user, data, { idempotencyKey = null } = {}) {
  await assertMethodAvailable(data.paymentMethod);
  const addresses = await resolveAddresses(user, data);
  const vatRate = await settings.get('vat_rate');

  return sequelize.transaction(async (transaction) => {
    // One checkout at a time per buyer
    await User.findByPk(user.id, { transaction, lock: transaction.LOCK.UPDATE });
    if (idempotencyKey) {
      const existing = await Order.findOne({ where: { userId: user.id, idempotencyKey }, transaction });
      if (existing) {
        const b = await Booking.findOne({ where: { orderId: existing.id }, attributes: ['id'], transaction });
        return { orderId: existing.id, bookingId: b ? b.id : null, created: false };
      }
    }

    // Lock the service: bookings of the same service go one at a time
    const l = await loadService(data.listingId, { transaction, lock: true });
    if (l.userId === user.id) throw fail(409, 'You cannot book your own service', 'OWN_SERVICE');
    const reason = unavailableReason(l);
    if (reason) throw fail(409, `${reason}. Please try again later.`, 'SERVICE_UNAVAILABLE');

    const c = compute(l, data, addresses, { vatRate });
    if (data.expectedTotal !== undefined && round2(data.expectedTotal) !== c.total) {
      throw new ApiError(409, `The booking total changed to ${c.labels.total}. Please check it again.`, {
        code: 'TOTAL_CHANGED',
        errors: [{ field: 'expectedTotal', message: `New total: ${c.labels.total}` }],
      });
    }
    await assertAvailable(l, c, { transaction });

    // The order (kind "booking"): one seller order, one line
    const now = new Date();
    const order = await Order.create(
      {
        userId: user.id,
        kind: 'booking',
        paymentMethod: data.paymentMethod,
        paymentDeadline: await deadlineFor(data.paymentMethod, now),
        deliveryAddress: null,
        subtotal: c.subtotal,
        deliveryTotal: 0,
        vatTotal: c.vatAmount,
        total: c.total,
        vatRate: c.vatRate,
        idempotencyKey,
        termsAcceptedAt: now,
      },
      { transaction }
    );
    const number = orderNumber(order.id);
    await order.update({ orderNumber: number }, { transaction });

    const so = await SellerOrder.create(
      {
        orderId: order.id,
        sellerId: l.userId,
        sellerOrderNumber: sellerOrderNumber(number, 1),
        fulfilment: 'service',
        subtotal: c.subtotal,
        deliveryFee: 0,
        deliveryVat: 0,
        vatTotal: c.vatAmount,
        total: c.total,
        payoutAmount: c.total,
        buyerNote: data.note || null,
        sellerVatRegistered: Boolean(l.seller && l.seller.vatStatus === VAT_STATUS.APPROVED),
      },
      { transaction }
    );
    const shaped = baseShape(l);
    const item = await OrderItem.create(
      {
        orderId: order.id,
        sellerOrderId: so.id,
        listingId: l.id,
        name: l.name,
        photoUrl: shaped.coverPhotoUrl || null,
        categoryName: l.category ? l.category.name : null,
        subCategoryName: l.subCategory ? l.subCategory.name : null,
        unit: c.billUnit,
        unitLabel: c.billUnit,
        unitPrice: c.rate,
        quantity: c.billableQuantity,
        lineTotal: c.subtotal,
        isVatApplicable: c.isVatApplicable,
        vatAmount: c.vatAmount,
        refundPolicy: B.BOOKING_REFUND_POLICY,
        nonReturnable: false,
        pickupLocation: null,
      },
      { transaction }
    );
    const booking = await Booking.create(
      {
        orderId: order.id,
        sellerOrderId: so.id,
        orderItemId: item.id,
        listingId: l.id,
        buyerId: user.id,
        providerId: l.userId,
        bookingType: c.bookingType,
        rate: c.rate,
        rateUnit: l.priceUnit,
        startDate: c.startDate,
        endDate: c.endDate,
        startTime: c.startTime,
        distanceKm: c.inputs.distanceKm,
        loadAmount: c.inputs.loadAmount,
        loadUnit: c.inputs.loadAmount === null ? null : c.inputs.loadUnit,
        spaceAmount: c.inputs.spaceAmount,
        spaceUnit: c.inputs.spaceAmount === null ? null : c.inputs.spaceUnit,
        quantity: c.inputs.quantity,
        hours: c.inputs.hours,
        breakdown: c.breakdown,
        billableQuantity: c.billableQuantity,
        minimumApplied: c.minimumApplied,
        pickupAddress: addresses.pickup,
        dropoffAddress: addresses.dropoff,
        serviceAddress: addresses.service,
      },
      { transaction }
    );
    await booking.update({ bookingNumber: B.bookingNumber(booking.id) }, { transaction });

    await recordHistory(
      {
        orderId: order.id,
        to: 'placed',
        actor: { type: 'buyer', id: user.id },
        note: `Service booking ${B.bookingNumber(booking.id)}. Payment method: ${PAYMENT_METHODS[data.paymentMethod]}`,
      },
      transaction
    );
    return { orderId: order.id, bookingId: booking.id, created: true };
  });
}

// GET /me/bookings   (My Bookings: same filters as My Orders)
function listMine(user, query = {}) {
  return orderService.listMine(user, { ...query, kind: 'booking' });
}

async function findMine(user, id, { transaction } = {}) {
  const b = await Booking.findOne({ where: { id, buyerId: user.id }, transaction });
  if (!b) throw bookingNotFound();
  return b;
}

// GET /me/bookings/:id   the booking + its order (payment, status, timeline, invoice, claims...)
async function getMine(user, id) {
  const b = await findMine(user, id);
  const order = await orderService.getMine(user, b.orderId);
  const so = order.sellerOrders.find((x) => x.id === b.sellerOrderId) || order.sellerOrders[0];
  return {
    bookingId: b.id,
    bookingNumber: b.bookingNumber,
    orderId: order.id,
    sellerOrderId: b.sellerOrderId,
    booking: so ? so.booking : bookingShape(b),
    provider: so ? so.seller : null,
    status: so ? so.status : null,
    statusLabel: so ? so.statusLabel : null,
    actions: so ? so.actions : {},
    order,
  };
}

// POST /me/bookings/:id/confirm-done   "Service Done" -> Completed, payout released
async function confirmDone(user, id) {
  const sellerOrderId = await sequelize.transaction(async (transaction) => {
    const b = await findMine(user, id, { transaction });
    const so = await SellerOrder.findOne({ where: { id: b.sellerOrderId }, transaction, lock: transaction.LOCK.UPDATE });
    if (!so) throw bookingNotFound();
    if (so.status !== SELLER_ORDER_STATUS.DELIVERED) {
      throw fail(409, 'You can confirm once the provider marks the service as done', 'INVALID_STATUS_CHANGE');
    }
    if (so.claimStatus === 'active') {
      throw fail(409, 'There is an open claim on this booking. It completes when the claim is settled.', 'CLAIM_ACTIVE');
    }
    if (so.payoutStatus === 'held') await so.update({ payoutStatus: 'released' }, { transaction });
    await applyStatus(so, SELLER_ORDER_STATUS.COMPLETED, { type: 'buyer', id: user.id }, { note: 'Service confirmed by the buyer' }, transaction);
    return so.id;
  });
  orderNotify.sellerOrderStatusChanged(sellerOrderId);
  reviews.requestReview(sellerOrderId); // "How was the service?"
  return getMine(user, id);
}

module.exports = {
  bookingForm,
  quote,
  place,
  listMine,
  getMine,
  confirmDone,
  // for tests / other modules
  formOf,
  compute,
  holdingBookings,
  calendarDays,
  isBookable,
};
