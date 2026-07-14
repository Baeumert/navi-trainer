const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../lib/db');
const { hashPassword, verifyPassword } = require('../lib/auth');
const { requireAuth } = require('../middleware/guards');
const { anonymizeAndDeleteUser } = require('../lib/userDeletion');
const { EMAIL_RE, validateAccountFields, validateNaviName, CREDIT_NAME_PREFS } = require('../lib/validation');
const { buildCreditDisplayName } = require('../lib/creditName');

const router = express.Router();

// Bremst Credential-Stuffing/Brute-Force gegen Login und die
// passwortgeschuetzten Selbstverwaltungs-Endpunkte (Passwort-/Konto-
// Loeschung verlangen das aktuelle Passwort erneut). scrypt allein bremst
// nur pro Versuch, nicht die Gesamtzahl der Versuche.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_attempts' },
});

// Oeffentlicher Status, ob Selbstregistrierung noch moeglich ist (nur vor
// dem allerersten Bootstrap-Admin) - Frontend blendet den Registrieren-Tab
// danach aus.
router.get('/status', (req, res) => {
  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  res.json({ registration_open: userCount === 0 });
});

router.post('/register', (req, res) => {
  // Offene Selbstregistrierung gibt es nur fuer den allerersten Bootstrap-
  // Admin (leere users-Tabelle). Danach koennen neue Nutzer nur noch von
  // einem Admin ueber das Admin-Panel (routes/admin.js) angelegt werden.
  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (userCount > 0) {
    return res.status(403).json({ error: 'registration_closed' });
  }

  const { name, email, password } = req.body || {};
  const validationError = validateAccountFields(name, email, password);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) {
    return res.status(409).json({ error: 'email_taken' });
  }

  // Erster registrierter User wird automatisch Admin (Bootstrap-Fall).
  const isAdmin = 1;

  const passwordHash = hashPassword(password);
  const info = db
    .prepare('INSERT INTO users (name, email, password_hash, is_admin) VALUES (?, ?, ?, ?)')
    .run(name, email.toLowerCase(), passwordHash, isAdmin);

  // Session-Fixation-Schutz: neue Session-ID nach erfolgreicher
  // Authentifizierung erzeugen, statt Auth-Daten auf eine Session-ID zu
  // schreiben, die schon vor dem Login bekannt gewesen sein koennte.
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'session_error' });
    req.session.userId = info.lastInsertRowid;
    req.session.isAdmin = !!isAdmin;
    req.session.isCreator = false;
    req.session.isReviewer = false;
    req.session.name = name;
    req.session.save((saveErr) => {
      if (saveErr) return res.status(500).json({ error: 'session_error' });
      res.json({
        id: info.lastInsertRowid,
        name,
        email: email.toLowerCase(),
        is_admin: !!isAdmin,
        is_creator: false,
        is_reviewer: false,
        welcome_seen: false,
      });
    });
  });
});

router.post('/login', authLimiter, (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'missing_fields' });
  }
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase());
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(user.id);

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'session_error' });
    req.session.userId = user.id;
    req.session.isAdmin = !!user.is_admin;
    req.session.isCreator = !!user.is_creator;
    req.session.isReviewer = !!user.is_reviewer;
    req.session.name = user.name;
    req.session.save((saveErr) => {
      if (saveErr) return res.status(500).json({ error: 'session_error' });
      res.json({
        id: user.id,
        name: user.name,
        email: user.email,
        is_admin: !!user.is_admin,
        is_creator: !!user.is_creator,
        is_reviewer: !!user.is_reviewer,
        welcome_seen: !!user.welcome_seen,
      });
    });
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

router.get('/me', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'auth_required' });
  }
  const user = db
    .prepare('SELECT email, welcome_seen, navi_name, credit_name_pref FROM users WHERE id = ?')
    .get(req.session.userId);
  res.json({
    id: req.session.userId,
    name: req.session.name,
    email: user ? user.email : null,
    is_admin: !!req.session.isAdmin,
    is_creator: !!req.session.isCreator,
    is_reviewer: !!req.session.isReviewer,
    welcome_seen: !!(user && user.welcome_seen),
    navi_name: user ? user.navi_name : null,
    credit_name_pref: user ? user.credit_name_pref : 'real',
  });
});

