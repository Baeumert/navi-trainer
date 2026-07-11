// Grammatik-Baukasten: regelbasierte Uebungen (Infix-Platzierung, Ergativ/
// Akkusativ-Suffixe, Lenisierung). NON-AI-POLICY: alle Inhalte kommen von
// menschlichen Creators, die Auswertung laeuft ausschliesslich ueber die
// deterministischen Funktionen in lib/grammar/*.js - keine KI beteiligt.
//
// Vier-Augen-Prinzip: neue Uebungen starten als status='pending' und sind
// fuer Learner unsichtbar, bis ein Reviewer sie freigibt (status='active').
const express = require('express');
const db = require('../lib/db');
const { requireAuth, requireCreator, requireReviewer } = require('../middleware/guards');
const { insertInfix } = require('../lib/grammar/infix');
const { applyPrefix } = require('../lib/grammar/lenition');
const { buildTemplate, checkAnswer } = require('../lib/grammar/suffix');
const { buildCreditDisplayName } = require('../lib/creditName');

const router = express.Router();

const MODULES = ['infix', 'suffix', 'lenition'];

// Danksagung: oeffentlich (keine requireAuth) erreichbar, da die
// Danksagungs-Seite selbst bewusst ohne Login aufrufbar ist (siehe
// app.js renderDanksagung) - muss also VOR der router.use(requireAuth)
// unten registriert werden. Zeigt bewusst nur Name + Anzahl + Module,
// keine Uebungsinhalte - dieser Datensatz ueberlebt eine Nutzerloeschung
// (siehe lib/db.js grammar_credits, lib/userDeletion.js).
router.get('/credits', (req, res) => {
  const rows = db.prepare('SELECT display_name, exercise_count, modules FROM grammar_credits ORDER BY exercise_count DESC, display_name').all();
  res.json(rows.map((r) => ({ display_name: r.display_name, exercise_count: r.exercise_count, modules: JSON.parse(r.modules) })));
});

router.use(requireAuth);

function parseExercise(row) {
  return { ...row, data: JSON.parse(row.data) };
}

// Learner-sichere Projektion pro Modul - entfernt jeweils das Feld, das die
// richtige Antwort verraten wuerde.
function learnerView(exercise) {
  const { id, module, data } = exercise;
  if (module === 'infix') {
    return { id, module, stammwort: data.stammwort, bedeutung: data.bedeutung, infix: data.infix, gaps: data.gaps };
  }
  if (module === 'suffix') {
    return {
      id,
      module,
      translation: data.translation,
      template: buildTemplate(data.full_sentence, data.gaps),
      gaps: data.gaps.map((g, index) => ({ index, options: g.options || null })),
    };
  }
  if (module === 'lenition') {
    return { id, module, prefix: data.prefix, prefix_realization: data.prefix_realization, base_word: data.base_word };
  }
  return { id, module };
}

// Fortschritt: pro Modul Gesamtzahl aktiver Uebungen vs. wie viele der
// Nutzer schon (mindestens einmal) richtig geloest hat. "correct" zaehlt
// eine Uebung sobald irgendein Attempt dafuer richtig war - kein Leitner-
// Verfall wie beim Vokabeltrainer, da Grammatik-Uebungen keine Wiederholung
// mit Faelligkeit kennen.
router.get('/progress', (req, res) => {
  const userId = req.session.userId;

  const totals = db
    .prepare("SELECT module, COUNT(*) AS total FROM grammar_exercises WHERE status = 'active' GROUP BY module")
    .all();
  const solved = db
    .prepare(
      `SELECT ge.module,
              COUNT(DISTINCT ga.exercise_id) AS attempted,
              COUNT(DISTINCT CASE WHEN ga.correct = 1 THEN ga.exercise_id END) AS correct
       FROM grammar_attempts ga
       JOIN grammar_exercises ge ON ge.id = ga.exercise_id
       WHERE ga.user_id = ? AND ge.status = 'active'
       GROUP BY ge.module`
    )
    .all(userId);

  const byModule = {};
  MODULES.forEach((m) => { byModule[m] = { total: 0, attempted: 0, correct: 0 }; });
  totals.forEach((row) => { byModule[row.module].total = row.total; });
  solved.forEach((row) => { byModule[row.module].attempted = row.attempted; byModule[row.module].correct = row.correct; });

  const summary = Object.values(byModule).reduce(
    (acc, m) => ({ total: acc.total + m.total, attempted: acc.attempted + m.attempted, correct: acc.correct + m.correct }),
    { total: 0, attempted: 0, correct: 0 }
  );

  res.json({ summary, byModule });
});

