/* =========================================================================
   DonTrack Web — mots de passe, sessions, limitation des tentatives

   Hachage scrypt (module crypto intégré) : aucune dépendance externe,
   et le mot de passe en clair n'est jamais stocké ni journalisé.
   ========================================================================= */

'use strict';
const crypto = require('crypto');
const db = require('./db');

const SESSION_TTL = 12 * 60 * 60 * 1000;      // 12 h
const COOKIE = 'dontrack_session';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), s, SCRYPT.keylen, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024
  }).toString('hex');
  return { hash, salt: s };
}

function verifyPassword(password, user) {
  const { hash } = hashPassword(password, user.pass_salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(user.pass_hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ----------------------------------------------------------- limitation */

const attempts = new Map();                   // clé -> { count, until }
const MAX_ATTEMPTS = 8;
const WINDOW = 10 * 60 * 1000;

function throttleKey(ip, username) {
  return ip + '|' + String(username || '').toLowerCase();
}

function isBlocked(key) {
  const a = attempts.get(key);
  if (!a) return 0;
  if (Date.now() > a.until) { attempts.delete(key); return 0; }
  return a.count >= MAX_ATTEMPTS ? Math.ceil((a.until - Date.now()) / 1000) : 0;
}

function noteFailure(key) {
  const a = attempts.get(key) || { count: 0, until: Date.now() + WINDOW };
  a.count++;
  a.until = Date.now() + WINDOW;
  attempts.set(key, a);
}

const clearFailures = (key) => attempts.delete(key);

/* ----------------------------------------------------------- cookies */

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i < 0) return;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function sessionCookie(value, maxAgeSec, secure) {
  const bits = [
    `${COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAgeSec}`
  ];
  if (secure) bits.push('Secure');
  return bits.join('; ');
}

/* ----------------------------------------------------------- compte initial */

/**
 * Crée l'administrateur au tout premier démarrage.
 *
 * Le mot de passe vient de DONTRACK_ADMIN_PASSWORD si elle est définie ;
 * sinon il est tiré au hasard et affiché au démarrage. Jamais de mot de
 * passe par défaut connu : l'application peut être exposée sur Internet
 * avant que son propriétaire ne s'y connecte.
 */
async function ensureFirstAdmin() {
  const existing = await db.listUsers();
  if (existing.length) return null;

  const fromEnv = String(process.env.DONTRACK_ADMIN_PASSWORD || '').trim();
  if (fromEnv && fromEnv.length < 8) {
    throw new Error('DONTRACK_ADMIN_PASSWORD doit faire au moins 8 caractères.');
  }
  const password = fromEnv || randomPassword();
  const { hash, salt } = hashPassword(password);
  const user = await db.createUser({
    username: 'admin',
    name: 'Administrateur',
    role: 'admin',
    hash, salt,
    mustChange: true
  });
  await db.logAction(null, 'creation', 'utilisateur', user.id, 'compte administrateur initial');
  return { username: 'admin', password, fromEnv: !!fromEnv };
}

/** Mot de passe initial lisible : sans caractères ambigus (l, 1, O, 0). */
function randomPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(14);
  return Array.from(bytes).map((b) => alphabet[b % alphabet.length]).join('');
}

module.exports = {
  COOKIE, SESSION_TTL, randomPassword,
  hashPassword, verifyPassword,
  throttleKey, isBlocked, noteFailure, clearFailures,
  parseCookies, sessionCookie,
  ensureFirstAdmin
};
