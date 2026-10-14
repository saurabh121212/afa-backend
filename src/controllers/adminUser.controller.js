// ADMIN user management + approval endpoints. Input is already validated (req.validated).
const asyncHandler = require('../utils/asyncHandler');
const service = require('../services/adminUser.service');

const adminId = (req) => req.admin.id;

// GET /admin/users/stats
const stats = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await service.stats() });
});

// GET /admin/users
const list = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await service.list(req.validated) });
});

// GET /admin/users/export
const exportCsv = asyncHandler(async (req, res) => {
  const csv = await service.exportCsv(req.validated);
  const date = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="afa-users-${date}.csv"`);
  res.send(csv);
});

// GET /admin/users/:id
const getDetails = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await service.getDetails(req.validated.id) });
});

// GET /admin/users/:id/documents/:documentType/file
const viewDocument = asyncHandler(async (req, res, next) => {
  const { fullPath, mimeType, originalName } = await service.getDocumentFile(
    req.validated.id,
    req.validated.documentType
  );
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(originalName)}`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.sendFile(fullPath, (err) => {
    if (err && !res.headersSent) next(err);
  });
});

// PATCH /admin/users/:id/documents/:documentType/review
const reviewDocument = asyncHandler(async (req, res) => {
  const { id, documentType, status, reason } = req.validated;
  const data = await service.reviewDocument(id, documentType, { status, reason }, adminId(req));
  res.json({ success: true, message: `Document ${status}`, data });
});

// POST /admin/users/:id/approve
const approve = asyncHandler(async (req, res) => {
  const data = await service.approve(req.validated.id, adminId(req));
  res.json({
    success: true,
    message: data.warnings.length
      ? 'Account approved. Please note the document warnings.'
      : 'Account approved. The user has been notified by email.',
    data,
  });
});

// POST /admin/users/:id/reject
const reject = asyncHandler(async (req, res) => {
  const data = await service.reject(req.validated.id, req.validated, adminId(req));
  res.json({ success: true, message: 'Registration rejected. The user has been notified by email.', data });
});

// POST /admin/users/:id/suspend
const suspend = asyncHandler(async (req, res) => {
  const data = await service.suspend(req.validated.id, req.validated, adminId(req));
  res.json({ success: true, message: 'Account suspended. The user has been notified by email.', data });
});

// POST /admin/users/:id/reactivate
const reactivate = asyncHandler(async (req, res) => {
  const data = await service.reactivate(req.validated.id, adminId(req));
  res.json({ success: true, message: 'Account reactivated. The user has been notified by email.', data });
});

// GET /admin/users/:id/notes
const listNotes = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await service.listNotes(req.validated.id) });
});

// POST /admin/users/:id/notes
const addNote = asyncHandler(async (req, res) => {
  const data = await service.addNote(req.validated.id, req.validated, adminId(req));
  res.status(201).json({ success: true, message: 'Note added', data });
});

module.exports = {
  stats,
  list,
  exportCsv,
  getDetails,
  viewDocument,
  reviewDocument,
  approve,
  reject,
  suspend,
  reactivate,
  listNotes,
  addNote,
};