router.get('/exercises', (req, res) => {
  const module = req.query.module;
  if (module && !MODULES.includes(module)) {
    return res.status(400).json({ error: 'invalid_module' });
  }
  const rows = module
    ? db.prepare("SELECT * FROM grammar_exercises WHERE status = 'active' AND module = ? ORDER BY id").all(module)
    : db.prepare("SELECT * FROM grammar_exercises WHERE status = 'active' ORDER BY id").all();
  res.json(rows.map(parseExercise).map(learnerView));
});

router.post('/exercises/:id/attempt', (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT * FROM grammar_exercises WHERE id = ? AND status = 'active'").get(id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  const exercise = parseExercise(row);
  const { data, module } = exercise;

  let correct = false;
  let expected;

  if (module === 'infix') {
    const chosenGap = req.body && req.body.gap;
    correct = chosenGap === data.correct_gap;
    expected = { gap: data.correct_gap, result: insertInfix(data.stammwort, data.gaps[data.correct_gap], data.infix) };
  } else if (module === 'suffix') {
    const answers = (req.body && req.body.answers) || [];
    const perGap = data.gaps.map((gap, index) => {
      const answer = answers.find((a) => a.index === index);
      return checkAnswer(gap, answer ? answer.value : '');
    });
    correct = perGap.every(Boolean);
    expected = { suffixes: data.gaps.map((g) => g.correct_suffix), per_gap_correct: perGap };
  } else if (module === 'lenition') {
    const answer = String((req.body && req.body.answer) || '').trim();
    correct = answer === data.expected_result;
    expected = { result: data.expected_result };
  } else {
    return res.status(400).json({ error: 'invalid_module' });
  }

  db.prepare('INSERT INTO grammar_attempts (user_id, exercise_id, correct) VALUES (?, ?, ?)')
    .run(req.session.userId, id, correct ? 1 : 0);

  res.json({ correct, expected });
});

// ---- Creator ----

router.get('/mine', requireCreator, (req, res) => {
  const rows = db.prepare('SELECT * FROM grammar_exercises WHERE creator_id = ? ORDER BY id DESC').all(req.session.userId);
  res.json(rows.map(parseExercise));
});

function validatePayload(module, data) {
  if (!MODULES.includes(module)) return 'invalid_module';
  if (module === 'infix') {
    if (!data.stammwort || !data.infix || !data.gaps || !data.correct_gap) return 'missing_fields';
    if (!['pos1', 'pos2'].includes(data.correct_gap)) return 'invalid_correct_gap';
    if (typeof data.gaps.pos1 !== 'number' || typeof data.gaps.pos2 !== 'number') return 'invalid_gaps';
  } else if (module === 'suffix') {
    if (!data.full_sentence || !Array.isArray(data.gaps) || data.gaps.length === 0) return 'missing_fields';
    for (const gap of data.gaps) {
      if (!gap.stem || !gap.correct_suffix) return 'invalid_gap';
    }
  } else if (module === 'lenition') {
    if (!data.base_word || !data.expected_result) return 'missing_fields';
  }
  return null;
}

router.post('/exercises', requireCreator, (req, res) => {
  const { module, data } = req.body || {};
  const error = validatePayload(module, data || {});
  if (error) return res.status(400).json({ error });

  const info = db
    .prepare("INSERT INTO grammar_exercises (module, creator_id, status, data) VALUES (?, ?, 'pending', ?)")
    .run(module, req.session.userId, JSON.stringify(data));
  res.status(201).json({ id: info.lastInsertRowid });
});

