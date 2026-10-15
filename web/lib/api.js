/* =========================================================================
   DonTrack Web — API JSON

   Règle d'accès : un collecteur ne voit et ne modifie que ses propres
   saisies ; l'administrateur voit et consolide l'ensemble.
   ========================================================================= */

'use strict';
const db = require('./db');
const auth = require('./auth');

const TYPES = ['particulier', 'association', 'entreprise', 'autre'];
const EPS = 0.5;

/* ----------------------------------------------------------- validation */

class Invalid extends Error {
  constructor(message) { super(message); this.status = 400; }
}

function str(value, label, { max = 200, required = false } = {}) {
  const s = String(value === null || value === undefined ? '' : value).trim();
  if (required && !s) throw new Invalid(`${label} est obligatoire.`);
  if (s.length > max) throw new Invalid(`${label} ne doit pas dépasser ${max} caractères.`);
  return s;
}

function money(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Invalid(`${label} doit être un montant supérieur à zéro.`);
  if (n > 1e12) throw new Invalid(`${label} est hors limites.`);
  return Math.round(n * 100) / 100;
}

function isoDate(value) {
  const s = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Invalid('La date est invalide.');
  const d = new Date(s + 'T12:00:00Z');
  if (Number.isNaN(d.getTime())) throw new Invalid('La date est invalide.');
  return s;
}

function cleanDonation(body) {
  const donor = str(body.donor, 'Le nom du donateur', { max: 120, required: true });
  const date = isoDate(body.date);
  const type = TYPES.includes(body.type) ? body.type : 'autre';
  const note = str(body.note, 'La note', { max: 500 });

  // « Autre » n'a de sens que précisé : on garde le texte libre saisi.
  const typeOther = type === 'autre'
    ? str(body.typeOther, 'La précision du type', { max: 60 })
    : '';

  // Un don peut être en argent ou en nature (vivres, animaux, matériel…).
  // Dans les deux cas il porte une quantité ; seule l'unité change.
  const kind = body.kind === 'nature' ? 'nature' : 'argent';
  const unit = kind === 'nature'
    ? str(body.unit, 'La nature du don', { max: 40, required: true })
    : '';
  const amount = money(body.amount, kind === 'nature' ? 'La quantité' : 'Le montant du don');

  const raw = Array.isArray(body.allocations) ? body.allocations : [];
  if (raw.length > 100) throw new Invalid('100 bénéficiaires au maximum par don.');

  const allocations = raw
    .map((a) => ({
      id: typeof a.id === 'string' && /^[\w-]{1,40}$/.test(a.id) ? a.id : undefined,
      name: str(a.name, 'Le nom du bénéficiaire', { max: 120 }),
      amount: Number(a.amount) || 0,
      note: str(a.note, 'La note du bénéficiaire', { max: 200 })
    }))
    .filter((a) => a.name || a.amount > 0);

  allocations.forEach((a, i) => {
    if (!a.name) throw new Invalid(`Bénéficiaire ${i + 1} : le nom est manquant.`);
    a.amount = money(a.amount, `Le montant du bénéficiaire ${i + 1}`);
  });

  const assigned = allocations.reduce((s, a) => s + a.amount, 0);
  if (assigned > amount + EPS) {
    throw new Invalid(kind === 'nature'
      ? 'La répartition dépasse la quantité reçue.'
      : 'La répartition dépasse le montant du don.');
  }
  return { donor, amount, date, type, typeOther, kind, unit, note, allocations };
}

/* ----------------------------------------------------------- helpers */

const publicUser = (u) => ({
  id: u.id, username: u.username, name: u.name, role: u.role,
  mustChange: !!u.must_change
});

const isAdmin = (u) => u && u.role === 'admin';

function requireAdmin(ctx) {
  if (!isAdmin(ctx.user)) {
    const e = new Error("Réservé à l'administrateur.");
    e.status = 403;
    throw e;
  }
}

function forbidden(message) {
  const e = new Error(message || 'Action non autorisée.');
  e.status = 403;
  return e;
}

/* ----------------------------------------------------------- routes */

const routes = [];
const on = (method, pattern, handler, opts) =>
  routes.push({ method, pattern, handler, open: !!(opts && opts.open) });

/* --- authentification --- */

