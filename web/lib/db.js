/* =========================================================================
   DonTrack Web — base de données centralisée (SQLite intégré à Node)

   Toutes les saisies de tous les collecteurs atterrissent dans ce fichier
   unique, côté serveur. Aucun poste ne garde de copie locale.
   ========================================================================= */

'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DONTRACK_DATA || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'dontrack.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_FILE);

// WAL : lectures concurrentes pendant qu'un collecteur enregistre.
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'agent')),
  pass_hash     TEXT NOT NULL,
  pass_salt     TEXT NOT NULL,
  must_change   INTEGER NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  last_login    TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,
  agent       TEXT
);

CREATE TABLE IF NOT EXISTS donations (
  id          TEXT PRIMARY KEY,
  donor       TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'autre',
  type_other  TEXT NOT NULL DEFAULT '',
  kind        TEXT NOT NULL DEFAULT 'argent',
  unit        TEXT NOT NULL DEFAULT '',
  amount      REAL NOT NULL,
  date        TEXT NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  created_by  TEXT NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL,
  updated_by  TEXT REFERENCES users(id),
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS allocations (
  id          TEXT PRIMARY KEY,
  donation_id TEXT NOT NULL REFERENCES donations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  amount      REAL NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  position    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  at        TEXT NOT NULL,
  user_id   TEXT,
  user_name TEXT NOT NULL,
  action    TEXT NOT NULL,
  entity    TEXT NOT NULL,
  entity_id TEXT,
  detail    TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_don_date    ON donations(date);
CREATE INDEX IF NOT EXISTS idx_don_creator ON donations(created_by);
CREATE INDEX IF NOT EXISTS idx_alloc_don   ON allocations(donation_id);
CREATE INDEX IF NOT EXISTS idx_audit_at    ON audit(at);
CREATE INDEX IF NOT EXISTS idx_sess_exp    ON sessions(expires_at);
`);

/* ----------------------------------------------------------- migrations */

// Les bases créées avant la prise en charge des dons en nature reçoivent
// les colonnes manquantes ; les dons existants restent des dons en argent.
(function migrate() {
  const cols = db.prepare('PRAGMA table_info(donations)').all().map((c) => c.name);
  const add = (name, ddl) => {
    if (!cols.includes(name)) db.exec(`ALTER TABLE donations ADD COLUMN ${ddl}`);
  };
  add('type_other', "type_other TEXT NOT NULL DEFAULT ''");
  add('kind', "kind TEXT NOT NULL DEFAULT 'argent'");
  add('unit', "unit TEXT NOT NULL DEFAULT ''");
})();

/* ----------------------------------------------------------- utilitaires */

const uid = (p) => p + '_' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
const nowIso = () => new Date().toISOString();

/* ----------------------------------------------------------- réglages */

function getSetting(key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, String(value));
}

function allSettings() {
  return {
    org: getSetting('org', ''),
    currency: getSetting('currency', 'FCFA')
  };
}

/* ----------------------------------------------------------- utilisateurs */

function listUsers() {
  return db.prepare(`
    SELECT u.id, u.username, u.name, u.role, u.active, u.must_change, u.created_at, u.last_login,
           (SELECT COUNT(*) FROM donations d WHERE d.created_by = u.id) AS donations,
           (SELECT COALESCE(SUM(d.amount), 0) FROM donations d WHERE d.created_by = u.id) AS collected
    FROM users u ORDER BY u.role = 'admin' DESC, u.name COLLATE NOCASE`).all();
}

const userByName = (username) =>
  db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username);

const userById = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);

function createUser({ username, name, role, hash, salt, mustChange }) {
  const id = uid('usr');
  db.prepare(`INSERT INTO users (id, username, name, role, pass_hash, pass_salt, must_change, active, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`)
    .run(id, username, name, role, hash, salt, mustChange ? 1 : 0, nowIso());
  return userById(id);
}

function updateUser(id, fields) {
  const allowed = ['name', 'role', 'active', 'pass_hash', 'pass_salt', 'must_change', 'last_login', 'username'];
  const keys = Object.keys(fields).filter((k) => allowed.includes(k));
  if (!keys.length) return userById(id);
  const sql = `UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`;
  db.prepare(sql).run(...keys.map((k) => fields[k]), id);
  return userById(id);
}

function deleteUser(id) {
  // Les dons restent : on ne perd jamais une trace de collecte.
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(id);
}

const countAdmins = () =>
  db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1").get().n;

/* ----------------------------------------------------------- sessions */

function createSession(userId, agent, ttlMs) {
  const id = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at, agent) VALUES (?, ?, ?, ?, ?)')
    .run(id, userId, nowIso(), Date.now() + ttlMs, String(agent || '').slice(0, 200));
  return id;
}

function sessionUser(sessionId) {
  if (!sessionId) return null;
  const row = db.prepare(`
    SELECT s.expires_at, u.* FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.id = ?`).get(sessionId);
  if (!row) return null;
  if (row.expires_at < Date.now() || !row.active) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    return null;
  }
  return row;
}

const dropSession = (id) => db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
const dropUserSessions = (userId) => db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
const purgeSessions = () => db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());

/* ----------------------------------------------------------- dons */

const DONATION_COLUMNS = `
  d.id, d.donor, d.type, d.type_other AS typeOther, d.kind, d.unit,
  d.amount, d.date, d.note,
  d.created_by, d.created_at, d.updated_by, d.updated_at,
  c.name AS created_by_name, e.name AS updated_by_name`;

function hydrate(rows) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const marks = ids.map(() => '?').join(',');
  const allocs = db.prepare(
    `SELECT id, donation_id, name, amount, note FROM allocations
     WHERE donation_id IN (${marks}) ORDER BY position, rowid`).all(...ids);

  const byDon = new Map(ids.map((id) => [id, []]));
  allocs.forEach((a) => byDon.get(a.donation_id).push({
    id: a.id, name: a.name, amount: a.amount, note: a.note
  }));
  return rows.map((r) => Object.assign({}, r, { allocations: byDon.get(r.id) || [] }));
}

/** @param {string|null} onlyUser  limite aux saisies d'un collecteur */
function listDonations(onlyUser) {
  const sql = `SELECT ${DONATION_COLUMNS} FROM donations d
    LEFT JOIN users c ON c.id = d.created_by
    LEFT JOIN users e ON e.id = d.updated_by
    ${onlyUser ? 'WHERE d.created_by = ?' : ''}
    ORDER BY d.date DESC, d.created_at DESC`;
  const rows = onlyUser ? db.prepare(sql).all(onlyUser) : db.prepare(sql).all();
  return hydrate(rows);
}

function getDonation(id) {
  const row = db.prepare(`SELECT ${DONATION_COLUMNS} FROM donations d
    LEFT JOIN users c ON c.id = d.created_by
    LEFT JOIN users e ON e.id = d.updated_by
    WHERE d.id = ?`).get(id);
  return row ? hydrate([row])[0] : null;
}

function saveDonation(don, userId, isUpdate) {
  const now = nowIso();
  const tx = db.prepare('BEGIN');
  tx.run();
  try {
    if (isUpdate) {
      db.prepare(`UPDATE donations SET donor = ?, type = ?, type_other = ?, kind = ?, unit = ?,
                  amount = ?, date = ?, note = ?, updated_by = ?, updated_at = ? WHERE id = ?`)
        .run(don.donor, don.type, don.typeOther, don.kind, don.unit,
             don.amount, don.date, don.note, userId, now, don.id);
      db.prepare('DELETE FROM allocations WHERE donation_id = ?').run(don.id);
    } else {
      db.prepare(`INSERT INTO donations (id, donor, type, type_other, kind, unit,
                  amount, date, note, created_by, created_at, updated_by, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(don.id, don.donor, don.type, don.typeOther, don.kind, don.unit,
             don.amount, don.date, don.note, userId, now, userId, now);
    }
    const ins = db.prepare(`INSERT INTO allocations (id, donation_id, name, amount, note, position)
                            VALUES (?, ?, ?, ?, ?, ?)`);
    don.allocations.forEach((a, i) => ins.run(a.id || uid('ben'), don.id, a.name, a.amount, a.note || '', i));
    db.prepare('COMMIT').run();
  } catch (err) {
    db.prepare('ROLLBACK').run();
    throw err;
  }
  return getDonation(don.id);
}

const deleteDonation = (id) => db.prepare('DELETE FROM donations WHERE id = ?').run(id);

/* ----------------------------------------------------------- journal */

function logAction(user, action, entity, entityId, detail) {
  db.prepare(`INSERT INTO audit (at, user_id, user_name, action, entity, entity_id, detail)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(nowIso(), user ? user.id : null, user ? user.name : 'système',
         action, entity, entityId || null, detail || '');
}

const listAudit = (limit) =>
  db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT ?').all(Math.min(Number(limit) || 200, 1000));

module.exports = {
  db, DB_FILE, DATA_DIR, uid, nowIso,
  getSetting, setSetting, allSettings,
  listUsers, userByName, userById, createUser, updateUser, deleteUser, countAdmins,
  createSession, sessionUser, dropSession, dropUserSessions, purgeSessions,
  listDonations, getDonation, saveDonation, deleteDonation,
  logAction, listAudit
};
