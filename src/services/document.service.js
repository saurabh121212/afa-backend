// KYC documents for ALL user types (list, upload/replace, remove, view, continue).
// Which documents a type can upload comes from config/documentTypes.js.
// "subtype" (e.g. buyer 'individual' / 'business') is passed in by the controller.
const path = require('path');
const fs = require('fs/promises');
const config = require('../config');
const { UserDocument } = require('../models');
const ApiError = require('../utils/ApiError');
const { getDocumentTypes, getDocumentType, isAvailableFor, countsForKyc, VAT_CERTIFICATE_TYPE } = require('../config/documentTypes');
const vatService = require('./vat.service');
const { kindForMimeType, fileMatchesKind, formatLabels } = require('../utils/fileTypes');

const uploadRoot = () => path.resolve(config.upload.dir);

// DB stores paths relative to UPLOAD_DIR; turn into a full path (and refuse anything outside it)
function absolutePath(relativePath) {
  const full = path.resolve(uploadRoot(), relativePath);
  if (!full.startsWith(uploadRoot() + path.sep)) {
    throw new ApiError(400, 'Invalid file path', { code: 'INVALID_FILE_PATH' });
  }
  return full;
}

async function deleteFileQuietly(fullPath) {
  try {
    await fs.unlink(fullPath);
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('Could not delete file:', fullPath, err.message);
  }
}

// GET .../documents -> every document card on the screen + what is already uploaded
//   subtypeLabel -> function turning 'business' into 'Business / Food Processor' (optional)
async function list(user, { subtype = null, subtypeLabel = (s) => s } = {}) {
  const types = getDocumentTypes(user.userType);
  const uploaded = await UserDocument.findAll({ where: { userId: user.id } });
  const byType = new Map(uploaded.map((d) => [d.documentType, d]));

  const documents = Object.entries(types).map(([documentType, rules]) => {
    const doc = byType.get(documentType);
    return {
      documentType,
      label: rules.label,
      description: rules.description,
      acceptedFormats: formatLabels(rules.formats),
      maxSizeMB: rules.maxSizeMB,
      required: rules.required,
      countsForKyc: countsForKyc(rules), // false = optional extra (VAT certificate), not in the counts
      // e.g. "Business / Food Processor accounts only" badge in Figma
      onlyFor: rules.onlyForSubtypes ? rules.onlyForSubtypes.map(subtypeLabel) : null,
      available: isAvailableFor(rules, subtype),
      uploaded: Boolean(doc),
      document: doc ? doc.toJSON() : null,
    };
  });

  return {
    registrationStep: user.registrationStep,
    uploadedCount: documents.filter((d) => d.available && d.countsForKyc && d.uploaded).length,
    totalCount: documents.filter((d) => d.available && d.countsForKyc).length,
    documents,
  };
}

// POST .../documents/:documentType -> save a new file (replaces the old one)
// (The "is this document allowed for you" check already ran in uploadKycDocument.)
async function upload(user, documentType, file) {
  const rules = getDocumentType(user.userType, documentType);
  const kind = kindForMimeType(file.mimetype, rules.formats);

  let document;
  try {
    // The file's real content must match its claimed type
    if (!(await fileMatchesKind(file.path, kind))) {
      throw new ApiError(
        415,
        `This file is not a valid ${formatLabels([kind])}. Allowed: ${formatLabels(rules.formats)}`,
        { code: 'INVALID_FILE_CONTENT' }
      );
    }

    // Store with "/" so the path also works if the server moves from Windows to Linux
    const relativePath = path.relative(uploadRoot(), file.path).split(path.sep).join('/');
    const values = {
      originalName: String(file.originalname || 'document').slice(0, 255),
      filePath: relativePath,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      // A new file always needs a fresh admin review
      status: 'pending',
      rejectionReason: null,
      reviewedAt: null,
      reviewedBy: null,
    };

    const existing = await UserDocument.findOne({ where: { userId: user.id, documentType } });
    if (existing) {
      const oldPath = existing.filePath;
      document = await existing.update(values);
      await deleteFileQuietly(absolutePath(oldPath)); // old file no longer needed
    } else {
      document = await UserDocument.create({ userId: user.id, documentType, ...values });
    }
  } catch (err) {
    // Anything failed -> don't leave the uploaded file lying around
    await deleteFileQuietly(file.path);
    throw err;
  }

  // A new VAT certificate needs a fresh review: approved / rejected VAT goes back to "pending"
  const vatChange = documentType === VAT_CERTIFICATE_TYPE ? await vatService.onCertificateUploaded(user.id) : null;

  return {
    documentType,
    label: rules.label,
    document: document.toJSON(),
    ...(vatChange ? { vatStatus: vatChange.to } : {}),
  };
}

// DELETE .../documents/:documentType -> the "X" on a document card
async function remove(user, documentType) {
  const doc = await UserDocument.findOne({ where: { userId: user.id, documentType } });
  if (!doc) {
    throw new ApiError(404, 'No file has been uploaded for this document', { code: 'DOCUMENT_NOT_FOUND' });
  }
  const filePath = doc.filePath;
  await doc.destroy();
  await deleteFileQuietly(absolutePath(filePath));

  // No certificate = no proof of VAT registration
  const vatChange = documentType === VAT_CERTIFICATE_TYPE ? await vatService.onCertificateRemoved(user.id) : null;
  return { documentType, ...(vatChange ? { vatStatus: vatChange.to } : {}) };
}

// Delete several document types at once (e.g. business documents when a buyer
// switches to individual). Returns the types that were actually removed.
async function removeTypes(userId, documentTypes) {
  if (!documentTypes.length) return [];
  const docs = await UserDocument.findAll({ where: { userId, documentType: documentTypes } });
  const removed = [];
  for (const doc of docs) {
    const filePath = doc.filePath;
    await doc.destroy();
    await deleteFileQuietly(absolutePath(filePath));
    removed.push(doc.documentType);
  }
  return removed;
}

// GET .../documents/:documentType/file -> the user views their own file
async function getFile(user, documentType) {
  const doc = await UserDocument.findOne({ where: { userId: user.id, documentType } });
  if (!doc) {
    throw new ApiError(404, 'No file has been uploaded for this document', { code: 'DOCUMENT_NOT_FOUND' });
  }
  const fullPath = absolutePath(doc.filePath);
  try {
    await fs.access(fullPath);
  } catch {
    throw new ApiError(404, 'The file is missing on the server. Please upload it again.', {
      code: 'FILE_MISSING',
    });
  }
  return { fullPath, mimeType: doc.mimeType, originalName: doc.originalName };
}

// POST .../documents/continue -> "Continue" button (documents are optional).
// The documents step is always followed by the last step (Account Security),
// so the user moves to step number = totalSteps (farmer 4, buyer 3).
async function completeStep(user, { totalSteps, ...listOptions }) {
  if (user.registrationStep < totalSteps) {
    user.registrationStep = totalSteps;
    await user.save();
  }
  return list(user, listOptions);
}

module.exports = { list, upload, remove, removeTypes, getFile, completeStep };
