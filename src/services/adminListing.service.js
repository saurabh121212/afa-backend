// ADMIN Listings Management (Figma "Listings Management" + "Listing Details").
// Only admin-approved listings are shown on the website.
//
//   approve   pending                         -> active    (on the website)
//   reject    pending                         -> rejected  (reason sent to the seller)
//   flag      pending | active | paused       -> flagged   (hidden, reason sent; seller fixes and re-sends)
//   disable   pending | active | paused | rejected | flagged -> disabled (hidden, reason sent)
//   enable    disabled | flagged              -> active
// Drafts are private to the seller and never shown here.
const { Op } = require('sequelize');
const { sequelize, Listing, ListingPhoto, Category, Location, User, Admin } = require('../models');
const ApiError = require('../utils/ApiError');
const { getPagination, paginationMeta } = require('../utils/pagination');
const { toCsvLine } = require('../utils/csv');
const { USER_STATUS_LABELS } = require('../utils/constants');
const { LISTING_STATUS, LISTING_STATUS_LABELS } = require('../config/listingOptions');
const directory = require('./userDirectory');
const emailService = require('./email.service');
const vatHold = require('./vatHold.service');
const { baseShape, missingForReview } = require('./listing.service');
const { sellerShape } = require('./marketplace.service');

const S = LISTING_STATUS;

const ACTIONS = {
  approve: { from: [S.PENDING], to: S.ACTIVE, label: 'approved' },
  reject: { from: [S.PENDING], to: S.REJECTED, label: 'rejected' },
  flag: { from: [S.PENDING, S.ACTIVE, S.PAUSED], to: S.FLAGGED, label: 'flagged' },
  disable: { from: [S.PENDING, S.ACTIVE, S.PAUSED, S.REJECTED, S.FLAGGED], to: S.DISABLED, label: 'disabled' },
  enable: { from: [S.DISABLED, S.FLAGGED], to: S.ACTIVE, label: 'enabled' },
};
const allowedActions = (status) => Object.keys(ACTIONS).filter((a) => ACTIONS[a].from.includes(status));

const notFound = () => new ApiError(404, 'Listing not found', { code: 'LISTING_NOT_FOUND' });

const adminIncludes = () => [
  { model: User, as: 'seller', attributes: ['id', 'userType', 'status', 'email', 'mobile'] },
  { model: Category, as: 'category', attributes: ['id', 'name', 'slug', 'vatApplicable'] },
  { model: Category, as: 'subCategory', attributes: ['id', 'name', 'slug', 'parentId', 'vatApplicable'] },
  { model: Location, as: 'region', attributes: ['id', 'name'] },
  { model: Location, as: 'inkhundla', attributes: ['id', 'name'] },
  { model: Location, as: 'umphakatsi', attributes: ['id', 'name'] },
  { model: ListingPhoto, as: 'photos', attributes: ['id', 'filePath', 'sortOrder'], separate: true },
];

function toAdmin(listing, dir) {
  return {
    ...baseShape(listing),
    status: listing.status,
    statusLabel: LISTING_STATUS_LABELS[listing.status],
    statusReason: listing.statusReason,
    vatHold: Boolean(listing.vatHold), // hidden from the website: seller needs VAT registration
    allowedActions: allowedActions(listing.status),
    submittedAt: listing.submittedAt,
    reviewedAt: listing.reviewedAt,
    createdAt: listing.createdAt,
    seller: {
      ...sellerShape(listing.userId, dir),
      accountStatus: listing.seller ? listing.seller.status : null,
      accountStatusLabel: listing.seller ? USER_STATUS_LABELS[listing.seller.status] : null,
    },
  };
}

// Filters shared by the list and the CSV export
async function buildWhere(query) {
  // Drafts are private to the seller (the validator doesn't accept status=draft)
  const where = { status: query.status ? query.status : { [Op.ne]: S.DRAFT } };
  if (query.kind) where.kind = query.kind;
  if (query.categoryId) where.categoryId = query.categoryId;
  if (typeof query.vatHold === 'boolean') where.vatHold = query.vatHold;
  if (query.search) {
    const like = `%${query.search}%`;
    const sellerIds = await directory.findUserIdsByName(query.search);
    where[Op.or] = [
      { name: { [Op.like]: like } },
      { sku: { [Op.like]: like } },
      ...(sellerIds.length ? [{ userId: sellerIds }] : []),
    ];
  }
  return where;
}

// ---------- GET /admin/listings/stats ----------
async function stats() {
  const grouped = await Listing.findAll({
    where: { status: { [Op.ne]: S.DRAFT } },
    attributes: ['status', [sequelize.fn('COUNT', sequelize.col('id')), 'total']],
    group: ['status'],
    raw: true,
  });
  const byStatus = Object.fromEntries(Object.values(S).filter((s) => s !== S.DRAFT).map((s) => [s, 0]));
  grouped.forEach((g) => {
    byStatus[g.status] = Number(g.total);
  });
  // Live listings hidden because the seller is not VAT-registered
  const vatHoldCount = await Listing.count({ where: { status: { [Op.ne]: S.DRAFT }, vatHold: true } });
  return {
    totalListings: Object.values(byStatus).reduce((a, b) => a + b, 0),
    vatHold: vatHoldCount,
    pendingReview: byStatus.pending,
    active: byStatus.active,
    flagged: byStatus.flagged,
    disabled: byStatus.disabled,
    byStatus,
  };
}

