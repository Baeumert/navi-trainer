// Datenbank-Setup: SQLite (better-sqlite3), WAL-Modus.
// Gleiche Begruendung wie im Mission-Marvel-Projekt: kein separater
// DB-Server noetig, WAL traegt deutlich mehr als die hier zu erwartende
// Nutzerzahl.
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'navi-vokabeltrainer.db');

const fs = require('fs');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS vocab (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  navi TEXT NOT NULL,
  de TEXT NOT NULL,
  en TEXT NOT NULL,
  transitivity TEXT,
  category TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_vocab_category ON vocab(category);

CREATE TABLE IF NOT EXISTS progress (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vocab_id INTEGER NOT NULL REFERENCES vocab(id) ON DELETE CASCADE,
  correct_count INTEGER NOT NULL DEFAULT 0,
  wrong_count INTEGER NOT NULL DEFAULT 0,
  last_seen TEXT,
  PRIMARY KEY (user_id, vocab_id)
);
`);

// Migration auf Leitner-Kartei: progress braucht direction/level/due_at und
// einen zusammengesetzten PK (user_id, vocab_id, direction), weil beide
// Richtungen (Na'vi->Zielsprache und Zielsprache->Na'vi) unabhaengig
// verfolgt werden. SQLite kann weder PK noch Spalten mit NOT-NULL-ohne-
// Default per ALTER TABLE nachruesten, daher wie bei der topic-Spalte per
// PRAGMA table_info pruefen und bei Bedarf per create-copy-drop-rename
// migrieren. Idempotent: wenn "level" schon existiert, war die Migration
// bereits gelaufen und wird uebersprungen.
const progressColumns = db.prepare('PRAGMA table_info(progress)').all();
const hasLevelColumn = progressColumns.some((col) => col.name === 'level');
if (!hasLevelColumn) {
  db.exec(`
    DROP TABLE IF EXISTS progress_new;
    CREATE TABLE progress_new (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      vocab_id INTEGER NOT NULL REFERENCES vocab(id) ON DELETE CASCADE,
      direction TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 0,
      due_at TEXT NOT NULL,
      correct_count INTEGER NOT NULL DEFAULT 0,
      wrong_count INTEGER NOT NULL DEFAULT 0,
      last_seen TEXT,
      PRIMARY KEY (user_id, vocab_id, direction)
    );

    INSERT INTO progress_new (user_id, vocab_id, direction, level, due_at, correct_count, wrong_count, last_seen)
    SELECT user_id, vocab_id, 'navi_to_target', 0, datetime('now'), correct_count, wrong_count, last_seen
    FROM progress;

    DROP TABLE progress;
    ALTER TABLE progress_new RENAME TO progress;
  `);
}

db.exec('CREATE INDEX IF NOT EXISTS idx_progress_due ON progress(user_id, direction, due_at)');

db.exec(`

CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  sess TEXT NOT NULL,
  expires INTEGER NOT NULL
);
`);

// Nachtraeglich hinzugefuegte Spalte fuer thematische Kategorisierung
// (dict-navi.topics.csv). SQLite kennt kein "ADD COLUMN IF NOT EXISTS",
// daher vorher per PRAGMA table_info pruefen, ob sie schon existiert -
// sonst crasht ein erneuter Start (gleiche Lehre wie beim
// ALTER-TABLE-UNIQUE-Vorfall im Mission-Marvel-Projekt).
const vocabColumns = db.prepare("PRAGMA table_info(vocab)").all();
const hasTopicColumn = vocabColumns.some((col) => col.name === 'topic');
if (!hasTopicColumn) {
  db.exec('ALTER TABLE vocab ADD COLUMN topic TEXT');
}

// Nachtraeglich hinzugefuegte Spalte fuer die Anfaenger-Kernliste (Reyknap-
// Vokabelliste): Datum (TT.MM.JJJJ), ab wann ein Wort im Anfaengerkurs
// eingefuehrt werden soll. Wird beim Ausspielen neuer (noch nie geuebter)
// Karten als Sortierkriterium genutzt, damit diese Woerter zuerst
// drankommen. NULL fuer alle anderen (nicht kuratierten) Woerter aus dem
// Woerterbuch-Import.
const vocabColumns2 = db.prepare("PRAGMA table_info(vocab)").all();
const hasPriorityDateColumn = vocabColumns2.some((col) => col.name === 'priority_date');
if (!hasPriorityDateColumn) {
  db.exec('ALTER TABLE vocab ADD COLUMN priority_date TEXT');
}

// Aktivierung: eine Vokabel muss pro Nutzer erst durch Abschreiben (siehe
// routes/activation.js) "freigeschaltet" werden, bevor sie im Karteikarten-
// Trainer (routes/trainer.js) auftaucht. Einmal pro Nutzer/Wort, nicht pro
// Richtung - das Abschreiben ist eine einmalige Kennenlern-Uebung.
db.exec(`
CREATE TABLE IF NOT EXISTS activation (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vocab_id INTEGER NOT NULL REFERENCES vocab(id) ON DELETE CASCADE,
  activated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, vocab_id)
);
`);

// Umstellung auf die Live-Fwew-API (siehe lib/fwew.js): Vokabeldaten werden
// nicht mehr lokal gespeichert, nur noch die Fwew-ID. progress/activation
// muessen deshalb von INTEGER-vocab_id (Fremdschluessel auf die lokale
// vocab-Tabelle) auf TEXT-vocab_id (Fwew-ID) umgestellt werden. Die alten
// Tabellen werden dabei NICHT geloescht, sondern per RENAME als *_legacy
// aufbewahrt (Backup/Audit-Trail fuer die Migrationsscripts unter db/) -
// gleiches Vorsichtsprinzip wie die Leitner-Migration oben. Idempotent per
// PRAGMA table_info-Check auf die neue Spaltenform.
function isTextVocabId(table) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  const col = cols.find((c) => c.name === 'vocab_id');
  return !!(col && col.type.toUpperCase() === 'TEXT');
}

if (!isTextVocabId('progress')) {
  db.exec(`
    ALTER TABLE progress RENAME TO progress_legacy;

    DROP INDEX IF EXISTS idx_progress_due;

    CREATE TABLE progress (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      vocab_id TEXT NOT NULL,
      direction TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 0,
      due_at TEXT NOT NULL,
      correct_count INTEGER NOT NULL DEFAULT 0,
      wrong_count INTEGER NOT NULL DEFAULT 0,
      last_seen TEXT,
      PRIMARY KEY (user_id, vocab_id, direction)
    );
  `);
}
db.exec('CREATE INDEX IF NOT EXISTS idx_progress_due ON progress(user_id, direction, due_at)');

if (!isTextVocabId('activation')) {
  db.exec(`
    ALTER TABLE activation RENAME TO activation_legacy;

    CREATE TABLE activation (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      vocab_id TEXT NOT NULL,
      activated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, vocab_id)
    );
  `);
}

// Prioritaets-Quelle im Live-Modus - ersetzt vocab.priority_date. Enthaelt
// bewusst nur ID + Datum, keinen Wortinhalt (siehe db/import-priority-vocab-fwew.js).
db.exec(`
CREATE TABLE IF NOT EXISTS vocab_priority (
  fwew_id TEXT PRIMARY KEY,
  priority_date TEXT NOT NULL
);
`);

// Merkt sich, ob ein Nutzer die interaktive Welcome-Tour schon gesehen hat -
// laeuft beim ersten Login automatisch, danach nur noch auf Wunsch ueber
// das Profil erneut startbar (rein clientseitig, kein Backend-Reset noetig).
const usersColumns = db.prepare('PRAGMA table_info(users)').all();
const hasWelcomeSeenColumn = usersColumns.some((col) => col.name === 'welcome_seen');
if (!hasWelcomeSeenColumn) {
  db.exec('ALTER TABLE users ADD COLUMN welcome_seen INTEGER NOT NULL DEFAULT 0');
}

// Rollen fuer den Grammatik-Baukasten (siehe routes/grammar.js): Creator
// legen Uebungen an, Reviewer geben sie im Vier-Augen-Prinzip frei. Admin
// hat implizit beide Rechte (siehe middleware/guards.js), braucht dafuer
// keine eigenen Flags - is_creator/is_reviewer sind rein additive Rollen,
// kein Sicherheits-Sonderfall wie is_admin (kein "letzter Admin"-Schutz noetig).
const usersColumns2 = db.prepare('PRAGMA table_info(users)').all();
if (!usersColumns2.some((col) => col.name === 'is_creator')) {
  db.exec('ALTER TABLE users ADD COLUMN is_creator INTEGER NOT NULL DEFAULT 0');
}
if (!usersColumns2.some((col) => col.name === 'is_reviewer')) {
  db.exec('ALTER TABLE users ADD COLUMN is_reviewer INTEGER NOT NULL DEFAULT 0');
}

// Na'vi-Name (optional, zusaetzlich zum Realnamen) + Praeferenz, wie der
// Nutzer in den Grammatik-Danksagungen (routes/grammar.js grammar_credits)
// genannt werden moechte: 'both' | 'navi' | 'real'. Default 'real' erhaelt
// das bisherige Verhalten fuer alle Bestandsnutzer unveraendert.
// navi_name bleibt NULL statt '', damit die partielle Unique-Index-Pruefung
// unten mehrere Nutzer ohne Na'vi-Name zulaesst (SQLite-Unique-Indizes
// ignorieren NULL-Werte).
const usersColumns3 = db.prepare('PRAGMA table_info(users)').all();
if (!usersColumns3.some((col) => col.name === 'navi_name')) {
  db.exec('ALTER TABLE users ADD COLUMN navi_name TEXT');
}
if (!usersColumns3.some((col) => col.name === 'credit_name_pref')) {
  db.exec("ALTER TABLE users ADD COLUMN credit_name_pref TEXT NOT NULL DEFAULT 'real'");
}
// Dubletten-Schutz auf DB-Ebene (case-insensitive) als Sicherheitsnetz
// hinter der expliziten Pruefung in routes/auth.js - verhindert eine
// Race-Condition bei zwei gleichzeitigen Requests mit demselben Namen.
db.exec(
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_navi_name ON users(navi_name COLLATE NOCASE) WHERE navi_name IS NOT NULL'
);

// Grammatik-Baukasten: Uebungen werden als JSON in `data` gespeichert (siehe
// routes/grammar.js fuer die drei Modul-Formen infix/suffix/lenition) -
// bewusst kein festes Spaltenschema pro Modul, um nicht drei fast-identische
// Tabellen pflegen zu muessen. status startet immer bei 'pending' (Vier-
// Augen-Prinzip: erst nach Reviewer-Freigabe fuer Learner sichtbar).
db.exec(`
CREATE TABLE IF NOT EXISTS grammar_exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module TEXT NOT NULL,
  creator_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending',
  data TEXT NOT NULL,
  reviewer_id INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  review_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_grammar_exercises_status ON grammar_exercises(status, module);

