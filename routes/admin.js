// Admin-Panel fuer Userverwaltung - analog Mission-Marvels routes/admin.js:
// Nutzer anlegen/loeschen, Adminrechte togglen, letzten Admin schuetzen.
// Ausserdem Verwaltung der Wort-Priorisierung (vocab_priority) im
// Live-Fwew-Modus - ersetzt die frueher ueber den (jetzt pausierten)
// Vokabel-Editor moegliche priority_date-Pflege.
const express = require('express');
const db = require('../lib/db');
const fwew = require('../lib/fwew');
const { hashPassword } = require('../lib/auth');
const { requireAdmin } = require('../middleware/guards');
const { anonymizeAndDeleteUser } = require('../lib/userDeletion');
const { validateAccountFields, MIN_PASSWORD_LENGTH } = require('../lib/validation');

const router = express.Router();
router.use(requireAdmin);

function adminCount() {
  return db.prepare('SELECT COUNT(*) AS c FROM users WHERE is_admin = 1').get().c;
}

router.get('/users', (req, res) => {
  const users = db.prepare('SELECT id, name, email, is_admin, is_creator, is_reviewer, created_at, last_login FROM users ORDER BY id').all();
  res.json(users);
});

router.post('/users', (req, res) => {
  const { name, email, password, is_admin, is_creator, is_reviewer } = req.body || {};
  // Dieselbe Validierung wie bei der Selbstregistrierung (E-Mail-Format,
  // Passwort-Mindestlaenge, Feldlaengen) - vorher liess das Admin-Panel
  // triviale Passwoerter/ungueltige E-Mails durch, obwohl die
  // Selbstregistrierung strenger war.
  const validationError = validateAccountFields(name, email, password);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(String(email).toLowerCase());
  if (existing) {
    return res.status(409).json({ error: 'email_taken' });
  }
  const passwordHash = hashPassword(password);
  const info = db
    .prepare('INSERT INTO users (name, email, password_hash, is_admin, is_creator, is_reviewer) VALUES (?, ?, ?, ?, ?, ?)')
    .run(name, String(email).toLowerCase(), passwordHash, is_admin ? 1 : 0, is_creator ? 1 : 0, is_reviewer ? 1 : 0);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.delete('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  if (id === req.session.userId) {
    return res.status(400).json({ error: 'cannot_delete_self' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'not_found' });
  if (user.is_admin && adminCount() <= 1) {
    return res.status(400).json({ error: 'cannot_delete_last_admin' });
  }
  // Loescht Login/Lerndaten vollstaendig (Art. 17 DSGVO), haengt aber
  // vom Nutzer erstellte/gereviewte Grammatik-Uebungen nur ab (Community-
  // Inhalt bleibt erhalten) - siehe lib/userDeletion.js.
  anonymizeAndDeleteUser(db, id);
  res.json({ ok: true });
});

router.patch('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'not_found' });

  const { is_admin, is_creator, is_reviewer, password } = req.body || {};

  if (typeof is_admin !== 'undefined') {
    const wantAdmin = !!is_admin;
    if (!wantAdmin && user.is_admin && adminCount() <= 1) {
      return res.status(400).json({ error: 'cannot_demote_last_admin' });
    }
    db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(wantAdmin ? 1 : 0, id);
  }

  // Creator/Reviewer sind additive Rollen ohne "letzter Admin"-Sonderfall -
  // beliebig togglebar, auch fuer sich selbst.
  if (typeof is_creator !== 'undefined') {
    db.prepare('UPDATE users SET is_creator = ? WHERE id = ?').run(is_creator ? 1 : 0, id);
  }
  if (typeof is_reviewer !== 'undefined') {
    db.prepare('UPDATE users SET is_reviewer = ? WHERE id = ?').run(is_reviewer ? 1 : 0, id);
  }

  if (password) {
    if (String(password).length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: 'password_too_short' });
    }
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), id);
  }

  const updated = db.prepare('SELECT id, name, email, is_admin, is_creator, is_reviewer FROM users WHERE id = ?').get(id);
  res.json(updated);
});

// --- Wort-Priorisierung (vocab_priority) ---
// Speichert bewusst nur Fwew-ID + Datum, keinen Wortinhalt. Navi-Text fuers
// Anzeigen kommt live aus dem Fwew-Cache dazu.
router.get('/priority', (req, res) => {
  const rows = db.prepare('SELECT fwew_id, priority_date FROM vocab_priority ORDER BY priority_date').all();
  const enriched = rows.map((row) => {
    const word = fwew.getWordById(row.fwew_id);
    return {
      fwew_id: row.fwew_id,
      priority_date: row.priority_date,
      navi: word ? word.Navi : null,
    };
  });
  res.json(enriched);
});

router.post('/priority', (req, res) => {
  const { fwew_id, priority_date } = req.body || {};
  if (!fwew_id || !priority_date) {
    return res.status(400).json({ error: 'missing_fields' });
  }
  if (!fwew.getWordById(fwew_id)) {
    return res.status(404).json({ error: 'not_found' });
  }
  db.prepare(
    `INSERT INTO vocab_priority (fwew_id, priority_date) VALUES (?, ?)
     ON CONFLICT (fwew_id) DO UPDATE SET priority_date = excluded.priority_date`
  ).run(String(fwew_id), priority_date);
  res.status(201).json({ ok: true });
});

router.delete('/priority/:fwewId', (req, res) => {
  db.prepare('DELETE FROM vocab_priority WHERE fwew_id = ?').run(req.params.fwewId);
  res.json({ ok: true });
});

module.exports = router;
