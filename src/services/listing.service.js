// SELLER side of marketplace listings (/me/listings) + the shared "listing -> API" shapes.
//
// Who: farmers and traders list PRODUCTS, logistics providers list SERVICES (one kind per user type).
// Only APPROVED accounts can use these APIs (checked in the routes).
//
// Life of a listing
//   "Save as Draft"   -> draft
//   "Publish Listing" -> pending   (the admin must approve it; NOT on the website yet)
//   admin approves    -> active    (on the website)
//   admin rejects     -> rejected  (seller edits and sends it again)
//   admin flags       -> flagged   (hidden; seller edits and sends it again)
//   admin disables    -> disabled  (hidden; only the admin can enable it)
//   seller pauses     -> paused    (hidden; seller can show it again WITHOUT a new review)
//
// Editing an active / paused listing sends it back to review, EXCEPT inventory changes
// (quantity, availability, available date) - see PATCH /me/listings/:id/inventory.
//
// VAT: a listing in a VAT-applicable category (or sub-category) can only be saved / sent for
// review by a seller whose VAT registration is approved (code VAT_REGISTRATION_REQUIRED).
// Delivery: deliveryType pickup | delivery | both. When the SELLER delivers, they set a fee per
// region (deliveryFees). A region not in the list = no delivery there. Pickup is always free.
const path = require('path');
const fs = require('fs/promises');
const { Op } = require('sequelize');
const config = require('../config');
const models = require('../models');
const ApiError = require('../utils/ApiError');
const { getPagination, paginationMeta } = require('../utils/pagination');
const { fileMatchesKind, kindForMimeType, formatLabels } = require('../utils/fileTypes');
const {
  LISTING_KIND_BY_USER_TYPE,
  LISTING_STATUS,
  LISTING_STATUS_LABELS,
  CURRENCY,
  PRODUCT_UNITS,
  SERVICE_RATE_UNITS,
  CAPACITY_UNITS,
  MIN_BOOKING_UNITS,
  DURATION_UNITS,
  PRODUCT_AVAILABILITY,
  SERVICE_AVAILABILITY,
  DELIVERY_TYPES,
  LOGISTICS_BY,
  LISTING_PHOTOS,
} = require('../config/listingOptions');
const locationService = require('./location.service');
const vatHold = require('./vatHold.service');
const { VAT_STATUS } = require('../config/vat');

const { listingIsVat } = vatHold;

const { sequelize, Listing, ListingPhoto, Category, Location } = models;
const S = LISTING_STATUS;

// ---------- fields ----------
const COMMON_FIELDS = [
  'name', 'description', 'categoryId', 'subCategoryId', 'price', 'priceUnit', 'availability',
  'useRegisteredAddress', 'address', 'regionId', 'inkhundlaId', 'umphakatsiId',
];
const PRODUCT_FIELDS = [
  'brand', 'sku', 'quantity', 'quantityUnit', 'minOrderQuantity', 'minOrderUnit', 'availableFrom',
  'deliveryType', 'deliveryDuration', 'deliveryDurationUnit', 'logisticsBy', 'deliveryFees', 'nonReturnable',
];
const SERVICE_FIELDS = [
  'vehicleRegistration', 'makeModel', 'capacity', 'capacityUnit', 'minBooking', 'minBookingUnit',
  'advanceNotice', 'advanceNoticeUnit', 'coverageRegionIds',
];
const FIELDS_BY_KIND = {
  product: [...COMMON_FIELDS, ...PRODUCT_FIELDS],
  service: [...COMMON_FIELDS, ...SERVICE_FIELDS],
};
const NOT_CLEARABLE = ['name', 'useRegisteredAddress', 'nonReturnable'];
// Changing only these does NOT send an active listing back to review
const INVENTORY_FIELDS = ['quantity', 'availability', 'availableFrom'];
const LOCATION_FIELDS = ['address', 'regionId', 'inkhundlaId', 'umphakatsiId'];

// Allowed codes per kind: { field: { code: label } }
const CHOICES = {
  product: {
    priceUnit: PRODUCT_UNITS,
    quantityUnit: PRODUCT_UNITS,
    minOrderUnit: PRODUCT_UNITS,
    availability: PRODUCT_AVAILABILITY,
  },
  service: {
    priceUnit: SERVICE_RATE_UNITS,
    capacityUnit: CAPACITY_UNITS,
    minBookingUnit: MIN_BOOKING_UNITS,
    availability: SERVICE_AVAILABILITY,
  },
};
const DEFAULT_AVAILABILITY = { product: 'in_stock', service: 'available' };