on('POST', '/api/auth/login', async (ctx) => {
  const username = str(ctx.body.username, "L'identifiant", { max: 60, required: true });
  const password = String(ctx.body.password || '');

  const key = auth.throttleKey(ctx.ip, username);
  const blocked = auth.isBlocked(key);
  if (blocked) {
    const e = new Error(`Trop de tentatives. Réessayez dans ${Math.ceil(blocked / 60)} minute(s).`);
    e.status = 429;
    throw e;
  }

  const user = db.userByName(username);
  // Message identique dans tous les cas : on ne révèle pas quels comptes existent.
  const bad = () => { const e = new Error('Identifiant ou mot de passe incorrect.'); e.status = 401; return e; };

  if (!user || !user.active || !auth.verifyPassword(password, user)) {
    auth.noteFailure(key);
    db.logAction(user || null, 'echec_connexion', 'session', null, `identifiant « ${username} »`);
    throw bad();
  }

  auth.clearFailures(key);
  const sid = db.createSession(user.id, ctx.req.headers['user-agent'], auth.SESSION_TTL);
  db.updateUser(user.id, { last_login: db.nowIso() });
  db.logAction(user, 'connexion', 'session', null, '');

  ctx.setCookie(auth.sessionCookie(sid, auth.SESSION_TTL / 1000, ctx.secure));
  return { user: publicUser(user) };
}, { open: true });

on('POST', '/api/auth/logout', async (ctx) => {
  if (ctx.sessionId) db.dropSession(ctx.sessionId);
  if (ctx.user) db.logAction(ctx.user, 'deconnexion', 'session', null, '');
  ctx.setCookie(auth.sessionCookie('', 0, ctx.secure));
  return { ok: true };
});

on('GET', '/api/me', async (ctx) => ({
  user: publicUser(ctx.user),
  settings: db.allSettings()
}));

on('POST', '/api/auth/password', async (ctx) => {
  const current = String(ctx.body.current || '');
  const next = String(ctx.body.next || '');

  if (next.length < 8) throw new Invalid('Le nouveau mot de passe doit faire au moins 8 caractères.');
  if (next.length > 200) throw new Invalid('Mot de passe trop long.');

  const full = db.userById(ctx.user.id);
  if (!auth.verifyPassword(current, full)) {
    const e = new Error('Mot de passe actuel incorrect.');
    e.status = 401;
    throw e;
  }

  const { hash, salt } = auth.hashPassword(next);
  db.updateUser(ctx.user.id, { pass_hash: hash, pass_salt: salt, must_change: 0 });
  db.logAction(ctx.user, 'changement_mot_de_passe', 'utilisateur', ctx.user.id, '');
  return { ok: true };
});

/* --- dons --- */

on('GET', '/api/donations', async (ctx) => ({
  donations: db.listDonations(isAdmin(ctx.user) ? null : ctx.user.id)
}));

on('POST', '/api/donations', async (ctx) => {
  const clean = cleanDonation(ctx.body);
  clean.id = db.uid('don');
  clean.allocations.forEach((a) => { a.id = db.uid('ben'); });

  const saved = db.saveDonation(clean, ctx.user.id, false);
  const unite = saved.kind === 'nature' ? (saved.unit || 'unités') : '';
  db.logAction(ctx.user, 'creation', 'don', saved.id,
    `${saved.donor} — ${saved.amount} ${unite}`.trim() +
    ` (${saved.allocations.length} bénéficiaire(s))`);
  return { donation: saved };
});

on('PUT', '/api/donations/:id', async (ctx) => {
  const existing = db.getDonation(ctx.params.id);
  if (!existing) { const e = new Error('Don introuvable.'); e.status = 404; throw e; }
  if (!isAdmin(ctx.user) && existing.created_by !== ctx.user.id) {
    throw forbidden("Vous ne pouvez modifier que les dons que vous avez enregistrés.");
  }

  const clean = cleanDonation(ctx.body);
  clean.id = existing.id;
  const saved = db.saveDonation(clean, ctx.user.id, true);
  db.logAction(ctx.user, 'modification', 'don', saved.id, `${saved.donor} — ${saved.amount}`);
  return { donation: saved };
});

on('DELETE', '/api/donations/:id', async (ctx) => {
  const existing = db.getDonation(ctx.params.id);
  if (!existing) { const e = new Error('Don introuvable.'); e.status = 404; throw e; }
  if (!isAdmin(ctx.user) && existing.created_by !== ctx.user.id) {
    throw forbidden("Vous ne pouvez supprimer que les dons que vous avez enregistrés.");
  }
  db.deleteDonation(existing.id);
  db.logAction(ctx.user, 'suppression', 'don', existing.id, `${existing.donor} — ${existing.amount}`);
  return { ok: true };
});

/* --- utilisateurs (administrateur) --- */

on('GET', '/api/users', async (ctx) => {
  requireAdmin(ctx);
  return { users: db.listUsers() };
});

