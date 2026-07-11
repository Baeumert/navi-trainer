// Minimaler RFC4180-CSV-Parser (kein Zusatzpaket im Projekt vorhanden).
// Unterstuetzt gequotete Felder mit eingebetteten Kommas/Zeilenumbruechen
// und "" als escapte Anfuehrungszeichen - reicht fuer die hier vorliegenden
// Dictionary-/Vokabellisten-Exporte. Von import-vocab.js und
// import-priority-vocab.js gemeinsam genutzt.
'use strict';

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (c === '\r') {
      i += 1;
      continue;
    }
    if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  // letztes Feld/Zeile (falls Datei nicht mit Newline endet)
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

module.exports = { parseCsv };
