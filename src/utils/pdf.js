// A small PDF writer with NO extra npm package: text in the standard Helvetica fonts,
// lines, boxes, colours, a JPEG image (the logo) and several pages. Enough for invoices,
// receipts and credit notes.
//
//   const doc = new PdfDocument({ title: 'Invoice AFA-INV-000001' });
//   doc.image(logoJpegBuffer, 40, 40, { width: 120 });
//   const h = doc.text('Hello', 40, 120, { size: 12, bold: true, width: 200, align: 'left', color: '#1F2937' });
//   doc.rect(40, 150, 515, 20, { fill: '#E8F5E9' });
//   doc.line(40, 175, 555, 175, { color: '#D1D5DB' });
//   doc.addPage();
//   const buffer = doc.toBuffer();
//
// Coordinates are in points (1/72 inch) from the TOP-LEFT of an A4 page (595 x 842).
// Text: Windows-1252 characters (English letters, digits, E, punctuation, accents);
// anything else is printed as "?".
const zlib = require('zlib');
const METRICS = require('./pdfFontMetrics');

const A4 = { width: 595.28, height: 841.89 };
const FONTS = { regular: 'Helvetica', bold: 'Helvetica-Bold' };

// Unicode -> Windows-1252 byte for the characters that differ from Latin-1
const CP1252 = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88,
  0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93,
  0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
  0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

function toCodes(str) {
  const out = [];
  for (const ch of String(str === null || str === undefined ? '' : str)) {
    const c = ch.codePointAt(0);
    if (c === 9) out.push(32);
    else if (c >= 32 && c <= 126) out.push(c);
    else if (c >= 0xa0 && c <= 0xff) out.push(c);
    else if (CP1252[c]) out.push(CP1252[c]);
    else if (c >= 32) out.push(63); // ?
  }
  return out;
}

function colorOf(hex) {
  const h = String(hex || '#000000').replace('#', '');
  const full = h.length === 3 ? h.split('').map((x) => x + x).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => (v / 255).toFixed(3)).join(' ');
}

const num = (n) => (Math.round(n * 100) / 100).toString();

// Width + height of a JPEG (from its SOF marker)
function jpegInfo(buf) {
  if (!Buffer.isBuffer(buf) || buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('Not a JPEG image');
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7), components: buf[i + 9] };
    }
    i += 2 + len;
  }
  throw new Error('JPEG size not found');
}

class PdfDocument {
  constructor({ title = '', author = 'AFA - Agricultural e-Marketplace for Eswatini' } = {}) {
    this.width = A4.width;
    this.height = A4.height;
    this.title = title;
    this.author = author;
    this.pages = [];
    this.images = []; // { buf, info }
    this.addPage();
  }

  addPage() {
    this.page = { ops: [], images: new Set() };
    this.pages.push(this.page);
    return this;
  }

  // ---------- measuring ----------
  widthOf(str, { size = 10, bold = false } = {}) {
    const table = METRICS[bold ? FONTS.bold : FONTS.regular];
    return (toCodes(str).reduce((s, c) => s + (table[c - 32] || 556), 0) * size) / 1000;
  }

  // Split text into lines that fit "width" (words longer than a line are cut)
  wrap(str, width, opts = {}) {
    const lines = [];
    String(str === null || str === undefined ? '' : str)
      .split(/\r?\n/)
      .forEach((para) => {
        const words = para.split(/\s+/).filter(Boolean);
        if (!words.length) {
          lines.push('');
          return;
        }
        let line = '';
        words.forEach((word) => {
          let w = word;
          // a single word wider than the line: cut it
          while (this.widthOf(w, opts) > width && w.length > 1) {
            let cut = w.length - 1;
            while (cut > 1 && this.widthOf(w.slice(0, cut), opts) > width) cut -= 1;
            if (line) {
              lines.push(line);
              line = '';
            }
            lines.push(w.slice(0, cut));
            w = w.slice(cut);
          }
          const next = line ? `${line} ${w}` : w;
          if (this.widthOf(next, opts) <= width || !line) line = next;
          else {
            lines.push(line);
            line = w;
          }
        });
        if (line) lines.push(line);
      });
    return lines;
  }

  // Height that text will take
  heightOf(str, width, { size = 10, bold = false, lineGap = 2 } = {}) {
    return this.wrap(str, width, { size, bold }).length * (size + lineGap);
  }

