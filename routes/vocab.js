// Vokabel-CRUD - lesend fuer alle eingeloggten User, schreibend nur Admin.
// Keine automatische Befuellung: Tabelle startet bewusst leer, Ronny
// pflegt die Vokabeln selbst ueber die Admin-UI.
const express = require('express');
const db = require('../lib/db');
const { requireAuth, requireAdmin } = require('../middleware/guards');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const { category } = req.query;
  let rows;
  if (category) {
    rows = db.prepare('SELECT * FROM vocab WHERE category = ? ORDER BY navi').all(category);
  } else {
    rows = db.prepare('SELECT * FROM vocab ORDER BY navi').all();
  }
  res.json(rows);
});

router.get('/categories', requireAuth, (req, res) => {
  const rows = db
    .prepare("SELECT DISTINCT category FROM vocab WHERE category IS NOT NULL AND category != '' ORDER BY category")
    .all();
  res.json(rows.map((r) => r.category));
});

router.post('/', requireAdmin, (req, res) => {
  const { navi, de, en, transitivity, category, notes } = req.body || {};
  if (!navi || !de || !en) {
    return res.status(400).json({ error: 'missing_fields' });
  }
  const info = db
    .prepare('INSERT INTO vocab (navi, de, en, transitivity, category, notes) VALUES (?, ?, ?, ?, ?, ?)')
    .run(navi, de, en, transitivity || null, category || null, notes || null);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.put('/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT id FROM vocab WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const { navi, de, en, transitivity, category, notes } = req.body || {};
  if (!navi || !de || !en) {
    return res.status(400).json({ error: 'missing_fields' });
  }
  db.prepare(
    'UPDATE vocab SET navi = ?, de = ?, en = ?, transitivity = ?, category = ?, notes = ? WHERE id = ?'
  ).run(navi, de, en, transitivity || null, category || null, notes || null, id);
  res.json({ ok: true });
});

router.delete('/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM vocab WHERE id = ?').run(id);
  res.json({ ok: true });
});

module.exports = router;
