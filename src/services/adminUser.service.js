// ADMIN: user management + approval (Module B).
//
// Status changes the admin can make:
//   approve      pending_approval            -> approved (warns about missing / unreviewed documents)
//   reject       pending_approval            -> rejected (final)
//   suspend      approved | pending_approval -> suspended
//   reactivate   suspended -> approved (or pending_approval if it was never approved)
// Documents are managed separately: users can upload them any time, and the admin
// approves / rejects each one (PATCH .../documents/:documentType/review).
const { sequelize, User, UserDocument, AdminNote, Admin } = require('../models');
const ApiError = require('../utils/ApiError');
const { getPagination, paginationMeta } = require('../utils/pagination');
const { toCsvLine } = require('../utils/csv');
const { displayId } = require('../utils/displayId');
const { USER_STATUS, USER_STATUS_LABELS, USER_TYPE_LABELS, USER_TYPES } = require('../utils/constants');
const { getDocumentTypes, isAvailableFor, countsForKyc, VAT_CERTIFICATE_TYPE } = require('../config/documentTypes');
const vatService = require('./vat.service');
const adminVatService = require('./adminVat.service');
const directory = require('./userDirectory');
const documentService = require('./document.service');
const emailService = require('./email.service');
const { loadUserWithProfile } = require('./registration.service');
const paymentMethodService = require('./paymentMethod.service');

const S = USER_STATUS;

// Which actions are possible from which status
const ACTIONS = {
  approve: [S.PENDING_APPROVAL],
  reject: [S.PENDING_APPROVAL],
  suspend: [S.APPROVED, S.PENDING_APPROVAL],
  reactivate: [S.SUSPENDED],
};
const allowedActions = (status) => Object.keys(ACTIONS).filter((a) => ACTIONS[a].includes(status));

const ACTION_LABEL = {
  approve: 'approved',
  reject: 'rejected',
  suspend: 'suspended',
  reactivate: 'reactivated',
};

// ---------- Documents summary (used by details + KYC queue) ----------
// docs = UserDocument rows (or plain objects with documentType/status)
// "items" lists every document; the counts only include documents that are part of the
// account check (countsForKyc), so the optional VAT certificate never shows as "missing".
function documentSummary(userType, subtype, docs) {
  const byType = new Map(docs.map((d) => [d.documentType, d]));
  const items = Object.entries(getDocumentTypes(userType))
    .filter(([, rules]) => isAvailableFor(rules, subtype))
    .map(([documentType, rules]) => {
      const doc = byType.get(documentType);
      return {
        documentType,
        label: rules.label,
        required: rules.required,
        countsForKyc: countsForKyc(rules),
        status: doc ? doc.status : 'missing', // missing | pending | approved | rejected
        document: doc && typeof doc.toJSON === 'function' ? doc.toJSON() : doc || null,
      };
    });
  const kycItems = items.filter((i) => i.countsForKyc);
  const count = (st) => kycItems.filter((i) => i.status === st).length;
  return {
    total: kycItems.length,
    uploaded: kycItems.length - count('missing'),
    approved: count('approved'),
    pending: count('pending'),
    rejected: count('rejected'),
    missing: count('missing'),
    items,
  };
}

// ---------- List rows ----------
function toListItem(row) {
  const joined = row.created_at;
  return {
    id: row.id,
    displayId: displayId(row.user_type, row.id),
    userType: row.user_type,
    userTypeLabel: USER_TYPE_LABELS[row.user_type],
    name: row.display_name,
    subName: row.sub_name,
    tin: row.tin,
    email: row.email,
    mobile: row.mobile,
    region: row.region_id ? { id: row.region_id, name: row.region_name } : null,
    status: row.status,
    statusLabel: USER_STATUS_LABELS[row.status],
    joinedAt: joined,
    submittedAt: row.submitted_at,
    trustScore: null, // filled in by the credit score module later
  };
}

// GET /admin/users
async function list(query) {
  const pg = getPagination(query);
  const { rows, total } = await directory.findUsers(query, {
    sort: query.sort,
    limit: pg.limit,
    offset: pg.offset,
  });
  return { items: rows.map(toListItem), pagination: paginationMeta(pg, total) };
}

