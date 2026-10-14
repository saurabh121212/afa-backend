// Receives ONE category icon (form-data field "file") and saves it to the PUBLIC folder:
//   uploads/public/categories/cat-<id>-<time>-<random>.<ext>
// Anyone can open it at /uploads/categories/<file> (it's shown on the website).
// Run AFTER the :id param is validated. The file content is checked in the service.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config');
const ApiError = require('../utils/ApiError');
const { CATEGORY_ICON } = require('../config/categories');
const { FILE_KINDS, kindForMimeType, formatLabels } = require('../utils/fileTypes');

const MB = 1024 * 1024;

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.resolve(config.upload.dir, 'public', CATEGORY_ICON.folder);
    fs.mkdir(dir, { recursive: true }, (err) => cb(err, dir));
  },
  filename: (req, file, cb) => {
    // Our own file name + extension from the checked type (never the user's file name)
    const kind = kindForMimeType(file.mimetype, CATEGORY_ICON.formats);
    const random = crypto.randomBytes(6).toString('hex');
    cb(null, `cat-${req.params.id}-${Date.now()}-${random}${FILE_KINDS[kind].extension}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: CATEGORY_ICON.maxSizeMB * MB, files: 1, fields: 5 },
  fileFilter: (req, file, cb) => {
    if (!kindForMimeType(file.mimetype, CATEGORY_ICON.formats)) {
      return cb(
        new ApiError(415, `Only ${formatLabels(CATEGORY_ICON.formats)} images are allowed for the category icon`, {
          code: 'INVALID_FILE_TYPE',
        })
      );
    }
    cb(null, true);
  },
}).single('file');

function uploadCategoryIcon(req, res, next) {
  upload(req, res, (err) => {
    if (!err) {
      if (!req.file) {
        return next(
          new ApiError(400, 'Please choose an image to upload (form-data field name: "file")', {
            code: 'FILE_REQUIRED',
          })
        );
      }
      return next();
    }
    if (err instanceof ApiError) return next(err);
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(
          new ApiError(413, `Image is too large. Maximum size is ${CATEGORY_ICON.maxSizeMB}MB`, {
            code: 'FILE_TOO_LARGE',
          })
        );
      }
      return next(
        new ApiError(400, 'Send exactly one file in the form-data field named "file"', { code: 'INVALID_FILE_FIELD' })
      );
    }
    return next(err);
  });
}

module.exports = uploadCategoryIcon;
