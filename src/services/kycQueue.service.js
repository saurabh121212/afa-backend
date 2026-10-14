// ADMIN KYC module:
//   1. Approval queue  -> users who submitted their registration and wait for the admin
//                         (status "pending_approval")
//   2. Documents to review -> every uploaded KYC document waiting for review, from ANY user
//                         (also approved users, who can upload documents later from their account)
const { Op } = require('sequelize');
const { User, UserDocument } = require('../models');
const { getPagination, paginationMeta } = require('../utils/pagination');
const {
  USER_STATUS,
  USER_STATUS_LABELS,
  USER_TYPE_LABELS,
  KYC_URGENT_AFTER_DAYS,
  BUSINESS_UTC_OFFSET_MINUTES,
} = require('../utils/constants');
const { getDocumentType } = require('../config/documentTypes');
const { displayId } = require('../utils/displayId');
const directory = require('./userDirectory');
const { toListItem, documentSummary } = require('./adminUser.service');

const DAY_MS = 24 * 60 * 60 * 1000;

// Start of "today" in Eswatini time (UTC+2), as a real Date
function startOfToday(now = new Date()) {
  const offsetMs = BUSINESS_UTC_OFFSET_MINUTES * 60 * 1000;
  const local = new Date(now.getTime() + offsetMs);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - offsetMs);
}

const urgentCutoff = (now = new Date()) => new Date(now.getTime() - KYC_URGENT_AFTER_DAYS * DAY_MS);

// GET /admin/kyc-queue/stats
async function stats() {
  const today = startOfToday();
  const [totalPending, urgent, approvedToday, rejectedToday, documentsToReview] = await Promise.all([
    directory.countUsers({ status: USER_STATUS.PENDING_APPROVAL }),
    directory.countUsers({ status: USER_STATUS.PENDING_APPROVAL, submittedBefore: urgentCutoff() }),
    User.count({ where: { status: USER_STATUS.APPROVED, approvedAt: { [Op.gte]: today } } }),
    User.count({ where: { status: USER_STATUS.REJECTED, statusChangedAt: { [Op.gte]: today } } }),
    directory.findDocuments({ status: 'pending' }, { limit: 1 }).then((r) => r.total),
  ]);
  return {
    totalPending,
    urgent,
    approvedToday,
    rejectedToday,
    documentsToReview, // uploaded documents not reviewed yet (all users)
    urgentAfterDays: KYC_URGENT_AFTER_DAYS,
  };
}

// GET /admin/kyc-queue?search=&userType=&priority=urgent|normal&sort=oldest|newest&page=&limit=
async function list(query) {
  const pg = getPagination(query);
  const now = new Date();
  const filters = {
    search: query.search,
    userType: query.userType,
    status: USER_STATUS.PENDING_APPROVAL,
  };
  if (query.priority === 'urgent') filters.submittedBefore = urgentCutoff(now);
  if (query.priority === 'normal') filters.submittedAfter = urgentCutoff(now);

  const { rows, total } = await directory.findUsers(filters, {
    sort: query.sort === 'newest' ? 'submitted_newest' : 'submitted_oldest',
    limit: pg.limit,
    offset: pg.offset,
  });

  // Documents of everyone on this page, in one query
  const ids = rows.map((r) => r.id);
  const docs = ids.length
    ? await UserDocument.findAll({ where: { userId: ids }, attributes: ['userId', 'documentType', 'status'] })
    : [];
  const docsByUser = new Map();
  docs.forEach((d) => {
    if (!docsByUser.has(d.userId)) docsByUser.set(d.userId, []);
    docsByUser.get(d.userId).push({ documentType: d.documentType, status: d.status });
  });

  const items = rows.map((row) => {
    const summary = documentSummary(row.user_type, row.subtype, docsByUser.get(row.id) || []);
    const waitingMs = row.submitted_at ? now - new Date(row.submitted_at) : 0;
    const daysWaiting = Math.floor(waitingMs / DAY_MS);
    return {
      ...toListItem(row),
      daysWaiting,
      urgent: waitingMs > KYC_URGENT_AFTER_DAYS * DAY_MS, // same rule as the "Urgent" stat
      documents: {
        uploaded: summary.uploaded,
        total: summary.total,
        approved: summary.approved,
        rejected: summary.rejected,
        missing: summary.missing,
      },
      // Figma "Ready for approval": every document uploaded and none rejected.
      // (Approve still works without this - it just returns a warning.)
      readyForApproval: summary.missing === 0 && summary.rejected === 0,
    };
  });

  return { items, pagination: paginationMeta(pg, total) };
}

// GET /admin/kyc-queue/documents?status=pending&userType=&documentType=&search=&sort=oldest&page=&limit=
// Each item links to the existing admin APIs to open and review the file.
async function listDocuments(query) {
  const pg = getPagination(query);
  const { rows, total } = await directory.findDocuments(
    {
      status: query.status || 'pending',
      userType: query.userType,
      documentType: query.documentType,
      search: query.search,
    },
    { sort: query.sort, limit: pg.limit, offset: pg.offset }
  );

  const items = rows.map((r) => {
    const rules = getDocumentType(r.user_type, r.document_type);
    const base = `/admin/users/${r.user_id}/documents/${r.document_type}`;
    return {
      id: r.id,
      documentType: r.document_type,
      label: rules ? rules.label : r.document_type,
      originalName: r.original_name,
      mimeType: r.mime_type,
      sizeBytes: r.size_bytes,
      status: r.status,
      rejectionReason: r.rejection_reason,
      uploadedAt: r.updated_at, // a replaced file updates this
      reviewedAt: r.reviewed_at,
      user: {
        id: r.user_id,
        displayId: displayId(r.user_type, r.user_id),
        name: r.display_name,
        subName: r.sub_name,
        userType: r.user_type,
        userTypeLabel: USER_TYPE_LABELS[r.user_type],
        status: r.user_status,
        statusLabel: USER_STATUS_LABELS[r.user_status],
        region: r.region_id ? { id: r.region_id, name: r.region_name } : null,
      },
      links: {
        viewFile: `GET ${base}/file`,
        review: `PATCH ${base}/review`,
      },
    };
  });

  return { items, pagination: paginationMeta(pg, total) };
}

module.exports = { stats, list, listDocuments, startOfToday };