const DECIMALS = ['price', 'quantity', 'minOrderQuantity', 'capacity', 'minBooking'];

const notFound = () => new ApiError(404, 'Listing not found', { code: 'LISTING_NOT_FOUND' });
const validationError = (errors, message = 'Validation failed') =>
  new ApiError(422, message, { code: 'VALIDATION_ERROR', errors });

const kindOf = (user) => {
  const kind = LISTING_KIND_BY_USER_TYPE[user.userType];
  if (!kind) {
    throw new ApiError(403, 'Only farmers, traders and logistics providers can create listings', {
      code: 'WRONG_USER_TYPE',
    });
  }
  return kind;
};

// ---------- API shapes ----------
const num = (v) => (v === null || v === undefined ? null : Number(v));
const photoUrl = (filePath) => `/uploads/${String(filePath).replace(/^public\//, '')}`;
const loc = (l) => (l ? { id: l.id, name: l.name } : null);
const cat = (c) => (c ? { id: c.id, name: c.name, slug: c.slug } : null);
const money = (v) => `${CURRENCY.symbol} ${Number(v).toFixed(2)}`;

// Does the seller deliver (and so charge a delivery fee)?
const sellerDelivers = (l) => (l.deliveryType === 'delivery' || l.deliveryType === 'both') && l.logisticsBy !== 'buyer';

function deliveryFeesShape(l) {
  if (!sellerDelivers(l)) return [];
  return (l.deliveryFees || []).map((d) => ({
    regionId: d.regionId,
    regionName: d.regionName || null,
    fee: Number(d.fee),
    feeLabel: Number(d.fee) === 0 ? 'Free delivery' : money(d.fee),
  }));
}

function priceLabel(listing) {
  if (listing.price === null || listing.price === undefined) return null;
  const amount = Number(listing.price).toFixed(2);
  const units = listing.kind === 'service' ? SERVICE_RATE_UNITS : PRODUCT_UNITS;
  const unit = units[listing.priceUnit];
  if (!unit) return `${CURRENCY.symbol} ${amount}`;
  return listing.kind === 'service' ? `${CURRENCY.symbol} ${amount} ${unit}` : `${CURRENCY.symbol} ${amount} / ${unit}`;
}

// Fields every screen needs (public, seller and admin)
function baseShape(listing) {
  const l = listing;
  const photos = (l.photos || [])
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
    .map((p) => ({ id: p.id, url: photoUrl(p.filePath), sortOrder: p.sortOrder }));
  const isProduct = l.kind === 'product';
  const choices = CHOICES[l.kind];
  const label = (field) => (l[field] && choices[field] ? choices[field][l[field]] || l[field] : null);

  return {
    id: l.id,
    kind: l.kind,
    name: l.name,
    description: l.description,
    category: cat(l.category),
    subCategory: cat(l.subCategory),
    coverPhotoUrl: photos.length ? photos[0].url : null,
    photos,
    price: num(l.price),
    priceUnit: l.priceUnit,
    priceUnitLabel: label('priceUnit'),
    priceLabel: priceLabel(l), // "E 5.20 / kg", "E 8.50 per km"
    currency: CURRENCY.code,
    isVatApplicable: listingIsVat(l.category, l.subCategory), // VAT is added at checkout
    availability: l.availability,
    availabilityLabel: label('availability'),
    ...(isProduct
      ? {
          brand: l.brand,
          sku: l.sku,
          quantity: num(l.quantity),
          quantityUnit: l.quantityUnit,
          quantityUnitLabel: label('quantityUnit'),
          minOrderQuantity: num(l.minOrderQuantity),
          minOrderUnit: l.minOrderUnit,
          minOrderUnitLabel: label('minOrderUnit'),
          availableFrom: l.availableFrom,
          deliveryType: l.deliveryType,
          deliveryTypeLabel: l.deliveryType ? DELIVERY_TYPES[l.deliveryType] : null,
          deliveryDuration: l.deliveryDuration,
          deliveryDurationUnit: l.deliveryDurationUnit,
          logisticsBy: l.logisticsBy,
          logisticsByLabel: l.logisticsBy ? LOGISTICS_BY[l.logisticsBy] : null,
          pickupAvailable: l.deliveryType === 'pickup' || l.deliveryType === 'both',
          deliveryAvailable: sellerDelivers(l) && (l.deliveryFees || []).length > 0,
          deliveryFees: deliveryFeesShape(l), // regions the seller delivers to + fee
          nonReturnable: Boolean(l.nonReturnable),
        }
      : {
          vehicleRegistration: l.vehicleRegistration,
          makeModel: l.makeModel,
          capacity: num(l.capacity),
          capacityUnit: l.capacityUnit,
          capacityUnitLabel: label('capacityUnit'),
          minBooking: num(l.minBooking),
          minBookingUnit: l.minBookingUnit,
          minBookingUnitLabel: label('minBookingUnit'),
          advanceNotice: l.advanceNotice,
          advanceNoticeUnit: l.advanceNoticeUnit,
          coverageRegionIds: l.coverageRegionIds || [],
        }),
    location: {
      useRegisteredAddress: l.useRegisteredAddress,
      address: l.address,
      region: loc(l.region),
      inkhundla: loc(l.inkhundla),
      umphakatsi: loc(l.umphakatsi),
    },
    publishedAt: l.publishedAt,
    updatedAt: l.updatedAt,
  };
}

