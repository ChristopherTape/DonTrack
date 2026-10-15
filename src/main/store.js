'use strict';
const fs = require('fs');
const path = require('path');

/**
 * Stockage local : un fichier JSON dans le dossier utilisateur de l'application.
 * Ecriture atomique (fichier temporaire + rename) pour ne jamais corrompre les donnees.
 */
const DEFAULT_DATA = {
  version: 1,
  settings: {
    org: '',
    currency: 'FCFA',
    theme: 'dark'
  },
  donations: []
};

class Store {
  constructor(userDataDir) {
    this.dir = userDataDir;
    this.file = path.join(userDataDir, 'dontrack-data.json');
    this.backupDir = path.join(userDataDir, 'sauvegardes');
  }

  read() {
    try {
      if (!fs.existsSync(this.file)) return structuredClone(DEFAULT_DATA);
      const raw = fs.readFileSync(this.file, 'utf8');
      if (!raw.trim()) return structuredClone(DEFAULT_DATA);
      const parsed = JSON.parse(raw);
      return this.migrate(parsed);
    } catch (err) {
      // Fichier illisible : on le met de cote plutot que de l'ecraser silencieusement.
      try {
        const corrupt = this.file + '.corrompu-' + Date.now();
        fs.copyFileSync(this.file, corrupt);
      } catch (_) { /* ignore */ }
      return structuredClone(DEFAULT_DATA);
    }
  }

  migrate(data) {
    const base = structuredClone(DEFAULT_DATA);
    const out = {
      version: 1,
      settings: Object.assign(base.settings, data && data.settings ? data.settings : {}),
      donations: Array.isArray(data && data.donations) ? data.donations : []
    };
    out.donations = out.donations.map((d) => ({
      id: d.id || 'don_' + Math.random().toString(36).slice(2, 11),
      donor: String(d.donor || 'Anonyme'),
      type: d.type || 'autre',
      amount: Number(d.amount) || 0,
      date: d.date || new Date().toISOString().slice(0, 10),
      note: d.note || '',
      createdAt: d.createdAt || new Date().toISOString(),
      updatedAt: d.updatedAt || d.createdAt || new Date().toISOString(),
      allocations: Array.isArray(d.allocations) ? d.allocations.map((a) => ({
        id: a.id || 'ben_' + Math.random().toString(36).slice(2, 11),
        name: String(a.name || ''),
        amount: Number(a.amount) || 0,
        note: a.note || ''
      })) : []
    }));
    return out;
  }

  write(data) {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
    return true;
  }

  /** Sauvegarde datee, conservee en rotation (30 dernieres). */
  snapshot() {
    if (!fs.existsSync(this.file)) return null;
    fs.mkdirSync(this.backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const target = path.join(this.backupDir, `dontrack-${stamp}.json`);
    fs.copyFileSync(this.file, target);
    const files = fs.readdirSync(this.backupDir).filter((f) => f.endsWith('.json')).sort();
    while (files.length > 30) {
      try { fs.unlinkSync(path.join(this.backupDir, files.shift())); } catch (_) { /* ignore */ }
    }
    return target;
  }
}

module.exports = { Store, DEFAULT_DATA };
