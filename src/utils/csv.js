// Small CSV reader (no extra package needed).
// Handles: Excel's BOM, Windows (CRLF) / Unix line endings, quoted values,
// commas inside quotes and "" (escaped quote) inside quotes.
//
//   parseCsv('Region,Inkhundla\nHhohho,"Mbabane, East"')
//   -> [['Region','Inkhundla'], ['Hhohho','Mbabane, East']]

function parseCsv(text) {
  const input = String(text).replace(/^﻿/, ''); // remove Excel BOM
  const rows = [];
  let row = [];
  let value = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          value += '"'; // "" inside quotes = one quote
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        value += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(value);
      value = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i += 1; // CRLF
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
    } else {
      value += ch;
    }
  }

  if (inQuotes) {
    throw new Error('The CSV file has a quote (") that is never closed');
  }

  // Last line (if the file doesn't end with a newline)
  if (value !== '' || row.length) {
    row.push(value);
    rows.push(row);
  }

  // Drop completely empty lines
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

// Turn values into a safe CSV line (used for downloads)
const toCsvLine = (values) =>
  values
    .map((v) => {
      const s = String(v == null ? '' : v);
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    })
    .join(',');

module.exports = { parseCsv, toCsvLine };
