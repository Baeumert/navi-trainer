// Aktivierung: bevor eine Vokabel im Karteikarten-Trainer erscheint, muss
// sie pro Nutzer einmal durch Abschreiben (exaktes Eintippen des Na'vi-
// Worts) "freigeschaltet" werden. Priorisierte Woerter (vocab_priority,
// z.B. aus der Reyknap-Anfaengerliste) werden zuerst zur Aktivierung
// angeboten, danach der Rest des Woerterbuchs. Wortdaten kommen live aus
// dem Fwew-Cache (lib/fwew.js), lokal wird nur die Fwew-ID gespeichert.
const express = require('express');
const db = require('../lib/db');
const fwew = require('../lib/fwew');
const { requireAuth } = require('../middleware/guards');

const router = express.Router();
router.use(requireAuth);

function stripStressTags(navi) {
  return navi.replace(/<\/?u>/g, '');
}

// Normalisiert fuer den Abschreib-Vergleich: Betonungs-Tags entfernen,
// Whitespace trimmen. Bewusst NICHT case-insensitive - Na'vi-Schreibweise
// ist durchgehend kleingeschrieben, das soll mit abgeschrieben werden.
function normalizeForCompare(str) {
  return stripStressTags(String(str)).trim();
}

function priorityDateFor(fwewId) {
  const row = db.prepare('SELECT priority_date FROM vocab_priority WHERE fwew_id = ?').get(fwewId);
  return row ? row.priority_date : null;
}

// Ronnys Wortherkunfts-Anmerkung aus der Reyknap-Liste (falls vorhanden) -
// gerade beim ersten Kennenlernen (Abschreiben) hilfreich, gleicher
// Feldname wie im Trainer (originNote).
function originNoteFor(fwewId) {
  const row = db.prepare('SELECT origin_note FROM vocab_priority WHERE fwew_id = ?').get(fwewId);
  return row && row.origin_note ? row.origin_note : null;
}

router.get('/next', (req, res) => {
  if (!fwew.isReady()) {
    return res.status(503).json({ error: 'fwew_unavailable' });
  }

  const userId = req.session.userId;
  const limit = Math.min(Number(req.query.limit) || 10, 50);

  const activatedIds = new Set(
    db.prepare('SELECT vocab_id FROM activation WHERE user_id = ?').all(userId).map((r) => r.vocab_id)
  );

  const candidates = fwew
    .getAllWords()
    .filter((w) => !activatedIds.has(String(w.ID)))
    .map((w) => ({ word: w, priority_date: priorityDateFor(String(w.ID)) }));

  candidates.sort((a, b) => {
    if (a.priority_date && b.priority_date) return a.priority_date < b.priority_date ? -1 : 1;
    if (a.priority_date) return -1;
    if (b.priority_date) return 1;
    return Number(a.word.ID) - Number(b.word.ID);
  });

  const rows = candidates.slice(0, limit).map((c) => ({
    id: c.word.ID,
    navi: c.word.Navi,
    translations: fwew.translationsOf(c.word),
    priority_date: c.priority_date,
    originNote: originNoteFor(String(c.word.ID)),
  }));

  res.json(rows);
});

router.post('/activate', (req, res) => {
  const userId = req.session.userId;
  const { vocab_id, input } = req.body || {};
  if (!vocab_id || typeof input !== 'string') {
    return res.status(400).json({ error: 'missing_fields' });
  }

  const word = fwew.getWordById(vocab_id);
  if (!word) return res.status(404).json({ error: 'not_found' });

  const expected = normalizeForCompare(word.Navi);
  const actual = normalizeForCompare(input);

  if (expected !== actual) {
    return res.status(400).json({ error: 'mismatch' });
  }

  db.prepare(
    `INSERT INTO activation (user_id, vocab_id, activated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT (user_id, vocab_id) DO NOTHING`
  ).run(userId, vocab_id);

  res.json({ ok: true });
});

router.get('/status', (req, res) => {
  if (!fwew.isReady()) {
    return res.status(503).json({ error: 'fwew_unavailable' });
  }

  const userId = req.session.userId;
  const total = fwew.getAllWords().length;
  const activated = db.prepare('SELECT COUNT(*) AS c FROM activation WHERE user_id = ?').get(userId).c;
  res.json({ total, activated, remaining: total - activated });
});

module.exports = router;
