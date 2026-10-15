/* =========================================================================
   DonTrack — noyau métier partagé par la version desktop et la version mobile.

   Fonctions pures uniquement : aucun accès au DOM, au disque ou à Electron.
   La devise est toujours passée en paramètre, jamais lue dans un état global.
   ========================================================================= */

(function (global) {
  'use strict';

  const TYPES = {
    particulier: 'Particulier',
    association: 'Association',
    entreprise: 'Entreprise',
    autre: 'Autre'
  };

  const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin',
    'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

  const DAYS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];

  // Un don n'est pas forcément de l'argent : vivres, animaux, matériel…
  // Dans les deux cas le don porte une quantité et une unité ; seule l'unité
  // change (la devise d'un côté, « sacs de riz » ou « chèvres » de l'autre).
  const KINDS = { argent: 'Argent', nature: 'En nature' };

  /** Libellé du type de donateur, en tenant compte de la précision « Autre ». */
  function typeLabel(don) {
    if (!don) return 'Autre';
    if (don.type === 'autre' && String(don.typeOther || '').trim()) return String(don.typeOther).trim();
    return TYPES[don.type] || 'Autre';
  }

  const isNature = (d) => d && d.kind === 'nature';

  /** Unité d'un don : la devise pour l'argent, le libellé saisi pour la nature. */
  const unitOf = (d, currency) =>
    isNature(d) ? (String(d.unit || '').trim() || 'unités') : (currency || 'FCFA');

  const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

  /* ----------------------------------------------------------- utilitaires */

  const uid = (p) => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function escapeHtml(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  const todayIso = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  /* ----------------------------------------------------------- formatage */

  const fmtNum = (n) => nf.format(Math.round(Number(n) || 0));
  const fmtMoney = (n, currency) => fmtNum(n) + ' ' + (currency || 'FCFA');

  /** Montant d'un don avec son unité : « 50 000 FCFA » ou « 10 sacs de riz ». */
  const fmtAmount = (n, don, currency) => fmtNum(n) + ' ' + unitOf(don, currency);

  /** Format court pour les graduations d'axe : 50 k, 1,2 M. */
  function fmtShort(n) {
    const v = Number(n) || 0;
    const abs = Math.abs(v);
    if (abs >= 1e9) return (v / 1e9).toFixed(abs >= 1e10 ? 0 : 1).replace('.', ',') + ' Md';
    if (abs >= 1e6) return (v / 1e6).toFixed(abs >= 1e7 ? 0 : 1).replace('.', ',') + ' M';
    if (abs >= 1e3) return Math.round(v / 1e3) + ' k';
    return nf.format(v);
  }

  /** Accepte « 50 000 », « 50000 », « 50.000 », « 50000,5 ». */
  function parseAmount(str) {
    if (typeof str === 'number') return str > 0 ? str : 0;
    let s = String(str || '').trim().replace(/[\s  ]/g, '');
    if (!s) return 0;
    s = s.replace(/,/g, '.');
    const parts = s.split('.');
    if (parts.length > 2) s = parts.slice(0, -1).join('') + '.' + parts[parts.length - 1];
    const n = parseFloat(s.replace(/[^\d.\-]/g, ''));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    const [y, m, d] = String(iso).split('-');
    return `${d}/${m}/${y}`;
  }

  /** « 12 mars 2026 » — plus lisible que le format court sur un écran étroit. */
  function fmtDateLong(iso) {
    if (!iso) return '—';
    const [y, m, d] = String(iso).split('-').map(Number);
    return `${d} ${MONTHS[m - 1].replace('.', '')} ${y}`;
  }

  function monthLabel(key) {
    const [y, m] = String(key).split('-');
    return MONTHS[Number(m) - 1] + ' ' + y.slice(2);
  }

  /* ----------------------------------------------------------- dons */

  const given = (d) => d.allocations.reduce((a, x) => a + (Number(x.amount) || 0), 0);

  function statusOf(d) {
    const g = given(d);
    if (g <= 0.5) return 'none';
    if (g >= d.amount - 0.5) return 'complete';
    return 'partial';
  }

  const STATUS_LABEL = {
    complete: 'Entièrement réparti',
    partial: 'Partiellement réparti',
    none: 'Non réparti'
  };

  /* ----------------------------------------------------------- filtres */

  function periodBounds(f) {
    const now = new Date();
    if (f.period === 'ytd') return { from: `${now.getFullYear()}-01-01`, to: '9999-12-31' };
    if (f.period === '30') {
      const d = new Date(now.getTime() - 29 * 864e5);
      return { from: d.toISOString().slice(0, 10), to: '9999-12-31' };
    }
    if (f.period === 'custom') return { from: f.from || '0000-01-01', to: f.to || '9999-12-31' };
    return { from: '0000-01-01', to: '9999-12-31' };
  }

  function periodLabel(f) {
    const b = periodBounds(f);
    if (f.period === 'ytd') return `Année ${new Date().getFullYear()}`;
    if (f.period === '30') return `30 derniers jours (depuis le ${fmtDate(b.from)})`;
    if (f.period === 'custom' && (f.from || f.to)) {
      return `Du ${f.from ? fmtDate(f.from) : '…'} au ${f.to ? fmtDate(f.to) : '…'}`;
    }
    return 'Toutes les données';
  }

  /** Filtre par période puis par recherche (donateur, note, bénéficiaires). */
  function filterDonations(donations, f) {
    const b = periodBounds(f);
    const q = String(f.search || '').trim().toLowerCase();
    return donations.filter((d) => {
      if (d.date < b.from || d.date > b.to) return false;
      if (!q) return true;
      if (d.donor.toLowerCase().includes(q)) return true;
      if ((d.note || '').toLowerCase().includes(q)) return true;
      return d.allocations.some((a) =>
        a.name.toLowerCase().includes(q) || (a.note || '').toLowerCase().includes(q));
    });
  }

  function sortDonations(list, sort) {
    const key = (sort && sort.key) || 'date';
    const mul = (sort && sort.dir) === 'asc' ? 1 : -1;
    return list.slice().sort((a, b) => {
      let r;
      if (key === 'amount') r = a.amount - b.amount;
      else if (key === 'donor') r = a.donor.localeCompare(b.donor, 'fr');
      else r = (a.date || '').localeCompare(b.date || '') || (a.createdAt || '').localeCompare(b.createdAt || '');
      return r * mul;
    });
  }

  /* ----------------------------------------------------------- agrégats */

  /**
   * Les dons en argent et les dons en nature ne s'additionnent pas : on ne
   * totalise pas des FCFA avec des sacs de riz. Les clés historiques
   * (total, distributed, remaining, avg) restent les montants en argent ;
   * `nature` regroupe le reste par unité.
   */
  function computeStats(list) {
    const money = list.filter((d) => !isNature(d));
    const total = money.reduce((a, d) => a + d.amount, 0);
    const distributed = money.reduce((a, d) => a + Math.min(given(d), d.amount), 0);

    const byUnit = new Map();
    list.filter(isNature).forEach((d) => {
      const key = unitOf(d).toLowerCase();
      if (!byUnit.has(key)) byUnit.set(key, { unit: unitOf(d), total: 0, distributed: 0, count: 0 });
      const e = byUnit.get(key);
      e.total += d.amount;
      e.distributed += Math.min(given(d), d.amount);
      e.count++;
    });
    const nature = Array.from(byUnit.values())
      .map((e) => Object.assign(e, { remaining: Math.max(0, e.total - e.distributed) }))
      .sort((a, b) => b.total - a.total);

    const names = new Set();
    let allocations = 0;
    let partialCount = 0;
    list.forEach((d) => {
      d.allocations.forEach((a) => {
        if (a.name.trim()) { names.add(a.name.trim().toLowerCase()); allocations++; }
      });
      if (statusOf(d) !== 'complete') partialCount++;
    });

    return {
      count: list.length,
      moneyCount: money.length,
      natureCount: list.length - money.length,
      total,
      distributed,
      remaining: Math.max(0, total - distributed),
      nature,
      beneficiaries: names.size,
      allocations,
      partialCount,
      avg: money.length ? total / money.length : 0
    };
  }

  /* --- séries temporelles ------------------------------------------------ */

  const addDays = (iso, n) => {
    const d = new Date(iso + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  /** Lundi de la semaine contenant la date (semaines ISO). */
  function weekStart(iso) {
    const d = new Date(iso + 'T12:00:00Z');
    const day = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - day);
    return d.toISOString().slice(0, 10);
  }

  const GRAIN = {
    jour: {
      key: (iso) => iso,
      next: (iso) => addDays(iso, 1),
      label: (iso) => {
        const d = new Date(iso + 'T12:00:00Z');
        return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].replace('.', '')}`;
      },
      full: (iso) => {
        const d = new Date(iso + 'T12:00:00Z');
        return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
      }
    },
    semaine: {
      key: weekStart,
      next: (iso) => addDays(iso, 7),
      label: (iso) => {
        const d = new Date(iso + 'T12:00:00Z');
        return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].replace('.', '')}`;
      },
      full: (iso) => `Semaine du ${fmtDate(iso)}`
    },
    mois: {
      key: (iso) => iso.slice(0, 7),
      next: (key) => {
        let [y, m] = key.split('-').map(Number);
        m++;
        if (m > 12) { m = 1; y++; }
        return `${y}-${String(m).padStart(2, '0')}`;
      },
      label: monthLabel,
      full: monthLabel
    }
  };

  /**
   * Série « collecté / réparti » agrégée au pas demandé (jour par défaut : une
   * collecte se joue souvent sur quelques jours, pas sur des mois).
   * Les périodes sans don restent présentes à zéro pour ne pas déformer le rythme.
   * Seuls les dons en argent alimentent la série : les unités ne s'additionnent pas.
   */
  function periodSeries(list, granularity, maxBuckets) {
    const grain = GRAIN[granularity] || GRAIN.jour;
    const map = new Map();

    list.filter((d) => !isNature(d)).forEach((d) => {
      if (!d.date) return;
      const key = grain.key(d.date);
      if (!map.has(key)) map.set(key, { collected: 0, distributed: 0 });
      const e = map.get(key);
      e.collected += d.amount;
      e.distributed += Math.min(given(d), d.amount);
    });

    const present = Array.from(map.keys()).sort();
    let keys = present;
    if (present.length > 1) {
      keys = [];
      let cur = present[0];
      const last = present[present.length - 1];
      let guard = 0;
      while (cur <= last && guard++ < 4000) {
        keys.push(cur);
        if (!map.has(cur)) map.set(cur, { collected: 0, distributed: 0 });
        cur = grain.next(cur);
      }
    }
    if (maxBuckets) keys = keys.slice(-maxBuckets);

    return {
      granularity: granularity || 'jour',
      keys,
      labels: keys.map(grain.label),
      fullLabels: keys.map(grain.full),
      collected: keys.map((k) => map.get(k).collected),
      distributed: keys.map((k) => map.get(k).distributed)
    };
  }

  /** Conservé pour les versions desktop et mobile. */
  const monthlySeries = (list, maxMonths) => periodSeries(list, 'mois', maxMonths || 12);

  function topBeneficiaries(list) {
    const map = new Map();
    list.forEach((d) => d.allocations.forEach((a) => {
      const name = a.name.trim();
      if (!name) return;
      const key = name.toLowerCase();
      if (!map.has(key)) map.set(key, { name, value: 0, count: 0 });
      const e = map.get(key);
      e.value += Number(a.amount) || 0;
      e.count++;
    }));
    return Array.from(map.values()).sort((a, b) => b.value - a.value);
  }

  function topDonors(list) {
    const map = new Map();
    list.forEach((d) => {
      const key = d.donor.trim().toLowerCase();
      if (!map.has(key)) map.set(key, { name: d.donor.trim(), value: 0, count: 0 });
      const e = map.get(key);
      e.value += d.amount;
      e.count++;
    });
    return Array.from(map.values()).sort((a, b) => b.value - a.value);
  }

  /* ----------------------------------------------------------- présentation */

  const AVATAR_COLORS = ['#3987e5', '#199e70', '#c98500', '#8b5cf6', '#e05a67', '#0ea5b7'];

  function avatarFor(name) {
    const s = String(name || '');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    const initials = s.trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?';
    return { color: AVATAR_COLORS[h % AVATAR_COLORS.length], initials };
  }

  /* ----------------------------------------------------------- export CSV */

  function toCsv(list) {
    const rows = [['Date', 'Donateur', 'Type', 'Forme', 'Quantité / Montant', 'Unité',
      'Bénéficiaire', 'Part attribuée', 'Part du don (%)', 'Note']];
    list.forEach((d) => {
      const type = typeLabel(d);
      const forme = isNature(d) ? 'En nature' : 'Argent';
      const unite = unitOf(d, 'FCFA');
      const base = [d.date, d.donor, type, forme, d.amount, unite];

      if (!d.allocations.length) {
        rows.push(base.concat(['(non réparti)', '', '', d.note || '']));
        return;
      }
      d.allocations.forEach((a) => {
        rows.push(base.concat([a.name, a.amount,
          d.amount > 0 ? ((a.amount / d.amount) * 100).toFixed(1) : '', d.note || '']));
      });
      const rest = d.amount - given(d);
      if (rest > 0.5) {
        rows.push(base.concat(['(reste non réparti)', rest,
          ((rest / d.amount) * 100).toFixed(1), '']));
      }
    });
    return rows.map((r) => r.map((c) => {
      const s = String(c === null || c === undefined ? '' : c);
      return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(';')).join('\r\n');
  }

  /* ----------------------------------------------------------- données */

  const DEFAULT_DATA = {
    version: 1,
    settings: { org: '', currency: 'FCFA', theme: 'dark' },
    donations: []
  };

  /** Remet n'importe quelle entrée (fichier importé, stockage ancien) en forme. */
  function normalize(data) {
    const out = {
      version: 1,
      settings: Object.assign({}, DEFAULT_DATA.settings, (data && data.settings) || {}),
      donations: Array.isArray(data && data.donations) ? data.donations : []
    };
    out.donations = out.donations.map((d) => ({
      id: d.id || uid('don'),
      donor: String(d.donor || 'Anonyme'),
      type: d.type || 'autre',
      typeOther: String(d.typeOther || ''),
      kind: d.kind === 'nature' ? 'nature' : 'argent',
      unit: String(d.unit || ''),
      amount: Number(d.amount) || 0,
      date: d.date || todayIso(),
      note: d.note || '',
      createdAt: d.createdAt || new Date().toISOString(),
      updatedAt: d.updatedAt || d.createdAt || new Date().toISOString(),
      allocations: Array.isArray(d.allocations) ? d.allocations.map((a) => ({
        id: a.id || uid('ben'),
        name: String(a.name || ''),
        amount: Number(a.amount) || 0,
        note: a.note || ''
      })) : []
    }));
    return out;
  }

  global.DTCore = {
    TYPES, KINDS, MONTHS, DAYS, STATUS_LABEL, DEFAULT_DATA,
    uid, escapeHtml, todayIso,
    fmtNum, fmtMoney, fmtAmount, fmtShort, fmtDate, fmtDateLong, monthLabel, parseAmount,
    given, statusOf, isNature, unitOf, typeLabel,
    periodBounds, periodLabel, filterDonations, sortDonations,
    computeStats, periodSeries, monthlySeries, topBeneficiaries, topDonors,
    avatarFor, toCsv, normalize
  };
})(typeof window !== 'undefined' ? window : globalThis);
