// Receives ONE CSV file (form-data field "file") into memory (not saved to disk).
// Max 2MB. Accepts .csv files (Windows often sends them as "application/vnd.ms-excel").
const path = require('path');
const multer = require('multer');
const ApiError = require('../utils/ApiError');

const MAX_SIZE_MB = 2;
const CSV_MIME_TYPES = ['text/csv', 'application/csv', 'text/plain', 'application/vnd.ms-excel'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE_MB * 1024 * 1024, files: 1, fields: 5 },
  fileFilter: (req, file, cb) => {
    const isCsvName = path.extname(file.originalname || '').toLowerCase() === '.csv';
    if (!isCsvName || !CSV_MIME_TYPES.includes(String(file.mimetype).toLowerCase())) {
      return cb(new ApiError(415, 'Only .csv files are allowed', { code: 'INVALID_FILE_TYPE' }));
    }
    cb(null, true);
  },
}).single('file');

function uploadCsv(req, res, next) {
  upload(req, res, (err) => {
    if (!err) {
      if (!req.file) {
        return next(
          new ApiError(400, 'Please choose a CSV file to upload (form-data field name: "file")', {
            code: 'FILE_REQUIRED',
          })
        );
      }
      return next();
    }
    if (err instanceof ApiError) return next(err);
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new ApiError(413, `File is too large. Maximum size is ${MAX_SIZE_MB}MB`, { code: 'FILE_TOO_LARGE' }));
      }
      return next(
        new ApiError(400, 'Send exactly one file in the form-data field named "file"', { code: 'INVALID_FILE_FIELD' })
      );
    }
    return next(err);
  });
}

module.exports = uploadCsv;
