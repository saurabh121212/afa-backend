// Contact Us (Figma "Website - Contact Us") + admin inbox.
//
// Public form -> message saved with status "new"
//   - the sender gets an acknowledgement email with a reference number (AFA-CNT-000123)
//   - the admin gets an alert email
//   - a hidden "website" field (honeypot) catches spam bots: they get a normal answer but nothing is saved
// Admin inbox
//   - opening a "new" message marks it "read"
//   - a reply is emailed to the sender and saved; status -> "replied"
//   - close / reopen; delete = soft delete
const { Op } = require('sequelize');
const { sequelize, ContactMessage, ContactReply, Admin } = require('../models');
const ApiError = require('../utils/ApiError');
const { getPagination, paginationMeta } = require('../utils/pagination');
const { toCsvLine } = require('../utils/csv');
const emailService = require('./email.service');
const { CONTACT_SENDER_TYPES, CONTACT_SUBJECTS, CONTACT_STATUSES } = require('../config/contact');

const reference = (id) => `AFA-CNT-${String(id).padStart(6, '0')}`;
const notFound = () => new ApiError(404, 'Message not found', { code: 'CONTACT_MESSAGE_NOT_FOUND' });
const logEmailError = (what, id) => (err) => console.error(`${what} failed for contact message ${id}:`, err.message);

function toAdmin(m, { withReplies = false } = {}) {
  return {
    id: m.id,
    reference: reference(m.id),
    fullName: m.fullName,
    email: m.email,
    phone: m.phone,
    senderType: m.senderType,
    senderTypeLabel: CONTACT_SENDER_TYPES[m.senderType] || m.senderType,
    subject: m.subject,
    subjectLabel: CONTACT_SUBJECTS[m.subject] || m.subject,
    message: m.message,
    status: m.status,
    statusLabel: CONTACT_STATUSES[m.status],
    readAt: m.readAt,
    repliedAt: m.repliedAt,
    closedAt: m.closedAt,
    createdAt: m.createdAt,
    ...(withReplies
      ? {
          replies: (m.replies || [])
            .slice()
            .sort((a, b) => a.id - b.id)
            .map((r) => ({
              id: r.id,
              message: r.message,
              emailSent: r.emailSent,
              emailError: r.emailError,
              admin: r.admin ? { id: r.admin.id, name: r.admin.name } : null,
              createdAt: r.createdAt,
            })),
          ipAddress: m.ipAddress,
          userAgent: m.userAgent,
        }
      : {}),
  };
}

// ======================= PUBLIC =======================

// POST /contact
//   data -> validated form; meta -> { ip, userAgent, honeypot }
async function submit(data, meta = {}) {
  // Spam bot filled the hidden field: pretend it worked, save nothing
  if (meta.honeypot) {
    return { reference: reference(0), spam: true };
  }

  const msg = await ContactMessage.create({
    fullName: data.fullName,
    email: data.email,
    phone: data.phone || null,
    senderType: data.senderType,
    subject: data.subject,
    message: data.message,
    status: 'new',
    ipAddress: meta.ip ? String(meta.ip).slice(0, 45) : null,
    userAgent: meta.userAgent ? String(meta.userAgent).slice(0, 255) : null,
  });

  const subjectLabel = CONTACT_SUBJECTS[msg.subject];
  // Emails never fail the request
  emailService
    .sendContactAcknowledgementEmail({ to: msg.email, name: msg.fullName, id: msg.id, subjectLabel, message: msg.message })
    .catch(logEmailError('Acknowledgement email', msg.id));
  Admin.findOne({ attributes: ['email'] })
    .then((admin) =>
      admin
        ? emailService.sendContactAdminAlertEmail({
            to: admin.email,
            id: msg.id,
            fullName: msg.fullName,
            email: msg.email,
            phone: msg.phone,
            senderTypeLabel: CONTACT_SENDER_TYPES[msg.senderType],
            subjectLabel,
            message: msg.message,
          })
        : null
    )
    .catch(logEmailError('Admin alert email', msg.id));

  return { reference: reference(msg.id), spam: false };
}

// GET /contact/options -> the form's dropdowns
const toList = (obj) => Object.entries(obj).map(([value, label]) => ({ value, label }));
const options = () => ({ senderTypes: toList(CONTACT_SENDER_TYPES), subjects: toList(CONTACT_SUBJECTS) });

// ======================= ADMIN =======================

// Filters shared by the list and the CSV export
function buildWhere(query = {}) {
  const where = {};
  if (query.status) where.status = query.status;
  if (query.subject) where.subject = query.subject;
  if (query.senderType) where.senderType = query.senderType;
  if (query.search) {
    const like = `%${query.search}%`;
    where[Op.or] = [
      { fullName: { [Op.like]: like } },
      { email: { [Op.like]: like } },
      { phone: { [Op.like]: like } },
      { message: { [Op.like]: like } },
    ];
  }
  if (query.from || query.to) {
    where.createdAt = {
      ...(query.from ? { [Op.gte]: query.from } : {}),
      ...(query.to ? { [Op.lte]: query.to } : {}),
    };
  }
  return where;
}