// Seller's own view: also status, review messages and what is missing before sending for review
function toSeller(listing) {
  return {
    ...baseShape(listing),
    status: listing.status,
    statusLabel: LISTING_STATUS_LABELS[listing.status],
    statusReason: listing.statusReason, // why rejected / flagged / disabled
    vatHold: Boolean(listing.vatHold), // hidden from the website: needs VAT registration
    vatHoldAt: listing.vatHoldAt || null,
    submittedAt: listing.submittedAt,
    createdAt: listing.createdAt,
    missingForReview: missingForReview(listing, (listing.photos || []).length),
  };
}

// ---------- loading ----------
const listingInclude = () => [
  { model: Category, as: 'category', attributes: ['id', 'name', 'slug', 'parentId', 'appliesTo', 'isActive', 'vatApplicable', 'refundPolicy'] },
  { model: Category, as: 'subCategory', attributes: ['id', 'name', 'slug', 'parentId', 'isActive', 'vatApplicable'] },
  { model: Location, as: 'region', attributes: ['id', 'name'] },
  { model: Location, as: 'inkhundla', attributes: ['id', 'name'] },
  { model: Location, as: 'umphakatsi', attributes: ['id', 'name'] },
  { model: ListingPhoto, as: 'photos', attributes: ['id', 'filePath', 'sortOrder'] },
];

async function findOwn(user, id, { transaction } = {}) {
  const listing = await Listing.findOne({ where: { id, userId: user.id }, include: listingInclude(), transaction });
  if (!listing) throw notFound();
  return listing;
}

// ---------- checks ----------

// What must be filled in before "Publish Listing" -> [{ field, message }]
function missingForReview(l, photoCount) {
  const missing = [];
  const need = (field, message) => {
    const v = l[field];
    if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) missing.push({ field, message });
  };
  need('name', 'Name is required');
  need('description', 'Description is required');
  need('categoryId', 'Category is required');
  need('price', l.kind === 'service' ? 'Rate / price is required' : 'Price per unit is required');
  need('priceUnit', 'Price unit is required');
  need('availability', 'Availability is required');
  need('regionId', 'Location (Region) is required');
  if (!photoCount) missing.push({ field: 'photos', message: 'Add at least one photo' });

  if (l.kind === 'product') {
    need('quantity', 'Quantity available is required');
    need('quantityUnit', 'Quantity unit is required');
    need('deliveryType', 'Delivery type is required');
    if (l.availability === 'pre_order') need('availableFrom', 'Approx. available date is required for a pre-order');
    if (l.minOrderQuantity !== null && l.minOrderQuantity !== undefined) need('minOrderUnit', 'Minimum order unit is required');
    if (l.deliveryDuration !== null && l.deliveryDuration !== undefined) need('deliveryDurationUnit', 'Delivery duration unit is required');
    if (l.deliveryType === 'delivery' || l.deliveryType === 'both') need('logisticsBy', 'Choose who manages the logistics');
    if (sellerDelivers(l) && l.logisticsBy) need('deliveryFees', 'Add a delivery fee for at least one region');
  } else {
    need('coverageRegionIds', 'Coverage area is required');
    if (l.capacity !== null && l.capacity !== undefined) need('capacityUnit', 'Capacity unit is required');
    if (l.minBooking !== null && l.minBooking !== undefined) need('minBookingUnit', 'Minimum booking unit is required');
    if (l.advanceNotice !== null && l.advanceNotice !== undefined) need('advanceNoticeUnit', 'Advance booking notice unit is required');
  }
  return missing;
}

