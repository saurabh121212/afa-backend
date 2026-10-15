// Receives listing photos (form-data field "photos", one or more files) and saves them to the
// PUBLIC folder: uploads/public/listings/<listingId>/photo-<time>-<random>.<ext>
// Anyone can open them at /uploads/listings/<listingId>/<file> (shown on the website).
// Run AFTER the :id param is validated. Ownership, the 5-photo limit and the real file
// content are checked in listing.service.js (files are removed again if anything is wrong).
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config');
const ApiError = require('../utils/ApiError');
const { LISTING_PHOTOS } = require('../config/listingOptions');
const { FILE_KINDS, kindForMimeType, formatLabels } = require('../utils/fileTypes');

const MB = 1024 * 1024;

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.resolve(config.upload.dir, 'public', LISTING_PHOTOS.folder, String(req.params.id));
    fs.mkdir(dir, { recursive: true }, (err) => cb(err, dir));
  },
  filename: (req, file, cb) => {
    const kind = kindForMimeType(file.mimetype, LISTING_PHOTOS.formats);
    const random = crypto.randomBytes(6).toString('hex');
    cb(null, `photo-${Date.now()}-${random}${FILE_KINDS[kind].extension}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: LISTING_PHOTOS.maxSizeMB * MB, files: LISTING_PHOTOS.max, fields: 5 },
  fileFilter: (req, file, cb) => {
    if (!kindForMimeType(file.mimetype, LISTING_PHOTOS.formats)) {
      return cb(
        new ApiError(415, `Only ${formatLabels(LISTING_PHOTOS.formats)} photos are allowed`, {
          code: 'INVALID_FILE_TYPE',
        })
      );
    }
    cb(null, true);
  },
}).array('photos', LISTING_PHOTOS.max);

// Remove files multer already saved (when the request fails half-way)
const cleanUp = (files = []) => files.forEach((f) => fs.unlink(f.path, () => {}));

function uploadListingPhotos(req, res, next) {
  upload(req, res, (err) => {
    if (!err) {
      if (!req.files || !req.files.length) {
        return next(
          new ApiError(400, 'Please choose at least one photo (form-data field name: "photos")', {
            code: 'FILE_REQUIRED',
          })
        );
      }
      return next();
    }
    cleanUp(req.files);
    if (err instanceof ApiError) return next(err);
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(
          new ApiError(413, `Each photo can be at most ${LISTING_PHOTOS.maxSizeMB}MB`, { code: 'FILE_TOO_LARGE' })
        );
      }
      if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
        return next(
          new ApiError(400, `Send up to ${LISTING_PHOTOS.max} photos in the form-data field named "photos"`, {
            code: 'INVALID_FILE_FIELD',
          })
        );
      }
      return next(new ApiError(400, `Upload error: ${err.message}`, { code: 'UPLOAD_ERROR' }));
    }
    return next(err);
  });
}

module.exports = uploadListingPhotos;
module.exports.cleanUp = cleanUp;