on('POST', '/api/users', async (ctx) => {
  requireAdmin(ctx);
  const username = str(ctx.body.username, "L'identifiant", { max: 60, required: true }).toLowerCase();
  if (!/^[a-z0-9._-]{3,60}$/.test(username)) {
    throw new Invalid("L'identifiant doit faire 3 caractères minimum (lettres, chiffres, . _ -).");
  }
  if (db.userByName(username)) throw new Invalid('Cet identifiant est déjà utilisé.');

  const name = str(ctx.body.name, 'Le nom complet', { max: 120, required: true });
  const role = ctx.body.role === 'admin' ? 'admin' : 'agent';
  const password = String(ctx.body.password || '');
  if (password.length < 8) throw new Invalid('Le mot de passe doit faire au moins 8 caractères.');

  const { hash, salt } = auth.hashPassword(password);
  const user = db.createUser({ username, name, role, hash, salt, mustChange: true });
  db.logAction(ctx.user, 'creation', 'utilisateur', user.id, `${name} (${role})`);
  return { user: publicUser(user) };
});

on('PUT', '/api/users/:id', async (ctx) => {
  requireAdmin(ctx);
  const target = db.userById(ctx.params.id);
  if (!target) { const e = new Error('Utilisateur introuvable.'); e.status = 404; throw e; }

  const fields = {};
  if (ctx.body.name !== undefined) fields.name = str(ctx.body.name, 'Le nom complet', { max: 120, required: true });
  if (ctx.body.role !== undefined) fields.role = ctx.body.role === 'admin' ? 'admin' : 'agent';
  if (ctx.body.active !== undefined) fields.active = ctx.body.active ? 1 : 0;

  // On ne peut pas se retirer soi-même le dernier accès administrateur.
  const losesAdmin = (fields.role === 'agent' || fields.active === 0) && target.role === 'admin' && target.active;
  if (losesAdmin && db.countAdmins() <= 1) {
    throw new Invalid('Il doit rester au moins un administrateur actif.');
  }

  if (ctx.body.password !== undefined && ctx.body.password !== '') {
    const pwd = String(ctx.body.password);
    if (pwd.length < 8) throw new Invalid('Le mot de passe doit faire au moins 8 caractères.');
    const { hash, salt } = auth.hashPassword(pwd);
    fields.pass_hash = hash;
    fields.pass_salt = salt;
    fields.must_change = 1;
    db.dropUserSessions(target.id);          // les sessions ouvertes sont coupées
  }

  const updated = db.updateUser(target.id, fields);
  if (fields.active === 0) db.dropUserSessions(target.id);
  db.logAction(ctx.user, 'modification', 'utilisateur', target.id,
    Object.keys(fields).map((k) => (k.startsWith('pass') ? 'mot de passe' : k)).filter((v, i, a) => a.indexOf(v) === i).join(', '));
  return { user: publicUser(updated) };
});

on('DELETE', '/api/users/:id', async (ctx) => {
  requireAdmin(ctx);
  const target = db.userById(ctx.params.id);
  if (!target) { const e = new Error('Utilisateur introuvable.'); e.status = 404; throw e; }
  if (target.id === ctx.user.id) throw new Invalid('Vous ne pouvez pas désactiver votre propre compte.');
  if (target.role === 'admin' && db.countAdmins() <= 1) {
    throw new Invalid('Il doit rester au moins un administrateur actif.');
  }
  db.deleteUser(target.id);
  db.logAction(ctx.user, 'desactivation', 'utilisateur', target.id, target.name);
  return { ok: true };
});

/* --- réglages & journal (administrateur) --- */

on('PUT', '/api/settings', async (ctx) => {
  requireAdmin(ctx);
  if (ctx.body.org !== undefined) db.setSetting('org', str(ctx.body.org, "Le nom de l'organisation", { max: 120 }));
  if (ctx.body.currency !== undefined) db.setSetting('currency', str(ctx.body.currency, 'La devise', { max: 10 }) || 'FCFA');
  db.logAction(ctx.user, 'modification', 'reglages', null, '');
  return { settings: db.allSettings() };
});

/**
 * Sauvegarde complète, réservée à l'administrateur. Indispensable quand la
 * base vit sur un serveur distant dont on n'a pas le système de fichiers.
 * Les empreintes de mots de passe ne sont jamais exportées.
 */
on('GET', '/api/backup', async (ctx) => {
  requireAdmin(ctx);
  db.logAction(ctx.user, 'export', 'sauvegarde', null, '');
  return {
    version: 1,
    exportedAt: db.nowIso(),
    settings: db.allSettings(),
    users: db.listUsers().map((u) => ({
      id: u.id, username: u.username, name: u.name,
      role: u.role, active: u.active, created_at: u.created_at
    })),
    donations: db.listDonations(null)
  };
});

on('GET', '/api/audit', async (ctx) => {
  requireAdmin(ctx);
  return { entries: db.listAudit(ctx.query.get('limit') || 200) };
});

module.exports = { routes, Invalid, publicUser, isAdmin };
