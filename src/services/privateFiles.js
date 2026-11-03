// Small helpers for PRIVATE uploaded files (claim photos, refund proofs):
// check the real file type, turn a saved file into DB columns, find it again safely, delete it.
const path = require('path');
const fs = require('fs/promises');
const config = require('../config');
const ApiError = require('../utils/ApiError');
const { fileMatchesKind, kindForMimeType, formatLabels } = require('../utils/fileTypes');

const uploadRoot = () => path.resolve(config.upload.dir);

// Every file must really be one of the allowed formats (magic bytes), not just say so
async function verify(files, formats) {
  for (const file of files) {
    const kind = kindForMimeType(file.mimetype, formats);
    // eslint-disable-next-line no-await-in-loop
    if (!kind || !(await fileMatchesKind(file.path, kind))) {
      throw new ApiError(415, `"${file.originalname || 'file'}" is not a valid ${formatLabels(formats)} file`, { code: 'INVALID_FILE_CONTENT' });
    }
  }
}

// multer file -> what we store
const toRecord = (file) => ({
  path: path.relative(uploadRoot(), file.path).split(path.sep).join('/'),
  originalName: String(file.originalname || 'file').slice(0, 255),
  mimeType: file.mimetype,
  sizeBytes: file.size,
});

// Stored relative path -> full path (never outside the upload folder)
function absolutePath(relativePath) {
  const full = path.resolve(uploadRoot(), relativePath);
  if (!full.startsWith(uploadRoot() + path.sep)) throw new ApiError(400, 'Invalid file path', { code: 'INVALID_FILE_PATH' });
  return full;
}

const remove = (files = []) => Promise.all(files.filter(Boolean).map((f) => fs.unlink(f.path || f).catch(() => {})));

module.exports = { verify, toRecord, absolutePath, remove };