// GET /admin/users/stats
async function stats() {
  const rows = await sequelize.query(
    `SELECT status, user_type, COUNT(*) AS total
       FROM users WHERE deleted_at IS NULL
      GROUP BY status, user_type`,
    { type: sequelize.QueryTypes.SELECT }
  );
  const byStatus = Object.fromEntries(Object.values(S).map((s) => [s, 0]));
  const byUserType = Object.fromEntries(USER_TYPES.map((t) => [t, 0]));
  let total = 0;
  rows.forEach((r) => {
    const n = Number(r.total);
    total += n;
    byStatus[r.status] = (byStatus[r.status] || 0) + n;
    byUserType[r.user_type] = (byUserType[r.user_type] || 0) + n;
  });
  return {
    totalUsers: total,
    active: byStatus[S.APPROVED],
    pendingVerification: byStatus[S.PENDING_APPROVAL],
    suspended: byStatus[S.SUSPENDED],
    byStatus,
    byUserType,
  };
}

// GET /admin/users/export  -> CSV text (same filters as the list, max 10,000 rows)
const EXPORT_LIMIT = 10000;
async function exportCsv(query) {
  const { rows } = await directory.findUsers(query, { sort: query.sort, limit: EXPORT_LIMIT, offset: 0 });
  const date = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
  const lines = [
    toCsvLine(['User ID', 'Name / Business', 'Details', 'Role', 'Email', 'Mobile', 'TIN / ID', 'Region', 'Status', 'Joined', 'Submitted']),
    ...rows.map((r) =>
      toCsvLine([
        displayId(r.user_type, r.id),
        r.display_name,
        r.sub_name,
        USER_TYPE_LABELS[r.user_type],
        r.email,
        r.mobile,
        r.tin,
        r.region_name,
        USER_STATUS_LABELS[r.status],
        date(r.created_at),
        date(r.submitted_at),
      ])
    ),
  ];
  return `﻿${lines.join('\r\n')}\r\n`; // BOM so Excel opens it as UTF-8
}

// ---------- Details ----------
async function findUserOr404(id) {
  const user = await User.findByPk(id);
  if (!user) throw new ApiError(404, 'User not found', { code: 'USER_NOT_FOUND' });
  return user;
}

async function notesOf(userId) {
  const notes = await AdminNote.findAll({
    where: { userId },
    include: [{ model: Admin, as: 'admin', attributes: ['id', 'name'] }],
    order: [['createdAt', 'DESC']],
  });
  return notes.map((n) => n.toJSON());
}

// GET /admin/users/:id
async function getDetails(id) {
  await findUserOr404(id);
  const [user, dir, docs, notes, paymentMethods] = await Promise.all([
    loadUserWithProfile(id),
    directory.findOne(id),
    UserDocument.findAll({ where: { userId: id }, order: [['documentType', 'ASC']] }),
    notesOf(id),
    paymentMethodService.listFor(id), // read-only for the admin (account numbers masked)
  ]);
  return {
    displayId: displayId(user.userType, user.id),
    name: dir ? dir.display_name : null,
    subName: dir ? dir.sub_name : null,
    region: dir && dir.region_id ? { id: dir.region_id, name: dir.region_name } : null,
    userTypeLabel: USER_TYPE_LABELS[user.userType],
    statusLabel: USER_STATUS_LABELS[user.status],
    allowedActions: allowedActions(user.status),
    user,
    documents: documentSummary(user.userType, dir ? dir.subtype : null, docs),
    // Sellers only (null for buyers / FIs). Approve / reject comes in the VAT admin actions.
    vat: vatService.isSellerType(user.userType)
      ? vatService.vatInfo(user, docs.find((d) => d.documentType === VAT_CERTIFICATE_TYPE) || null)
      : null,
    notes,
    paymentMethods: paymentMethodService.isAllowed(user.userType) ? paymentMethods : null,
    trustScore: null,
  };
}

// GET /admin/users/:id/documents/:documentType/file
async function getDocumentFile(id, documentType) {
  const user = await findUserOr404(id);
  return documentService.getFile(user, documentType);
}

// PATCH /admin/users/:id/documents/:documentType/review   { status, reason }
async function reviewDocument(id, documentType, { status, reason }, adminId) {
  await findUserOr404(id);
  const doc = await UserDocument.findOne({ where: { userId: id, documentType } });
  if (!doc) {
    throw new ApiError(404, 'This document has not been uploaded yet', { code: 'DOCUMENT_NOT_FOUND' });
  }
  await doc.update({
    status,
    rejectionReason: status === 'rejected' ? reason : null,
    reviewedAt: new Date(),
    reviewedBy: adminId,
  });

  // The VAT certificate also decides the seller's VAT status (see adminVat.service)
  if (documentType === VAT_CERTIFICATE_TYPE) {
    const vatStatus = await adminVatService.onCertificateReviewed(id, { status, reason }, adminId);
    if (vatStatus) return { ...doc.toJSON(), vatStatus };
  }
  return doc.toJSON();
}

