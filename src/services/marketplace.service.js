// PUBLIC marketplace (website + apps, no login): search listings and open one listing.
// Shows ONLY listings that are:
//   - approved by the admin (status "active")
//   - in an active category
//   - from a seller whose account is approved (not suspended)
const { Op } = require('sequelize');
const { sequelize, Listing, ListingPhoto, Category, Location, User } = require('../models');
const ApiError = require('../utils/ApiError');
const { getPagination, paginationMeta } = require('../utils/pagination');
const { displayId } = require('../utils/displayId');
const { USER_STATUS, USER_TYPE_LABELS } = require('../utils/constants');
const { LISTING_STATUS } = require('../config/listingOptions');
const directory = require('./userDirectory');
const { baseShape } = require('./listing.service');
const { sellerCard } = require('./seller.service');

const SORTS = {
  newest: [['publishedAt', 'DESC'], ['id', 'DESC']],
  price_asc: [['price', 'ASC'], ['id', 'ASC']],
  price_desc: [['price', 'DESC'], ['id', 'DESC']],
  name_asc: [['name', 'ASC'], ['id', 'ASC']],
};

// Public seller card. Farmers show their farm name when they have one ("Sunrise Farm").
function sellerShape(userId, dir) {
  if (!dir) return { id: userId };
  const name = dir.user_type === 'farmer' ? dir.sub_name || dir.display_name : dir.display_name;
  return {
    id: userId,
    displayId: displayId(dir.user_type, userId),
    name,
    userType: dir.user_type,
    userTypeLabel: USER_TYPE_LABELS[dir.user_type],
    region: dir.region_id ? { id: dir.region_id, name: dir.region_name } : null,
    verified: dir.status === USER_STATUS.APPROVED,
  };
}

// Includes that also do the "only visible listings" filtering
function visibleIncludes({ sellerType } = {}) {
  return [
    {
      model: User,
      as: 'seller',
      attributes: ['id', 'userType', 'status'],
      where: { status: USER_STATUS.APPROVED, ...(sellerType ? { userType: sellerType } : {}) },
      required: true,
    },
    {
      model: Category,
      as: 'category',
      attributes: ['id', 'name', 'slug', 'vatApplicable'],
      where: { isActive: true },
      required: true,
    },
    { model: Category, as: 'subCategory', attributes: ['id', 'name', 'slug', 'parentId', 'vatApplicable'] },
    { model: Location, as: 'region', attributes: ['id', 'name'] },
    { model: Location, as: 'inkhundla', attributes: ['id', 'name'] },
    { model: Location, as: 'umphakatsi', attributes: ['id', 'name'] },
    { model: ListingPhoto, as: 'photos', attributes: ['id', 'filePath', 'sortOrder'], separate: true },
  ];
}

// ---------- GET /listings ----------
async function list(query) {
  const pg = getPagination(query);
  const where = { status: LISTING_STATUS.ACTIVE, vatHold: false };
  const and = [];

  if (query.kind) where.kind = query.kind;
  if (query.categoryId) where.categoryId = query.categoryId;
  if (query.subCategoryId) where.subCategoryId = query.subCategoryId;
  if (query.sellerId) where.userId = query.sellerId;
  if (query.availability) where.availability = query.availability;
  if (query.minPrice !== undefined || query.maxPrice !== undefined) {
    where.price = {
      ...(query.minPrice !== undefined ? { [Op.gte]: query.minPrice } : {}),
      ...(query.maxPrice !== undefined ? { [Op.lte]: query.maxPrice } : {}),
    };
  }
  if (query.search) {
    const like = `%${query.search}%`;
    and.push({ [Op.or]: [{ name: { [Op.like]: like } }, { description: { [Op.like]: like } }, { brand: { [Op.like]: like } }] });
  }
  // Region: where the listing is, or (services) a region it covers
  if (query.regionId) {
    const regionId = Number(query.regionId);
    and.push({
      [Op.or]: [
        { regionId },
        sequelize.where(sequelize.fn('JSON_CONTAINS', sequelize.col('coverage_region_ids'), String(regionId)), 1),
      ],
    });
  }
  if (and.length) where[Op.and] = and;

  const { rows, count } = await Listing.findAndCountAll({
    where,
    include: visibleIncludes({ sellerType: query.sellerType }),
    order: SORTS[query.sort] || SORTS.newest,
    limit: pg.limit,
    offset: pg.offset,
    distinct: true,
  });

  const sellers = await directory.findMany(rows.map((r) => r.userId));
  return {
    items: rows.map((r) => ({ ...baseShape(r), seller: sellerShape(r.userId, sellers.get(r.userId)) })),
    pagination: paginationMeta(pg, count),
  };
}

// ---------- GET /listings/:id ----------
async function getById(id) {
  const listing = await Listing.findOne({
    where: { id, status: LISTING_STATUS.ACTIVE, vatHold: false },
    include: visibleIncludes(),
  });
  if (!listing) throw new ApiError(404, 'Listing not found', { code: 'LISTING_NOT_FOUND' });

  const [seller, coverage] = await Promise.all([
    sellerCard(listing.userId), // "About the Seller" card
    listing.coverageRegionIds && listing.coverageRegionIds.length
      ? Location.findAll({ where: { id: listing.coverageRegionIds }, attributes: ['id', 'name'], order: [['name', 'ASC']] })
      : [],
  ]);
  return {
    ...baseShape(listing),
    ...(listing.kind === 'service' ? { coverageRegions: coverage.map((c) => ({ id: c.id, name: c.name })) } : {}),
    seller,
  };
}

// ---------- GET /listings/:id/related ("You May Also Like") ----------
// Live listings of the same kind, best matches first:
//   same sub-category -> same category -> same region -> newest.
// Never the listing itself, and never other listings of the same seller (that's "Visit Store").
async function related(id, { limit = 8 } = {}) {
  const listing = await Listing.findOne({
    where: { id, status: LISTING_STATUS.ACTIVE, vatHold: false },
    attributes: ['id', 'userId', 'kind', 'categoryId', 'subCategoryId', 'regionId'],
  });
  if (!listing) throw new ApiError(404, 'Listing not found', { code: 'LISTING_NOT_FOUND' });

  const score = (column, value) =>
    value ? sequelize.literal(`CASE WHEN \`Listing\`.\`${column}\` = ${Number(value)} THEN 1 ELSE 0 END`) : null;
  const order = [
    score('sub_category_id', listing.subCategoryId),
    score('category_id', listing.categoryId),
    score('region_id', listing.regionId),
  ]
    .filter(Boolean)
    .map((expr) => [expr, 'DESC'])
    .concat([['publishedAt', 'DESC'], ['id', 'DESC']]);

  const rows = await Listing.findAll({
    where: { status: LISTING_STATUS.ACTIVE, vatHold: false, kind: listing.kind, id: { [Op.ne]: listing.id }, userId: { [Op.ne]: listing.userId } },
    include: visibleIncludes(),
    order,
    limit,
  });
  const sellers = await directory.findMany(rows.map((r) => r.userId));
  return rows.map((r) => ({ ...baseShape(r), seller: sellerShape(r.userId, sellers.get(r.userId)) }));
}

module.exports = { list, getById, related, sellerShape, visibleIncludes };