// Codes must come from the right list for this kind (e.g. "per km" is a service unit)
function checkChoices(kind, values) {
  const errors = [];
  Object.entries(CHOICES[kind]).forEach(([field, options]) => {
    const v = values[field];
    if (v !== undefined && v !== null && !options[v]) {
      errors.push({ field, message: `${field} must be one of: ${Object.keys(options).join(', ')}` });
    }
  });
  if (errors.length) throw validationError(errors);
}

// Fields of the other kind (e.g. "capacity" on a product) are a mistake -> clear message
function checkForeignFields(kind, rawBody) {
  const foreign = kind === 'product' ? SERVICE_FIELDS : PRODUCT_FIELDS;
  const errors = foreign
    .filter((f) => rawBody[f] !== undefined && rawBody[f] !== null && rawBody[f] !== '')
    .map((f) => ({ field: f, message: `${f} is not used for a ${kind} listing` }));
  if (errors.length) throw validationError(errors);
}

// Category must be an active MAIN category of the right tab; sub-category must belong to it.
// Returns { category, subCategory } (empty when no category is chosen).
async function checkCategory(kind, categoryId, subCategoryId) {
  if (!categoryId) {
    if (subCategoryId) throw validationError([{ field: 'categoryId', message: 'Choose a category first' }]);
    return {};
  }
  const category = await Category.findOne({ where: { id: categoryId, parentId: null, isActive: true } });
  if (!category || !(category.appliesTo === kind || category.appliesTo === 'both')) {
    throw validationError([{ field: 'categoryId', message: `Choose an active ${kind} category` }]);
  }
  let sub = null;
  if (subCategoryId) {
    sub = await Category.findOne({ where: { id: subCategoryId, parentId: category.id, isActive: true } });
    if (!sub) {
      throw validationError([{ field: 'subCategoryId', message: `This sub-category does not belong to ${category.name}` }]);
    }
  }
  return { category, subCategory: sub };
}

// Only a VAT-approved seller may use a VAT-applicable category / sub-category
const vatRequiredError = (field, name) =>
  new ApiError(422, `${name} is VAT-applicable. Only VAT-registered sellers can list it.`, {
    code: 'VAT_REGISTRATION_REQUIRED',
    errors: [{ field, message: 'Get your VAT registration approved first (Profile -> VAT registration)' }],
  });

function assertVatAllowed(user, category, subCategory) {
  if (!category || user.vatStatus === VAT_STATUS.APPROVED) return;
  if (listingIsVat(category, subCategory)) {
    const vatOn = subCategory && subCategory.vatApplicable === true ? subCategory : category;
    throw vatRequiredError(vatOn === subCategory ? 'subCategoryId' : 'categoryId', vatOn.name);
  }
}

// Delivery fees: one fee per region, regions must exist. Returns the list to save.
async function cleanDeliveryFees(fees) {
  if (!fees || !fees.length) return null;
  const seen = new Set();
  const errors = [];
  fees.forEach((f, i) => {
    if (seen.has(f.regionId)) errors.push({ field: `deliveryFees[${i}].regionId`, message: 'Each region can only be listed once' });
    seen.add(f.regionId);
  });
  if (errors.length) throw validationError(errors);
  const ids = [...seen];
  await locationService.assertRegions(ids, 'deliveryFees');
  const regions = await Location.findAll({ where: { id: ids }, attributes: ['id', 'name'] });
  const nameOf = new Map(regions.map((r) => [r.id, r.name]));
  return fees
    .map((f) => ({ regionId: f.regionId, regionName: nameOf.get(f.regionId) || null, fee: Math.round(Number(f.fee) * 100) / 100 }))
    .sort((a, b) => a.regionId - b.regionId);
}

