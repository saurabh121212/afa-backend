// Receives an OPTIONAL chat photo (form-data field "image", one file) and saves it to the PRIVATE
// folder: uploads/private/chat/<senderId>/img-<time>-<random>.<ext>  (never publicly reachable).
// The other fields (text, clientMsgId…) come in the same form-data. JSON requests pass straight
// through (text-only messages). Run AFTER protectUser. The real file content is checked in the
// chat service, which also removes the file again if the message isn't saved.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../../config');
const ApiError = require('../../utils/ApiError');
const { CHAT_IMAGES } = require('../../config/chat');
const { FILE_KINDS, kindForMimeType, formatLabels } = require('../../utils/fileTypes');

const MB = 1024 * 1024;

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.resolve(config.upload.dir, 'private', CHAT_IMAGES.folder, String(req.user.id));
    fs.mkdir(dir, { recursive: true }, (err) => cb(err, dir));
  },
  filename: (req, file, cb) => {
    // Our own name + extension from the checked type (never trust the user's file name)
    const kind = kindForMimeType(file.mimetype, CHAT_IMAGES.formats);
    const random = crypto.randomBytes(6).toString('hex');
    cb(null, `img-${Date.now()}-${random}${FILE_KINDS[kind].extension}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: CHAT_IMAGES.maxSizeMB * MB, files: 1, fields: 10 },
  fileFilter: (req, file, cb) => {
    if (!kindForMimeType(file.mimetype, CHAT_IMAGES.formats)) {
      return cb(
        new ApiError(415, `Only ${formatLabels(CHAT_IMAGES.formats)} images can be sent`, { code: 'INVALID_FILE_TYPE' })
      );
    }
    cb(null, true);
  },
}).single('image');

function uploadChatImage(req, res, next) {
  upload(req, res, (err) => {
    if (!err) return next();
    if (req.file) fs.unlink(req.file.path, () => {});
    if (err instanceof ApiError) return next(err);
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new ApiError(413, `An image can be at most ${CHAT_IMAGES.maxSizeMB}MB`, { code: 'FILE_TOO_LARGE' }));
      }
      if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
        return next(new ApiError(400, 'Send one image in the form-data field named "image"', { code: 'INVALID_FILE_FIELD' }));
      }
      return next(new ApiError(400, `Upload error: ${err.message}`, { code: 'UPLOAD_ERROR' }));
    }
    return next(err);
  });
}

// Error handler for the chat routes: a request that fails (e.g. validation) never leaves its photo behind
function removeUploadOnError(err, req, res, next) {
  if (req.file) fs.unlink(req.file.path, () => {});
  next(err);
}

module.exports = { uploadChatImage, removeUploadOnError };
