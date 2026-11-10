// Allowed upload formats and how to recognise them.
//
// The browser/app tells us a file's type (mimetype), but that can be faked
// (e.g. a renamed .exe sent as "image/jpeg"). So after upload we also check
// the first bytes of the file ("magic number"), which are fixed for each format.
//
// Format lists in the config files (e.g. LISTING_PHOTOS.formats) use the keys of FILE_KINDS:
//   'jpg' (also covers .jpeg / .JPG / .JPEG), 'png', 'webp', 'pdf'.
// Case does not matter and 'jpeg' is read as 'jpg'. Unknown names (e.g. 'heic') are ignored
// with a warning in the log, instead of crashing the upload.
const fs = require('fs/promises');
const path = require('path');

const FILE_KINDS = {
  jpg: {
    label: 'JPG',
    mimeTypes: ['image/jpeg', 'image/jpg', 'image/pjpeg'],
    extensions: ['.jpg', '.jpeg', '.jpe', '.jfif'],
    extension: '.jpg',
    signature: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  png: {
    label: 'PNG',
    mimeTypes: ['image/png'],
    extensions: ['.png'],
    extension: '.png',
    signature: (b) =>
      b.length >= 8 &&
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  webp: {
    label: 'WEBP',
    mimeTypes: ['image/webp'],
    extensions: ['.webp'],
    extension: '.webp',
    // "RIFF" <4 bytes size> "WEBP"
    signature: (b) => b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
  },
  pdf: {
    label: 'PDF',
    mimeTypes: ['application/pdf'],
    extensions: ['.pdf'],
    extension: '.pdf',
    signature: (b) => b.length >= 5 && b.toString('ascii', 0, 5) === '%PDF-',
  },
};

const ALIASES = { jpeg: 'jpg', jpe: 'jpg', jfif: 'jpg' };
// Mimetypes some phones / apps send for any file: then the file name's extension decides
const GENERIC_MIME_TYPES = ['', 'application/octet-stream', 'binary/octet-stream', 'image/*', 'application/x-unknown'];

const warned = new Set();
// ['JPG', 'jpeg', 'png', 'heic'] -> ['jpg', 'png']   (unknown names are skipped with a warning)
function normalizeKinds(kinds = []) {
  const out = [];
  kinds.forEach((k) => {
    const key = ALIASES[String(k).toLowerCase()] || String(k).toLowerCase();
    if (FILE_KINDS[key]) {
      if (!out.includes(key)) out.push(key);
    } else if (!warned.has(key)) {
      warned.add(key);
      console.warn(`[fileTypes] "${k}" is not a supported upload format and is ignored. Supported: ${Object.keys(FILE_KINDS).join(', ')}`);
    }
  });
  return out;
}

// Which of the allowed kinds matches this file? (null = not allowed)
// Uses the mimetype; when the app sends a generic one (octet-stream), the file name's extension.
function kindForMimeType(mimeType, allowedKinds, originalName = '') {
  const allowed = normalizeKinds(allowedKinds);
  const mt = String(mimeType || '').toLowerCase().trim();
  const byMime = allowed.find((k) => FILE_KINDS[k].mimeTypes.includes(mt));
  if (byMime) return byMime;
  if (GENERIC_MIME_TYPES.includes(mt) && originalName) {
    const ext = path.extname(String(originalName)).toLowerCase();
    return allowed.find((k) => FILE_KINDS[k].extensions.includes(ext)) || null;
  }
  return null;
}

async function readHead(filePath) {
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(12);
    const { bytesRead } = await handle.read(buffer, 0, 12, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

// Do the file's first bytes really match this kind?
async function fileMatchesKind(filePath, kind) {
  const key = ALIASES[String(kind).toLowerCase()] || String(kind).toLowerCase();
  if (!FILE_KINDS[key]) return false;
  return FILE_KINDS[key].signature(await readHead(filePath));
}

// What is this file really, among the allowed kinds? (null = none of them)
// e.g. a photo named "IMG_001.JPG" that is really a PNG or WEBP -> 'png' / 'webp'
async function detectKind(filePath, allowedKinds) {
  const head = await readHead(filePath);
  return normalizeKinds(allowedKinds).find((k) => FILE_KINDS[k].signature(head)) || null;
}

// ['jpg','png'] -> "JPG, PNG"
const formatLabels = (kinds) => normalizeKinds(kinds).map((k) => FILE_KINDS[k].label).join(', ');

module.exports = { FILE_KINDS, normalizeKinds, kindForMimeType, fileMatchesKind, detectKind, formatLabels };
