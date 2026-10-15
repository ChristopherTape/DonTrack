/* =========================================================================
   DonTrack Web — base de données centralisée

   Une seule couche, deux usages :
     • en local  : un fichier SQLite ordinaire (file:…), rien à installer ;
     • en ligne  : une base Turso (libsql://…), car les hébergeurs gratuits
                   effacent leur disque à chaque redémarrage.

   Le choix se fait par DONTRACK_DB_URL ; le code au-dessus ne voit aucune
   différence. Toutes les fonctions sont asynchrones : un accès distant
   passe par le réseau.
   ========================================================================= */

'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@libsql/client');

const DATA_DIR = process.env.DONTRACK_DATA || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'dontrack.db');

const DB_URL = process.env.DONTRACK_DB_URL || ('file:' + DB_FILE.replace(/\\/g, '/'));
const DB_TOKEN = process.env.DONTRACK_DB_TOKEN || undefined;
const IS_REMOTE = !DB_URL.startsWith('file:');

if (!IS_REMOTE) fs.mkdirSync(DATA_DIR, { recursive: true });

const client = createClient({ url: DB_URL, authToken: DB_TOKEN });

/** Où vivent les données, pour l'affichage au démarrage. */
const describeStorage = () => (IS_REMOTE ? DB_URL.replace(/\?.*$/, '') : DB_FILE);

/* ----------------------------------------------------------- accès bas niveau */

const run = (sql, args) => client.execute(args ? { sql, args } : sql);
const all = async (sql, args) => (await run(sql, args)).rows;
const one = async (sql, args) => (await all(sql, args))[0] || null;

const SCHEMA = `
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
`;

/** Création du schéma et rattrapage des bases antérieures. */
async function init() {
  if (!IS_REMOTE) {
    // Réglages utiles au fichier local ; sans objet sur une base distante.
    for (const p of ['PRAGMA journal_mode = WAL', 'PRAGMA busy_timeout = 5000']) {
      try { await run(p); } catch (_) { /* ignoré */ }
    }
  }
  try { await run('PRAGMA foreign_keys = ON'); } catch (_) { /* ignoré */ }

  await client.executeMultiple(SCHEMA);

  // Colonnes ajoutées après coup (dons en nature, précision du type).
  const cols = (await all('PRAGMA table_info(donations)')).map((c) => c.name);
  const add = async (name, ddl) => {
    if (!cols.includes(name)) await run(`ALTER TABLE donations ADD COLUMN ${ddl}`);
  };
  await add('type_other', "type_other TEXT NOT NULL DEFAULT ''");
  await add('kind', "kind TEXT NOT NULL DEFAULT 'argent'");
  await add('unit', "unit TEXT NOT NULL DEFAULT ''");

  return { remote: IS_REMOTE, storage: describeStorage() };
}

/* ----------------------------------------------------------- utilitaires */

const uid = (p) => p + '_' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
const nowIso = () => new Date().toISOString();

/* ----------------------------------------------------------- réglages */

