// Trainer-Modus: Leitner-Karteikartensystem (10 Boxen/Level 0-9) mit
// exponentiellem Wiederholungsabstand, angelehnt an jMemorize
// (Category.java/LearnSettings.java). Beide Richtungen (Na'vi->Zielsprache
// und Zielsprache->Na'vi) werden als unabhaengige Boxen pro Vokabel und
// User gefuehrt, s. progress.direction.
//
// Wortdaten (Na'vi-Text + alle verfuegbaren Uebersetzungen) kommen live aus
// dem Fwew-Cache (lib/fwew.js), nicht mehr aus einer lokalen vocab-Tabelle -
// progress/activation referenzieren nur noch die Fwew-ID (vocab_id TEXT).
const express = require('express');
const db = require('../lib/db');
const fwew = require('../lib/fwew');
const { requireAuth } = require('../middleware/guards');

const router = express.Router();
router.use(requireAuth);

const DIRECTIONS = ['navi_to_target', 'target_to_navi'];
const MAX_LEVEL = 9;

function isValidDirection(direction) {
  return DIRECTIONS.includes(direction);
}

// Verzoegerung bis zur naechsten Faelligkeit, indiziert nach dem Level VOR
// der Beforderung durch diese Antwort (wie jMemorize's getExpirationDate):
// Level 0 -> 1 Tag, Level 1 -> 2 Tage, ..., Level 8 -> 256 Tage.
function delayDaysForLevel(level) {
  return Math.pow(2, level);
}

function priorityDateFor(fwewId) {
  const row = db.prepare('SELECT priority_date FROM vocab_priority WHERE fwew_id = ?').get(fwewId);
  return row ? row.priority_date : null;
}

// Ronnys Wortherkunfts-Anmerkung aus der Reyknap-Liste (falls vorhanden) -
// wird auf der Na'vi-Seite der Karteikarte angezeigt.
function originNoteFor(fwewId) {
  const row = db.prepare('SELECT origin_note FROM vocab_priority WHERE fwew_id = ?').get(fwewId);
  return row && row.origin_note ? row.origin_note : null;
}

// Reichert eine Wort-ID mit den live geladenen Fwew-Daten an (alle
// verfuegbaren Uebersetzungen, nicht nur DE/EN). Woerter, die im Cache
// nicht (mehr) gefunden werden, werden herausgefiltert statt mit leeren
// Daten ausgeliefert zu werden.
function enrich(row) {
  const word = fwew.getWordById(row.vocab_id);
  if (!word) return null;
  return {
    ...row,
    navi: word.Navi,
    partOfSpeech: word.PartOfSpeech,
    translations: fwew.translationsOf(word),
    ...fwew.metaOf(word),
    originNote: originNoteFor(row.vocab_id),
  };
}