async function findPage(query, { limit, offset } = {}) {
  const where = await buildWhere(query);
  const include = adminIncludes();
  if (query.sellerType) {
    include[0] = { ...include[0], where: { userType: query.sellerType }, required: true };
  }
  return Listing.findAndCountAll({
    where,
    include,
    order: query.sort === 'oldest' ? [['createdAt', 'ASC'], ['id', 'ASC']] : [['createdAt', 'DESC'], ['id', 'DESC']],
    limit,
    offset,
    distinct: true,
  });
}

// ---------- GET /admin/listings ----------
async function list(query) {
  const pg = getPagination(query);
  const { rows, count } = await findPage(query, { limit: pg.limit, offset: pg.offset });
  const sellers = await directory.findMany(rows.map((r) => r.userId));
  return {
    items: rows.map((r) => toAdmin(r, sellers.get(r.userId))),
    pagination: paginationMeta(pg, count),
  };
}

// ---------- GET /admin/listings/export (CSV) ----------
async function exportCsv(query) {
  const { rows } = await findPage(query, {});
  const sellers = await directory.findMany(rows.map((r) => r.userId));
  const lines = [
    toCsvLine(['ID', 'Listing', 'Type', 'Category', 'Sub-Category', 'Seller', 'Seller Type', 'Price', 'Status', 'Region', 'Listed', 'Reason']),
  ];
  rows.forEach((r) => {
    const a = toAdmin(r, sellers.get(r.userId));
    lines.push(
      toCsvLine([
        a.id,
        a.name,
        a.kind,
        a.category ? a.category.name : '',
        a.subCategory ? a.subCategory.name : '',
        a.seller.name || '',
        a.seller.userTypeLabel || '',
        a.priceLabel || '',
        a.statusLabel,
        a.location.region ? a.location.region.name : '',
        r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : '',
        a.statusReason || '',
      ])
    );
  });
  return `﻿${lines.join('\r\n')}\r\n`; // BOM so Excel reads names correctly
}

// ---------- GET /admin/listings/:id ----------
async function getById(id) {
  const listing = await Listing.findOne({ where: { id, status: { [Op.ne]: S.DRAFT } }, include: adminIncludes() });
  if (!listing) throw notFound();
  const sellers = await directory.findMany([listing.userId]);
  const [coverage, reviewer] = await Promise.all([
    listing.coverageRegionIds && listing.coverageRegionIds.length
      ? Location.findAll({ where: { id: listing.coverageRegionIds }, attributes: ['id', 'name'], order: [['name', 'ASC']] })
      : [],
    listing.reviewedBy ? Admin.findByPk(listing.reviewedBy, { attributes: ['id', 'name'] }) : null,
  ]);
  return {
    ...toAdmin(listing, sellers.get(listing.userId)),
    ...(listing.kind === 'service' ? { coverageRegions: coverage.map((c) => ({ id: c.id, name: c.name })) } : {}),
    sellerContact: listing.seller ? { email: listing.seller.email, mobile: listing.seller.mobile } : null,
    reviewedBy: reviewer ? { id: reviewer.id, name: reviewer.name } : null,
    missingForReview: missingForReview(listing, (listing.photos || []).length),
  };
}

// ---------- status changes ----------
async function changeStatus(id, action, adminId, { reason } = {}) {
  const rule = ACTIONS[action];
  const result = await sequelize.transaction(async (transaction) => {
    const listing = await Listing.findOne({
      where: { id, status: { [Op.ne]: S.DRAFT } },
      include: [{ model: User, as: 'seller', attributes: ['id', 'userType', 'email'] }],
      transaction,
    });
    if (!listing) throw notFound();
    if (!rule.from.includes(listing.status)) {
      const allowed = allowedActions(listing.status);
      throw new ApiError(
        409,
        `This listing can't be ${rule.label} while it is "${LISTING_STATUS_LABELS[listing.status]}".` +
          (allowed.length ? ` Possible actions: ${allowed.join(', ')}.` : ''),
        { code: 'INVALID_STATUS_CHANGE' }
      );
    }
    const now = new Date();
    await listing.update(
      {
        status: rule.to,
        statusReason: reason || null,
        reviewedAt: now,
        reviewedBy: adminId,
        ...(rule.to === S.ACTIVE && !listing.publishedAt ? { publishedAt: now } : {}),
      },
      { transaction }
    );
    // Approving a VAT item of a seller who lost VAT registration in the meantime -> hidden (vatHold)
    await vatHold.forListing(listing.id, { transaction });
    return listing;
  });

  // Tell the seller (a failed email never fails the action)
  if (result.seller) {
    directory
      .findOne(result.userId)
      .then((dir) =>
        emailService.sendListingStatusEmail({
          to: result.seller.email,
          name: dir ? dir.display_name : '',
          userType: result.seller.userType,
          listingName: result.name,
          action,
          reason,
        })
      )
      .catch((err) => console.error(`Listing email failed for listing ${result.id}:`, err.message));
  }
  return getById(id);
}

const approve = (id, adminId) => changeStatus(id, 'approve', adminId);
const reject = (id, adminId, data) => changeStatus(id, 'reject', adminId, data);
const flag = (id, adminId, data) => changeStatus(id, 'flag', adminId, data);
const disable = (id, adminId, data) => changeStatus(id, 'disable', adminId, data);
const enable = (id, adminId) => changeStatus(id, 'enable', adminId);

module.exports = { stats, list, exportCsv, getById, approve, reject, flag, disable, enable, ACTIONS };