// The seller's registered address (farmers: farm location if filled in, else home address)
async function registeredLocation(user) {
  if (user.userType === 'farmer') {
    const p = await models.FarmerProfile.findOne({ where: { userId: user.id } });
    if (!p) return {};
    if (p.farmRegionId) {
      return { address: p.farmAddress || null, regionId: p.farmRegionId, inkhundlaId: p.farmInkhundlaId, umphakatsiId: p.farmUmphakatsiId };
    }
    return { address: p.residentAddress, regionId: p.regionId, inkhundlaId: p.inkhundlaId, umphakatsiId: p.umphakatsiId };
  }
  const Model = user.userType === 'trader' ? models.TraderProfile : models.LogisticsProfile;
  const p = await Model.findOne({ where: { userId: user.id } });
  if (!p) return {};
  return { address: p.businessAddress, regionId: p.regionId, inkhundlaId: p.inkhundlaId, umphakatsiId: p.umphakatsiId };
}

// Validated body + raw body -> values to save (all checks done)
async function buildValues(user, kind, data, rawBody, current = null) {
  checkForeignFields(kind, rawBody);
  const values = {};
  FIELDS_BY_KIND[kind].forEach((f) => {
    if (data[f] !== undefined) values[f] = data[f];
    else if (!NOT_CLEARABLE.includes(f) && (rawBody[f] === null || rawBody[f] === '')) values[f] = null;
  });
  checkChoices(kind, values);

  const pick = (f) => (values[f] !== undefined ? values[f] : current ? current[f] : undefined);

  // Category / sub-category (checked when either changes)
  if (values.categoryId !== undefined || values.subCategoryId !== undefined) {
    // Changing the category without a sub-category clears the old sub-category
    if (
      values.categoryId !== undefined &&
      values.subCategoryId === undefined &&
      current &&
      current.subCategoryId &&
      values.categoryId !== current.categoryId
    ) {
      values.subCategoryId = null;
    }
    const { category, subCategory } = await checkCategory(kind, pick('categoryId'), pick('subCategoryId'));
    assertVatAllowed(user, category, subCategory);
  }

  // Delivery fees (products): only when the seller delivers
  if (kind === 'product') {
    if (values.deliveryFees !== undefined) values.deliveryFees = await cleanDeliveryFees(values.deliveryFees);
    const final = { deliveryType: pick('deliveryType'), logisticsBy: pick('logisticsBy') };
    if (!sellerDelivers(final)) {
      const sentFees = Array.isArray(rawBody.deliveryFees) && rawBody.deliveryFees.length > 0;
      if (sentFees && final.deliveryType) {
        throw validationError([
          {
            field: 'deliveryFees',
            message:
              final.deliveryType === 'pickup'
                ? 'Delivery fees are not used for a pickup-only listing'
                : 'Delivery fees are not used when the buyer arranges transport',
          },
        ]);
      }
      if (final.deliveryType && (current ? current.deliveryFees : values.deliveryFees)) values.deliveryFees = null;
    }
    if (values.nonReturnable === null) delete values.nonReturnable;
  }

  // Pre-order: keep the date only for pre-orders
  if (kind === 'product' && values.availability && values.availability !== 'pre_order') values.availableFrom = null;

  // Location
  //   ticked "Same as my registered address" -> copy the registered address (refreshed on every save;
  //                                             location fields sent with it are ignored)
  //   not ticked -> use the sent address / Region -> Inkhundla -> Umphakatsi (chain checked)
  const useRegistered =
    values.useRegisteredAddress !== undefined ? values.useRegisteredAddress : current ? current.useRegisteredAddress : true;
  values.useRegisteredAddress = useRegistered;
  if (useRegistered) {
    Object.assign(values, await registeredLocation(user));
  } else if (LOCATION_FIELDS.some((f) => values[f] !== undefined)) {
    await locationService.assertValidChain(
      { region: pick('regionId'), inkhundla: pick('inkhundlaId'), umphakatsi: pick('umphakatsiId') },
      { region: 'regionId', inkhundla: 'inkhundlaId', umphakatsi: 'umphakatsiId' }
    );
  }

  // Coverage regions (service)
  if (Array.isArray(values.coverageRegionIds)) {
    values.coverageRegionIds = [...new Set(values.coverageRegionIds)];
    await locationService.assertRegions(values.coverageRegionIds, 'coverageRegionIds');
  }
  return values;
}

