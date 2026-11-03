// Receives files sent as form-data and saves them in the PRIVATE upload folder
// (never served publicly; the API streams them only to people allowed to see them).
//
//   uploadPrivateFiles({
//     field: 'photos',                 // form-data field name
//     maxFiles: 5,                     // 1 = single file (req.file), more = req.files
//     formats: ['jpg', 'png'],         // see utils/fileTypes.js
//     maxSizeMB: 5,
//     folder: (req) => 'claims/u12',   // under uploads/private/
//     prefix: 'photo',
//     required: false,                 // true = at least one file needed
//     label: 'photo',                  // used in messages
//   })
//
// The file content (magic bytes) is checked again in the service. Use validateUpload after
// the text-field rules so files are deleted when validation fails.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config');
const ApiError = require('../utils/ApiError');
const { FILE_KINDS, kindForMimeType, formatLabels } = require('../utils/fileTypes');

const MB = 1024 * 1024;

function uploadPrivateFiles({ field, maxFiles = 1, formats, maxSizeMB, folder, prefix = 'file', required = false, label = 'file' }) {
  return function upload(req, res, next) {
    const storage = multer.diskStorage({
      destination: (r, file, cb) => {
        const dir = path.resolve(config.upload.dir, 'private', folder(req));
        fs.mkdir(dir, { recursive: true }, (err) => cb(err, dir));
      },
      filename: (r, file, cb) => {
        const kind = kindForMimeType(file.mimetype, formats);
        cb(null, `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${FILE_KINDS[kind].extension}`);
      },
    });

    const handler = multer({
      storage,
      limits: { fileSize: maxSizeMB * MB, files: maxFiles, fields: 20 },
      fileFilter: (r, file, cb) => {
        if (!kindForMimeType(file.mimetype, formats)) {
          return cb(new ApiError(415, `Only ${formatLabels(formats)} files are allowed`, { code: 'INVALID_FILE_TYPE' }));
        }
        return cb(null, true);
      },
    });
    const run = maxFiles === 1 ? handler.single(field) : handler.array(field, maxFiles);

    run(req, res, (err) => {
      if (!err) {
        const count = maxFiles === 1 ? (req.file ? 1 : 0) : (req.files || []).length;
        if (required && !count) {
          return next(new ApiError(400, `Please attach a ${label} (form-data field name: "${field}")`, { code: 'FILE_REQUIRED' }));
        }
        return next();
      }
      // Remove whatever was already saved
      const saved = [].concat(req.file || [], req.files || []);
      saved.forEach((f) => fs.unlink(f.path, () => {}));
      if (err instanceof ApiError) return next(err);
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return next(new ApiError(413, `File is too large. Maximum size is ${maxSizeMB}MB`, { code: 'FILE_TOO_LARGE' }));
        }
        if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
          return next(
            new ApiError(400, `Send at most ${maxFiles} ${label}${maxFiles > 1 ? 's' : ''} in the form-data field named "${field}"`, {
              code: 'INVALID_FILE_FIELD',
            })
          );
        }
        return next(new ApiError(400, `Upload error: ${err.message}`, { code: 'UPLOAD_ERROR' }));
      }
      return next(err);
    });
  };
}

module.exports = uploadPrivateFiles;
