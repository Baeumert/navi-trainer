// Verknuepft die Reyknap-Anfaengerliste (sources/de/vokabelliste-anfaenger-
// reyknap.csv) mit der bestehenden `vocab`-Tabelle: setzt `priority_date`
// (ISO-Datum) auf den passenden Woertern, damit der Trainer sie beim
// Ausspielen neuer Karten zuerst zeigt (siehe routes/trainer.js). Ausserdem
// wird die Wortherkunft (falls vorhanden und `notes` noch leer) uebernommen.
//
// Matching: die Reyknap-Liste enthaelt reine Woerter ohne <u>-Betonungs-Tags;
// `vocab.navi` enthaelt sie (aus dem Woerterbuch-Import). Es wird deshalb
// per Tag-freiem Vergleich gematcht. Manche Reyknap-Eintraege listen zwei
// Varianten getrennt durch " / " (z.B. "tsa'u / tsaw") - beide werden
// versucht.
//
// GEHOERT ZUM PAUSIERTEN VOKABEL-EDITOR (siehe server.js): die CSV-Quelle
// wurde bei der Umstellung auf die Live-Fwew-API aus dem Repo entfernt (kein
// Vokabelbestand mehr im Projekt selbst). Der Live-Modus nutzt stattdessen
// db/import-priority-vocab-fwew.js gegen priority-seed.json (reine
// Fwew-ID+Datum-Liste, kein Wortinhalt).
//
// Aufruf: node db/import-priority-vocab.js  (bzw. npm run import-priority-vocab)
'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../lib/db');
const { parseCsv } = require('./csv-util');

const FILE = path.join(__dirname, '..', '..', 'sources', 'de', 'vokabelliste-anfaenger-reyknap.csv');

function stripTags(navi) {
  return navi.replace(/<\/?u>/g, '').trim();
}

function isoDate(ddmmyyyy) {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(ddmmyyyy.trim());
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

function readCsvAsObjects(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const rows = parseCsv(text).filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ''));
  const header = rows[0];
  return rows.slice(1).map((r) => {
    const obj = {};
    header.forEach((h, idx) => {
      obj[h] = r[idx] !== undefined ? r[idx] : '';
    });
    return obj;
  });
}

function main() {
  const rows = readCsvAsObjects(FILE);

  // navi (tag-frei) -> vocab-Zeile, fuer schnelles Matching.
  const allVocab = db.prepare('SELECT id, navi, notes FROM vocab').all();
  const byPlainNavi = new Map();
  for (const v of allVocab) {
    const plain = stripTags(v.navi);
    if (!byPlainNavi.has(plain)) byPlainNavi.set(plain, []);
    byPlainNavi.get(plain).push(v);
  }

  const updateStmt = db.prepare('UPDATE vocab SET priority_date = ?, notes = ? WHERE id = ?');

  let matched = 0;
  let unmatched = [];

  const run = db.transaction(() => {
    for (const row of rows) {
      const iso = isoDate(row.LernenBis);
      if (!iso) continue;

      const candidates = row.Navi.split('/').map((s) => s.trim()).filter(Boolean);
      let found = false;
      for (const cand of candidates) {
        const vocabRows = byPlainNavi.get(cand);
        if (!vocabRows) continue;
        for (const v of vocabRows) {
          const notes = v.notes && v.notes.length > 0 ? v.notes : (row.Wortherkunft || null);
          updateStmt.run(iso, notes, v.id);
          found = true;
        }
      }
      if (found) {
        matched += 1;
      } else {
        unmatched.push(row.Navi);
      }
    }
  });

  run();

  console.log(`Prioritaets-Import abgeschlossen: ${matched} Woerter markiert.`);
  if (unmatched.length > 0) {
    console.log(`Nicht gefunden (${unmatched.length}): ${unmatched.join(', ')}`);
  }
}

main();
