// Receives ONE proof of payment (form-data field "file") plus the text fields, and saves it
// to the PRIVATE folder: uploads/private/payments/<orderId>/proof-<time>-<random>.<ext>
// JPG, PNG or PDF, max 5MB (config/orders.js PAYMENT_PROOF). Run after the :id param is validated.
// The file content (magic bytes) is checked again in payment.service.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config');
const ApiError = require('../utils/ApiError');
const { PAYMENT_PROOF } = require('../config/orders');
const { FILE_KINDS, kindForMimeType, formatLabels } = require('../utils/fileTypes');

const MB = 1024 * 1024;

function uploadPaymentProof(req, res, next) {
  const orderId = String(parseInt(req.params.id, 10) || 0);
  const storage = multer.diskStorage({
    destination: (r, file, cb) => {
      const dir = path.resolve(config.upload.dir, 'private', PAYMENT_PROOF.folder, orderId);
      fs.mkdir(dir, { recursive: true }, (err) => cb(err, dir));
    },
    filename: (r, file, cb) => {
      const kind = kindForMimeType(file.mimetype, PAYMENT_PROOF.formats);
      cb(null, `proof-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${FILE_KINDS[kind].extension}`);
    },
  });

  const upload = multer({
    storage,
    limits: { fileSize: PAYMENT_PROOF.maxSizeMB * MB, files: 1, fields: 10 },
    fileFilter: (r, file, cb) => {
      if (!kindForMimeType(file.mimetype, PAYMENT_PROOF.formats)) {
        return cb(new ApiError(415, `Only ${formatLabels(PAYMENT_PROOF.formats)} files are allowed`, { code: 'INVALID_FILE_TYPE' }));
      }
      return cb(null, true);
    },
  }).single('file');

  upload(req, res, (err) => {
    if (!err) {
      if (!req.file) {
        return next(new ApiError(400, 'Please attach your proof of payment (form-data field name: "file")', { code: 'FILE_REQUIRED' }));
      }
      return next();
    }
    if (err instanceof ApiError) return next(err);
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new ApiError(413, `File is too large. Maximum size is ${PAYMENT_PROOF.maxSizeMB}MB`, { code: 'FILE_TOO_LARGE' }));
      }
      if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT') {
        return next(new ApiError(400, 'Send exactly one file in the form-data field named "file"', { code: 'INVALID_FILE_FIELD' }));
      }
      return next(new ApiError(400, `Upload error: ${err.message}`, { code: 'UPLOAD_ERROR' }));
    }
    return next(err);
  });
}

module.exports = uploadPaymentProof;