// Selbstverwaltung im Profil: Namen aendern und/oder Passwort aendern
// (verlangt dafuer das aktuelle Passwort). Beides optional, aber mindestens
// eines muss angegeben sein.
router.patch('/me', requireAuth, authLimiter, (req, res) => {
  const { name, navi_name, credit_name_pref, current_password, new_password } = req.body || {};
  const userId = req.session.userId;

  if (name) {
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, userId);
    req.session.name = name;
  }

  // Na'vi-Name ist optional: ein expliziter leerer String loescht ihn
  // wieder (auf NULL statt '', siehe lib/db.js), undefined laesst ihn
  // unangetastet. Dubletten-Check case-insensitive gegen alle ANDEREN
  // Nutzer - der Unique-Index in lib/db.js faengt eine Race-Condition
  // zwischen Check und Write zusaetzlich ab.
  let naviNameChanged = false;
  if (navi_name !== undefined) {
    const trimmed = String(navi_name).trim();
    if (trimmed === '') {
      db.prepare('UPDATE users SET navi_name = NULL WHERE id = ?').run(userId);
    } else {
      const naviNameError = validateNaviName(trimmed);
      if (naviNameError) {
        return res.status(400).json({ error: naviNameError });
      }
      const duplicate = db
        .prepare('SELECT id FROM users WHERE navi_name = ? COLLATE NOCASE AND id != ?')
        .get(trimmed, userId);
      if (duplicate) {
        return res.status(409).json({ error: 'navi_name_taken' });
      }
      try {
        db.prepare('UPDATE users SET navi_name = ? WHERE id = ?').run(trimmed, userId);
      } catch (err) {
        if (String(err.message).includes('UNIQUE constraint failed')) {
          return res.status(409).json({ error: 'navi_name_taken' });
        }
        throw err;
      }
    }
    naviNameChanged = true;
  }

  let prefChanged = false;
  if (credit_name_pref !== undefined) {
    if (!CREDIT_NAME_PREFS.includes(credit_name_pref)) {
      return res.status(400).json({ error: 'invalid_credit_name_pref' });
    }
    db.prepare('UPDATE users SET credit_name_pref = ? WHERE id = ?').run(credit_name_pref, userId);
    prefChanged = true;
  }

  if (new_password) {
    if (!current_password) {
      return res.status(400).json({ error: 'current_password_required' });
    }
    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId);
    if (!verifyPassword(current_password, user.password_hash)) {
      return res.status(401).json({ error: 'wrong_current_password' });
    }
    if (String(new_password).length < 8) {
      return res.status(400).json({ error: 'password_too_short' });
    }
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(new_password), userId);
  }

  if (!name && navi_name === undefined && !prefChanged && !new_password) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  // Ein schon bestehender Danksagungs-Eintrag (grammar_credits) traegt den
  // Anzeige-Namen denormalisiert (er muss eine Account-Loeschung ueberleben,
  // siehe lib/userDeletion.js) - bei Name-/Na'vi-Name-/Praeferenz-Aenderung
  // hier aktualisieren, statt auf die naechste Uebungs-Freigabe zu warten.
  if (name || naviNameChanged || prefChanged) {
    const existingCredit = db.prepare('SELECT id FROM grammar_credits WHERE user_id = ?').get(userId);
    if (existingCredit) {
      const current = db.prepare('SELECT name, navi_name, credit_name_pref FROM users WHERE id = ?').get(userId);
      const displayName = buildCreditDisplayName(current.name, current.navi_name, current.credit_name_pref);
      db.prepare('UPDATE grammar_credits SET display_name = ? WHERE id = ?').run(displayName, existingCredit.id);
    }
  }

  res.json({ ok: true, name: req.session.name });
});

// Selbstloeschung des eigenen Accounts (Art. 17 DSGVO, Recht auf Loeschung).
// Verlangt das aktuelle Passwort als Bestaetigung (gleiches Muster wie beim
// Passwort-Aendern) - eine so endgueltige Aktion sollte nicht durch einen
// blossen Klick/eine gekaperte Session ausloesbar sein. Der letzte
// verbleibende Admin kann sich nicht selbst loeschen (gleicher Schutz wie
// admin.js "cannot_demote_last_admin" - sonst waere das System ohne jeden
// Admin nicht mehr verwaltbar).
router.delete('/me', requireAuth, authLimiter, (req, res) => {
  const { password } = req.body || {};
  if (!password) {
    return res.status(400).json({ error: 'missing_fields' });
  }
  const userId = req.session.userId;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'wrong_current_password' });
  }
  if (user.is_admin) {
    const adminCount = db.prepare('SELECT COUNT(*) AS c FROM users WHERE is_admin = 1').get().c;
    if (adminCount <= 1) {
      return res.status(400).json({ error: 'cannot_delete_last_admin' });
    }
  }

  anonymizeAndDeleteUser(db, userId);

  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

