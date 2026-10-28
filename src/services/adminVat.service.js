// ADMIN: review sellers' VAT registration (farmer, trader, logistics).
//
//   approve -> pending  -> approved   (+ the VAT certificate document is approved)
//   reject  -> pending  -> rejected   (+ the certificate is rejected with the same reason)
//   remove  -> approved -> rejected   (e.g. ERS cancelled it / certificate no longer valid;
//                                      the certificate is rejected too, so the seller must
//                                      upload a new one before applying again)
//
// Reviewing the certificate from the KYC screens does the same (onCertificateReviewed),
// so the document and the VAT status never disagree.
// The admin checks that the TIN on the certificate matches the seller's TIN on AFA ("tin").
const { Op } = require('sequelize');
const { sequelize, User, UserDocument } = require('../models');
const ApiError = require('../utils/ApiError');
const directory = require('./userDirectory');
const vatService = require('./vat.service');
const { displayId } = require('../utils/displayId');
const { USER_TYPE_LABELS, USER_STATUS_LABELS } = require('../utils/constants');
const { getPagination, paginationMeta } = require('../utils/pagination');
const { VAT_STATUS, VAT_STATUS_LABELS, VAT_SELLER_TYPES } = require('../config/vat');
const { VAT_CERTIFICATE_TYPE } = require('../config/documentTypes');

const notFound = () => new ApiError(404, 'Seller not found', { code: 'USER_NOT_FOUND' });

const certificateFileUrl = (userId) => `/admin/users/${userId}/documents/${VAT_CERTIFICATE_TYPE}/file`;

// Seller row (locked) + certificate, inside a transaction
async function loadSeller(userId, transaction) {
  const user = await User.findByPk(userId, { transaction, lock: transaction.LOCK.UPDATE });
  if (!user) throw notFound();
  if (!VAT_SELLER_TYPES.includes(user.userType)) {
    throw new ApiError(422, 'VAT registration is only for farmers, traders and logistics providers', {
      code: 'NOT_A_SELLER',
    });
  }
  const certificate = await UserDocument.findOne({
    where: { userId, documentType: VAT_CERTIFICATE_TYPE },
    transaction,
  });
  return { user, certificate };
}

function requireStatus(user, allowed, action) {
  if (allowed.includes(user.vatStatus)) return;
  throw new ApiError(
    409,
    `Cannot ${action}: VAT status is "${VAT_STATUS_LABELS[user.vatStatus]}"`,
    { code: 'VAT_STATUS_CONFLICT' }
  );
}

const reviewValues = (adminId, now) => ({ vatReviewedAt: now, vatReviewedBy: adminId });

// The result every admin action returns: the seller's VAT block (same as GET /admin/users/:id)
async function result(user, certificate) {
  const dir = (await directory.findMany([user.id])).get(user.id);
  return {
    userId: user.id,
    displayId: displayId(user.userType, user.id),
    name: dir ? dir.display_name : null,
    tin: dir ? dir.tin : null,
    vat: vatService.vatInfo(user, certificate),
  };
}

// ---------- POST /admin/vat-registrations/:userId/approve ----------
async function approve(userId, adminId) {
  const out = await vatService.runChange(async (transaction) => {
    const { user, certificate } = await loadSeller(userId, transaction);
    requireStatus(user, [VAT_STATUS.PENDING], 'approve');
    if (!certificate) {
      throw new ApiError(422, 'The seller has not uploaded a VAT Registration Certificate', {
        code: 'VAT_CERTIFICATE_REQUIRED',
      });
    }
    const now = new Date();
    await certificate.update(
      { status: 'approved', rejectionReason: null, reviewedAt: now, reviewedBy: adminId },
      { transaction }
    );
    const change = await vatService.changeStatus(
      user,
      VAT_STATUS.APPROVED,
      { vatStatusReason: null, ...reviewValues(adminId, now) },
      { transaction }
    );
    return { user, certificate, change };
  });
  return { ...(await result(out.user, out.certificate)), ...vatService.holdCounts(out.change) };
}

// Reject (pending) or remove (approved): VAT -> rejected, certificate -> rejected, same reason
async function rejectWith(userId, reason, adminId, allowed, action) {
  const out = await vatService.runChange(async (transaction) => {
    const { user, certificate } = await loadSeller(userId, transaction);
    requireStatus(user, allowed, action);
    const now = new Date();
    if (certificate) {
      await certificate.update(
        { status: 'rejected', rejectionReason: reason, reviewedAt: now, reviewedBy: adminId },
        { transaction }
      );
    }
    const change = await vatService.changeStatus(
      user,
      VAT_STATUS.REJECTED,
      { vatStatusReason: reason, ...reviewValues(adminId, now) },
      { transaction }
    );
    return { user, certificate, change };
  });
  return { ...(await result(out.user, out.certificate)), ...vatService.holdCounts(out.change) };
}