async function getSetting(key, fallback) {
  const row = await one('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? row.value : fallback;
}

const setSetting = (key, value) =>
  run(`INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [key, String(value)]);

async function allSettings() {
  return {
    org: await getSetting('org', ''),
    currency: await getSetting('currency', 'FCFA')
  };
}

/* ----------------------------------------------------------- utilisateurs */

const listUsers = () => all(`
  SELECT u.id, u.username, u.name, u.role, u.active, u.must_change, u.created_at, u.last_login,
         (SELECT COUNT(*) FROM donations d WHERE d.created_by = u.id) AS donations,
         (SELECT COALESCE(SUM(d.amount), 0) FROM donations d
            WHERE d.created_by = u.id AND d.kind = 'argent') AS collected
  FROM users u ORDER BY u.role = 'admin' DESC, u.name COLLATE NOCASE`);

const userByName = (username) =>
  one('SELECT * FROM users WHERE username = ? COLLATE NOCASE', [username]);

const userById = (id) => one('SELECT * FROM users WHERE id = ?', [id]);

async function createUser({ username, name, role, hash, salt, mustChange }) {
  const id = uid('usr');
  await run(`INSERT INTO users (id, username, name, role, pass_hash, pass_salt, must_change, active, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    [id, username, name, role, hash, salt, mustChange ? 1 : 0, nowIso()]);
  return userById(id);
}

async function updateUser(id, fields) {
  const allowed = ['name', 'role', 'active', 'pass_hash', 'pass_salt', 'must_change', 'last_login', 'username'];
  const keys = Object.keys(fields).filter((k) => allowed.includes(k));
  if (!keys.length) return userById(id);
  await run(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`,
    keys.map((k) => fields[k]).concat(id));
  return userById(id);
}

/** Désactivation plutôt que suppression : les dons saisis restent traçables. */
async function deleteUser(id) {
  await run('DELETE FROM sessions WHERE user_id = ?', [id]);
  await run('UPDATE users SET active = 0 WHERE id = ?', [id]);
}

const countAdmins = async () =>
  Number((await one("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1")).n);

/* ----------------------------------------------------------- sessions */

async function createSession(userId, agent, ttlMs) {
  const id = crypto.randomBytes(32).toString('base64url');
  await run('INSERT INTO sessions (id, user_id, created_at, expires_at, agent) VALUES (?, ?, ?, ?, ?)',
    [id, userId, nowIso(), Date.now() + ttlMs, String(agent || '').slice(0, 200)]);
  return id;
}

async function sessionUser(sessionId) {
  if (!sessionId) return null;
  const row = await one(`
    SELECT s.expires_at, u.* FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.id = ?`, [sessionId]);
  if (!row) return null;
  if (Number(row.expires_at) < Date.now() || !row.active) {
    await run('DELETE FROM sessions WHERE id = ?', [sessionId]);
    return null;
  }
  return row;
}

const dropSession = (id) => run('DELETE FROM sessions WHERE id = ?', [id]);
const dropUserSessions = (userId) => run('DELETE FROM sessions WHERE user_id = ?', [userId]);
const purgeSessions = () => run('DELETE FROM sessions WHERE expires_at < ?', [Date.now()]);

/* ----------------------------------------------------------- dons */

const DONATION_COLUMNS = `
  d.id, d.donor, d.type, d.type_other AS typeOther, d.kind, d.unit,
  d.amount, d.date, d.note,
  d.created_by, d.created_at, d.updated_by, d.updated_at,
  c.name AS created_by_name, e.name AS updated_by_name`;

async function hydrate(rows) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const marks = ids.map(() => '?').join(',');
  const allocs = await all(
    `SELECT id, donation_id, name, amount, note FROM allocations
     WHERE donation_id IN (${marks}) ORDER BY position, rowid`, ids);

  const byDon = new Map(ids.map((id) => [id, []]));
  allocs.forEach((a) => byDon.get(a.donation_id).push({
    id: a.id, name: a.name, amount: a.amount, note: a.note
  }));
  return rows.map((r) => Object.assign({}, r, { allocations: byDon.get(r.id) || [] }));
}

/** @param {string|null} onlyUser  limite aux saisies d'un collecteur */
async function listDonations(onlyUser) {
  const sql = `SELECT ${DONATION_COLUMNS} FROM donations d
    LEFT JOIN users c ON c.id = d.created_by
    LEFT JOIN users e ON e.id = d.updated_by
    ${onlyUser ? 'WHERE d.created_by = ?' : ''}
    ORDER BY d.date DESC, d.created_at DESC`;
  return hydrate(await all(sql, onlyUser ? [onlyUser] : undefined));
}

async function getDonation(id) {
  const row = await one(`SELECT ${DONATION_COLUMNS} FROM donations d
    LEFT JOIN users c ON c.id = d.created_by
    LEFT JOIN users e ON e.id = d.updated_by
    WHERE d.id = ?`, [id]);
  return row ? (await hydrate([row]))[0] : null;
}

/** Don et répartition écrits ensemble : jamais l'un sans l'autre. */
async function saveDonation(don, userId, isUpdate) {
  const now = nowIso();
  const tx = await client.transaction('write');
  try {
    if (isUpdate) {
      await tx.execute({
        sql: `UPDATE donations SET donor = ?, type = ?, type_other = ?, kind = ?, unit = ?,
              amount = ?, date = ?, note = ?, updated_by = ?, updated_at = ? WHERE id = ?`,
        args: [don.donor, don.type, don.typeOther, don.kind, don.unit,
               don.amount, don.date, don.note, userId, now, don.id]
      });
      await tx.execute({ sql: 'DELETE FROM allocations WHERE donation_id = ?', args: [don.id] });
    } else {
      await tx.execute({
        sql: `INSERT INTO donations (id, donor, type, type_other, kind, unit,
              amount, date, note, created_by, created_at, updated_by, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [don.id, don.donor, don.type, don.typeOther, don.kind, don.unit,
               don.amount, don.date, don.note, userId, now, userId, now]
      });
    }
    for (let i = 0; i < don.allocations.length; i++) {
      const a = don.allocations[i];
      await tx.execute({
        sql: `INSERT INTO allocations (id, donation_id, name, amount, note, position)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [a.id || uid('ben'), don.id, a.name, a.amount, a.note || '', i]
      });
    }
    await tx.commit();
  } catch (err) {
    try { await tx.rollback(); } catch (_) { /* déjà fermée */ }
    throw err;
  }
  return getDonation(don.id);
}

const deleteDonation = (id) => run('DELETE FROM donations WHERE id = ?', [id]);

/* ----------------------------------------------------------- journal */

const logAction = (user, action, entity, entityId, detail) =>
  run(`INSERT INTO audit (at, user_id, user_name, action, entity, entity_id, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [nowIso(), user ? user.id : null, user ? user.name : 'système',
     action, entity, entityId || null, detail || '']);

const listAudit = (limit) =>
  all('SELECT * FROM audit ORDER BY id DESC LIMIT ?', [Math.min(Number(limit) || 200, 1000)]);

module.exports = {
  client, init, DB_FILE, DATA_DIR, IS_REMOTE, describeStorage, uid, nowIso,
  getSetting, setSetting, allSettings,
  listUsers, userByName, userById, createUser, updateUser, deleteUser, countAdmins,
  createSession, sessionUser, dropSession, dropUserSessions, purgeSessions,
  listDonations, getDonation, saveDonation, deleteDonation,
  logAction, listAudit
};
