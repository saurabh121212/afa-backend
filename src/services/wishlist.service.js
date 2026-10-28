// Wishlist of the logged-in user (heart icon on listings + "Wishlist" page). Any user type can use it.
//
//   - Only listings that are live on the marketplace can be added.
//   - Your own listings can't be added.
//   - Adding twice is fine (nothing changes). Removing = soft delete; adding again restores it.
//   - A saved listing that later stops being live (paused, sold out by the admin, seller suspended...)
//     stays in the wishlist with available: false, so the user understands why it can't be bought.
const { sequelize, WishlistItem, Listing } = require('../models');
const ApiError = require('../utils/ApiError');
const { getPagination, paginationMeta } = require('../utils/pagination');
const { LISTING_STATUS } = require('../config/listingOptions');
const directory = require('./userDirectory');
const { baseShape, listingInclude } = require('./listing.service');
const { sellerShape, visibleIncludes } = require('./marketplace.service');

const MAX_WISHLIST_ITEMS = 500;

// Is this listing visible on the marketplace right now? -> Set of visible ids
async function visibleIds(listingIds) {
  if (!listingIds.length) return new Set();
  const rows = await Listing.findAll({
    where: { id: listingIds, status: LISTING_STATUS.ACTIVE, vatHold: false },
    attributes: ['id'],
    include: visibleIncludes().filter((inc) => inc.required), // seller approved + category active
  });
  return new Set(rows.map((r) => r.id));
}

// ---------- GET /me/wishlist ----------
async function list(user, query) {
  const pg = getPagination(query);
  const { rows, count } = await WishlistItem.findAndCountAll({
    where: { userId: user.id },
    order: [['updatedAt', 'DESC'], ['id', 'DESC']], // updatedAt = when it was (re-)added
    limit: pg.limit,
    offset: pg.offset,
  });
  const listingIds = rows.map((r) => r.listingId);

  // paranoid: false -> a listing the seller deleted still shows (as "no longer available")
  const [listings, visible] = await Promise.all([
    listingIds.length
      ? Listing.findAll({ where: { id: listingIds }, include: listingInclude(), paranoid: false })
      : [],
    visibleIds(listingIds),
  ]);
  const byId = new Map(listings.map((l) => [l.id, l]));
  const sellers = await directory.findMany(listings.map((l) => l.userId));

  const items = rows
    .filter((r) => byId.has(r.listingId))
    .map((r) => {
      const l = byId.get(r.listingId);
      return {
        wishlistItemId: r.id,
        addedAt: r.updatedAt,
        available: visible.has(l.id), // false -> show "No longer available"
        listing: { ...baseShape(l), seller: sellerShape(l.userId, sellers.get(l.userId)) },
      };
    });
  return { items, pagination: paginationMeta(pg, count) };
}

// ---------- GET /me/wishlist/ids ----------
// Just the listing ids, to colour the heart icons on any list of listings (load once after login).
async function ids(user) {
  const rows = await WishlistItem.findAll({ where: { userId: user.id }, attributes: ['listingId'] });
  return rows.map((r) => r.listingId);
}

// ---------- POST /me/wishlist   { listingId } ----------
async function add(user, listingId) {
  const listing = await Listing.findOne({ where: { id: listingId }, attributes: ['id', 'userId', 'status'] });
  if (!listing || !(await visibleIds([listingId])).has(listingId)) {
    throw new ApiError(404, 'This listing is not available on the marketplace', { code: 'LISTING_NOT_FOUND' });
  }
  if (listing.userId === user.id) {
    throw new ApiError(422, 'You cannot add your own listing to your wishlist', { code: 'OWN_LISTING' });
  }

  return sequelize.transaction(async (transaction) => {
    const existing = await WishlistItem.findOne({
      where: { userId: user.id, listingId },
      paranoid: false,
      transaction,
    });
    if (existing && !existing.deletedAt) return { listingId, inWishlist: true, alreadyAdded: true };

    if (!existing) {
      const count = await WishlistItem.count({ where: { userId: user.id }, transaction });
      if (count >= MAX_WISHLIST_ITEMS) {
        throw new ApiError(409, `Your wishlist can have at most ${MAX_WISHLIST_ITEMS} items`, { code: 'LIMIT_REACHED' });
      }
      await WishlistItem.create({ userId: user.id, listingId }, { transaction });
    } else {
      await existing.restore({ transaction }); // also sets updatedAt = now -> shown as newly added
    }
    return { listingId, inWishlist: true, alreadyAdded: false };
  });
}

// ---------- DELETE /me/wishlist/:listingId   (soft delete) ----------
async function remove(user, listingId) {
  const item = await WishlistItem.findOne({ where: { userId: user.id, listingId } });
  if (!item) throw new ApiError(404, 'This listing is not in your wishlist', { code: 'NOT_IN_WISHLIST' });
  await item.destroy();
  return { listingId, inWishlist: false };
}

// ---------- DELETE /me/wishlist   (clear: removes every item, soft) ----------
async function clear(user) {
  const removed = await WishlistItem.destroy({ where: { userId: user.id } }); // paranoid -> sets deleted_at
  return { removed };
}

module.exports = { list, ids, add, remove, clear };
