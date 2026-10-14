// KYC document endpoints, shared by every user type's routes (farmer.routes.js, buyer.routes.js, ...).
const asyncHandler = require('../utils/asyncHandler');
const documentService = require('../services/document.service');
const { documentOptions } = require('../services/userTypes.registry');

// GET .../register/documents
const list = asyncHandler(async (req, res) => {
  const { subtype, subtypeLabel } = await documentOptions(req.user);
  const data = await documentService.list(req.user, { subtype, subtypeLabel });
  res.json({ success: true, data });
});

// POST .../register/documents/:documentType   (form-data, field "file")
const upload = asyncHandler(async (req, res) => {
  const data = await documentService.upload(req.user, req.params.documentType, req.file);
  res.status(201).json({ success: true, message: `${data.label} uploaded`, data });
});

// DELETE .../register/documents/:documentType
const remove = asyncHandler(async (req, res) => {
  await documentService.remove(req.user, req.params.documentType);
  res.json({ success: true, message: 'Document removed' });
});

// GET .../register/documents/:documentType/file
const viewFile = asyncHandler(async (req, res, next) => {
  const { fullPath, mimeType, originalName } = await documentService.getFile(
    req.user,
    req.params.documentType
  );
  res.setHeader('Content-Type', mimeType);
  // "inline" = open in the browser / app viewer instead of downloading
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(originalName)}`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.sendFile(fullPath, (err) => {
    if (err && !res.headersSent) next(err);
  });
});

// POST .../register/documents/continue
const completeStep = asyncHandler(async (req, res) => {
  const options = await documentOptions(req.user);
  const data = await documentService.completeStep(req.user, options);
  res.json({ success: true, message: 'Documents step completed. Continue to Account Security.', data });
});

module.exports = { list, upload, remove, viewFile, completeStep };
