// Service bookings (logistics providers' services: transport, warehousing, equipment hire).
//
// A service is listed like a product with a fixed rate ("E 18 per km", "E 900 per day",
// "E 45 per pallet per month"). Only BUYERS book. The booking form depends on what the rate is "per":
//
//   transport  per km, per ton per km, per trip, per load
//              -> pickup + drop-off address, date, distance (km) / trips / loads, load (<= capacity)
//   time       per hour, per day, per week, per month
//              -> start + end date (hours for "per hour"), where the service / equipment is needed
//   storage    per pallet per day / month, per cubic metre (per month), per square metre per month, per pallet
//              -> start + end date, space needed (<= free space), no address
//   count      per kg, per ton, per bag, per head, per hectare, per acre, per unit, per job
//              -> date(s), quantity, where the service is needed
//
// Price = rate x billable quantity (+ VAT when the category has VAT), worked out by the API.
// The minimum booking applies when its unit matches the rate (e.g. 50 km minimum on a per-km rate).
// Each booking is saved as an ORDER (one seller order, one line) so payments, invoices,
// cancellations, claims and refunds work exactly like product orders.

const BOOKING_TYPES = { transport: 'Transport', time: 'Hire by time', storage: 'Storage', count: 'By quantity' };

// What each service rate unit means for the booking form.
//   factors: what is multiplied (in order). billUnit: the unit shown on the invoice line.
const RATE_RULES = {
  km: { type: 'transport', factors: ['distanceKm'], billUnit: 'km' },
  ton_km: { type: 'transport', factors: ['tons', 'distanceKm'], billUnit: 'ton-km' },
  trip: { type: 'transport', factors: ['quantity'], billUnit: 'trip', quantityLabel: 'Number of trips' },
  load: { type: 'transport', factors: ['quantity'], billUnit: 'load', quantityLabel: 'Number of loads' },
  hour: { type: 'time', factors: ['hours'], billUnit: 'hour' },
  day: { type: 'time', factors: ['days'], billUnit: 'day' },
  week: { type: 'time', factors: ['weeks'], billUnit: 'week' },
  month: { type: 'time', factors: ['months'], billUnit: 'month' },
  pallet_day: { type: 'storage', factors: ['space', 'days'], billUnit: 'pallet-day', spaceUnit: 'pallet' },
  pallet_month: { type: 'storage', factors: ['space', 'months'], billUnit: 'pallet-month', spaceUnit: 'pallet' },
  cubic_metre_month: { type: 'storage', factors: ['space', 'months'], billUnit: 'm³-month', spaceUnit: 'cubic_metre' },
  square_metre_month: { type: 'storage', factors: ['space', 'months'], billUnit: 'm²-month', spaceUnit: 'square_metre' },
  pallet: { type: 'storage', factors: ['space'], billUnit: 'pallet', spaceUnit: 'pallet' },
  cubic_metre: { type: 'storage', factors: ['space'], billUnit: 'm³', spaceUnit: 'cubic_metre' },
  kg: { type: 'count', factors: ['quantity'], billUnit: 'kg', quantityLabel: 'Quantity (kg)' },
  ton: { type: 'count', factors: ['quantity'], billUnit: 'ton', quantityLabel: 'Quantity (tons)' },
  bag: { type: 'count', factors: ['quantity'], billUnit: 'bag', quantityLabel: 'Number of bags' },
  head: { type: 'count', factors: ['quantity'], billUnit: 'head', quantityLabel: 'Head of livestock' },
  hectare: { type: 'count', factors: ['quantity'], billUnit: 'hectare', quantityLabel: 'Hectares' },
  acre: { type: 'count', factors: ['quantity'], billUnit: 'acre', quantityLabel: 'Acres' },
  unit: { type: 'count', factors: ['quantity'], billUnit: 'unit', quantityLabel: 'Quantity' },
  job: { type: 'count', factors: ['quantity'], billUnit: 'job', quantityLabel: 'Number of jobs' },
};

const FACTOR_LABELS = {
  distanceKm: 'Distance (km)',
  tons: 'Load (tons)',
  quantity: 'Quantity',
  hours: 'Hours',
  days: 'Days',
  weeks: 'Weeks',
  months: 'Months',
  space: 'Space',
};
const SPACE_UNIT_LABELS = { pallet: 'pallets', cubic_metre: 'cubic metres', square_metre: 'square metres' };

