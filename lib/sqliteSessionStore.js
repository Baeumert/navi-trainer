// Eigener, minimaler SQLite-Session-Store auf Basis von better-sqlite3.
// Bewusst KEIN connect-sqlite3 (zieht sqlite3/node-gyp/tar mit bekannten
// CVEs in den Dependency-Baum) - gleiches Muster wie im
// Mission-Marvel-Projekt (siehe lib/sqliteSessionStore.js dort).
const session = require('express-session');
const db = require('./db');

class SqliteSessionStore extends session.Store {
  constructor() {
    super();
    this._get = db.prepare('SELECT sess, expires FROM sessions WHERE sid = ?');
    this._set = db.prepare(
      'INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?) ' +
      'ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires'
    );
    this._destroy = db.prepare('DELETE FROM sessions WHERE sid = ?');
    this._touch = db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?');
    this._reap = db.prepare('DELETE FROM sessions WHERE expires < ?');

    // periodisches Aufraeumen abgelaufener Sessions
    this._reapInterval = setInterval(() => {
      this._reap.run(Date.now());
    }, 15 * 60 * 1000);
    this._reapInterval.unref();
  }

  get(sid, cb) {
    try {
      const row = this._get.get(sid);
      if (!row) return cb(null, null);
      if (row.expires < Date.now()) {
        this._destroy.run(sid);
        return cb(null, null);
      }
      cb(null, JSON.parse(row.sess));
    } catch (err) {
      cb(err);
    }
  }

  set(sid, sess, cb) {
    try {
      const maxAge = sess.cookie && sess.cookie.maxAge ? sess.cookie.maxAge : 24 * 60 * 60 * 1000;
      const expires = Date.now() + maxAge;
      this._set.run(sid, JSON.stringify(sess), expires);
      cb && cb(null);
    } catch (err) {
      cb && cb(err);
    }
  }

  destroy(sid, cb) {
    try {
      this._destroy.run(sid);
      cb && cb(null);
    } catch (err) {
      cb && cb(err);
    }
  }

  touch(sid, sess, cb) {
    try {
      const maxAge = sess.cookie && sess.cookie.maxAge ? sess.cookie.maxAge : 24 * 60 * 60 * 1000;
      this._touch.run(Date.now() + maxAge, sid);
      cb && cb(null);
    } catch (err) {
      cb && cb(err);
    }
  }
}

module.exports = SqliteSessionStore;
