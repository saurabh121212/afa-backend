// SELLER listing endpoints (/me/listings) + PUBLIC marketplace endpoints (/listings).
// Input is already validated (req.validated).
const asyncHandler = require('../utils/asyncHandler');
const listingService = require('../services/listing.service');
const marketplaceService = require('../services/marketplace.service');
const options = require('../config/listingOptions');

// ======================= SELLER =======================

// GET /me/listings
const listMine = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await listingService.listMine(req.user, req.validated) });
});

// GET /me/listings/:id
const getMine = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await listingService.getMine(req.user, req.validated.id) });
});

// POST /me/listings   ("Save as Draft", or "Publish Listing" with submit: true)
const create = asyncHandler(async (req, res) => {
  const { listing, sentForReview, submitErrors } = await listingService.create(req.user, req.validated, req.body);
  let message = 'Listing saved as draft';
  if (sentForReview) message = 'Listing sent to the AFA admin for review';
  else if (submitErrors.length) message = 'Listing saved as draft. Complete it (e.g. add photos) to publish it.';
  res.status(201).json({ success: true, message, data: listing, missingForReview: submitErrors });
});

// PUT /me/listings/:id
const update = asyncHandler(async (req, res) => {
  const { listing, reReview } = await listingService.update(req.user, req.validated.id, req.validated, req.body);
  let message = 'Listing updated';
  if (reReview) message = 'Listing updated and sent to the AFA admin for review again';
  else if (listing.status === 'pending') message = 'Listing saved and sent to the AFA admin for review';
  res.json({ success: true, message, data: listing });
});

// POST /me/listings/:id/submit
const submit = asyncHandler(async (req, res) => {
  const data = await listingService.submit(req.user, req.validated.id);
  res.json({ success: true, message: 'Listing sent to the AFA admin for review', data });
});

// PATCH /me/listings/:id/inventory
const updateInventory = asyncHandler(async (req, res) => {
  const data = await listingService.updateInventory(req.user, req.validated.id, req.validated);
  res.json({ success: true, message: 'Stock / availability updated', data });
});

// PATCH /me/listings/:id/visibility
const setVisibility = asyncHandler(async (req, res) => {
  const data = await listingService.setVisibility(req.user, req.validated.id, req.validated);
  res.json({ success: true, message: req.validated.visible ? 'Listing is visible again' : 'Listing paused', data });
});

// DELETE /me/listings/:id   (soft delete)
const remove = asyncHandler(async (req, res) => {
  const data = await listingService.remove(req.user, req.validated.id);
  res.json({ success: true, message: `"${data.name}" deleted`, data });
});

// POST /me/listings/:id/photos   (form-data, field "photos")
const addPhotos = asyncHandler(async (req, res) => {
  const data = await listingService.addPhotos(req.user, req.validated.id, req.files);
  res.status(201).json({ success: true, message: `${req.files.length} photo(s) added`, data });
});

// DELETE /me/listings/:id/photos/:photoId
const removePhoto = asyncHandler(async (req, res) => {
  const data = await listingService.removePhoto(req.user, req.validated.id, req.validated.photoId);
  res.json({ success: true, message: 'Photo removed', data });
});

// PATCH /me/listings/:id/photos/order
const reorderPhotos = asyncHandler(async (req, res) => {
  const data = await listingService.reorderPhotos(req.user, req.validated.id, req.validated);
  res.json({ success: true, message: 'Photo order saved', data });
});

// ======================= PUBLIC =======================

// GET /listings
const publicList = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await marketplaceService.list(req.validated) });
});

// GET /listings/:id
const publicGet = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await marketplaceService.getById(req.validated.id) });
});

// GET /listings/options -> every dropdown of the listing forms and filters
const toList = (obj) => Object.entries(obj).map(([value, label]) => ({ value, label }));
const listingOptions = (req, res) => {
  res.json({
    success: true,
    data: {
      currency: options.CURRENCY,
      listingKindByUserType: options.LISTING_KIND_BY_USER_TYPE,
      statuses: toList(options.LISTING_STATUS_LABELS),
      product: {
        units: toList(options.PRODUCT_UNITS),
        availability: toList(options.PRODUCT_AVAILABILITY),
        deliveryTypes: toList(options.DELIVERY_TYPES),
        durationUnits: toList(options.DURATION_UNITS),
        logisticsBy: toList(options.LOGISTICS_BY),
      },
      service: {
        rateUnits: toList(options.SERVICE_RATE_UNITS),
        capacityUnits: toList(options.CAPACITY_UNITS),
        minBookingUnits: toList(options.MIN_BOOKING_UNITS),
        availability: toList(options.SERVICE_AVAILABILITY),
        durationUnits: toList(options.DURATION_UNITS),
      },
      photos: options.LISTING_PHOTOS,
    },
  });
};

module.exports = {
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
  publicList,
  publicGet,
  listingOptions,
};
