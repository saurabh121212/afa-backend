// Chat conversations of the logged-in account (/me/conversations). Input is already validated.
const asyncHandler = require('../../utils/asyncHandler');
const service = require('../../services/chat/conversation.service');

// GET /me/conversations
const list = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await service.list(req.user, req.validated) });
});

// GET /me/conversations/unread-count
const unreadCount = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await service.unreadTotal(req.user) });
});

// GET /me/conversations/lookup?contextType=listing&contextId=42
const lookup = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await service.lookup(req.user, req.validated) });
});

// POST /me/conversations
const start = asyncHandler(async (req, res) => {
  const data = await service.start(req.user, req.validated, req.file);
  res.status(data.created ? 201 : 200).json({ success: true, message: 'Message sent', data });
});

// GET /me/conversations/:id
const getOne = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await service.getOne(req.user, req.validated.id) });
});

// GET /me/conversations/:id/messages
const messages = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await service.messages(req.user, req.validated.id, req.validated) });
});

// POST /me/conversations/:id/messages
const send = asyncHandler(async (req, res) => {
  const data = await service.send(req.user, req.validated.id, req.validated, req.file);
  res.status(201).json({ success: true, message: 'Message sent', data });
});

// PATCH /me/conversations/:id/read
const markRead = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await service.markRead(req.user, req.validated.id, req.validated) });
});

// GET /me/conversations/:id/messages/:messageId/image   (participants only)
const image = asyncHandler(async (req, res) => {
  const { fullPath, mimeType } = await service.image(req.user, req.validated.id, req.validated.messageId);
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Cache-Control', 'private, max-age=86400'); // only this browser keeps a copy
  res.sendFile(fullPath, (err) => {
    if (err && !res.headersSent) res.status(404).json({ success: false, message: 'Image not found', code: 'FILE_NOT_FOUND' });
  });
});

module.exports = { list, unreadCount, lookup, start, getOne, messages, send, image, markRead };