  // ---------- drawing ----------
  // Returns the height used. width = wrap width (none = one line, no wrap).
  text(str, x, y, { size = 10, bold = false, color = '#1F2937', width = null, align = 'left', lineGap = 2 } = {}) {
    const opts = { size, bold };
    const lines = width ? this.wrap(str, width, opts) : String(str === null || str === undefined ? '' : str).split(/\r?\n/);
    const font = bold ? 'F2' : 'F1';
    lines.forEach((line, i) => {
      const lw = this.widthOf(line, opts);
      let lx = x;
      if (width && align === 'right') lx = x + width - lw;
      if (width && align === 'center') lx = x + (width - lw) / 2;
      const baseline = this.height - (y + i * (size + lineGap) + size * 0.8);
      const bytes = Buffer.from(toCodes(line)).toString('latin1').replace(/([\\()])/g, '\\$1');
      this.page.ops.push(`BT /${font} ${num(size)} Tf ${colorOf(color)} rg ${num(lx)} ${num(baseline)} Td (${bytes}) Tj ET`);
    });
    return lines.length * (size + lineGap);
  }

  rect(x, y, w, h, { fill = null, stroke = null, lineWidth = 0.75 } = {}) {
    const parts = [];
    if (fill) parts.push(`${colorOf(fill)} rg`);
    if (stroke) parts.push(`${colorOf(stroke)} RG ${num(lineWidth)} w`);
    parts.push(`${num(x)} ${num(this.height - y - h)} ${num(w)} ${num(h)} re`);
    parts.push(fill && stroke ? 'B' : fill ? 'f' : 'S');
    this.page.ops.push(parts.join(' '));
    return this;
  }

  line(x1, y1, x2, y2, { color = '#D1D5DB', width = 0.75 } = {}) {
    this.page.ops.push(`${colorOf(color)} RG ${num(width)} w ${num(x1)} ${num(this.height - y1)} m ${num(x2)} ${num(this.height - y2)} l S`);
    return this;
  }

  // JPEG only. Give width (height follows the image) or both. Returns the height used.
  image(buf, x, y, { width = null, height = null } = {}) {
    let entry = this.images.find((im) => im.buf === buf);
    if (!entry) {
      entry = { buf, info: jpegInfo(buf), name: `Im${this.images.length + 1}` };
      this.images.push(entry);
    }
    const w = width || (height ? (height * entry.info.width) / entry.info.height : entry.info.width);
    const h = height || (w * entry.info.height) / entry.info.width;
    this.page.images.add(entry.name);
    this.page.ops.push(`q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(this.height - y - h)} cm /${entry.name} Do Q`);
    return h;
  }

  // ---------- output ----------
  toBuffer() {
    const objects = []; // index = object number - 1, each a Buffer
    const add = (content) => {
      objects.push(Buffer.isBuffer(content) ? content : Buffer.from(content, 'latin1'));
      return objects.length;
    };
    const stream = (dict, data) =>
      Buffer.concat([Buffer.from(`<< ${dict} /Length ${data.length} >>\nstream\n`, 'latin1'), data, Buffer.from('\nendstream', 'latin1')]);

    const catalogNo = add(''); // filled in later
    const pagesNo = add('');
    const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const imageNos = {};
    this.images.forEach((im) => {
      const cs = { 1: '/DeviceGray', 3: '/DeviceRGB', 4: '/DeviceCMYK' }[im.info.components] || '/DeviceRGB';
      imageNos[im.name] = add(
        stream(`/Type /XObject /Subtype /Image /Width ${im.info.width} /Height ${im.info.height} /ColorSpace ${cs} /BitsPerComponent 8 /Filter /DCTDecode`, im.buf)
      );
    });
    const pageNos = this.pages.map((p) => {
      const content = zlib.deflateSync(Buffer.from(p.ops.join('\n'), 'latin1'));
      const contentNo = add(stream('/Filter /FlateDecode', content));
      const xobjects = [...p.images].map((n) => `/${n} ${imageNos[n]} 0 R`).join(' ');
      return add(
        `<< /Type /Page /Parent ${pagesNo} 0 R /MediaBox [0 0 ${num(this.width)} ${num(this.height)}] ` +
          `/Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >>${xobjects ? ` /XObject << ${xobjects} >>` : ''} >> /Contents ${contentNo} 0 R >>`
      );
    });
    objects[catalogNo - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pagesNo} 0 R >>`, 'latin1');
    objects[pagesNo - 1] = Buffer.from(`<< /Type /Pages /Kids [${pageNos.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageNos.length} >>`, 'latin1');
    const pdfString = (s) => `(${Buffer.from(toCodes(s)).toString('latin1').replace(/([\\()])/g, '\\$1')})`;
    const infoNo = add(`<< /Title ${pdfString(this.title)} /Author ${pdfString(this.author)} /Producer (AFA API) >>`);

    const chunks = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
    let offset = chunks[0].length;
    const offsets = [];
    objects.forEach((body, i) => {
      offsets.push(offset);
      const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), body, Buffer.from('\nendobj\n', 'latin1')]);
      chunks.push(chunk);
      offset += chunk.length;
    });
    const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
    chunks.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root ${catalogNo} 0 R /Info ${infoNo} 0 R >>\nstartxref\n${offset}\n%%EOF\n`, 'latin1'));
    return Buffer.concat(chunks);
  }
}

module.exports = { PdfDocument, A4 };