// GET /admin/contact-messages/stats
async function stats() {
  const grouped = await ContactMessage.findAll({
    attributes: ['status', [sequelize.fn('COUNT', sequelize.col('id')), 'total']],
    group: ['status'],
    raw: true,
  });
  const byStatus = Object.fromEntries(Object.keys(CONTACT_STATUSES).map((s) => [s, 0]));
  grouped.forEach((g) => {
    byStatus[g.status] = Number(g.total);
  });
  return {
    total: Object.values(byStatus).reduce((a, b) => a + b, 0),
    new: byStatus.new, // unread badge
    read: byStatus.read,
    replied: byStatus.replied,
    closed: byStatus.closed,
    open: byStatus.new + byStatus.read, // still need an answer
  };
}

// GET /admin/contact-messages
async function list(query) {
  const pg = getPagination(query);
  const { rows, count } = await ContactMessage.findAndCountAll({
    where: buildWhere(query),
    order: query.sort === 'oldest' ? [['createdAt', 'ASC'], ['id', 'ASC']] : [['createdAt', 'DESC'], ['id', 'DESC']],
    limit: pg.limit,
    offset: pg.offset,
  });
  return { items: rows.map((m) => toAdmin(m)), pagination: paginationMeta(pg, count) };
}

// GET /admin/contact-messages/export (CSV)
async function exportCsv(query) {
  const rows = await ContactMessage.findAll({ where: buildWhere(query), order: [['createdAt', 'DESC'], ['id', 'DESC']] });
  const lines = [toCsvLine(['Reference', 'Date', 'Name', 'Email', 'Phone', 'I am a', 'Subject', 'Status', 'Message'])];
  rows.forEach((r) => {
    const m = toAdmin(r);
    lines.push(
      toCsvLine([
        m.reference,
        new Date(m.createdAt).toISOString().slice(0, 16).replace('T', ' '),
        m.fullName,
        m.email,
        m.phone || '',
        m.senderTypeLabel,
        m.subjectLabel,
        m.statusLabel,
        m.message,
      ])
    );
  });
  return `﻿${lines.join('\r\n')}\r\n`;
}

async function findOr404(id, transaction) {
  const msg = await ContactMessage.findByPk(id, {
    include: [{ model: ContactReply, as: 'replies', include: [{ model: Admin, as: 'admin', attributes: ['id', 'name'] }] }],
    transaction,
  });
  if (!msg) throw notFound();
  return msg;
}

// GET /admin/contact-messages/:id   (opening a "new" message marks it "read")
async function getById(id, adminId) {
  const msg = await findOr404(id);
  if (msg.status === 'new') await msg.update({ status: 'read', readAt: new Date(), readBy: adminId });
  return toAdmin(msg, { withReplies: true });
}

// POST /admin/contact-messages/:id/reply   { message }
// The reply is saved even when the email can't be sent (emailSent: false + the error), so it can be retried.
async function reply(id, { message }, adminId) {
  const msg = await findOr404(id);
  const now = new Date();
  const saved = await ContactReply.create({ contactMessageId: msg.id, adminId, message, emailSent: false });

  try {
    await emailService.sendContactReplyEmail({
      to: msg.email,
      name: msg.fullName,
      id: msg.id,
      subjectLabel: CONTACT_SUBJECTS[msg.subject] || msg.subject,
      originalMessage: msg.message,
      reply: message,
    });
    await saved.update({ emailSent: true });
  } catch (err) {
    await saved.update({ emailError: String(err.message || 'Email failed').slice(0, 255) });
  }

  await msg.update({
    status: 'replied',
    repliedAt: now,
    closedAt: null,
    ...(msg.readAt ? {} : { readAt: now, readBy: adminId }),
  });
  const fresh = await findOr404(id);
  return { message: toAdmin(fresh, { withReplies: true }), emailSent: saved.emailSent };
}

// PATCH /admin/contact-messages/:id/status   { status: 'read' | 'closed' }  (mark read / close / reopen)
async function setStatus(id, { status }, adminId) {
  const msg = await findOr404(id);
  const now = new Date();
  if (status === 'closed') {
    await msg.update({ status: 'closed', closedAt: now, ...(msg.readAt ? {} : { readAt: now, readBy: adminId }) });
  } else if (status === 'read') {
    // Reopen a closed message (back to "replied" if it was answered) or mark a new one read
    const back = msg.repliedAt ? 'replied' : 'read';
    await msg.update({ status: back, closedAt: null, ...(msg.readAt ? {} : { readAt: now, readBy: adminId }) });
  } else if (status === 'new') {
    await msg.update({ status: 'new', readAt: null, readBy: null, closedAt: null }); // "mark as unread"
  }
  return toAdmin(await findOr404(id), { withReplies: true });
}

// DELETE /admin/contact-messages/:id   (soft delete; replies are kept)
async function remove(id) {
  const msg = await findOr404(id);
  await msg.destroy();
  return { id: msg.id, reference: reference(msg.id) };
}

module.exports = { submit, options, stats, list, exportCsv, getById, reply, setStatus, remove, reference };
