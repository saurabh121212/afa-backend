// Same as validate.js, but for routes that receive files first (multer runs before the
// text fields can be checked): when validation fails, the uploaded file(s) are deleted.
// Works for one file (req.file) and several (req.files).
const fs = require('fs/promises');
const validate = require('./validate');

function uploadedFiles(req) {
  const files = [];
  if (req.file && req.file.path) files.push(req.file);
  if (Array.isArray(req.files)) files.push(...req.files.filter((f) => f && f.path));
  return files;
}

function validateUpload(req, res, next) {
  validate(req, res, (err) => {
    if (err) {
      const files = uploadedFiles(req);
      if (files.length) {
        return Promise.all(files.map((f) => fs.unlink(f.path).catch(() => {}))).then(() => next(err));
      }
    }
    return next(err);
  });
}

module.exports = validateUpload;
module.exports.uploadedFiles = uploadedFiles;