// ---------- POST /admin/vat-registrations/:userId/reject  { reason } ----------
const reject = (userId, { reason }, adminId) => rejectWith(userId, reason, adminId, [VAT_STATUS.PENDING], 'reject');

// ---------- POST /admin/vat-registrations/:userId/remove  { reason } ----------
const remove = (userId, { reason }, adminId) => rejectWith(userId, reason, adminId, [VAT_STATUS.APPROVED], 'remove');

// ---------- hook: PATCH /admin/users/:id/documents/vat_certificate/review ----------
// Keeps VAT in step with the certificate review. Returns the new VAT status, or null if unchanged.
//   certificate approved + VAT pending           -> VAT approved
//   certificate rejected + VAT pending/approved  -> VAT rejected (same reason)
async function onCertificateReviewed(userId, { status, reason }, adminId) {
  const { change } = await vatService.runChange(async (transaction) => {
    const user = await User.findByPk(userId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!user || !VAT_SELLER_TYPES.includes(user.userType)) return { change: null };
    const now = new Date();

    if (status === 'approved' && user.vatStatus === VAT_STATUS.PENDING) {
      const c = await vatService.changeStatus(user, VAT_STATUS.APPROVED, { vatStatusReason: null, ...reviewValues(adminId, now) }, { transaction });
      return { change: c };
    }
    if (status === 'rejected' && [VAT_STATUS.PENDING, VAT_STATUS.APPROVED].includes(user.vatStatus)) {
      const c = await vatService.changeStatus(user, VAT_STATUS.REJECTED, { vatStatusReason: reason, ...reviewValues(adminId, now) }, { transaction });
      return { change: c };
    }
    return { change: null };
  });
  return change ? change.to : null;
}

// ---------- GET /admin/vat-registrations/stats ----------
async function stats() {
  const rows = await User.findAll({
    where: { userType: { [Op.in]: VAT_SELLER_TYPES } },
    attributes: ['vatStatus', [sequelize.fn('COUNT', sequelize.col('id')), 'total']],
    group: ['vatStatus'],
    raw: true,
  });
  const counts = { none: 0, pending: 0, approved: 0, rejected: 0 };
  rows.forEach((r) => {
    counts[r.vatStatus] = Number(r.total);
  });
  return { pending: counts.pending, approved: counts.approved, rejected: counts.rejected, notRegistered: counts.none };
}

// ---------- GET /admin/vat-registrations?status=&userType=&search=&sort=&page=&limit= ----------
// Default: every seller who has applied (pending / approved / rejected). Pending: oldest first.
async function list(query = {}) {
  const pg = getPagination(query);
  const where = {
    userType: query.userType ? query.userType : { [Op.in]: VAT_SELLER_TYPES },
    vatStatus: query.status ? query.status : { [Op.ne]: VAT_STATUS.NONE },
  };
  if (query.search) {
    const ids = await directory.findUserIdsByName(query.search);
    where.id = { [Op.in]: ids.length ? ids : [0] };
  }
  const direction = query.sort === 'newest' ? 'DESC' : 'ASC';

  const { rows, count } = await User.findAndCountAll({
    where,
    order: [['vatRequestedAt', direction], ['id', direction]],
    limit: pg.limit,
    offset: pg.offset,
  });

  const ids = rows.map((u) => u.id);
  const [dirs, certs] = await Promise.all([
    directory.findMany(ids),
    ids.length ? UserDocument.findAll({ where: { userId: ids, documentType: VAT_CERTIFICATE_TYPE } }) : [],
  ]);
  const certByUser = new Map(certs.map((c) => [c.userId, c]));

  const items = rows.map((u) => {
    const dir = dirs.get(u.id);
    const certificate = certByUser.get(u.id) || null;
    return {
      userId: u.id,
      displayId: displayId(u.userType, u.id),
      userType: u.userType,
      userTypeLabel: USER_TYPE_LABELS[u.userType],
      name: dir ? dir.display_name : null,
      subName: dir ? dir.sub_name : null,
      tin: dir ? dir.tin : null, // compare with the TIN on the certificate
      email: u.email,
      mobile: u.mobile,
      accountStatus: u.status,
      accountStatusLabel: USER_STATUS_LABELS[u.status],
      vat: vatService.vatInfo(u, certificate),
      certificateFileUrl: certificate ? certificateFileUrl(u.id) : null,
    };
  });

  return { items, pagination: paginationMeta(pg, count) };
}

module.exports = { list, stats, approve, reject, remove, onCertificateReviewed };