// Naechste Karten fuer eine Trainer-Runde. Zwei Modi (?mode=):
// - "due" (Default): bevorzugt faellige Karten (am laengsten ueberfaellig
//   zuerst), fuellt den Rest mit noch nie geuebten Woertern auf - priorisierte
//   Woerter (vocab_priority, z.B. aus der Reyknap-Anfaengerliste) zuerst und
//   nach ihrem Lerndatum sortiert, danach der Rest des Woerterbuchs in
//   zufaelliger Reihenfolge.
// - "all": alle aktivierten Woerter dieser Richtung, unabhaengig von der
//   Faelligkeit - zum bewussten Wiederholen des gesamten aktivierten
//   Bestands, nicht nur der gerade faelligen Karten. Beantworten laeuft
//   ueber denselben /answer-Endpunkt wie im "due"-Modus, eine falsche
//   Antwort faellt also genauso auf Box 0 zurueck.
// Nur Woerter, die der Nutzer bereits per Abschreiben aktiviert hat (siehe
// routes/activation.js), tauchen hier ueberhaupt auf.
router.get('/next', (req, res) => {
  if (!fwew.isReady()) {
    return res.status(503).json({ error: 'fwew_unavailable' });
  }

  const userId = req.session.userId;
  const direction = req.query.direction;
  const mode = req.query.mode === 'all' ? 'all' : 'due';
  const limit = mode === 'all'
    ? Math.min(Number(req.query.limit) || 1000, 2000)
    : Math.min(Number(req.query.limit) || 10, 50);

  if (!isValidDirection(direction)) {
    return res.status(400).json({ error: 'invalid_direction' });
  }

  const activatedIds = new Set(
    db.prepare('SELECT vocab_id FROM activation WHERE user_id = ?').all(userId).map((r) => r.vocab_id)
  );

  if (mode === 'all') {
    const progressRows = db
      .prepare('SELECT vocab_id, level, due_at, correct_count, wrong_count, last_seen FROM progress WHERE user_id = ? AND direction = ?')
      .all(userId, direction);
    const progressById = new Map(progressRows.map((r) => [r.vocab_id, r]));

    const allRows = Array.from(activatedIds).map((id) => progressById.get(id) || {
      vocab_id: id, level: null, due_at: null, correct_count: 0, wrong_count: 0, last_seen: null,
    });
    // Fisher-Yates-Mischung, damit eine Wiederholungsrunde nicht immer in
    // derselben Reihenfolge kommt.
    for (let i = allRows.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [allRows[i], allRows[j]] = [allRows[j], allRows[i]];
    }

    const cards = allRows.slice(0, limit).map(enrich).filter(Boolean);
    return res.json(cards);
  }

  const dueRows = db
    .prepare(
      `SELECT vocab_id, level, due_at, correct_count, wrong_count, last_seen
       FROM progress
       WHERE user_id = ? AND direction = ? AND due_at <= datetime('now')
       ORDER BY due_at ASC`
    )
    .all(userId, direction)
    .filter((r) => activatedIds.has(r.vocab_id))
    .slice(0, limit);

  const remaining = limit - dueRows.length;
  let newRows = [];
  if (remaining > 0) {
    const seenIds = new Set(
      db.prepare('SELECT vocab_id FROM progress WHERE user_id = ? AND direction = ?').all(userId, direction).map((r) => r.vocab_id)
    );
    const candidates = Array.from(activatedIds)
      .filter((id) => !seenIds.has(id))
      .map((id) => ({ vocab_id: id, priority_date: priorityDateFor(id) }));

    // Priorisierte Woerter zuerst (nach Datum), Rest zufaellig - Zufalls-
    // Reihenfolge wird einmal pro Request stabil ueber einen Sortierschluessel
    // erzeugt statt live per RANDOM() (das gab es vorher als SQL-ORDER-BY,
    // hier clientseitig in JS nachgebildet, da die Wortliste jetzt aus dem
    // Cache statt der DB kommt).
    candidates.sort((a, b) => {
      if (a.priority_date && b.priority_date) return a.priority_date < b.priority_date ? -1 : 1;
      if (a.priority_date) return -1;
      if (b.priority_date) return 1;
      return Math.random() - 0.5;
    });

    newRows = candidates.slice(0, remaining).map((c) => ({
      vocab_id: c.vocab_id,
      level: null,
      due_at: null,
      correct_count: 0,
      wrong_count: 0,
      last_seen: null,
    }));
  }

  const cards = [...dueRows, ...newRows].map(enrich).filter(Boolean);
  res.json(cards);
});

// Leichtgewichtiger Zaehler (nur Zahlen, keine Wortliste) fuer die
// "X heute faellig"-Anzeige im Trainer - gleiche Faellig-Definition wie
// /progress (faellige Karten + aktivierte, aber noch nie geuebte Woerter),
// hier aber ueber beide Richtungen summiert statt pro Richtung aufgeschluesselt.
router.get('/due-count', (req, res) => {
  const userId = req.session.userId;
  const activatedIds = new Set(
    db.prepare('SELECT vocab_id FROM activation WHERE user_id = ?').all(userId).map((r) => r.vocab_id)
  );

  let due = 0;
  for (const direction of DIRECTIONS) {
    const dueCount = db
      .prepare(
        `SELECT COUNT(*) AS c FROM progress
         WHERE user_id = ? AND direction = ? AND due_at <= datetime('now')`
      )
      .get(userId, direction).c;
    const seenIds = new Set(
      db.prepare('SELECT vocab_id FROM progress WHERE user_id = ? AND direction = ?').all(userId, direction).map((r) => r.vocab_id)
    );
    const notStarted = Array.from(activatedIds).filter((id) => !seenIds.has(id)).length;
    due += dueCount + notStarted;
  }

  res.json({ due, activated: activatedIds.size });
});

