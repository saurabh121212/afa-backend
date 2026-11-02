// Same as validate.js, but for routes that receive a file first (multer runs before the
// text fields can be checked): when validation fails, the uploaded file is deleted.
const fs = require('fs/promises');
const validate = require('./validate');

function validateUpload(req, res, next) {
  validate(req, res, (err) => {
    if (err && req.file && req.file.path) {
      return fs.unlink(req.file.path).catch(() => {}).then(() => next(err));
    }
    return next(err);
  });
}

module.exports = validateUpload;
