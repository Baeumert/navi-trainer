function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'auth_required' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'auth_required' });
  }
  if (!req.session.isAdmin) {
    return res.status(403).json({ error: 'admin_required' });
  }
  next();
}

// Grammatik-Baukasten-Rollen (siehe routes/grammar.js): Admin hat implizit
// beide Rechte, ohne eigene Flags - is_creator/is_reviewer sind additive
// Rollen, kein Ersatz fuer requireAdmin.
function requireCreator(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'auth_required' });
  }
  if (!req.session.isAdmin && !req.session.isCreator) {
    return res.status(403).json({ error: 'creator_required' });
  }
  next();
}

function requireReviewer(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'auth_required' });
  }
  if (!req.session.isAdmin && !req.session.isReviewer) {
    return res.status(403).json({ error: 'reviewer_required' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin, requireCreator, requireReviewer };
