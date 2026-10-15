/* =========================================================================
   DonTrack Web — serveur

   Node seul : aucune dépendance npm. Base SQLite intégrée, sessions en
   cookie HttpOnly, mots de passe hachés en scrypt.

   Démarrage : npm run web      (port 8080 par défaut, PORT pour changer)
   ========================================================================= */

'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const db = require('./lib/db');
const auth = require('./lib/auth');
const api = require('./lib/api');

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const BEHIND_HTTPS = process.env.DONTRACK_HTTPS === '1';
// Derrière un proxy (Fly, Render, nginx…), l'adresse du client est dans
// l'en-tête transmis par le proxy, pas dans la socket.
const TRUST_PROXY = process.env.DONTRACK_TRUST_PROXY === '1';

const PUBLIC = path.join(__dirname, 'public');
const SHARED = path.join(__dirname, '..', 'src', 'shared');
const MAX_BODY = 1024 * 1024;                 // 1 Mo

/* ----------------------------------------------------------- statique */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'"
].join('; ');

function securityHeaders(res) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (BEHIND_HTTPS) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
}

/**
 * Sert un fichier d'un dossier autorisé, en bloquant toute remontée de chemin.
 *
 * Revalidation par ETag plutôt que durée de cache fixe : une mise à jour du
 * serveur parvient immédiatement aux postes, sans retélécharger ce qui n'a
 * pas changé (réponse 304).
 */
function sendFile(req, res, root, relative) {
  const target = path.resolve(root, '.' + path.posix.normalize('/' + relative));
  if (!target.startsWith(path.resolve(root))) return notFound(res);

  fs.stat(target, (err, stat) => {
    if (err || !stat.isFile()) return notFound(res);

    const etag = `"${stat.size.toString(36)}-${stat.mtimeMs.toString(36)}"`;
    res.setHeader('Content-Type', MIME[path.extname(target).toLowerCase()] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('ETag', etag);

    if (req.headers['if-none-match'] === etag) {
      res.statusCode = 304;
      return res.end();
    }
    fs.readFile(target, (err2, data) => {
      if (err2) return notFound(res);
      res.statusCode = 200;
      res.end(data);
    });
  });
}

function notFound(res) {
  res.statusCode = 404;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end('Introuvable');
}

function sendJson(res, status, payload, cookies) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (cookies && cookies.length) res.setHeader('Set-Cookie', cookies);
  res.end(JSON.stringify(payload));
}

function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader('Location', location);
  res.end();
}

/* ----------------------------------------------------------- corps */

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Requête trop volumineuse.'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(Object.assign(new Error('JSON invalide.'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

/* ----------------------------------------------------------- routage */

function matchRoute(method, pathname) {
  for (const route of api.routes) {
    if (route.method !== method) continue;
    const parts = route.pattern.split('/');
    const got = pathname.split('/');
    if (parts.length !== got.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].startsWith(':')) params[parts[i].slice(1)] = decodeURIComponent(got[i]);
      else if (parts[i] !== got[i]) { ok = false; break; }
    }
    if (ok) return { route, params };
  }
  return null;
}