router.patch('/exercises/:id', requireCreator, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM grammar_exercises WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  if (row.creator_id !== req.session.userId && !req.session.isAdmin) {
    return res.status(403).json({ error: 'not_owner' });
  }
  if (!['pending', 'rejected'].includes(row.status)) {
    return res.status(400).json({ error: 'not_editable' });
  }

  const { data } = req.body || {};
  const error = validatePayload(row.module, data || {});
  if (error) return res.status(400).json({ error });

  // Erneutes Einreichen nach Ablehnung setzt den Status zurueck auf
  // 'pending' - das Vier-Augen-Prinzip gilt auch fuer ueberarbeitete Uebungen.
  db.prepare(
    "UPDATE grammar_exercises SET data = ?, status = 'pending', reviewer_id = NULL, reviewed_at = NULL, review_note = NULL, updated_at = datetime('now') WHERE id = ?"
  ).run(JSON.stringify(data), id);
  res.json({ ok: true });
});

router.delete('/exercises/:id', requireCreator, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT creator_id FROM grammar_exercises WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  if (row.creator_id !== req.session.userId && !req.session.isAdmin) {
    return res.status(403).json({ error: 'not_owner' });
  }
  db.prepare('DELETE FROM grammar_exercises WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ---- Reviewer ----

router.get('/review-queue', requireReviewer, (req, res) => {
  // LEFT JOIN statt INNER JOIN: creator_id kann NULL sein (Creator hat
  // seinen Account inzwischen geloescht, waehrend die Uebung noch
  // 'pending' war) - eine INNER JOIN wuerde solche Uebungen einfach aus
  // der Queue verschwinden lassen, ohne dass sie je review-bar waeren.
  const rows = db
    .prepare(
      `SELECT ge.*, COALESCE(u.name, NULL) AS creator_name
       FROM grammar_exercises ge
       LEFT JOIN users u ON u.id = ge.creator_id
       WHERE ge.status = 'pending'
       ORDER BY ge.id`
    )
    .all();
  res.json(rows.map(parseExercise));
});

// Legt bei Freigabe einen (pro Person einmaligen) Danksagungs-Eintrag an
// bzw. aktualisiert ihn - siehe lib/db.js grammar_credits. Absichtlich nur
// beim Freigeben aufgerufen, nicht beim Ablehnen; jede Uebung kann in der
// aktuellen API hoechstens einmal freigegeben werden (danach nicht mehr
// editierbar), daher kein Risiko einer Doppelzaehlung.
function creditCreatorForApproval(creatorId, module) {
  if (!creatorId) return;
  const user = db.prepare('SELECT name, navi_name, credit_name_pref FROM users WHERE id = ?').get(creatorId);
  if (!user) return;
  const displayName = buildCreditDisplayName(user.name, user.navi_name, user.credit_name_pref);
  const existing = db.prepare('SELECT * FROM grammar_credits WHERE user_id = ?').get(creatorId);
  if (existing) {
    const modules = Array.from(new Set([...JSON.parse(existing.modules), module]));
    db.prepare(
      "UPDATE grammar_credits SET display_name = ?, exercise_count = exercise_count + 1, modules = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(displayName, JSON.stringify(modules), existing.id);
  } else {
    db.prepare('INSERT INTO grammar_credits (user_id, display_name, exercise_count, modules) VALUES (?, ?, 1, ?)')
      .run(creatorId, displayName, JSON.stringify([module]));
  }
}

router.post('/exercises/:id/review', requireReviewer, (req, res) => {
  const id = Number(req.params.id);
  const { decision, note } = req.body || {};
  if (!['approve', 'reject'].includes(decision)) {
    return res.status(400).json({ error: 'invalid_decision' });
  }
  const row = db.prepare('SELECT id, module, creator_id FROM grammar_exercises WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'not_found' });

  const status = decision === 'approve' ? 'active' : 'rejected';
  db.prepare(
    "UPDATE grammar_exercises SET status = ?, reviewer_id = ?, reviewed_at = datetime('now'), review_note = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(status, req.session.userId, note || null, id);

  if (decision === 'approve') {
    creditCreatorForApproval(row.creator_id, row.module);
  }

  res.json({ ok: true });
});

module.exports = router;
