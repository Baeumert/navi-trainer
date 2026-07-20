// Wochensync der Wort-Priorisierung aus Ronnys Reyknap-Vokabelliste
// (Google Sheet, anonym lesbarer CSV-Export). Die Sheet-URL kommt bewusst
// NUR per Umgebungsvariable SHEET_CSV_URL herein - sie steht nicht im Repo,
// weil app/ oeffentlich nach GitHub gespiegelt wird.
//
// Ablauf: CSV laden -> Zeilen (Na'vi-Wort + "lernen bis"-Datum, Datum wird
// zeilenweise weitergefuellt) -> Na'vi-Text gegen den Fwew-Cache matchen
// (wie beim einmaligen Seed-Erzeugungsscript, siehe Git-Historie zu
// priority-seed.json) -> vocab_priority upserten. Es werden wie ueberall
// sonst KEINE Vokabelinhalte gespeichert, nur Fwew-ID + Datum; das Sheet
// wird nur transient im Speicher verarbeitet.
//
// Eintraege, die im Sheet fehlen, werden bewusst NICHT geloescht - die
// Admin-UI (routes/admin.js) darf eigene Prioritaeten pflegen.
//
// Ausgabe: ein JSON-Report auf stdout (added/date_changed/unmatched sowie
// der komplette Prioritaetsstand als "seed" im priority-seed.json-Format,
// damit der Aufrufer das Repo-Seed synchron halten kann). Exit != 0 nur
// bei harten Fehlern (Sheet nicht ladbar, Fwew leer, DB-Fehler).
//
// Aufruf (auf dem Zielhost, als Service-User wegen SQLite-WAL-Dateirechten):
//   SHEET_CSV_URL='https://...' node scripts/sync-priority-from-sheet.js
'use strict';

const db = require('../lib/db');
const fwew = require('../lib/fwew');
const { parseCsv } = require('../db/csv-util');

const SHEET_CSV_URL = process.env.SHEET_CSV_URL;
const FETCH_TIMEOUT_MS = 30000;

function isoDate(ddmmyyyy) {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(ddmmyyyy).trim());
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

async function fetchSheetCsv(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`sheet_http_${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

// Sheet-Layout: Spalte B = "lernen bis:" (dd.mm.yyyy, nur in der ersten
// Zeile eines Blocks gesetzt), Spalte C = Na'vi, Spalte F = Wortherkunft
// (Ronnys eigene Anmerkung, optional). Kopf-/Hinweiszeilen haben entweder
// kein Na'vi-Feld oder liegen vor dem ersten gueltigen Datum.
function extractEntries(csvText) {
  const entries = [];
  let currentDate = null;
  for (const row of parseCsv(csvText)) {
    const dateIso = isoDate(row[1] || '');
    if (dateIso) currentDate = dateIso;
    const navi = (row[2] || '').trim();
    if (!navi || !currentDate) continue;
    const note = (row[5] || '').trim() || null;
    entries.push({ navi, date: currentDate, note });
  }
  return entries;
}

async function main() {
  if (!SHEET_CSV_URL) {
    throw new Error('SHEET_CSV_URL nicht gesetzt');
  }

  const csvText = await fetchSheetCsv(SHEET_CSV_URL);
  const entries = extractEntries(csvText);
  if (entries.length === 0) {
    // Ein ploetzlich leeres/umgebautes Sheet soll keine stille Null-Runde
    // sein, sondern auffallen.
    throw new Error('keine Vokabelzeilen im Sheet gefunden (Layout geaendert?)');
  }

  // lib/fwew loggt seinen Cache-Status per console.log - stdout muss hier
  // aber reines Report-JSON bleiben (der Aufrufer parst es), also waehrend
  // des Refreshs auf stderr umleiten.
  const origConsoleLog = console.log;
  console.log = (...args) => console.error(...args);
  try {
    await fwew.refreshCache();
  } finally {
    console.log = origConsoleLog;
  }
  if (!fwew.isReady()) {
    throw new Error('Fwew-Cache leer, Matching nicht moeglich');
  }

  // Na'vi-Text (exakt, getrimmt) -> [Fwew-Woerter]; Mehrfachtreffer
  // (Homonyme) werden wie beim urspruenglichen Seed alle priorisiert.
  const byNavi = new Map();
  for (const word of fwew.getAllWords()) {
    const key = String(word.Navi || '').trim();
    if (!key) continue;
    if (!byNavi.has(key)) byNavi.set(key, []);
    byNavi.get(key).push(word);
  }

  const desired = new Map(); // fwew_id -> { navi, date }
  const unmatched = [];
  for (const entry of entries) {
    // Manche Zeilen listen Varianten getrennt durch " / " (z.B. "tsa'u / tsaw").
    const variants = entry.navi.split('/').map((s) => s.trim()).filter(Boolean);
    let found = false;
    for (const variant of variants) {
      let words = byNavi.get(variant) || [];
      if (words.length === 0) {
        // Fallback: Einzel-Lookup gegen die Live-API (exakter Treffer noetig,
        // /fwew/ liefert auch Stamm-Analysen zurueck).
        try {
          const hits = await fwew.lookupByNavi(variant);
          words = hits.filter((w) => String(w.Navi || '').trim() === variant);
        } catch (err) {
          words = [];
        }
      }
      for (const word of words) {
        desired.set(String(word.ID), { navi: variant, date: entry.date, note: entry.note });
        found = true;
      }
    }
    if (!found) unmatched.push(entry);
  }

  const existing = new Map(
    db
      .prepare('SELECT fwew_id, priority_date FROM vocab_priority')
      .all()
      .map((r) => [String(r.fwew_id), r.priority_date])
  );

  const added = [];
  const dateChanged = [];
  for (const [fwewId, info] of desired) {
    if (!existing.has(fwewId)) {
      added.push({ fwew_id: fwewId, navi: info.navi, date: info.date });
    } else if (existing.get(fwewId) !== info.date) {
      dateChanged.push({ fwew_id: fwewId, navi: info.navi, old_date: existing.get(fwewId), new_date: info.date });
    }
  }

  // origin_note wird mitgepflegt (Ronnys Wortherkunfts-Anmerkung aus dem
  // Sheet, Anzeige auf der Karteikarte) - das Sheet ist fuer seine Eintraege
  // die Wahrheit, eine geleerte Sheet-Zelle leert also auch die DB-Spalte.
  const upsert = db.prepare(
    `INSERT INTO vocab_priority (fwew_id, priority_date, origin_note) VALUES (?, ?, ?)
     ON CONFLICT (fwew_id) DO UPDATE SET priority_date = excluded.priority_date, origin_note = excluded.origin_note`
  );
  db.transaction(() => {
    for (const [fwewId, info] of desired) upsert.run(fwewId, info.date, info.note);
  })();

  const seed = db
    .prepare('SELECT fwew_id, priority_date FROM vocab_priority ORDER BY priority_date, CAST(fwew_id AS INTEGER)')
    .all()
    .map((r) => ({ fwew_id: String(r.fwew_id), priority_date: r.priority_date }));

  console.log(
    JSON.stringify(
      {
        sheet_entries: entries.length,
        matched_ids: desired.size,
        added,
        date_changed: dateChanged,
        unmatched,
        seed,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(`sync-priority-from-sheet: ${err.message}`);
  process.exit(1);
});
