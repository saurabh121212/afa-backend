// Wishlist (/me/wishlist) + public seller pages (/sellers) + "You May Also Like" (/listings/:id/related).
const asyncHandler = require('../utils/asyncHandler');
const wishlistService = require('../services/wishlist.service');
const sellerService = require('../services/seller.service');
const marketplaceService = require('../services/marketplace.service');

// ======================= WISHLIST (login) =======================

// GET /me/wishlist
const list = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await wishlistService.list(req.user, req.validated) });
});

// GET /me/wishlist/ids
const ids = asyncHandler(async (req, res) => {
  res.json({ success: true, data: { listingIds: await wishlistService.ids(req.user) } });
});

// POST /me/wishlist
const add = asyncHandler(async (req, res) => {
  const data = await wishlistService.add(req.user, req.validated.listingId);
  res.status(data.alreadyAdded ? 200 : 201).json({
    success: true,
    message: data.alreadyAdded ? 'Already in your wishlist' : 'Added to your wishlist',
    data,
  });
});

// DELETE /me/wishlist/:listingId
const remove = asyncHandler(async (req, res) => {
  const data = await wishlistService.remove(req.user, req.validated.listingId);
  res.json({ success: true, message: 'Removed from your wishlist', data });
});

// DELETE /me/wishlist
const clear = asyncHandler(async (req, res) => {
  const data = await wishlistService.clear(req.user);
  res.json({ success: true, message: 'Wishlist cleared', data });
});

// ======================= PUBLIC =======================

// GET /sellers/:id   ("About the Seller" / store header)
const getSeller = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await sellerService.getSeller(req.validated.id) });
});

// GET /sellers/:id/listings   (store page: the seller's live listings, same filters as /listings)
const sellerListings = asyncHandler(async (req, res) => {
  const { id, ...filters } = req.validated;
  await sellerService.sellerCard(id); // 404 when the seller isn't public
  res.json({ success: true, data: await marketplaceService.list({ ...filters, sellerId: id }) });
});

// GET /listings/:id/related   ("You May Also Like")
const related = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await marketplaceService.related(req.validated.id, { limit: req.validated.limit || 8 }) });
});

module.exports = { list, ids, add, remove, clear, getSeller, sellerListings, related };