// ---------- GET /me/listings ----------
async function listMine(user, query) {
  kindOf(user);
  const pg = getPagination(query);
  const where = { userId: user.id };
  if (query.status) where.status = query.status;
  if (query.search) where.name = { [Op.like]: `%${query.search}%` };

  const { rows, count } = await Listing.findAndCountAll({
    where,
    include: listingInclude(),
    order: [['updatedAt', 'DESC'], ['id', 'DESC']],
    limit: pg.limit,
    offset: pg.offset,
    distinct: true,
  });

  // Counts for the status tabs
  const grouped = await Listing.findAll({
    where: { userId: user.id },
    attributes: ['status', [sequelize.fn('COUNT', sequelize.col('id')), 'total']],
    group: ['status'],
    raw: true,
  });
  const counts = Object.fromEntries(Object.values(S).map((s) => [s, 0]));
  grouped.forEach((g) => {
    counts[g.status] = Number(g.total);
  });

  return { items: rows.map(toSeller), counts, pagination: paginationMeta(pg, count) };
}

// ---------- GET /me/listings/:id ----------
async function getMine(user, id) {
  kindOf(user);
  return toSeller(await findOwn(user, id));
}

// Send for admin review (status -> pending). Throws 422 listing what is missing,
// or VAT_REGISTRATION_REQUIRED (the seller's VAT status may have changed since saving).
async function sendForReview(user, listing, transaction) {
  const photoCount = await ListingPhoto.count({ where: { listingId: listing.id }, transaction });
  const missing = missingForReview(listing, photoCount);
  if (missing.length) {
    throw validationError(missing, 'Please complete the listing before publishing it');
  }
  if (listing.categoryId) {
    const category = await Category.findByPk(listing.categoryId, { transaction });
    const sub = listing.subCategoryId ? await Category.findByPk(listing.subCategoryId, { transaction }) : null;
    assertVatAllowed(user, category, sub);
  }
  await listing.update(
    { status: S.PENDING, submittedAt: new Date(), statusReason: null },
    { transaction }
  );
}

// ---------- POST /me/listings ----------
async function create(user, data, rawBody = {}) {
  const kind = kindOf(user);
  const values = await buildValues(user, kind, data, rawBody, null);
  if (values.availability === undefined || values.availability === null) values.availability = DEFAULT_AVAILABILITY[kind];

  const listing = await Listing.create({ ...values, userId: user.id, kind, status: S.DRAFT, currency: CURRENCY.code });
  // A new listing has no photos yet, so "Publish" is only possible after uploading them.
  let submitError = null;
  if (data.submit === true) {
    try {
      await sendForReview(user, listing);
    } catch (err) {
      if (err.code !== 'VALIDATION_ERROR') throw err;
      submitError = err;
    }
  }
  const fresh = await findOwn(user, listing.id);
  return { listing: toSeller(fresh), sentForReview: fresh.status === S.PENDING, submitErrors: submitError ? submitError.errors : [] };
}

// ---------- PUT /me/listings/:id ----------
async function update(user, id, data, rawBody = {}) {
  const kind = kindOf(user);
  return sequelize.transaction(async (transaction) => {
    const listing = await findOwn(user, id, { transaction });
    if (listing.status === S.DISABLED) {
      throw new ApiError(409, 'This listing was disabled by the AFA admin and cannot be edited.', { code: 'LISTING_DISABLED' });
    }
    const values = await buildValues(user, kind, data, rawBody, listing);

    // Which fields really change?
    const changed = Object.keys(values).filter((f) => {
      const a = values[f];
      const b = listing[f];
      if (DECIMALS.includes(f)) return num(a) !== num(b);
      return JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);
    });
    const contentChanged = changed.some((f) => !INVENTORY_FIELDS.includes(f));

    await listing.update(values, { transaction });

    let reReview = false;
    if (data.submit === true && [S.DRAFT, S.REJECTED, S.FLAGGED].includes(listing.status)) {
      await sendForReview(user, listing, transaction);
    } else if (contentChanged && [S.ACTIVE, S.PAUSED].includes(listing.status)) {
      await sendForReview(user, listing, transaction); // a changed live listing is checked again
      reReview = true;
    }
    // A new category may end (or start) a VAT hold
    if (changed.includes('categoryId') || changed.includes('subCategoryId')) {
      await vatHold.forListing(listing.id, { transaction });
    }
    return { listing: toSeller(await findOwn(user, id, { transaction })), reReview };
  });
}