function clientIp(req) {
  if (TRUST_PROXY) {
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (fwd) return fwd.replace(/^::ffff:/, '');
  }
  return (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
}

async function handleApi(req, res, url) {
  const found = matchRoute(req.method, url.pathname);
  if (!found) return sendJson(res, 404, { error: 'Route inconnue.' });

  const cookies = auth.parseCookies(req.headers.cookie);
  const sessionId = cookies[auth.COOKIE];
  const user = await db.sessionUser(sessionId);

  if (!found.route.open && !user) {
    return sendJson(res, 401, { error: 'Session expirée. Reconnectez-vous.' });
  }

  // Anti-CSRF : toute écriture doit porter l'en-tête applicatif, qu'un
  // formulaire tiers ne peut pas ajouter.
  if (req.method !== 'GET' && req.headers['x-dontrack'] !== '1') {
    return sendJson(res, 403, { error: 'Requête rejetée.' });
  }

  // Tant que le mot de passe initial n'est pas changé, seules ces routes passent.
  if (user && user.must_change) {
    const allowed = ['/api/me', '/api/auth/password', '/api/auth/logout'];
    if (!allowed.includes(url.pathname)) {
      return sendJson(res, 428, { error: 'Changez votre mot de passe pour continuer.', mustChange: true });
    }
  }

  const outCookies = [];
  const ctx = {
    req, res, user, sessionId,
    params: found.params,
    query: url.searchParams,
    ip: clientIp(req),
    secure: BEHIND_HTTPS,
    body: {},
    setCookie: (c) => outCookies.push(c)
  };

  try {
    if (req.method !== 'GET' && req.method !== 'DELETE') ctx.body = await readBody(req);
    const result = await found.route.handler(ctx);
    sendJson(res, 200, result, outCookies);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('[api]', url.pathname, err);
    sendJson(res, status, { error: err.message || 'Erreur interne.' }, outCookies);
  }
}

/* ----------------------------------------------------------- serveur */

const server = http.createServer(async (req, res) => {
  securityHeaders(res);

  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch (_) {
    return notFound(res);
  }
  const p = url.pathname;

  if (p.startsWith('/api/')) return handleApi(req, res, url);

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    return res.end('Méthode non autorisée');
  }

  // Sonde de l'hébergeur : ne touche ni aux sessions ni à la base.
  if (p === '/health') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.end('ok');
  }

  const session = await db.sessionUser(auth.parseCookies(req.headers.cookie)[auth.COOKIE]);

  if (p === '/') return redirect(res, session ? '/app' : '/connexion');
  if (p === '/connexion') {
    if (session) return redirect(res, '/app');
    return sendFile(req, res, PUBLIC, 'login.html');
  }
  if (p === '/app') {
    if (!session) return redirect(res, '/connexion');
    return sendFile(req, res, PUBLIC, 'index.html');
  }
  if (p.startsWith('/shared/')) return sendFile(req, res, SHARED, p.slice('/shared'.length));
  if (p === '/favicon.ico') return sendFile(req, res, PUBLIC, 'logo.png');

  return sendFile(req, res, PUBLIC, p);
});

/* ----------------------------------------------------------- démarrage */

function localAddresses() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

/* Le schéma est créé — ou complété — avant d'accepter la moindre requête. */
async function start() {
  const stockage = await db.init();
  const firstAdmin = await auth.ensureFirstAdmin();

  setInterval(() => {
    db.purgeSessions().catch(() => { /* réessayé au tour suivant */ });
  }, 30 * 60 * 1000).unref();

  server.listen(PORT, HOST, () => {
    const lines = [];
    lines.push('');
    lines.push('  DonTrack — serveur web démarré');
    lines.push('');
    lines.push(`  Sur ce poste ......... http://localhost:${PORT}`);
    localAddresses().forEach((ip) => lines.push(`  Sur le réseau local .. http://${ip}:${PORT}`));
    lines.push(`  Données .............. ${stockage.storage}`);
    if (stockage.remote) lines.push('  (base distante : elle survit aux redéploiements)');
    lines.push('');

    if (firstAdmin) {
      lines.push('  ==================================================');
      lines.push('   PREMIERE CONNEXION - compte administrateur');
      lines.push('  --------------------------------------------------');
      lines.push(`   identifiant  : ${firstAdmin.username}`);
      lines.push(`   mot de passe : ${firstAdmin.password}`);
      lines.push('');
      if (!firstAdmin.fromEnv) {
        lines.push('   Mot de passe tire au hasard : notez-le maintenant,');
        lines.push('   il ne sera plus affiche. (DONTRACK_ADMIN_PASSWORD');
        lines.push('   permet de le choisir vous-meme.)');
      }
      lines.push('   Son changement est exige des la premiere connexion.');
      lines.push('  ==================================================');
      lines.push('');
    }
    if (!BEHIND_HTTPS) {
      lines.push('  Note : en accès hors du réseau local, placez le serveur');
      lines.push('         derrière HTTPS et démarrez avec DONTRACK_HTTPS=1.');
      lines.push('');
    }
    console.log(lines.join('\n'));
  });
}

start().catch((err) => {
  console.error('Démarrage impossible :', err.message);
  process.exit(1);
});

/* Les hébergeurs envoient SIGTERM avant de recycler l'instance :
   on ferme proprement pour que SQLite termine ses écritures. */
function arret(signal) {
  console.log(`\n${signal} reçu — arrêt du serveur.`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 8000).unref();
}
process.on('SIGINT', () => arret('SIGINT'));
process.on('SIGTERM', () => arret('SIGTERM'));