router.post('/answer', (req, res) => {
  const userId = req.session.userId;
  const { vocab_id, direction, correct } = req.body || {};
  if (!vocab_id || !isValidDirection(direction) || typeof correct !== 'boolean') {
    return res.status(400).json({ error: 'missing_fields' });
  }

  const word = fwew.getWordById(vocab_id);
  if (!word) return res.status(404).json({ error: 'not_found' });

  // Erste Antwort auf ein Wort/Richtung startet bei Level 0, analog zu
  // jMemorize's addCard-Default.
  db.prepare(
    `INSERT INTO progress (user_id, vocab_id, direction, level, due_at, correct_count, wrong_count, last_seen)
     VALUES (?, ?, ?, 0, datetime('now'), 0, 0, NULL)
     ON CONFLICT (user_id, vocab_id, direction) DO NOTHING`
  ).run(userId, vocab_id, direction);

  const existing = db
    .prepare('SELECT * FROM progress WHERE user_id = ? AND vocab_id = ? AND direction = ?')
    .get(userId, vocab_id, direction);

  let newLevel;
  let dueAtSql;
  if (correct) {
    const levelBeforePromotion = existing.level;
    newLevel = Math.min(existing.level + 1, MAX_LEVEL);
    const delayDays = delayDaysForLevel(levelBeforePromotion);
    dueAtSql = `datetime('now', '+${delayDays} days')`;
  } else {
    newLevel = 0;
    dueAtSql = "datetime('now')";
  }

  db.prepare(
    `UPDATE progress
     SET level = ?,
         due_at = ${dueAtSql},
         correct_count = correct_count + ?,
         wrong_count = wrong_count + ?,
         last_seen = datetime('now')
     WHERE user_id = ? AND vocab_id = ? AND direction = ?`
  ).run(newLevel, correct ? 1 : 0, correct ? 0 : 1, userId, vocab_id, direction);

  const updated = db
    .prepare('SELECT * FROM progress WHERE user_id = ? AND vocab_id = ? AND direction = ?')
    .get(userId, vocab_id, direction);

  res.json({ ok: true, progress: updated });
});

router.get('/progress', (req, res) => {
  if (!fwew.isReady()) {
    return res.status(503).json({ error: 'fwew_unavailable' });
  }

  const userId = req.session.userId;
  const totalWords = fwew.getAllWords().length;
  const activatedWords = db.prepare('SELECT COUNT(*) AS c FROM activation WHERE user_id = ?').get(userId).c;

  const directions = {};
  for (const direction of DIRECTIONS) {
    const dueCount = db
      .prepare(
        `SELECT COUNT(*) AS c FROM progress
         WHERE user_id = ? AND direction = ? AND due_at <= datetime('now')`
      )
      .get(userId, direction).c;

    const levelRows = db
      .prepare('SELECT level, COUNT(*) AS c FROM progress WHERE user_id = ? AND direction = ? GROUP BY level')
      .all(userId, direction);
    const levels = Array.from({ length: MAX_LEVEL + 1 }, () => 0);
    levelRows.forEach((r) => { levels[r.level] = r.c; });

    const studied = levelRows.reduce((sum, r) => sum + r.c, 0);
    // Nur aktivierte, aber noch nie geuebte Woerter gelten als sofort
    // faellig - nicht aktivierte Woerter tauchen im Trainer noch gar nicht
    // auf (siehe /trainer/next), zaehlen also hier nicht als "faellig".
    const notStarted = Math.max(activatedWords - studied, 0);
    directions[direction] = {
      due: dueCount + notStarted,
      levels,
      studied,
      not_started: notStarted,
    };
  }

  const progressRows = db
    .prepare(
      `SELECT vocab_id,
              MAX(CASE WHEN direction = 'navi_to_target' THEN level END) AS level_navi_to_target,
              MAX(CASE WHEN direction = 'target_to_navi' THEN level END) AS level_target_to_navi,
              MAX(CASE WHEN direction = 'navi_to_target' THEN correct_count END) AS correct_navi_to_target,
              MAX(CASE WHEN direction = 'navi_to_target' THEN wrong_count END) AS wrong_navi_to_target,
              MAX(CASE WHEN direction = 'target_to_navi' THEN correct_count END) AS correct_target_to_navi,
              MAX(CASE WHEN direction = 'target_to_navi' THEN wrong_count END) AS wrong_target_to_navi
       FROM progress
       WHERE user_id = ?
       GROUP BY vocab_id`
    )
    .all(userId);

  const words = progressRows
    .map((row) => {
      const word = fwew.getWordById(row.vocab_id);
      if (!word) return null;
      return {
        id: row.vocab_id,
        navi: word.Navi,
        translations: fwew.translationsOf(word),
        level_navi_to_target: row.level_navi_to_target,
        level_target_to_navi: row.level_target_to_navi,
        correct_navi_to_target: row.correct_navi_to_target,
        wrong_navi_to_target: row.wrong_navi_to_target,
        correct_target_to_navi: row.correct_target_to_navi,
        wrong_target_to_navi: row.wrong_target_to_navi,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.navi.localeCompare(b.navi));

  const summary = {
    total: totalWords,
    activated: activatedWords,
    seen: words.length,
    mastered: words.filter((w) => w.level_navi_to_target >= 5 && w.level_target_to_navi >= 5).length,
  };

  res.json({ summary, directions, words });
});

module.exports = router;