// ---------- POST /me/listings/:id/submit ----------
async function submit(user, id) {
  kindOf(user);
  return sequelize.transaction(async (transaction) => {
    const listing = await findOwn(user, id, { transaction });
    if (listing.status === S.PENDING) {
      throw new ApiError(409, 'This listing is already waiting for review', { code: 'ALREADY_PENDING' });
    }
    if (![S.DRAFT, S.REJECTED, S.FLAGGED].includes(listing.status)) {
      throw new ApiError(409, `A listing that is "${LISTING_STATUS_LABELS[listing.status]}" can't be sent for review`, {
        code: 'INVALID_STATUS_CHANGE',
      });
    }
    await sendForReview(user, listing, transaction);
    return toSeller(await findOwn(user, id, { transaction }));
  });
}

// ---------- PATCH /me/listings/:id/inventory ----------
// Stock / availability only: no new review (Figma "Inventory management by seller").
async function updateInventory(user, id, data) {
  const kind = kindOf(user);
  return sequelize.transaction(async (transaction) => {
    const listing = await findOwn(user, id, { transaction });
    if (listing.status === S.DISABLED) {
      throw new ApiError(409, 'This listing was disabled by the AFA admin and cannot be edited.', { code: 'LISTING_DISABLED' });
    }
    const values = {};
    if (data.availability !== undefined) values.availability = data.availability;
    if (kind === 'product') {
      if (data.quantity !== undefined) values.quantity = data.quantity;
      if (data.availableFrom !== undefined) values.availableFrom = data.availableFrom;
    } else if (data.quantity !== undefined || data.availableFrom !== undefined) {
      throw validationError([{ field: 'quantity', message: 'Services only have an availability status' }]);
    }
    checkChoices(kind, values);

    const finalAvailability = values.availability || listing.availability;
    if (kind === 'product') {
      if (finalAvailability === 'pre_order' && !(values.availableFrom || listing.availableFrom)) {
        throw validationError([{ field: 'availableFrom', message: 'Approx. available date is required for a pre-order' }]);
      }
      if (finalAvailability !== 'pre_order') values.availableFrom = null;
    }
    await listing.update(values, { transaction });
    return toSeller(await findOwn(user, id, { transaction }));
  });
}

// ---------- PATCH /me/listings/:id/visibility ----------
async function setVisibility(user, id, { visible }) {
  kindOf(user);
  const listing = await findOwn(user, id);
  const target = visible ? S.ACTIVE : S.PAUSED;
  if (listing.status !== target) {
    // Only active <-> paused (an approved listing); anything else needs the admin
    const from = visible ? S.PAUSED : S.ACTIVE;
    if (listing.status !== from) {
      throw new ApiError(
        409,
        visible ? 'Only a paused listing can be shown again' : 'Only an active listing can be paused',
        { code: 'INVALID_STATUS_CHANGE' }
      );
    }
    await listing.update({ status: target });
  }
  return toSeller(await findOwn(user, id));
}

// ---------- DELETE /me/listings/:id   (soft delete) ----------
async function remove(user, id) {
  kindOf(user);
  const listing = await findOwn(user, id);
  await listing.destroy(); // paranoid -> sets deleted_at; photos are kept for the record
  return { id: listing.id, name: listing.name };
}

// ======================= PHOTOS =======================
const uploadRoot = () => path.resolve(config.upload.dir);
const removeFiles = (files = []) => Promise.all(files.map((f) => fs.unlink(f.path).catch(() => {})));

