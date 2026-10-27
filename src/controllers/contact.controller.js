// Contact Us form (public) + admin inbox. Input is already validated (req.validated).
const asyncHandler = require('../utils/asyncHandler');
const service = require('../services/contact.service');

const adminId = (req) => req.admin.id;

// ======================= PUBLIC =======================

// GET /contact/options
const options = (req, res) => res.json({ success: true, data: service.options() });

// POST /contact
const submit = asyncHandler(async (req, res) => {
  const { reference } = await service.submit(req.validated, {
    ip: req.ip,
    userAgent: req.get('user-agent'),
    honeypot: req.validated.website,
  });
  res.status(201).json({
    success: true,
    message: 'Thank you! Your message has been sent. Our support team will get back to you within one business day.',
    data: { reference },
  });
});

// ======================= ADMIN =======================

const stats = asyncHandler(async (req, res) => res.json({ success: true, data: await service.stats() }));
const list = asyncHandler(async (req, res) => res.json({ success: true, data: await service.list(req.validated) }));

const exportCsv = asyncHandler(async (req, res) => {
  const csv = await service.exportCsv(req.validated);
  const date = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="afa-contact-messages-${date}.csv"`);
  res.send(csv);
});

const getById = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await service.getById(req.validated.id, adminId(req)) });
});

const reply = asyncHandler(async (req, res) => {
  const { message, emailSent } = await service.reply(req.validated.id, req.validated, adminId(req));
  res.status(201).json({
    success: true,
    message: emailSent
      ? `Reply sent to ${message.email}`
      : 'Reply saved, but the email could not be sent. Check the SMTP settings and try again.',
    data: message,
  });
});

const setStatus = asyncHandler(async (req, res) => {
  const data = await service.setStatus(req.validated.id, req.validated, adminId(req));
  res.json({ success: true, message: `Message marked as ${data.statusLabel}`, data });
});

const remove = asyncHandler(async (req, res) => {
  const data = await service.remove(req.validated.id);
  res.json({ success: true, message: `Message ${data.reference} deleted`, data });
});

module.exports = { options, submit, stats, list, exportCsv, getById, reply, setStatus, remove };
