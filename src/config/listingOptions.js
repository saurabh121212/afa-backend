// Fixed choices used by marketplace listings (dropdowns in the Figma listing forms).
// Edit these lists to add / rename options; codes are what the API stores, labels are what screens show.
//
//   Who lists what (one user type = one kind of listing):
//     farmer, trader -> 'product'   (Create New Listing / Add New Product)
//     logistics      -> 'service'   (Add New Service: transport, warehousing, equipment rental)

const LISTING_KIND_BY_USER_TYPE = {
  farmer: 'product',
  trader: 'product',
  logistics: 'service',
};
const SELLER_USER_TYPES = Object.keys(LISTING_KIND_BY_USER_TYPE);
const LISTING_KINDS = ['product', 'service'];

const CURRENCY = { code: 'SZL', symbol: 'E', name: 'Emalangeni' };

// ---------- Listing status ----------
//   draft    -> saved by the seller, not sent yet
//   pending  -> waiting for admin review (NOT on the website)
//   active   -> approved by the admin, visible on the website
//   rejected -> admin rejected it (reason given); seller can edit and send again
//   paused   -> seller hid an approved listing; can show it again without a new review
//   flagged  -> admin flagged it as suspicious (hidden); seller can edit and send again
//   disabled -> admin disabled it (hidden); only the admin can enable it again
const LISTING_STATUS = {
  DRAFT: 'draft',
  PENDING: 'pending',
  ACTIVE: 'active',
  REJECTED: 'rejected',
  PAUSED: 'paused',
  FLAGGED: 'flagged',
  DISABLED: 'disabled',
};
const LISTING_STATUS_LABELS = {
  draft: 'Draft',
  pending: 'Pending Review',
  active: 'Active',
  rejected: 'Rejected',
  paused: 'Paused',
  flagged: 'Flagged',
  disabled: 'Disabled',
};

// ---------- Units ----------
// Products: price per unit, stock quantity, minimum order quantity
const PRODUCT_UNITS = {
  kg: 'kg',
  g: 'gram',
  ton: 'ton',
  bag: 'bag',
  sack: 'sack',
  crate: 'crate',
  box: 'box',
  carton: 'carton',
  tray: 'tray',
  bucket: 'bucket',
  bunch: 'bunch',
  bundle: 'bundle',
  bale: 'bale',
  head: 'head',
  piece: 'piece',
  unit: 'unit',
  dozen: 'dozen',
  pair: 'pair',
  packet: 'packet',
  punnet: 'punnet',
  litre: 'litre',
  ml: 'ml',
  bottle: 'bottle',
  can: 'can',
  jerrycan: 'jerrycan',
  drum: 'drum',
  pallet: 'pallet',
  cubic_metre: 'cubic metre',
  hectare: 'hectare',
  acre: 'acre',
  metre: 'metre',
  roll: 'roll',
  seedling: 'seedling',
  tray_of_eggs: 'tray of 30 eggs',
};

// Services: rate / price is charged "per ..."
const SERVICE_RATE_UNITS = {
  km: 'per km',
  trip: 'per trip',
  load: 'per load',
  hour: 'per hour',
  day: 'per day',
  week: 'per week',
  month: 'per month',
  kg: 'per kg',
  ton: 'per ton',
  ton_km: 'per ton per km',
  pallet: 'per pallet',
  pallet_day: 'per pallet per day',
  pallet_month: 'per pallet per month',
  cubic_metre: 'per cubic metre',
  cubic_metre_month: 'per cubic metre per month',
  square_metre_month: 'per square metre per month',
  bag: 'per bag',
  head: 'per head',
  hectare: 'per hectare',
  acre: 'per acre',
  unit: 'per unit',
  job: 'per job',
};

// Services: capacity / load size
const CAPACITY_UNITS = {
  ton: 'tons',
  kg: 'kg',
  litre: 'litres',
  pallet: 'pallets',
  cubic_metre: 'cubic metres',
  square_metre: 'square metres',
  bag: 'bags',
  head: 'head of livestock',
  seat: 'seats',
  unit: 'units',
  hectare_day: 'hectares per day',
  horsepower: 'horsepower (hp)',
};

// Services: minimum booking
const MIN_BOOKING_UNITS = {
  trip: 'trip',
  load: 'load',
  hour: 'hour',
  day: 'day',
  week: 'week',
  month: 'month',
  km: 'km',
  ton: 'ton',
  pallet: 'pallet',
  hectare: 'hectare',
};

// Delivery duration, advance booking notice
const DURATION_UNITS = {
  hours: 'hours',
  days: 'days',
  weeks: 'weeks',
  months: 'months',
};

// ---------- Availability ----------
const PRODUCT_AVAILABILITY = { in_stock: 'In Stock Now', pre_order: 'Pre-Order' };
const SERVICE_AVAILABILITY = {
  available: 'Available Now',
  booked: 'Currently Booked',
  maintenance: 'Under Maintenance',
};

const DELIVERY_TYPES = { pickup: 'Pickup Only', delivery: 'Delivery', both: 'Pickup & Delivery' };
const LOGISTICS_BY = { seller: 'Seller', buyer: 'Buyer' }; // who arranges pickup / delivery

// ---------- Photos ----------
const LISTING_PHOTOS = {
  max: 5,
  maxSizeMB: 5,
  formats: ['jpg', 'png'],
  folder: 'listings', // uploads/public/listings/<listingId>/
};

module.exports = {
  LISTING_KIND_BY_USER_TYPE,
  SELLER_USER_TYPES,
  LISTING_KINDS,
  CURRENCY,
  LISTING_STATUS,
  LISTING_STATUS_LABELS,
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
};
