// Allowed upload formats and how to recognise them.
//
// The browser/app tells us a file's type (mimetype), but that can be faked
// (e.g. a renamed .exe sent as "image/jpeg"). So after upload we also check
// the first bytes of the file ("magic number"), which are fixed for each format.
const fs = require('fs/promises');

const FILE_KINDS = {
  jpg: {
    label: 'JPG',
    mimeTypes: ['image/jpeg', 'image/jpg', 'image/pjpeg'],
    extension: '.jpg',
    signature: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  png: {
    label: 'PNG',
    mimeTypes: ['image/png'],
    extension: '.png',
    signature: (b) =>
      b.length >= 8 &&
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  pdf: {
    label: 'PDF',
    mimeTypes: ['application/pdf'],
    extension: '.pdf',
    signature: (b) => b.length >= 5 && b.toString('ascii', 0, 5) === '%PDF-',
  },
};

// Which of the allowed kinds matches this mimetype? (null = not allowed)
function kindForMimeType(mimeType, allowedKinds) {
  const mt = String(mimeType || '').toLowerCase();
  return allowedKinds.find((k) => FILE_KINDS[k] && FILE_KINDS[k].mimeTypes.includes(mt)) || null;
}

// Do the file's first bytes really match this kind?
async function fileMatchesKind(filePath, kind) {
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(8);
    const { bytesRead } = await handle.read(buffer, 0, 8, 0);
    return FILE_KINDS[kind].signature(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

// ['jpg','png'] -> "JPG, PNG"
const formatLabels = (kinds) => kinds.map((k) => FILE_KINDS[k].label).join(', ');

module.exports = { FILE_KINDS, kindForMimeType, fileMatchesKind, formatLabels };
