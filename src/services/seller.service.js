// PUBLIC seller profile: "About the Seller" on Product Details + the seller's store page ("Visit Store").
// Only approved farmers, traders and logistics providers have a public profile.
// Never returns private data (email, mobile, TIN, documents, bank details).
const { Listing, Category, User, Location, FarmerProfile, TraderProfile, LogisticsProfile } = require('../models');
const ApiError = require('../utils/ApiError');
const { displayId } = require('../utils/displayId');
const { USER_STATUS, USER_TYPE_LABELS } = require('../utils/constants');
const { LISTING_STATUS, SELLER_USER_TYPES } = require('../config/listingOptions');
const directory = require('./userDirectory');

const notFound = () => new ApiError(404, 'Seller not found', { code: 'SELLER_NOT_FOUND' });

// Live listings of one seller (same rules as the marketplace: active listing in an active category)
const countActiveListings = (userId) =>
  Listing.count({
    where: { userId, status: LISTING_STATUS.ACTIVE },
    include: [{ model: Category, as: 'category', attributes: [], where: { isActive: true }, required: true }],
  });

// Business details that are safe to show publicly, per seller type
async function publicDetails(user) {
  if (user.userType === 'farmer') {
    const p = await FarmerProfile.findOne({ where: { userId: user.id } });
    return p
      ? {
          farmName: p.farmName,
          farmingActivity: p.farmingActivity,
          farmSizeHa: p.farmSizeHa === null ? null : Number(p.farmSizeHa),
          mainCrops: p.mainCrops || [],
          farmingSeasons: p.farmingSeasons || [],
        }
      : {};
  }
  if (user.userType === 'trader') {
    const p = await TraderProfile.findOne({ where: { userId: user.id } });
    return p
      ? { businessName: p.businessName, businessCategory: p.businessCategory, yearsInOperation: p.yearsInOperation, website: p.website }
      : {};
  }
  const p = await LogisticsProfile.findOne({
    where: { userId: user.id },
    include: [{ model: Location, as: 'coverageRegions', attributes: ['id', 'name'], through: { attributes: [] } }],
  });
  return p
    ? {
        businessName: p.businessName,
        serviceType: p.serviceType,
        coverageRegions: (p.coverageRegions || []).map((r) => ({ id: r.id, name: r.name })),
      }
    : {};
}

// "About the Seller" card. withDetails = also the public business details (store page).
async function sellerCard(userId, { withDetails = false } = {}) {
  const user = await User.findOne({
    where: { id: userId, status: USER_STATUS.APPROVED },
    attributes: ['id', 'userType', 'status', 'approvedAt', 'submittedAt', 'createdAt'],
  });
  if (!user || !SELLER_USER_TYPES.includes(user.userType)) throw notFound();

  const [dirMap, activeListings, details] = await Promise.all([
    directory.findMany([user.id]),
    countActiveListings(user.id),
    withDetails ? publicDetails(user) : null,
  ]);
  const dir = dirMap.get(user.id) || {};
  const name = user.userType === 'farmer' ? dir.sub_name || dir.display_name : dir.display_name;

  return {
    id: user.id,
    displayId: displayId(user.userType, user.id),
    name: name || null,
    userType: user.userType,
    userTypeLabel: USER_TYPE_LABELS[user.userType],
    verified: true, // only approved sellers have a public profile ("Verified Farmer")
    region: dir.region_id ? { id: dir.region_id, name: dir.region_name } : null,
    memberSince: user.approvedAt || user.submittedAt || user.createdAt, // "Member since March 2025"
    activeListings,
    // Filled in when the Reviews and Orders modules are built
    rating: null, // e.g. 4.8
    reviewsCount: 0, // e.g. 42 reviews
    ordersCompleted: 0, // e.g. 128 orders completed
    ...(withDetails ? { details } : {}),
  };
}

// GET /sellers/:id
const getSeller = (id) => sellerCard(id, { withDetails: true });

module.exports = { sellerCard, getSeller };
