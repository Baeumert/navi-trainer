// Importiert die Vokabel-CSV-Exporte (sources/de + sources/en, all + topics)
// in die `vocab`-Tabelle. Idempotent: ueberspringt Woerter, die (per exaktem
// `navi`-Match) schon in der DB stehen, statt Duplikate anzulegen (`navi`
// ist in der Tabelle bewusst nicht UNIQUE, siehe db.js - der Check passiert
// hier im Script).
//
// GEHOERT ZUM PAUSIERTEN VOKABEL-EDITOR (siehe server.js): mit der
// Umstellung auf die Live-Fwew-API wurden die CSV-Quellen (volle
// Woerterbuch-Dumps mit Wortinhalt) bewusst aus dem Repo entfernt - hier
// soll kein Vokabelbestand mehr im Projekt selbst liegen. Dieses Script
// laeuft daher nur, wenn die CSVs manuell wieder unter sources/ abgelegt
// werden (z.B. falls der Editor je reaktiviert wird).
//
// Aufruf: node db/import-vocab.js  (bzw. npm run import-vocab)
'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../lib/db');
const { parseCsv } = require('./csv-util');

const SOURCES_DIR = path.join(__dirname, '..', '..', 'sources');

const FILES = {
  deAll: path.join(SOURCES_DIR, 'de', 'dict-navi.all.csv'),
  enAll: path.join(SOURCES_DIR, 'en', 'dict-navi.all.csv'),
  deTopics: path.join(SOURCES_DIR, 'de', 'dict-navi.topics.csv'),
  enTopics: path.join(SOURCES_DIR, 'en', 'dict-navi.topics.csv'),
};

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

// Wortklasse -> transitivity-Kuerzel, wie schon anderswo im Projekt verwendet
// (vtr/vin, siehe sources/de/Vokabeln Anfänger.txt bzw. vocab-transitivity-table).
function transitivityFor(category) {
  if (!category) return null;
  const c = category.trim().toLowerCase();
  if (c === 'verb, transitiv' || c === 'modalverben, transitiv') return 'vtr';
  if (c === 'verb, intransitiv' || c === 'modalverben, intransitiv') return 'vin';
  return null;
}

function main() {
  const deAll = readCsvAsObjects(FILES.deAll);
  const enAll = readCsvAsObjects(FILES.enAll);
  const deTopics = readCsvAsObjects(FILES.deTopics);

  if (deAll.length !== enAll.length) {
    throw new Error(
      `dict-navi.all.csv (DE/EN) row count mismatch: de=${deAll.length} en=${enAll.length}`
    );
  }

  // Topics je Na'vi-Wort einsammeln (comma-join bei mehreren Themen).
  const topicsByNavi = new Map();
  for (const row of deTopics) {
    const navi = row.Frontside;
    const topic = row.Category;
    if (!navi || !topic) continue;
    const list = topicsByNavi.get(navi) || [];
    if (!list.includes(topic)) list.push(topic);
    topicsByNavi.set(navi, list);
  }

  const existingStmt = db.prepare('SELECT id FROM vocab WHERE navi = ?');
  const insertStmt = db.prepare(
    'INSERT INTO vocab (navi, de, en, transitivity, category, topic, notes) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );

  let inserted = 0;
  let skipped = 0;

  const importAll = db.transaction(() => {
    for (let i = 0; i < deAll.length; i += 1) {
      const deRow = deAll[i];
      const enRow = enAll[i];
      const navi = deRow.Frontside;
      if (!navi) continue;

      if (existingStmt.get(navi)) {
        skipped += 1;
        continue;
      }

      const de = deRow.Flipside;
      const en = enRow.Flipside;
      const category = deRow.Category;
      const transitivity = transitivityFor(category);
      const topicList = topicsByNavi.get(navi);
      const topic = topicList && topicList.length > 0 ? topicList.join(', ') : null;

      insertStmt.run(navi, de, en, transitivity, category || null, topic, null);
      inserted += 1;
    }
  });

  importAll();

  console.log(`Vokabel-Import abgeschlossen: ${inserted} eingefuegt, ${skipped} uebersprungen (bereits vorhanden).`);
}

main();