// POST /me/listings/:id/photos  (form-data "photos", 1-5 files)
async function addPhotos(user, id, files) {
  try {
    kindOf(user);
    const listing = await findOwn(user, id);
    if (listing.status === S.DISABLED) {
      throw new ApiError(409, 'This listing was disabled by the AFA admin and cannot be edited.', { code: 'LISTING_DISABLED' });
    }
    const existing = await ListingPhoto.count({ where: { listingId: listing.id } });
    if (existing + files.length > LISTING_PHOTOS.max) {
      throw new ApiError(409, `A listing can have at most ${LISTING_PHOTOS.max} photos (it has ${existing}).`, {
        code: 'LIMIT_REACHED',
      });
    }
    // Real file content must be a JPG / PNG
    for (const file of files) {
      const kind = kindForMimeType(file.mimetype, LISTING_PHOTOS.formats);
      // eslint-disable-next-line no-await-in-loop
      if (!kind || !(await fileMatchesKind(file.path, kind))) {
        throw new ApiError(415, `"${file.originalname}" is not a valid image. Allowed: ${formatLabels(LISTING_PHOTOS.formats)}`, {
          code: 'INVALID_FILE_CONTENT',
        });
      }
    }

    const maxOrder = await ListingPhoto.max('sortOrder', { where: { listingId: listing.id } });
    let next = Number.isFinite(maxOrder) ? maxOrder + 1 : 0;
    await sequelize.transaction(async (transaction) => {
      for (const file of files) {
        // eslint-disable-next-line no-await-in-loop
        await ListingPhoto.create(
          {
            listingId: listing.id,
            filePath: path.relative(uploadRoot(), file.path).split(path.sep).join('/'),
            originalName: String(file.originalname || 'photo').slice(0, 255),
            mimeType: file.mimetype,
            sizeBytes: file.size,
            sortOrder: next,
          },
          { transaction }
        );
        next += 1;
      }
      // New photos on a live listing must be checked by the admin again
      if ([S.ACTIVE, S.PAUSED].includes(listing.status)) await sendForReview(user, listing, transaction);
    });
    return toSeller(await findOwn(user, id));
  } catch (err) {
    await removeFiles(files);
    throw err;
  }
}

// Renumber photos 0, 1, 2 ... in the given order
async function renumber(photoIds, transaction) {
  for (let i = 0; i < photoIds.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await ListingPhoto.update({ sortOrder: i }, { where: { id: photoIds[i] }, transaction });
  }
}

// DELETE /me/listings/:id/photos/:photoId   (soft delete)
async function removePhoto(user, id, photoId) {
  kindOf(user);
  return sequelize.transaction(async (transaction) => {
    const listing = await findOwn(user, id, { transaction });
    const photos = await ListingPhoto.findAll({
      where: { listingId: listing.id },
      order: [['sortOrder', 'ASC'], ['id', 'ASC']],
      transaction,
    });
    const photo = photos.find((p) => p.id === photoId);
    if (!photo) throw new ApiError(404, 'Photo not found', { code: 'PHOTO_NOT_FOUND' });
    if (photos.length === 1 && [S.ACTIVE, S.PAUSED, S.PENDING].includes(listing.status)) {
      throw new ApiError(409, 'A published listing needs at least one photo. Add another photo first.', {
        code: 'LAST_PHOTO',
      });
    }
    await photo.destroy({ transaction });
    await renumber(photos.filter((p) => p.id !== photoId).map((p) => p.id), transaction);
    return toSeller(await findOwn(user, id, { transaction }));
  });
}

// PATCH /me/listings/:id/photos/order   { photoIds: [...] } -> first one becomes the cover photo
async function reorderPhotos(user, id, { photoIds }) {
  kindOf(user);
  return sequelize.transaction(async (transaction) => {
    const listing = await findOwn(user, id, { transaction });
    const photos = await ListingPhoto.findAll({ where: { listingId: listing.id }, attributes: ['id'], transaction });
    const own = new Set(photos.map((p) => p.id));
    const unique = [...new Set(photoIds)];
    if (unique.length !== own.size || unique.some((pid) => !own.has(pid))) {
      throw validationError([{ field: 'photoIds', message: `Send all ${own.size} photo ids of this listing, in the new order` }]);
    }
    await renumber(unique, transaction);
    return toSeller(await findOwn(user, id, { transaction }));
  });
}

module.exports = {
  listingIsVat,
  sellerDelivers,
  listMine,
  getMine,
  create,
  update,
  submit,
  updateInventory,
  setVisibility,
  remove,
  addPhotos,
  removePhoto,
  reorderPhotos,
  // shared with marketplace.service.js and adminListing.service.js
  baseShape,
  listingInclude,
  missingForReview,
  priceLabel,
};
