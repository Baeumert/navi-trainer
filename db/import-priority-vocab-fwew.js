// Befuellt vocab_priority (Prioritaetsquelle im Live-Fwew-Modus) aus
// priority-seed.json - einer reinen Fwew-ID+Datum-Liste, OHNE Wortinhalt.
//
// Der Seed wurde einmalig aus der Reyknap-Anfaengerliste erzeugt (Navi-Text
// gegen den Fwew-Cache gematcht, siehe Git-Historie fuer das Erzeugungs-
// Script), danach wurde die CSV-Quelle bewusst aus dem Repo entfernt - hier
// werden keine Vokabeln (Woerter/Uebersetzungen) mehr gespeichert oder
// eingelesen, nur noch IDs.
//
// Idempotent (INSERT OR REPLACE), beliebig oft erneut lauffaehig.
//
// Aufruf: node db/import-priority-vocab-fwew.js
'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../lib/db');

const SEED_FILE = path.join(__dirname, 'priority-seed.json');

function main() {
  const seed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));

  const upsert = db.prepare(
    'INSERT INTO vocab_priority (fwew_id, priority_date) VALUES (?, ?) ON CONFLICT (fwew_id) DO UPDATE SET priority_date = excluded.priority_date'
  );

  const run = db.transaction(() => {
    for (const entry of seed) {
      upsert.run(entry.fwew_id, entry.priority_date);
    }
  });
  run();

  console.log(`Prioritaets-Import abgeschlossen: ${seed.length} Fwew-IDs markiert.`);
}

main();