// Time conversions used for dates and for a minimum booking in another time unit
const DAYS_PER = { day: 1, week: 7, month: 30 };

// Minimum booking unit -> which factor it limits (when the listing's rate has that factor)
const MIN_BOOKING_FACTOR = {
  km: 'distanceKm',
  ton: 'tons', // per ton per km; for a "per ton" rate it limits the quantity (see below)
  trip: 'quantity',
  load: 'quantity',
  pallet: 'space',
  hectare: 'quantity',
  hour: 'hours',
  day: 'time',
  week: 'time',
  month: 'time',
};

// ---------- rules ----------
const BOOKING_RULES = {
  maxDays: 366, // longest booking (start to end)
  maxDaysAhead: 365, // how far ahead a booking can start
  calendarDefaultDays: 60, // booked-dates calendar
  calendarMaxDays: 180,
  freeCancelHours: 24, // buyer cancels at once (full refund) until this long before the start; later = request
  claimWindowHours: 72, // after "Service Done": buyer confirms or reports a problem; then completed
  noteMax: 500,
};

// Seller order status labels for a booking (fulfilment "service")
const SERVICE_STATUS_LABELS = {
  awaiting_payment: 'Awaiting Payment',
  paid: 'New Booking',
  confirmed: 'Confirmed',
  in_progress: 'In Progress',
  delivered: 'Service Done',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

// Seller order statuses that hold the service's dates / space (not cancelled)
const HOLDING_STATUSES = ['awaiting_payment', 'paid', 'confirmed', 'in_progress', 'delivered'];
// ...and the checkout must still be alive (unpaid bookings expire with their payment deadline)
const HOLDING_ORDER_STATUSES = ['awaiting_payment', 'under_review', 'paid'];

// Claims on a booking: the service was not done, done badly, or goods were damaged / lost
const BOOKING_REFUND_POLICY = 'booking';

// AFA-BKG-000001
const bookingNumber = (id) => `AFA-BKG-${String(id).padStart(6, '0')}`;

// ---------- dates (Eswatini time, UTC+2) ----------
const TZ = '+02:00';
const dayStart = (ymd, time = '00:00') => new Date(`${ymd}T${time}:00${TZ}`);
const todayYmd = (now = new Date()) => new Date(now.getTime() + 2 * 3600 * 1000).toISOString().slice(0, 10);
const ymdOf = (date) => new Date(new Date(date).getTime() + 2 * 3600 * 1000).toISOString().slice(0, 10);
const addDaysYmd = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1; // inclusive

// Advance notice -> earliest start date (YYYY-MM-DD)
const NOTICE_HOURS = { hours: 1, days: 24, weeks: 7 * 24, months: 30 * 24 };
function earliestStart(listing, now = new Date()) {
  const n = Number(listing.advanceNotice || 0);
  const hours = n * (NOTICE_HOURS[listing.advanceNoticeUnit] || 24);
  return ymdOf(new Date(now.getTime() + hours * 3600 * 1000));
}

// "paid" -> buyer cancels at once; "confirmed" -> at once until freeCancelHours before the start, then a request
function buyerCancelMode(so, booking, now = new Date()) {
  if (so.status === 'paid') return 'direct';
  if (so.status !== 'confirmed') return null;
  if (!booking) return 'request';
  const start = dayStart(booking.startDate, booking.startTime || '00:00');
  return start.getTime() - now.getTime() >= BOOKING_RULES.freeCancelHours * 3600 * 1000 ? 'direct' : 'request';
}

module.exports = {
  BOOKING_TYPES,
  RATE_RULES,
  FACTOR_LABELS,
  SPACE_UNIT_LABELS,
  DAYS_PER,
  MIN_BOOKING_FACTOR,
  BOOKING_RULES,
  SERVICE_STATUS_LABELS,
  HOLDING_STATUSES,
  HOLDING_ORDER_STATUSES,
  BOOKING_REFUND_POLICY,
  bookingNumber,
  dayStart,
  todayYmd,
  ymdOf,
  addDaysYmd,
  daysBetween,
  earliestStart,
  buyerCancelMode,
};