CREATE TABLE IF NOT EXISTS grammar_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exercise_id INTEGER NOT NULL REFERENCES grammar_exercises(id) ON DELETE CASCADE,
  correct INTEGER NOT NULL,
  answered_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Datenschutz/Loeschrecht: grammar_exercises.creator_id/reviewer_id muessen
// nullbar sein, damit eine Nutzerloeschung (siehe lib/userDeletion.js) nur
// die Personen-Verknuepfung kappt, aber die erstellten/gereviewten
// Uebungen selbst (Community-Inhalt, keine "Userdaten" im engeren Sinne)
// erhalten bleiben. SQLite kann NOT NULL nicht per ALTER TABLE entfernen,
// daher das etablierte create-copy-drop-rename-Muster.
//
// Falle (per Test entdeckt): "ALTER TABLE ... RENAME TO" schreibt bei
// modernen SQLite-Versionen automatisch die Fremdschluessel-Klauseln
// ANDERER Tabellen um, die auf die umbenannte Tabelle zeigen -
// grammar_attempts.exercise_id zeigte danach auf "grammar_exercises_old"
// statt wieder auf "grammar_exercises", obwohl der Tabellenname am Ende
// wieder derselbe ist. PRAGMA foreign_keys=OFF verhindert das NICHT (das
// steuert nur die Durchsetzung, nicht das Nachschreiben der DDL-Texte).
// Betroffene Tabelle (grammar_attempts) muss deshalb im selben Zug mit
// erneuert werden, damit ihre eigene REFERENCES-Klausel wieder auf den
// richtigen (finalen) Tabellennamen zeigt.
const grammarExercisesColumns = db.prepare('PRAGMA table_info(grammar_exercises)').all();
const creatorIdCol = grammarExercisesColumns.find((c) => c.name === 'creator_id');
if (creatorIdCol && creatorIdCol.notnull === 1) {
  db.pragma('foreign_keys = OFF');
  db.exec(`
    ALTER TABLE grammar_exercises RENAME TO grammar_exercises_old;
    DROP INDEX IF EXISTS idx_grammar_exercises_status;

    CREATE TABLE grammar_exercises (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      module TEXT NOT NULL,
      creator_id INTEGER REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'pending',
      data TEXT NOT NULL,
      reviewer_id INTEGER REFERENCES users(id),
      reviewed_at TEXT,
      review_note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT INTO grammar_exercises SELECT * FROM grammar_exercises_old;

    DROP TABLE grammar_exercises_old;

    CREATE INDEX IF NOT EXISTS idx_grammar_exercises_status ON grammar_exercises(status, module);

    -- grammar_attempts neu anlegen, damit seine REFERENCES-Klausel wieder
    -- auf "grammar_exercises" zeigt statt auf den Zwischennamen von oben.
    ALTER TABLE grammar_attempts RENAME TO grammar_attempts_old;

    CREATE TABLE grammar_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      exercise_id INTEGER NOT NULL REFERENCES grammar_exercises(id) ON DELETE CASCADE,
      correct INTEGER NOT NULL,
      answered_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT INTO grammar_attempts SELECT * FROM grammar_attempts_old;

    DROP TABLE grammar_attempts_old;
  `);
  db.pragma('foreign_keys = ON');

  // Nachtraeglicher Konsistenz-Check: bricht laut sichtbar (statt still zu
  // scheitern), falls die Migration doch irgendwo eine Fremdschluessel-
  // Inkonsistenz hinterlassen hat.
  const fkIssues = db.pragma('foreign_key_check');
  if (fkIssues.length > 0) {
    throw new Error(`grammar_exercises-Migration hat Fremdschluessel-Inkonsistenzen hinterlassen: ${JSON.stringify(fkIssues)}`);
  }
}

// Danksagungs-Credits: wird bei Freigabe einer Uebung befuellt/aktualisiert
// (siehe routes/grammar.js, POST /exercises/:id/review). Bewusst OHNE
// Fremdschluessel auf users(id) - dieser Datensatz soll eine Nutzerloeschung
// explizit UEBERLEBEN (Dankeschoen an die Community bleibt sichtbar, siehe
// Datenschutzerklaerung). user_id dient waehrend eines aktiven Accounts nur
// der Deduplizierung (ein Eintrag pro Person, nicht pro Uebung).
db.exec(`
CREATE TABLE IF NOT EXISTS grammar_credits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  display_name TEXT NOT NULL,
  exercise_count INTEGER NOT NULL DEFAULT 0,
  modules TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

module.exports = db;
