// Makes an upload middleware for ONE public image (form-data field "file"), e.g. a CMS banner.
// The file is saved to uploads/public/<folder>/<prefix>-<id>-<time>-<random>.<ext> and anyone
// can open it at /uploads/<folder>/<file>. The real file content is checked in the service.
//
//   const uploadBannerImage = uploadPublicImage({ folder: 'banners', prefix: 'banner', formats: ['jpg','png'], maxSizeMB: 5 });
//   router.post('/:id/image', rules.byId, validate, uploadBannerImage, controller.setImage);
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config');
const ApiError = require('../utils/ApiError');
const { FILE_KINDS, kindForMimeType, formatLabels } = require('../utils/fileTypes');

const MB = 1024 * 1024;

function uploadPublicImage({ folder, prefix, formats, maxSizeMB }) {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.resolve(config.upload.dir, 'public', folder);
      fs.mkdir(dir, { recursive: true }, (err) => cb(err, dir));
    },
    filename: (req, file, cb) => {
      const kind = kindForMimeType(file.mimetype, formats);
      const random = crypto.randomBytes(6).toString('hex');
      cb(null, `${prefix}-${req.params.id || 'x'}-${Date.now()}-${random}${FILE_KINDS[kind].extension}`);
    },
  });

  const upload = multer({
    storage,
    limits: { fileSize: maxSizeMB * MB, files: 1, fields: 5 },
    fileFilter: (req, file, cb) => {
      if (!kindForMimeType(file.mimetype, formats)) {
        return cb(new ApiError(415, `Only ${formatLabels(formats)} images are allowed`, { code: 'INVALID_FILE_TYPE' }));
      }
      cb(null, true);
    },
  }).single('file');

  return function uploadImage(req, res, next) {
    upload(req, res, (err) => {
      if (!err) {
        if (!req.file) {
          return next(new ApiError(400, 'Please choose an image (form-data field name: "file")', { code: 'FILE_REQUIRED' }));
        }
        return next();
      }
      if (err instanceof ApiError) return next(err);
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return next(new ApiError(413, `Image is too large. Maximum size is ${maxSizeMB}MB`, { code: 'FILE_TOO_LARGE' }));
        }
        return next(new ApiError(400, 'Send exactly one file in the form-data field named "file"', { code: 'INVALID_FILE_FIELD' }));
      }
      return next(err);
    });
  };
}

module.exports = uploadPublicImage;
