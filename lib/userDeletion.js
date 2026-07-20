// Gemeinsame Loeschlogik fuer Selbstloeschung (routes/auth.js DELETE /me)
// und Admin-Loeschung (routes/admin.js DELETE /users/:id) - Recht auf
// Loeschung (Art. 17 DSGVO).
//
// Was passiert:
// - Vokabel-Lernstand (progress, activation) und Grammatik-Antwortverlauf
//   (grammar_attempts) werden vollstaendig geloescht (ON DELETE CASCADE auf
//   users(id), siehe lib/db.js) - das ist eindeutig persoenliche Lerndaten.
// - Vom Nutzer erstellte/gereviewte Grammatik-Uebungen (Community-Inhalt,
//   nicht "seine" Daten im engeren Sinne) bleiben erhalten - nur die
//   Personen-Verknuepfung (creator_id/reviewer_id) wird auf NULL gesetzt.
// - Ein vorher bei Freigabe angelegter Danksagungs-Credit-Eintrag (siehe
//   routes/grammar.js) bleibt bewusst unberuehrt und ueberlebt die
//   Loeschung (siehe Datenschutzerklaerung fuer die Begruendung).
'use strict';

// progress_legacy/activation_legacy entstehen durch die Fwew-Migration
// (lib/db.js, ALTER TABLE ... RENAME TO) und enthalten weiterhin
// nutzerbezogene Lerndaten. Explizites Loeschen statt sich auf ON DELETE
// CASCADE zu verlassen - ob deren REFERENCES-Klausel nach dem Rename noch
// zuverlaessig kaskadiert, ist nicht in jedem Deployment-Alter garantiert,
// ein expliziter DELETE ist immer korrekt (im besten Fall redundant).
function tableExists(db, name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(name);
}

// Alle Sessions des Nutzers loeschen, nicht nur die des ausloesenden
// Requests: sonst bleiben Sessions anderer Geraete (mit userId und Name im
// sess-JSON) bis zu 30 Tage in der sessions-Tabelle bestehen und wuerden
// sogar weiter als eingeloggt akzeptiert, obwohl das Konto geloescht ist
// (Art. 17 DSGVO + Sicherheitsproblem). Die sess-Spalte ist JSON-Text ohne
// eigene userId-Spalte, daher parsen statt fragilem LIKE-Matching.
function deleteUserSessions(db, userId) {
  const destroy = db.prepare('DELETE FROM sessions WHERE sid = ?');
  for (const row of db.prepare('SELECT sid, sess FROM sessions').all()) {
    try {
      if (JSON.parse(row.sess).userId === userId) destroy.run(row.sid);
    } catch (e) {
      // nicht parsebare Session: ignorieren, der Reaper raeumt sie ab
    }
  }
}

function anonymizeAndDeleteUser(db, userId) {
  const run = db.transaction(() => {
    db.prepare('UPDATE grammar_exercises SET creator_id = NULL WHERE creator_id = ?').run(userId);
    db.prepare('UPDATE grammar_exercises SET reviewer_id = NULL WHERE reviewer_id = ?').run(userId);
    deleteUserSessions(db, userId);
    if (tableExists(db, 'progress_legacy')) {
      db.prepare('DELETE FROM progress_legacy WHERE user_id = ?').run(userId);
    }
    if (tableExists(db, 'activation_legacy')) {
      db.prepare('DELETE FROM activation_legacy WHERE user_id = ?').run(userId);
    }
    // progress/activation/grammar_attempts loeschen sich automatisch via
    // ON DELETE CASCADE beim folgenden DELETE FROM users.
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  });
  run();
}

module.exports = { anonymizeAndDeleteUser };