// Auskunftsrecht (Art. 15 DSGVO): saemtliche ueber den Nutzer gespeicherten
// Daten in einer Struktur zusammentragen - sowohl fuer den JSON- als auch
// den CSV-Export genutzt, damit beide Formate garantiert deckungsgleich sind.
function gatherUserData(userId) {
  const account = db
    .prepare(
      'SELECT id, name, navi_name, credit_name_pref, email, is_admin, is_creator, is_reviewer, welcome_seen, created_at FROM users WHERE id = ?'
    )
    .get(userId);
  const vocabProgress = db
    .prepare('SELECT vocab_id, direction, level, due_at, correct_count, wrong_count, last_seen FROM progress WHERE user_id = ?')
    .all(userId);
  const vocabActivation = db
    .prepare('SELECT vocab_id, activated_at FROM activation WHERE user_id = ?')
    .all(userId);
  const grammarAttempts = db
    .prepare(
      `SELECT ga.exercise_id, ge.module, ga.correct, ga.answered_at
       FROM grammar_attempts ga
       LEFT JOIN grammar_exercises ge ON ge.id = ga.exercise_id
       WHERE ga.user_id = ?`
    )
    .all(userId);
  const grammarCreated = db
    .prepare('SELECT id, module, status, data, review_note, created_at, updated_at FROM grammar_exercises WHERE creator_id = ?')
    .all(userId)
    .map((r) => ({ ...r, data: JSON.parse(r.data) }));
  const grammarReviewed = db
    .prepare('SELECT id, module, status, reviewed_at, review_note FROM grammar_exercises WHERE reviewer_id = ?')
    .all(userId);

  return {
    exported_at: new Date().toISOString(),
    account,
    vocab_progress: vocabProgress,
    vocab_activation: vocabActivation,
    grammar_attempts: grammarAttempts,
    grammar_exercises_created: grammarCreated,
    grammar_exercises_reviewed: grammarReviewed,
  };
}

// Flacht die verschachtelte Auskunfts-Struktur zu category/index/field/value-
// Zeilen ab - funktioniert unabhaengig davon, welche Felder eine Kategorie
// hat (kein festes Spaltenschema noetig), bleibt aber garantiert gueltiges,
// einfaches CSV ohne verschachtelte Werte.
function toCsv(data) {
  const rows = [['category', 'index', 'field', 'value']];
  Object.entries(data).forEach(([category, value]) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        Object.entries(item).forEach(([field, v]) => {
          rows.push([category, String(index), field, typeof v === 'object' ? JSON.stringify(v) : String(v ?? '')]);
        });
      });
    } else if (value && typeof value === 'object') {
      Object.entries(value).forEach(([field, v]) => {
        rows.push([category, '', field, typeof v === 'object' ? JSON.stringify(v) : String(v ?? '')]);
      });
    } else {
      rows.push([category, '', '', String(value ?? '')]);
    }
  });
  const escape = (cell) => {
    let s = String(cell);
    // CSV-/Formel-Injection: Zellen, die mit =, +, -, @ (oder Tab)
    // beginnen, wuerden Excel/LibreOffice beim Oeffnen als Formel
    // interpretieren (z.B. ein Nutzername "=cmd|..."). Mit einem
    // fuehrenden Apostroph entschaerft, ohne den sichtbaren Wert zu
    // veraendern.
    if (/^[=+\-@\t]/.test(s)) {
      s = `'${s}`;
    }
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((row) => row.map(escape).join(',')).join('\n');
}

router.get('/me/export.json', requireAuth, (req, res) => {
  res.setHeader('Content-Disposition', 'attachment; filename="meine-daten.json"');
  res.json(gatherUserData(req.session.userId));
});

router.get('/me/export.csv', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="meine-daten.csv"');
  res.send(toCsv(gatherUserData(req.session.userId)));
});

// Wird nach Abschluss/Ueberspringen der Welcome-Tour aufgerufen, damit sie
// beim naechsten Login nicht automatisch erneut startet. Manuelles erneutes
// Starten ueber das Profil laeuft rein clientseitig, ohne diesen Flag zu
// beruehren.
router.post('/me/welcome-seen', requireAuth, (req, res) => {
  db.prepare('UPDATE users SET welcome_seen = 1 WHERE id = ?').run(req.session.userId);
  res.json({ ok: true });
});

module.exports = router;