// ---------- Status changes ----------
async function changeStatus(id, action, adminId, apply) {
  const user = await findUserOr404(id);
  if (!ACTIONS[action].includes(user.status)) {
    const allowed = allowedActions(user.status);
    throw new ApiError(
      409,
      `This user can't be ${ACTION_LABEL[action]} while their status is "${USER_STATUS_LABELS[user.status]}".` +
        (allowed.length ? ` Possible actions: ${allowed.join(', ')}.` : ' No actions are possible right now.'),
      { code: 'INVALID_STATUS_CHANGE' }
    );
  }
  const now = new Date();
  const changes = apply(user, now);
  await user.update({ ...changes, statusChangedAt: now, statusChangedBy: adminId });
  return user;
}

// Name for emails (fire-and-forget: a failed email never fails the action)
function notify(user, sendFn, extra = {}) {
  directory
    .findOne(user.id)
    .then((dir) => sendFn({ to: user.email, name: dir ? dir.display_name : '', userType: user.userType, ...extra }))
    .catch((err) => console.error(`Status email failed for user ${user.id}:`, err.message));
}

const statusResult = (user, extra = {}) => ({
  id: user.id,
  status: user.status,
  statusLabel: USER_STATUS_LABELS[user.status],
  statusReason: user.statusReason,
  allowedActions: allowedActions(user.status),
  ...extra,
});

// POST /admin/users/:id/approve  -> approves even with missing documents, but warns
async function approve(id, adminId) {
  const user = await changeStatus(id, 'approve', adminId, (u, now) => ({
    status: S.APPROVED,
    approvedAt: now,
    statusReason: null,
    rejectionReason: null,
  }));

  const dir = await directory.findOne(id);
  const docs = await UserDocument.findAll({ where: { userId: id } });
  const summary = documentSummary(user.userType, dir ? dir.subtype : null, docs);
  const warnings = [];
  const kycItems = summary.items.filter((i) => i.countsForKyc); // the VAT certificate is checked separately
  const missing = kycItems.filter((i) => i.status === 'missing').map((i) => i.label);
  const notApproved = kycItems.filter((i) => ['pending', 'rejected'].includes(i.status)).map((i) => `${i.label} (${i.status})`);
  if (missing.length) warnings.push({ type: 'MISSING_DOCUMENTS', message: `Missing documents: ${missing.join(', ')}`, documents: missing });
  if (notApproved.length) {
    warnings.push({ type: 'DOCUMENTS_NOT_APPROVED', message: `Documents not approved: ${notApproved.join(', ')}`, documents: notApproved });
  }

  notify(user, emailService.sendAccountApprovedEmail);
  return statusResult(user, { warnings });
}

// POST /admin/users/:id/reject   { reason }   (final)
async function reject(id, { reason }, adminId) {
  const user = await changeStatus(id, 'reject', adminId, () => ({
    status: S.REJECTED,
    statusReason: reason,
    rejectionReason: reason,
  }));
  notify(user, emailService.sendAccountRejectedEmail, { reason });
  return statusResult(user);
}

// POST /admin/users/:id/suspend   { reason }  (blocks login immediately)
async function suspend(id, { reason }, adminId) {
  const user = await changeStatus(id, 'suspend', adminId, () => ({
    status: S.SUSPENDED,
    statusReason: reason,
  }));
  notify(user, emailService.sendAccountSuspendedEmail, { reason });
  return statusResult(user);
}

// POST /admin/users/:id/reactivate
async function reactivate(id, adminId) {
  const user = await changeStatus(id, 'reactivate', adminId, (u) => ({
    status: u.approvedAt ? S.APPROVED : S.PENDING_APPROVAL,
    statusReason: null,
  }));
  notify(user, emailService.sendAccountReactivatedEmail);
  return statusResult(user);
}

// ---------- Internal notes ----------
async function listNotes(id) {
  await findUserOr404(id);
  return notesOf(id);
}

async function addNote(id, { note }, adminId) {
  await findUserOr404(id);
  const created = await AdminNote.create({ userId: id, adminId, note });
  const withAdmin = await AdminNote.findByPk(created.id, {
    include: [{ model: Admin, as: 'admin', attributes: ['id', 'name'] }],
  });
  return withAdmin.toJSON();
}

module.exports = {
  list,
  stats,
  exportCsv,
  getDetails,
  getDocumentFile,
  reviewDocument,
  approve,
  reject,
  suspend,
  reactivate,
  listNotes,
  addNote,
  documentSummary,
  toListItem,
};
