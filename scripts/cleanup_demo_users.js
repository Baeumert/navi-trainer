// Rollierende Bereinigung fuer die drei oeffentlichen Preview-/Demo-Konten
// (siehe README "Demo-Zugaenge"). Zwei unabhaengige Massnahmen bei jedem
// Lauf:
// 1. Passwort/Name/Rollen/Na'vi-Name/Welcome-Tour-Status jedes Demo-Kontos
//    werden IMMER (nicht erst nach 120 Min) auf den bekannten, oeffentlich
//    dokumentierten Ausgangszustand zurueckgesetzt - sonst koennte ein
//    Besucher, der das Passwort aendert, den naechsten Besucher
//    aussperren, und die Welcome-Tour wuerde nach dem ersten Demo-Besuch
//    fuer alle folgenden Besucher dauerhaft ausbleiben.
// 2. Lern-/Uebungsdaten dieser Accounts werden 120 Minuten nach ihrer
//    letzten Aenderung geloescht, damit die Demo-Umgebung sich selbst
//    zuruecksetzt und keine dauerhaften Spuren im Produktivsystem
//    hinterlaesst. Laeuft per Cron alle 10 Minuten (siehe docs/deploy.md
//    "Demo-Zugaenge").
//
// Bewusst NICHT geloescht: die drei Accounts selbst (bleiben dauerhaft
// nutzbar) und Grammatik-Uebungen ECHTER Nutzer, auch wenn ein Demo-
// Reviewer sie freigegeben/abgelehnt hat - nur von einem Demo-Konto
// SELBST erstellte Uebungen gelten als Demo-Inhalt und werden geloescht.
'use strict';

const path = require('path');
const db = require(path.join(__dirname, '..', 'lib', 'db'));
const { hashPassword } = require(path.join(__dirname, '..', 'lib', 'auth'));

const DEMO_ACCOUNTS = [
  { email: 'demo-lerner@navi.diy-ehome.de', name: 'Lena Lernbeispiel', password: 'lerner123', is_creator: 0, is_reviewer: 0 },
  { email: 'demo-lehrer@navi.diy-ehome.de', name: 'Theo Lehrbeispiel', password: 'lehrer123', is_creator: 1, is_reviewer: 0 },
  { email: 'demo-reviewer@navi.diy-ehome.de', name: 'Rita Prüfbeispiel', password: 'reviewer123', is_creator: 0, is_reviewer: 1 },
];
const MAX_AGE_MINUTES = 120;

// Zugangsdaten/Anzeigename/Rollen/Welcome-Tour-Status jedes Demo-Kontos bei
// JEDEM Lauf hart auf den bekannten, oeffentlich dokumentierten
// Ausgangszustand zurueckstellen (nicht erst nach 120 Min) - sonst koennte
// ein Besucher, der Passwort oder Namen aendert, den naechsten Besucher
// aussperren bzw. das Konto verfaelschen, ggf. schon Minuten spaeter statt
// erst nach zwei Stunden. welcome_seen=0 sorgt dafuer, dass die
// interaktive Welcome-Tour beim naechsten Login wieder automatisch
// startet, statt fuer immer "gesehen" zu bleiben, weil ein frueherer
// Demo-Besucher sie schon einmal beendet/uebersprungen hat - es gibt
// keinen Zeitstempel fuer "zuletzt gesehen", daher hier an denselben
// Sofort-Reset gekoppelt statt an die 120-Minuten-Datenloeschung unten.
for (const acc of DEMO_ACCOUNTS) {
  db.prepare(
    'UPDATE users SET name = ?, password_hash = ?, is_admin = 0, is_creator = ?, is_reviewer = ?, navi_name = NULL, credit_name_pref = ?, welcome_seen = 0 WHERE email = ?'
  ).run(acc.name, hashPassword(acc.password), acc.is_creator, acc.is_reviewer, 'real', acc.email);
}

const DEMO_EMAILS = DEMO_ACCOUNTS.map((a) => a.email);
const demoIds = db
  .prepare(`SELECT id FROM users WHERE email IN (${DEMO_EMAILS.map(() => '?').join(',')})`)
  .all(...DEMO_EMAILS)
  .map((r) => r.id);

if (demoIds.length === 0) {
  console.log('Keine Demo-Konten gefunden - nichts zu tun.');
  process.exit(0);
}

const placeholders = demoIds.map(() => '?').join(',');
const cutoff = `-${MAX_AGE_MINUTES} minutes`;

const run = db.transaction(() => {
  const progress = db
    .prepare(`DELETE FROM progress WHERE user_id IN (${placeholders}) AND last_seen < datetime('now', ?)`)
    .run(...demoIds, cutoff);
  const activation = db
    .prepare(`DELETE FROM activation WHERE user_id IN (${placeholders}) AND activated_at < datetime('now', ?)`)
    .run(...demoIds, cutoff);
  const attempts = db
    .prepare(`DELETE FROM grammar_attempts WHERE user_id IN (${placeholders}) AND answered_at < datetime('now', ?)`)
    .run(...demoIds, cutoff);
  // ON DELETE CASCADE auf grammar_attempts.exercise_id raeumt Attempts
  // (auch von echten Nutzern, die eine Demo-Uebung ausprobiert haben)
  // automatisch mit ab.
  const exercises = db
    .prepare(`DELETE FROM grammar_exercises WHERE creator_id IN (${placeholders}) AND created_at < datetime('now', ?)`)
    .run(...demoIds, cutoff);
  // Danksagungen-Eintraege fuer Demo-Konten IMMER sofort entfernen (nicht
  // erst nach 120 Min) - die Seite ist oeffentlich, ein Demo-Konto soll
  // dort nie auch nur kurz als "Community-Mitwirkende(r)" erscheinen.
  const credits = db
    .prepare(`DELETE FROM grammar_credits WHERE user_id IN (${placeholders})`)
    .run(...demoIds);

  return { progress: progress.changes, activation: activation.changes, attempts: attempts.changes, exercises: exercises.changes, credits: credits.changes };
});

const result = run();
console.log(new Date().toISOString(), JSON.stringify(result));
