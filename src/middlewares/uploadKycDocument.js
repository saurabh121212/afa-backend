// Receives ONE KYC file (form-data field "file") and saves it to the PRIVATE folder:
//   uploads/private/kyc/<userId>/<documentType>-<time>-<random>.<ext>
//
// The size limit and allowed formats come from config/documentTypes.js for the
// user's type and the :documentType in the URL. Run AFTER protectRegistration
// (needs req.user) and AFTER the documentType param is validated.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config');
const ApiError = require('../utils/ApiError');
const { getDocumentType } = require('../config/documentTypes');
const { FILE_KINDS, kindForMimeType, formatLabels } = require('../utils/fileTypes');

const MB = 1024 * 1024;

function uploadKycDocument(req, res, next) {
  const { documentType } = req.params;
  const rules = getDocumentType(req.user.userType, documentType);
  if (!rules) {
    return next(new ApiError(404, 'Unknown document type', { code: 'UNKNOWN_DOCUMENT_TYPE' }));
  }

  const storage = multer.diskStorage({
    destination: (r, file, cb) => {
      const dir = path.resolve(config.upload.dir, 'private', 'kyc', String(req.user.id));
      fs.mkdir(dir, { recursive: true }, (err) => cb(err, dir));
    },
    filename: (r, file, cb) => {
      // Our own name + extension from the checked type (never trust the user's file name)
      const kind = kindForMimeType(file.mimetype, rules.formats);
      const random = crypto.randomBytes(6).toString('hex');
      cb(null, `${documentType}-${Date.now()}-${random}${FILE_KINDS[kind].extension}`);
    },
  });

  const upload = multer({
    storage,
    limits: { fileSize: rules.maxSizeMB * MB, files: 1, fields: 5 },
    fileFilter: (r, file, cb) => {
      if (!kindForMimeType(file.mimetype, rules.formats)) {
        return cb(
          new ApiError(415, `Only ${formatLabels(rules.formats)} files are allowed for ${rules.label}`, {
            code: 'INVALID_FILE_TYPE',
          })
        );
      }
      cb(null, true);
    },
  }).single('file');

  upload(req, res, (err) => {
    if (!err) {
      if (!req.file) {
        return next(
          new ApiError(400, 'Please choose a file to upload (form-data field name: "file")', {
            code: 'FILE_REQUIRED',
          })
        );
      }
      req.documentRules = rules;
      return next();
    }

    if (err instanceof ApiError) return next(err);

    // Turn multer's errors into clear messages
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(
          new ApiError(413, `File is too large. Maximum size for ${rules.label} is ${rules.maxSizeMB}MB`, {
            code: 'FILE_TOO_LARGE',
          })
        );
      }
      if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT') {
        return next(
          new ApiError(400, 'Send exactly one file in the form-data field named "file"', {
            code: 'INVALID_FILE_FIELD',
          })
        );
      }
      return next(new ApiError(400, `Upload error: ${err.message}`, { code: 'UPLOAD_ERROR' }));
    }

    return next(err);
  });
}

module.exports = uploadKycDocument;
