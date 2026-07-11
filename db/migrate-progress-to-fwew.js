// Einmalige Migration: uebertraegt Lernstaende (progress_legacy) und
// Aktivierungen (activation_legacy), die vor der Umstellung auf die Live-
// Fwew-API mit lokalen (INTEGER) vocab-IDs entstanden sind, auf die neuen
// TEXT-Tabellen mit Fwew-IDs. Matching per betonungsfreiem Na'vi-Text
// (gleiche Normalisierung wie routes/activation.js) gegen den live
// geladenen Fwew-Cache.
//
// Rein additiv und wiederholbar: liest nur aus *_legacy + vocab (unveraendert),
// schreibt per INSERT OR IGNORE in die neuen Tabellen. Nicht matchbare
// Woerter werden am Ende aufgelistet statt stillschweigend verworfen.
//
// Aufruf: node db/migrate-progress-to-fwew.js
'use strict';

const db = require('../lib/db');
const fwew = require('../lib/fwew');

function stripStressTags(navi) {
  return String(navi).replace(/<\/?u>/g, '').trim();
}

async function main() {
  const hasLegacy = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('progress_legacy','activation_legacy')")
    .all();
  if (hasLegacy.length === 0) {
    console.log('Keine *_legacy-Tabellen gefunden - nichts zu migrieren (frische Installation oder bereits migriert).');
    return;
  }

  console.log('Lade Fwew-Woerterbuch...');
  await fwew.refreshCache();
  if (!fwew.isReady()) {
    console.error('Fwew-Cache konnte nicht geladen werden - Abbruch. Bitte Netzwerk/API pruefen und erneut versuchen.');
    process.exitCode = 1;
    return;
  }
  const allWords = fwew.getAllWords();
  console.log(`Fwew-Woerterbuch geladen: ${allWords.length} Woerter.`);

  // navi (tag-frei) -> Fwew-ID(s). Mehrdeutige Treffer (mehrere Fwew-Eintraege
  // mit identischem Klartext, z.B. Homonyme) werden aufgehoben und am Ende
  // separat gemeldet statt geraten.
  const byPlainNavi = new Map();
  for (const word of allWords) {
    const plain = stripStressTags(word.Navi || word.navi);
    if (!byPlainNavi.has(plain)) byPlainNavi.set(plain, []);
    byPlainNavi.get(plain).push(word);
  }

  const vocabRows = db.prepare('SELECT id, navi FROM vocab').all();
  const localIdToFwewId = new Map();
  const unmatched = [];
  const ambiguous = [];
  for (const v of vocabRows) {
    const plain = stripStressTags(v.navi);
    const candidates = byPlainNavi.get(plain);
    if (!candidates || candidates.length === 0) {
      unmatched.push(v.navi);
    } else if (candidates.length > 1) {
      ambiguous.push({ navi: v.navi, fwewIds: candidates.map((c) => c.ID) });
      // Bei Mehrdeutigkeit trotzdem den ersten Treffer nehmen, damit der
      // Lernstand nicht verloren geht - der Ambiguous-Report macht die
      // Unsicherheit sichtbar, damit es bei Bedarf manuell korrigiert wird.
      localIdToFwewId.set(v.id, String(candidates[0].ID));
    } else {
      localIdToFwewId.set(v.id, String(candidates[0].ID));
    }
  }

  const insertProgress = db.prepare(
    `INSERT INTO progress (user_id, vocab_id, direction, level, due_at, correct_count, wrong_count, last_seen)
     VALUES (@user_id, @vocab_id, @direction, @level, @due_at, @correct_count, @wrong_count, @last_seen)
     ON CONFLICT (user_id, vocab_id, direction) DO NOTHING`
  );
  const insertActivation = db.prepare(
    `INSERT INTO activation (user_id, vocab_id, activated_at)
     VALUES (@user_id, @vocab_id, @activated_at)
     ON CONFLICT (user_id, vocab_id) DO NOTHING`
  );

  let progressMigrated = 0;
  let progressSkipped = 0;
  let activationMigrated = 0;
  let activationSkipped = 0;

  const run = db.transaction(() => {
    const legacyProgress = db.prepare('SELECT * FROM progress_legacy').all();
    for (const row of legacyProgress) {
      const fwewId = localIdToFwewId.get(row.vocab_id);
      if (!fwewId) {
        progressSkipped += 1;
        continue;
      }
      insertProgress.run({ ...row, vocab_id: fwewId });
      progressMigrated += 1;
    }

    const legacyActivation = db.prepare('SELECT * FROM activation_legacy').all();
    for (const row of legacyActivation) {
      const fwewId = localIdToFwewId.get(row.vocab_id);
      if (!fwewId) {
        activationSkipped += 1;
        continue;
      }
      insertActivation.run({ ...row, vocab_id: fwewId });
      activationMigrated += 1;
    }
  });
  run();

  console.log(`\nprogress: ${progressMigrated} migriert, ${progressSkipped} uebersprungen (kein Fwew-Match fuer die Vokabel).`);
  console.log(`activation: ${activationMigrated} migriert, ${activationSkipped} uebersprungen.`);

  if (unmatched.length > 0) {
    console.log(`\nNicht in Fwew gefunden (${unmatched.length} von ${vocabRows.length} lokalen Woertern):`);
    console.log(unmatched.join(', '));
  }
  if (ambiguous.length > 0) {
    console.log(`\nMehrdeutig (${ambiguous.length}) - erster Treffer wurde verwendet, ggf. manuell pruefen:`);
    ambiguous.forEach((a) => console.log(`  ${a.navi} -> Fwew-IDs: ${a.fwewIds.join(', ')}`));
  }
  if (unmatched.length === 0 && ambiguous.length === 0) {
    console.log('\nAlle lokalen Woerter konnten eindeutig auf Fwew-IDs gemappt werden.');
  }
}

main().catch((err) => {
  console.error('Migration fehlgeschlagen:', err);
  process.exitCode = 1;
});
