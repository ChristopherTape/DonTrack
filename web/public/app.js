/* =========================================================================
   DonTrack Web — application

   Le métier (formatage, filtres, agrégats, rapport) vient de /shared/, le
   même code que les versions desktop et mobile. Ici : le dialogue avec le
   serveur, les droits selon le rôle, et le rendu.
   ========================================================================= */

(function () {
  'use strict';

  const C = window.DTCore;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const { TYPES, STATUS_LABEL, uid, escapeHtml, todayIso, fmtNum, fmtShort,
          fmtDate, fmtDateLong, parseAmount, given, statusOf, avatarFor,
          isNature, unitOf, typeLabel } = C;

  /* ===================================================== état */

  const state = {
    me: null,
    settings: { org: '', currency: 'FCFA' },
    donations: [],
    users: [],
    screen: 'dons',
    search: '',
    period: 'all',
    status: 'all',
    collector: 'all',
    grain: 'jour',
    expanded: new Set(),
    draft: null,
    editingId: null,
    detailId: null,
    editingUserId: null,
    ready: false
  };

  const isAdmin = () => state.me && state.me.role === 'admin';
  const currency = () => state.settings.currency || 'FCFA';
  const fmtMoney = (n) => C.fmtMoney(n, currency());
  /** Montant d'un don avec son unité propre (FCFA, sacs de riz, chèvres…). */
  const fmtOf = (n, don) => C.fmtAmount(n, don, currency());
  const unitLabel = (don) => unitOf(don, currency());
  const periodLabel = () => C.periodLabel({ period: state.period });

  function visibleDonations() {
    let list = C.filterDonations(state.donations, { period: state.period, search: state.search });
    if (isAdmin() && state.collector !== 'all') {
      list = list.filter((d) => d.created_by === state.collector);
    }
    return list;
  }

  /* ===================================================== client API */

  async function api(path, options) {
    const opts = Object.assign({ method: 'GET' }, options || {});
    opts.headers = Object.assign({ 'X-DonTrack': '1' }, opts.headers || {});
    if (opts.body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }

    let res;
    try {
      res = await fetch(path, opts);
    } catch (e) {
      throw new Error('Serveur injoignable. Vérifiez votre connexion.');
    }

    if (res.status === 401) {
      window.location.href = '/connexion';
      throw new Error('Session expirée.');
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 428) {
      openPasswordSheet(true);
      throw new Error(data.error || 'Changement de mot de passe requis.');
    }
    if (!res.ok) throw new Error(data.error || 'Erreur serveur.');
    return data;
  }

  /* ===================================================== bandeau d'indicateurs */

  function stat(o) {
    return `<div class="stat" style="--dot:${o.color}">
      <div class="stat__label"><i></i>${o.label}</div>
      <div class="stat__value">${o.value}${o.unit ? `<small>${escapeHtml(o.unit)}</small>` : ''}</div>
      <div class="stat__foot">${o.foot || ''}</div>
    </div>`;
  }

  function renderStatband() {
    const list = visibleDonations();
    const s = C.computeStats(list);
    const pct = s.total > 0 ? (s.distributed / s.total) * 100 : 0;
    const cur = currency();

    // Une jauge segmentée plutôt qu'une barre pleine : réparti et reste
    // se lisent d'un coup d'œil, même à zéro.
    const meter = s.total > 0
      ? `<div class="meter">
           <span style="width:${pct}%;background:var(--series-2)"></span>
           <span class="meter__rest"></span>
         </div>`
      : `<div class="meter"><span class="meter__rest"></span></div>`;

    const hero = `<div class="hero">
      <div class="hero__label">${isAdmin() ? 'Total collecté' : 'Mes collectes'}${state.period === 'all' ? '' : ' · ' + escapeHtml(periodLabel())}</div>
      <div class="hero__value">${fmtNum(s.total)}<small>${escapeHtml(cur)}</small></div>
      <div class="hero__meta">${s.moneyCount} don${s.moneyCount > 1 ? 's' : ''} en argent${s.moneyCount ? ` · moyenne ${fmtNum(s.avg)}` : ''}</div>
      ${meter}
      <div class="meterlegend">
        <div><i style="background:var(--series-2)"></i>Réparti <b>${fmtNum(s.distributed)}</b></div>
        <div><i style="background:var(--surface-3)"></i>Reste <b>${fmtNum(s.remaining)}</b></div>
      </div>
    </div>`;

    const natureFoot = s.nature.length
      ? s.nature.slice(0, 2).map((n) => `${fmtNum(n.total)} ${escapeHtml(n.unit)}`).join(' · ')
        + (s.nature.length > 2 ? ` +${s.nature.length - 2}` : '')
      : 'Aucun don en nature';

    const tiles = [
      stat({
        label: 'Dons en nature', color: 'var(--series-3)',
        value: fmtNum(s.natureCount),
        foot: natureFoot
      }),
      stat({
        label: 'Reste à répartir', color: 'var(--warn)',
        value: fmtNum(s.remaining), unit: cur,
        foot: s.partialCount ? `${s.partialCount} don${s.partialCount > 1 ? 's' : ''} à compléter` : 'Tout est réparti'
      }),
      isAdmin()
        ? stat({
            label: 'Collecteurs actifs', color: 'var(--brand)',
            value: fmtNum(new Set(list.map((d) => d.created_by)).size),
            foot: `${s.beneficiaries} bénéficiaire${s.beneficiaries > 1 ? 's' : ''} servis`
          })
        : stat({
            label: 'Bénéficiaires', color: 'var(--brand)',
            value: fmtNum(s.beneficiaries),
            foot: `${s.allocations} attribution${s.allocations > 1 ? 's' : ''}`
          })
    ].join('');

    $('#statband').innerHTML = hero + `<div class="statgrid">${tiles}</div>`;
  }

  /* ===================================================== liste des dons */

  const RAILS = { complete: 'var(--good)', partial: 'var(--warn)', none: 'var(--ink-3)' };

  function renderList() {
    let list = visibleDonations();
    if (state.status !== 'all') list = list.filter((d) => statusOf(d) === state.status);
    list = C.sortDonations(list, { key: 'date', dir: 'desc' });

    const box = $('#donList');
    const empty = $('#donEmpty');

    if (!list.length) {
      box.innerHTML = '';
      empty.hidden = false;
      const vierge = state.donations.length === 0;
      $('h3', empty).textContent = vierge ? "Aucun don pour l'instant" : 'Aucun résultat';
      $('p', empty).innerHTML = vierge
        ? 'Enregistrez un premier don — en argent ou en nature — pour suivre sa répartition.'
        : 'Aucun don ne correspond aux filtres actifs.';
      return;
    }
    empty.hidden = true;

    box.innerHTML = list.map((d) => {
      const g = Math.min(given(d), d.amount);
      const pct = d.amount > 0 ? (g / d.amount) * 100 : 0;
      const st = statusOf(d);
      const av = avatarFor(d.donor);
      const open = state.expanded.has(d.id);
      const rest = d.amount - given(d);
      const nature = isNature(d);

      let benef = '';
      if (open) {
        const lignes = d.allocations.map((a, i) => `
          <div class="benefline">
            <span class="benefline__i">${i + 1}</span>
            <span class="benefline__n">${escapeHtml(a.name)}</span>
            <span class="benefline__v">${fmtOf(a.amount, d)}</span>
            <span class="benefline__p">${d.amount > 0 ? Math.round((a.amount / d.amount) * 100) : 0} %</span>
          </div>`).join('');
        const resteLigne = rest > 0.5 ? `
          <div class="benefline benefline--rest">
            <span class="benefline__i" style="background:var(--warn-soft);color:var(--warn)">!</span>
            <span class="benefline__n">Reste non réparti</span>
            <span class="benefline__v">${fmtOf(rest, d)}</span>
            <span class="benefline__p">${Math.round((rest / d.amount) * 100)} %</span>
          </div>` : '';
        benef = `<div class="doncard__benef">
          ${lignes || '<div class="benefline benefline--hint">Aucun bénéficiaire enregistré.</div>'}
          ${resteLigne}
          <div class="benefline benefline--hint">Double-clic pour ouvrir la fiche détaillée</div>
        </div>`;
      } else if (d.allocations.length) {
        const noms = d.allocations.slice(0, 2).map((a) => a.name).join(', ');
        const suite = d.allocations.length > 2 ? ` +${d.allocations.length - 2}` : '';
        benef = `<div class="doncard__benef"><div class="benefline benefline--hint">${escapeHtml(noms)}${suite}</div></div>`;
      }

      const who = isAdmin() && d.created_by_name
        ? `<span class="pill pill--brand">${escapeHtml(d.created_by_name)}${d.created_by === state.me.id ? ' (vous)' : ''}</span>`
        : '';

      return `<article class="doncard ${open ? 'is-open' : ''}" data-id="${d.id}" style="--rail:${RAILS[st]}">
        <span class="avatar" style="background:${av.color}">${av.initials}</span>
        <div class="doncard__id">
          <div class="doncard__donor">${escapeHtml(d.donor)}</div>
          <div class="doncard__sub">${fmtDateLong(d.date)} · ${escapeHtml(typeLabel(d))}</div>
        </div>
        <div class="doncard__amt">
          <b>${fmtNum(d.amount)}</b>
          <span>${escapeHtml(unitLabel(d))}</span>
        </div>
        <div class="doncard__foot">
          <span class="prog"><span style="width:${pct}%;background:${st === 'complete' ? 'var(--good)' : 'var(--series-2)'}"></span></span>
          <span class="doncard__pct">${Math.round(pct)} % réparti</span>
          <span class="pillrow">
            <span class="pill pill--${st}"><i></i>${STATUS_LABEL[st]}</span>
            ${nature ? '<span class="pill pill--nature">En nature</span>' : ''}
            ${who}
          </span>
        </div>
        ${benef}
      </article>`;
    }).join('');
  }

  function renderCollectorFilter() {
    const sel = $('#collectorFilter');
    if (!isAdmin()) { sel.hidden = true; return; }
    const noms = new Map();
    state.donations.forEach((d) => { if (d.created_by_name) noms.set(d.created_by, d.created_by_name); });
    sel.hidden = noms.size < 2;
    sel.innerHTML = ['<option value="all">Tous les collecteurs</option>']
      .concat(Array.from(noms.entries())
        .sort((a, b) => a[1].localeCompare(b[1], 'fr'))
        .map(([id, nom]) => `<option value="${escapeHtml(id)}">${escapeHtml(nom)}</option>`))
      .join('');
    sel.value = state.collector;
  }

  /* ===================================================== statistiques */

  const shorten = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

  function collectorTotals(list) {
    const map = new Map();
    list.filter((d) => !isNature(d)).forEach((d) => {
      const key = d.created_by;
      if (!map.has(key)) map.set(key, { name: d.created_by_name || 'Inconnu', value: 0, count: 0 });
      const e = map.get(key);
      e.value += d.amount;
      e.count++;
    });
    return Array.from(map.values()).sort((a, b) => b.value - a.value);
  }

  const GRAIN_TITLE = {
    jour: ['Évolution journalière', 'Collecté et réparti, jour par jour'],
    semaine: ['Évolution hebdomadaire', 'Collecté et réparti, semaine par semaine'],
    mois: ['Évolution mensuelle', 'Collecté et réparti, mois par mois']
  };

  function renderStats() {
    const list = visibleDonations();
    const s = C.computeStats(list);
    const cur = currency();
    const c1 = DTCharts.css('--series-1');
    const c2 = DTCharts.css('--series-2');

    const best = C.topBeneficiaries(list)[0];
    const bestDonor = C.topDonors(list)[0];

    $('#statTiles').innerHTML = [
      stat({ label: 'Dons sur la période', color: 'var(--brand)', value: fmtNum(s.count),
             foot: `${s.moneyCount} en argent · ${s.natureCount} en nature` }),
      stat({ label: 'Don moyen', color: 'var(--series-1)', value: fmtNum(s.avg), unit: cur,
             foot: s.moneyCount ? `sur ${s.moneyCount} don${s.moneyCount > 1 ? 's' : ''} en argent` : '—' }),
      stat({ label: 'Premier donateur', color: 'var(--series-2)',
             value: bestDonor ? escapeHtml(shorten(bestDonor.name, 18)) : '—',
             foot: bestDonor ? `${fmtNum(bestDonor.value)} ${cur}` : 'Aucune donnée' }),
      stat({ label: 'Premier bénéficiaire', color: 'var(--series-3)',
             value: best ? escapeHtml(shorten(best.name, 18)) : '—',
             foot: best ? `${fmtNum(best.value)} ${cur}` : 'Aucune donnée' })
    ].join('');

    // --- série temporelle, journalière par défaut ---
    const [titre, soustitre] = GRAIN_TITLE[state.grain];
    $('#serieTitle').textContent = titre;
    $('#serieSub').textContent = soustitre;

    const serie = C.periodSeries(list, state.grain);
    const box = $('#chartSerie');
    // Beaucoup de jours : on garde un pas lisible et on fait défiler
    // horizontalement plutôt que d'écraser les barres.
    const minPitch = 34;
    const needed = serie.labels.length * minPitch + 70;
    const large = needed > box.clientWidth;
    box.classList.toggle('chart--scroll', large);

    DTCharts.groupedBars(box, {
      labels: serie.labels,
      fullLabels: serie.fullLabels,
      series: [
        { key: 'collected', label: 'Collecté', color: c1, values: serie.collected },
        { key: 'distributed', label: 'Réparti', color: c2, values: serie.distributed }
      ],
      fmt: fmtMoney, fmtShort,
      width: large ? needed : undefined
    });
    DTCharts.dataTable($('#chartSerie-table'),
      [{ key: 'p', label: 'Période' }, { key: 'col', label: 'Collecté', num: true }, { key: 'dis', label: 'Réparti', num: true }],
      serie.fullLabels.map((l, i) => ({ p: l, col: fmtMoney(serie.collected[i]), dis: fmtMoney(serie.distributed[i]) })));

    // --- dons en nature ---
    const natureCard = $('#natureCard');
    natureCard.hidden = !s.nature.length;
    if (s.nature.length) {
      DTCharts.dataTable($('#natureTable'),
        [{ key: 'u', label: 'Nature' }, { key: 'c', label: 'Dons', num: true },
         { key: 't', label: 'Reçu', num: true }, { key: 'd', label: 'Réparti', num: true },
         { key: 'r', label: 'Reste', num: true }],
        s.nature.map((n) => ({
          u: escapeHtml(n.unit), c: n.count,
          t: fmtNum(n.total), d: fmtNum(n.distributed), r: fmtNum(n.remaining)
        })));
    }

    DTCharts.meter($('#chartMeter'), { value: s.distributed, total: s.total, fmt: fmtMoney });

    const benef = C.topBeneficiaries(list.filter((d) => !isNature(d)));
    DTCharts.hBars($('#chartBenef'), {
      rows: benef.slice(0, 10).map((b) => ({ label: b.name, value: b.value, meta: `${b.count} attribution${b.count > 1 ? 's' : ''}` })),
      color: c2, fmt: fmtShort
    });
    DTCharts.dataTable($('#chartBenef-table'),
      [{ key: 'n', label: 'Bénéficiaire' }, { key: 'c', label: 'Attributions', num: true }, { key: 'v', label: 'Total reçu', num: true }],
      benef.map((b) => ({ n: escapeHtml(b.name), c: b.count, v: fmtMoney(b.value) })));

    const donors = C.topDonors(list.filter((d) => !isNature(d)));
    DTCharts.hBars($('#chartDonor'), {
      rows: donors.slice(0, 10).map((b) => ({ label: b.name, value: b.value, meta: `${b.count} don${b.count > 1 ? 's' : ''}` })),
      color: c1, fmt: fmtShort
    });
    DTCharts.dataTable($('#chartDonor-table'),
      [{ key: 'n', label: 'Donateur' }, { key: 'c', label: 'Dons', num: true }, { key: 'v', label: 'Total donné', num: true }],
      donors.map((b) => ({ n: escapeHtml(b.name), c: b.count, v: fmtMoney(b.value) })));

    const card = $('#collectorCard');
    const cols = collectorTotals(list);
    card.hidden = !isAdmin() || cols.length < 2;
    if (!card.hidden) {
      DTCharts.hBars($('#chartCollector'), {
        rows: cols.map((c) => ({ label: c.name, value: c.value, meta: `${c.count} don${c.count > 1 ? 's' : ''}` })),
        color: c1, fmt: fmtShort
      });
      DTCharts.dataTable($('#chartCollector-table'),
        [{ key: 'n', label: 'Utilisateur' }, { key: 'c', label: 'Dons', num: true }, { key: 'v', label: 'Collecté', num: true }],
        cols.map((c) => ({ n: escapeHtml(c.name), c: c.count, v: fmtMoney(c.value) })));
    }
  }

  /* ===================================================== rapport */

  function reportModel() {
    const list = C.sortDonations(visibleDonations(), { key: 'date', dir: 'asc' });
    const now = new Date();
    const scope = isAdmin()
      ? (state.collector === 'all' ? '' : ' · ' + ((state.donations.find((d) => d.created_by === state.collector) || {}).created_by_name || ''))
      : ' · saisies de ' + state.me.name;
    const [titre] = GRAIN_TITLE[state.grain];

    return {
      title: $('#repTitle').value.trim() || 'Rapport de répartition des dons',
      org: $('#repOrg').value.trim(),
      logo: window.location.origin + '/logo.png',
      periodLabel: periodLabel() + scope,
      searchLabel: state.search.trim(),
      generatedAt: `${fmtDate(todayIso())} à ${String(now.getHours()).padStart(2, '0')}h${String(now.getMinutes()).padStart(2, '0')}`,
      stats: C.computeStats(list),
      donations: list,
      monthly: C.periodSeries(list, state.grain, state.grain === 'jour' ? 31 : 12),
      seriesTitle: titre,
      topBenef: C.topBeneficiaries(list.filter((d) => !isNature(d))).slice(0, 10).map((b) => ({ label: b.name, value: b.value })),
      allBenef: C.topBeneficiaries(list.filter((d) => !isNature(d))),
      topDonors: C.topDonors(list),
      collectors: isAdmin() ? collectorTotals(list) : null,
      options: {
        summary: $('#optSummary').checked,
        charts: $('#optCharts').checked,
        detail: $('#optDetail').checked,
        benef: $('#optBenef').checked,
        sign: $('#optSign').checked
      },
      typeLabel: (t) => TYPES[t] || 'Autre',
      fmt: fmtMoney,
      fmtFor: (n, don) => fmtOf(n, don),
      fmtNum,
      fmtShort, fmtDate
    };
  }

  let previewTimer = null;
  function renderPreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      const model = reportModel();
      const r = DTReport.build(model);
      $('#repPreview').innerHTML = `<style>${r.css}</style><div class="rpt">${r.body}</div>`;
      $('#previewSub').textContent = `${model.donations.length} don${model.donations.length > 1 ? 's' : ''} · ${periodLabel()}`;
      $('#reportScope').textContent = isAdmin()
        ? 'Consolidation de toutes les saisies'
        : 'Vos propres saisies uniquement';
    }, 80);
  }

  function generatePdf() {
    const doc = DTReport.build(reportModel()).fullDoc;
    const win = window.open('', '_blank');

    if (win) {
      win.document.open();
      win.document.write(doc);
      win.document.close();
      setTimeout(() => { try { win.print(); } catch (_) { /* déjà imprimé */ } }, 700);
      toast('Choisissez « Enregistrer au format PDF » comme destination.', 'info');
      return;
    }

    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;width:0;height:0;border:0;opacity:0';
    frame.srcdoc = doc;
    frame.onload = () => setTimeout(() => {
      frame.contentWindow.focus();
      frame.contentWindow.print();
      setTimeout(() => frame.remove(), 60000);
    }, 300);
    document.body.appendChild(frame);
    toast('Choisissez « Enregistrer au format PDF » comme destination.', 'info');
  }

  function exportCsv() {
    const list = C.sortDonations(visibleDonations(), { key: 'date', dir: 'desc' });
    if (!list.length) { toast('Aucune donnée à exporter.', 'error'); return; }
    const blob = new Blob(['﻿' + C.toCsv(list)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dons-${todayIso()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('Export CSV téléchargé.');
  }

  /* ===================================================== utilisateurs */

  function renderUsers() {
    $('#userList').innerHTML = state.users.map((u) => {
      const av = avatarFor(u.name);
      const moi = u.id === state.me.id;
      return `<article class="usercard ${u.active ? '' : 'is-off'}" data-id="${u.id}">
        <div class="usercard__top">
          <span class="avatar" style="background:${av.color}">${av.initials}</span>
          <div class="usercard__id">
            <b>${escapeHtml(u.name)}${moi ? ' (vous)' : ''}</b>
            <span>${escapeHtml(u.username)}</span>
          </div>
        </div>
        <div class="pillrow">
          <span class="pill ${u.role === 'admin' ? 'pill--brand' : ''}">${u.role === 'admin' ? 'Administrateur' : 'Collecteur'}</span>
          ${u.active ? '' : '<span class="pill pill--none">Désactivé</span>'}
          ${u.must_change ? '<span class="pill pill--partial"><i></i>Mot de passe à changer</span>' : ''}
        </div>
        <div class="usercard__stats">
          <div><b>${fmtNum(u.donations)}</b>don${u.donations > 1 ? 's' : ''} saisi${u.donations > 1 ? 's' : ''}</div>
          <div><b>${fmtNum(u.collected)}</b>${escapeHtml(currency())} collectés</div>
        </div>
        <div class="usercard__actions">
          <button class="btn btn--ghost btn--sm" data-edit="${u.id}">Modifier</button>
          ${moi ? '' : `<button class="btn btn--sm btn--danger" data-toggle="${u.id}">${u.active ? 'Désactiver' : 'Réactiver'}</button>`}
        </div>
      </article>`;
    }).join('');
  }

  async function loadUsers() {
    state.users = (await api('/api/users')).users;
    renderUsers();
  }

  function randomPassword() {
    const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
    return Array.from(crypto.getRandomValues(new Uint8Array(10)))
      .map((b) => alphabet[b % alphabet.length]).join('');
  }

  function openUserSheet(user) {
    state.editingUserId = user ? user.id : null;
    $('#userSheetTitle').textContent = user ? "Modifier l'utilisateur" : 'Nouvel utilisateur';
    $('#uName').value = user ? user.name : '';
    $('#uUsername').value = user ? user.username : '';
    $('#uUsername').disabled = !!user;
    $('#uRole').value = user ? user.role : 'agent';
    $('#uPassword').value = user ? '' : randomPassword();
    $('#uPwdLabel').innerHTML = user
      ? 'Nouveau mot de passe <span style="font-weight:500;color:var(--ink-3)">(laisser vide pour ne pas changer)</span>'
      : 'Mot de passe provisoire <b>*</b>';
    $('#uActiveRow').hidden = !user || user.id === state.me.id;
    $('#uActive').checked = user ? !!user.active : true;
    $('#btnSaveUser').textContent = user ? 'Enregistrer' : 'Créer le compte';
    $('#userError').hidden = true;
    openSheet('#sheetUser');
  }

  async function saveUser() {
    const btn = $('#btnSaveUser');
    const err = $('#userError');
    err.hidden = true;
    btn.disabled = true;
    try {
      const payload = {
        name: $('#uName').value.trim(),
        role: $('#uRole').value,
        password: $('#uPassword').value
      };
      if (state.editingUserId) {
        if (!$('#uActiveRow').hidden) payload.active = $('#uActive').checked;
        await api('/api/users/' + encodeURIComponent(state.editingUserId), { method: 'PUT', body: payload });
        toast('Utilisateur mis à jour.');
      } else {
        payload.username = $('#uUsername').value.trim().toLowerCase();
        await api('/api/users', { method: 'POST', body: payload });
        toast('Compte créé. Communiquez le mot de passe provisoire à la personne.');
      }
      closeSheet('#sheetUser');
      await loadUsers();
      await loadDonations();
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
    } finally {
      btn.disabled = false;
    }
  }

  /* ===================================================== journal */

  const ACTION_LABEL = {
    creation: 'Création', modification: 'Modification', suppression: 'Suppression',
    connexion: 'Connexion', deconnexion: 'Déconnexion', echec_connexion: 'Échec de connexion',
    desactivation: 'Désactivation', changement_mot_de_passe: 'Mot de passe changé'
  };

  async function loadAudit() {
    const data = await api('/api/audit?limit=300');
    DTCharts.dataTable($('#auditTable'),
      [{ key: 'quand', label: 'Quand' }, { key: 'qui', label: 'Qui' },
       { key: 'quoi', label: 'Action' }, { key: 'objet', label: 'Objet' },
       { key: 'detail', label: 'Détail' }],
      data.entries.map((e) => ({
        quand: fmtDate(e.at.slice(0, 10)) + ' ' + e.at.slice(11, 16),
        qui: escapeHtml(e.user_name),
        quoi: ACTION_LABEL[e.action] || e.action,
        objet: e.entity,
        detail: escapeHtml(e.detail || '')
      })));
  }

  /* ===================================================== feuilles */

  function openSheet(id) { $(id).hidden = false; document.body.style.overflow = 'hidden'; }

  function closeSheet(id) {
    $(id).hidden = true;
    if (!$$('.sheet').some((s) => !s.hidden)) document.body.style.overflow = '';
    DTCharts.hideTip();
  }

  function confirmDialog(o) {
    return new Promise((resolve) => {
      $('#cfTitle').textContent = o.title || 'Confirmer';
      $('#cfMessage').textContent = o.message || '';
      $('#cfDetail').textContent = o.detail || '';
      $('#cfDetail').hidden = !o.detail;
      const ok = $('#cfOk');
      ok.textContent = o.confirmLabel || 'Confirmer';
      ok.classList.toggle('btn--danger', !!o.danger);
      ok.classList.toggle('btn--primary', !o.danger);

      const done = (v) => {
        closeSheet('#dialogConfirm');
        ok.onclick = null;
        $('#cfCancel').onclick = null;
        resolve(v);
      };
      ok.onclick = () => done(true);
      $('#cfCancel').onclick = () => done(false);
      openSheet('#dialogConfirm');
    });
  }

  /* ===================================================== assistant de saisie */

  const QUICK = [5000, 10000, 25000, 50000, 100000];

  const newDraft = () => ({
    id: null, donor: '', amount: 0, date: todayIso(),
    type: 'particulier', typeOther: '', kind: 'argent', unit: '', note: '', allocations: []
  });

  function openWizard(existing) {
    state.draft = existing ? JSON.parse(JSON.stringify(existing)) : newDraft();
    state.editingId = existing ? existing.id : null;
    const d = state.draft;

    $('#fDonor').value = d.donor;
    $('#fAmount').value = d.amount ? fmtNum(d.amount) : '';
    $('#fDate').value = d.date;
    $('#fType').value = d.type;
    $('#fTypeOther').value = d.typeOther || '';
    $('#fUnit').value = d.unit || '';
    $('#fNote').value = d.note || '';
    $('#donSheetTitle').textContent = existing ? 'Modifier le don' : 'Nouveau don';
    $('#donError').hidden = true;
    $('#allocError').hidden = true;

    setKind(d.kind === 'nature' ? 'nature' : 'argent');
    syncTypeOther();
    refreshSuggestions();
    gotoStep(1);
    openSheet('#sheetDon');
    setTimeout(() => $('#fDonor').focus(), 90);
  }

  /** Bascule argent / nature : les libellés et l'unité suivent. */
  function setKind(kind) {
    state.draft.kind = kind;
    const nature = kind === 'nature';

    $$('#kindSwitch .kindopt').forEach((b) => b.classList.toggle('is-active', b.dataset.kind === kind));
    $('#unitField').hidden = !nature;
    $('#quickAmounts').hidden = nature;
    $('#amountLabel').innerHTML = nature ? 'Quantité reçue <b>*</b>' : 'Montant du don <b>*</b>';
    $('#fAmount').placeholder = nature ? '0' : '0';
    $('#quickAmounts').innerHTML = nature ? '' :
      QUICK.map((v) => `<button type="button" class="chipbtn" data-amount="${v}">+ ${fmtNum(v)}</button>`).join('');
    syncUnitLabel();
  }

  function syncUnitLabel() {
    const nature = state.draft.kind === 'nature';
    const u = nature ? ($('#fUnit').value.trim() || 'unités') : currency();
    $('#curLabel').textContent = u;
  }

  function syncTypeOther() {
    const autre = $('#fType').value === 'autre';
    $('#typeOtherField').hidden = !autre;
    if (autre) setTimeout(() => $('#fTypeOther').focus(), 60);
  }

  function refreshSuggestions() {
    const donors = new Set();
    const units = new Set();
    const others = new Set();
    state.donations.forEach((d) => {
      if (d.donor) donors.add(d.donor.trim());
      if (isNature(d) && d.unit) units.add(d.unit.trim());
      if (d.typeOther) others.add(d.typeOther.trim());
    });
    const fill = (sel, set) => {
      $(sel).innerHTML = Array.from(set).filter(Boolean).sort()
        .map((n) => `<option value="${escapeHtml(n)}"></option>`).join('');
    };
    fill('#donorList', donors);
    fill('#unitList', units);
    fill('#typeOtherList', others);
  }

  function gotoStep(n) {
    const un = n === 1;
    $('#stepDon').hidden = !un;
    $('#stepAlloc').hidden = un;
    $('#btnNext').hidden = !un;
    $('#btnSaveAll').hidden = un;
    $('#btnBack').hidden = un;
    $('#donStepLabel').textContent = `Étape ${n} / 2`;
    $('#stepFill').style.width = (un ? 50 : 100) + '%';
    const body = $('.sheet__body:not([hidden])', $('#sheetDon'));
    if (body) body.scrollTop = 0;
    if (!un) {
      renderAllocRows();
      setTimeout(() => {
        const first = $('.alloc-row input[data-role="name"]');
        if (first) first.focus();
      }, 90);
    }
  }

  function validateStep1() {
    const d = state.draft;
    const donor = $('#fDonor').value.trim();
    const amount = parseAmount($('#fAmount').value);
    const type = $('#fType').value;
    const typeOther = $('#fTypeOther').value.trim();
    const unit = $('#fUnit').value.trim();
    const err = $('#donError');
    const fail = (msg, focus) => {
      err.textContent = msg;
      err.hidden = false;
      if (focus) $(focus).focus();
      return false;
    };

    if (!donor) return fail('Indiquez le nom du donateur.', '#fDonor');
    if (type === 'autre' && !typeOther) return fail('Précisez le type de donateur.', '#fTypeOther');
    if (d.kind === 'nature' && !unit) return fail('Indiquez la nature du don (sacs de riz, chèvres…).', '#fUnit');
    if (amount <= 0) {
      return fail(d.kind === 'nature'
        ? 'Indiquez une quantité supérieure à zéro.'
        : 'Indiquez un montant supérieur à zéro.', '#fAmount');
    }

    err.hidden = true;
    d.donor = donor;
    d.amount = amount;
    d.date = $('#fDate').value || todayIso();
    d.type = type;
    d.typeOther = type === 'autre' ? typeOther : '';
    d.unit = d.kind === 'nature' ? unit : '';
    d.note = $('#fNote').value.trim();
    return true;
  }

  /* --- étape 2 --- */

  function allocRowHtml(a, i) {
    const u = unitLabel(state.draft);
    return `<div class="alloc-row" data-idx="${i}">
      <div class="alloc-row__head">
        <span class="alloc-row__idx">${i + 1}</span>
        <span class="alloc-row__title">Bénéficiaire ${i + 1}</span>
        <button class="iconbtn alloc-row__del" data-role="remove" aria-label="Retirer">
          <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>
        </button>
      </div>
      <input type="text" data-role="name" placeholder="Nom du bénéficiaire"
             value="${escapeHtml(a.name)}" autocomplete="off" autocapitalize="words" list="benefList" />
      <div class="amt">
        <input type="text" inputmode="numeric" data-role="amount" placeholder="0" value="${a.amount ? fmtNum(a.amount) : ''}" />
        <span>${escapeHtml(u)}</span>
      </div>
      <div class="alloc-row__pct" data-role="pct"></div>
    </div>`;
  }

  function renderAllocRows() {
    const d = state.draft;
    if (!d.allocations.length) d.allocations = [{ id: uid('ben'), name: '', amount: 0, note: '' }];
    $('#allocList').innerHTML = d.allocations.map(allocRowHtml).join('');

    let dl = $('#benefList');
    if (!dl) {
      dl = document.createElement('datalist');
      dl.id = 'benefList';
      document.body.appendChild(dl);
    }
    const noms = Array.from(new Set(
      state.donations.flatMap((x) => x.allocations.map((a) => a.name.trim())).filter(Boolean))).sort();
    dl.innerHTML = noms.map((n) => `<option value="${escapeHtml(n)}"></option>`).join('');

    $('#allocTotalLabel').textContent = isNature(d) ? 'Quantité reçue' : 'Montant du don';
    updateTotals();
  }

  function readRows() {
    state.draft.allocations = $$('.alloc-row').map((row, i) => ({
      id: (state.draft.allocations[i] && state.draft.allocations[i].id) || uid('ben'),
      name: $('[data-role="name"]', row).value.trim(),
      amount: parseAmount($('[data-role="amount"]', row).value),
      note: (state.draft.allocations[i] && state.draft.allocations[i].note) || ''
    }));
  }

  function updateTotals() {
    readRows();
    const d = state.draft;
    const total = d.amount;
    const assigned = d.allocations.reduce((a, x) => a + x.amount, 0);
    const left = total - assigned;
    const pct = total > 0 ? Math.min(100, (assigned / total) * 100) : 0;

    $('#allocTotal').textContent = fmtOf(total, d);
    $('#allocAssigned').textContent = fmtOf(assigned, d);
    $('#allocLeft').textContent = (left < 0 ? '− ' : '') + fmtOf(Math.abs(left), d);
    $('#allocBarFill').style.width = (left < 0 ? 100 : pct) + '%';

    const sum = $('#allocSum');
    sum.classList.toggle('is-full', Math.abs(left) < 0.5 && assigned > 0);
    sum.classList.toggle('is-over', left < -0.5);
    $('.allocsum__left span', sum).textContent =
      Math.abs(left) < 0.5 && assigned > 0 ? 'Tout est réparti' : (left < 0 ? 'Dépassement' : 'Reste à répartir');

    $$('.alloc-row').forEach((row, i) => {
      const a = d.allocations[i];
      $('[data-role="pct"]', row).textContent = a && a.amount > 0 && total > 0
        ? `${((a.amount / total) * 100).toFixed(a.amount / total < 0.1 ? 1 : 0)} % du don`
        : '';
    });

    if (left < -0.5) {
      $('#allocError').textContent = isNature(d)
        ? `La répartition dépasse la quantité de ${fmtOf(-left, d)}.`
        : `La répartition dépasse le don de ${fmtOf(-left, d)}.`;
      $('#allocError').hidden = false;
    } else {
      $('#allocError').hidden = true;
    }
    $('#btnSaveAll').disabled = left < -0.5;
  }

  function addRow(focus) {
    readRows();
    state.draft.allocations.push({ id: uid('ben'), name: '', amount: 0, note: '' });
    renderAllocRows();
    if (focus !== false) {
      const rows = $$('.alloc-row');
      const last = rows[rows.length - 1];
      if (last) {
        $('[data-role="name"]', last).focus();
        last.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
  }

  async function saveDon() {
    readRows();
    const d = state.draft;

    const bad = d.allocations.findIndex((a) => (a.name && a.amount <= 0) || (!a.name && a.amount > 0));
    if (bad >= 0) {
      const row = $$('.alloc-row')[bad];
      if (row) { row.classList.add('is-invalid'); row.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      $('#allocError').textContent = `Bénéficiaire ${bad + 1} : indiquez à la fois un nom et un montant.`;
      $('#allocError').hidden = false;
      return;
    }

    const clean = d.allocations.filter((a) => a.name && a.amount > 0);
    const left = d.amount - clean.reduce((a, x) => a + x.amount, 0);
    if (left < -0.5) return;

    if (left > 0.5) {
      const ok = await confirmDialog({
        title: 'Répartition incomplète',
        message: clean.length
          ? `Il reste ${fmtOf(left, d)} non réparti sur ce don.`
          : "Ce don n'a encore aucun bénéficiaire.",
        detail: 'Vous pourrez compléter la répartition plus tard.',
        confirmLabel: 'Enregistrer quand même'
      });
      if (!ok) return;
    }

    const btn = $('#btnSaveAll');
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Enregistrement…';

    const payload = {
      donor: d.donor, type: d.type, typeOther: d.typeOther,
      kind: d.kind, unit: d.unit,
      amount: d.amount, date: d.date, note: d.note, allocations: clean
    };

    try {
      const edition = !!state.editingId;
      const res = edition
        ? await api('/api/donations/' + encodeURIComponent(state.editingId), { method: 'PUT', body: payload })
        : await api('/api/donations', { method: 'POST', body: payload });

      closeSheet('#sheetDon');
      state.expanded.add(res.donation.id);
      state.editingId = null;
      await loadDonations();
      toast(edition
        ? 'Don modifié.'
        : `Don de ${fmtOf(res.donation.amount, res.donation)} enregistré (${clean.length} bénéficiaire${clean.length > 1 ? 's' : ''}).`);
    } catch (e) {
      $('#allocError').textContent = e.message;
      $('#allocError').hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  /* ===================================================== détail */

  function openDetail(id) {
    const d = state.donations.find((x) => x.id === id);
    if (!d) return;
    state.detailId = id;

    const g = given(d);
    const rest = d.amount - g;
    const av = avatarFor(d.donor);
    const st = statusOf(d);
    const modifiable = isAdmin() || d.created_by === state.me.id;

    $('#detailBody').innerHTML = `
      <div class="detail-head">
        <span class="avatar" style="background:${av.color}">${av.initials}</span>
        <div class="detail-head__n">
          <b>${escapeHtml(d.donor)}</b>
          <span>${escapeHtml(typeLabel(d))} · ${fmtDateLong(d.date)}</span>
        </div>
      </div>

      <div class="detail-amount">
        <b>${fmtOf(d.amount, d)}</b>
        <span class="pillrow" style="justify-content:center">
          <span class="pill pill--${st}"><i></i>${STATUS_LABEL[st]}</span>
          ${isNature(d) ? '<span class="pill pill--nature">Don en nature</span>' : ''}
        </span>
      </div>

      <div class="detail-grid">
        <div><span>Réparti</span><b>${fmtOf(g, d)}</b></div>
        <div><span>Reste</span><b>${fmtOf(Math.max(0, rest), d)}</b></div>
        <div><span>Saisi par</span><b>${escapeHtml(d.created_by_name || '—')}</b></div>
        <div><span>Enregistré le</span><b>${fmtDate((d.created_at || '').slice(0, 10))}</b></div>
      </div>
      ${d.updated_by_name && d.updated_at !== d.created_at
        ? `<p class="hint">Dernière modification par ${escapeHtml(d.updated_by_name)} le ${fmtDate(d.updated_at.slice(0, 10))}.</p>` : ''}
      ${d.note ? `<p class="hint">« ${escapeHtml(d.note)} »</p>` : ''}

      <div class="sectionlabel">Répartition</div>
      <div class="detail-list">
        ${d.allocations.length ? d.allocations.map((a, i) => `
          <div class="detail-item">
            <span class="alloc-row__idx">${i + 1}</span>
            <div class="detail-item__n">${escapeHtml(a.name)}${a.note ? `<small>${escapeHtml(a.note)}</small>` : ''}</div>
            <div class="detail-item__v">${fmtOf(a.amount, d)}<small>${d.amount > 0 ? Math.round((a.amount / d.amount) * 100) : 0} %</small></div>
          </div>`).join('') : '<div class="detail-item"><div class="detail-item__n">Aucun bénéficiaire enregistré.</div></div>'}
        ${rest > 0.5 ? `
          <div class="detail-item detail-item--rest">
            <div class="detail-item__n">Reste non réparti</div>
            <div class="detail-item__v">${fmtOf(rest, d)}<small>${Math.round((rest / d.amount) * 100)} %</small></div>
          </div>` : ''}
      </div>
      ${modifiable ? '' : '<p class="hint">Ce don a été saisi par une autre personne : seul son auteur ou l\'administrateur peut le modifier.</p>'}`;

    $('#btnEdit').hidden = !modifiable;
    $('#btnDelete').hidden = !modifiable;
    openSheet('#sheetDetail');
  }

  async function deleteDon(id) {
    const d = state.donations.find((x) => x.id === id);
    if (!d) return;
    const ok = await confirmDialog({
      title: 'Supprimer le don',
      message: `Supprimer le don de ${d.donor} (${fmtOf(d.amount, d)}) ?`,
      detail: `Les ${d.allocations.length} ligne(s) de répartition seront également supprimées. L'opération est tracée dans le journal.`,
      confirmLabel: 'Supprimer',
      danger: true
    });
    if (!ok) return;
    try {
      await api('/api/donations/' + encodeURIComponent(id), { method: 'DELETE' });
      state.expanded.delete(id);
      closeSheet('#sheetDetail');
      await loadDonations();
      toast('Don supprimé.', 'info');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  /* ===================================================== mot de passe */

  function openPasswordSheet(forced) {
    $('#pwdForcedNote').hidden = !forced;
    $('#pwdClose').hidden = !!forced;
    $('#pwdCurrent').value = '';
    $('#pwdNext').value = '';
    $('#pwdConfirm').value = '';
    $('#pwdError').hidden = true;
    openSheet('#sheetPassword');
    setTimeout(() => $('#pwdCurrent').focus(), 90);
  }

  async function savePassword() {
    const err = $('#pwdError');
    const next = $('#pwdNext').value;
    err.hidden = true;

    if (next.length < 8) {
      err.textContent = 'Le nouveau mot de passe doit faire au moins 8 caractères.';
      err.hidden = false;
      return;
    }
    if (next !== $('#pwdConfirm').value) {
      err.textContent = 'Les deux saisies ne correspondent pas.';
      err.hidden = false;
      return;
    }

    const btn = $('#btnSavePwd');
    btn.disabled = true;
    try {
      await api('/api/auth/password', { method: 'POST', body: { current: $('#pwdCurrent').value, next } });
      state.me.mustChange = false;
      closeSheet('#sheetPassword');
      toast('Mot de passe mis à jour.');
      if (!state.ready) await boot2();
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
    } finally {
      btn.disabled = false;
    }
  }

  /* ===================================================== navigation */

  const SCREENS = {
    dons: ['Collecte', 'Dons'],
    stats: ['Collecte', 'Statistiques'],
    rapport: ['Collecte', 'Rapport'],
    users: ['Administration', 'Utilisateurs'],
    journal: ['Administration', 'Journal']
  };

  function goScreen(name) {
    if ((name === 'users' || name === 'journal') && !isAdmin()) name = 'dons';
    state.screen = name;

    $$('.navitem, .navbtn').forEach((b) => b.classList.toggle('is-active', b.dataset.screen === name));
    $$('.screen').forEach((s) => s.classList.toggle('is-active', s.id === 'screen-' + name));

    const [eyebrow, title] = SCREENS[name] || ['', 'DonTrack'];
    $('#screenEyebrow').textContent = eyebrow;
    $('#screenTitle').textContent = title;

    const filtresUtiles = name === 'dons' || name === 'stats' || name === 'rapport';
    $('#filterbar').hidden = !filtresUtiles;
    $('#btnNewDon').hidden = name !== 'dons';
    $('#fab').hidden = name !== 'dons';

    document.body.classList.remove('menu-open');
    removeScrim();
    window.scrollTo(0, 0);

    if (name === 'users') loadUsers().catch((e) => toast(e.message, 'error'));
    else if (name === 'journal') loadAudit().catch((e) => toast(e.message, 'error'));
    else renderAll();
  }

  function renderAll() {
    if (!state.ready) return;
    const list = visibleDonations();
    const s = C.computeStats(list);
    $('#screenSub').textContent = state.screen === 'journal' || state.screen === 'users'
      ? ''
      : `${s.count} don${s.count > 1 ? 's' : ''} · ${fmtMoney(s.total)}${s.natureCount ? ` + ${s.natureCount} en nature` : ''}`;

    if (state.screen === 'dons') { renderStatband(); renderCollectorFilter(); renderList(); }
    if (state.screen === 'stats') renderStats();
    if (state.screen === 'rapport') renderPreview();
  }

  /* ===================================================== divers */

  function toast(msg, kind) {
    const el = document.createElement('div');
    el.className = 'toast' + (kind ? ' toast--' + kind : '');
    el.innerHTML = `<span class="toast__dot"></span><span>${escapeHtml(msg)}</span>`;
    $('#toasts').appendChild(el);
    setTimeout(() => {
      el.classList.add('is-out');
      setTimeout(() => el.remove(), 220);
    }, 4200);
  }

  function applyTheme(theme) {
    const dark = theme === 'dark';
    if (dark) document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    // Seul un choix explicite est mémorisé ; sans choix, le mode jour reprend.
    try { localStorage.setItem('dontrack.theme.v2', dark ? 'dark' : 'light'); } catch (_) { /* ignore */ }
    const btn = $('#themeBtn');
    if (btn) btn.textContent = dark ? 'Passer en mode jour' : 'Passer en mode nuit';
    if (state.screen === 'stats') renderStats();
  }

  const currentTheme = () => (document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');

  function addScrim() {
    if ($('.scrim')) return;
    const s = document.createElement('div');
    s.className = 'scrim';
    s.addEventListener('click', () => { document.body.classList.remove('menu-open'); removeScrim(); });
    document.body.appendChild(s);
  }
  function removeScrim() { const s = $('.scrim'); if (s) s.remove(); }

  async function loadDonations() {
    const data = await api('/api/donations');
    state.donations = data.donations.map((d) => Object.assign(d, { allocations: d.allocations || [] }));
    refreshSuggestions();
    renderAll();
  }

  /* ===================================================== évènements */

  function bind() {
    $$('.navitem').forEach((b) => b.addEventListener('click', () => goScreen(b.dataset.screen)));

    $('#btnMobileMenu').addEventListener('click', () => {
      const open = document.body.classList.toggle('menu-open');
      if (open) addScrim(); else removeScrim();
    });

    $('#btnNewDon').addEventListener('click', () => openWizard(null));
    $('#fab').addEventListener('click', () => openWizard(null));
    $('#btnThemeMobile').addEventListener('click', () => applyTheme(currentTheme() === 'dark' ? 'light' : 'dark'));

    let searchTimer = null;
    $('#search').addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { state.search = e.target.value; renderAll(); }, 160);
    });

    $('#periodSeg').addEventListener('click', (e) => {
      const b = e.target.closest('[data-period]');
      if (!b) return;
      state.period = b.dataset.period;
      $$('#periodSeg .seg').forEach((x) => x.classList.toggle('is-active', x === b));
      renderAll();
    });

    $('#grainSeg').addEventListener('click', (e) => {
      const b = e.target.closest('[data-grain]');
      if (!b) return;
      state.grain = b.dataset.grain;
      $$('#grainSeg .seg').forEach((x) => x.classList.toggle('is-active', x === b));
      renderStats();
    });

    $('#statusChips').addEventListener('click', (e) => {
      const b = e.target.closest('[data-status]');
      if (!b) return;
      state.status = b.dataset.status;
      $$('#statusChips .chipbtn').forEach((x) => x.classList.toggle('is-active', x === b));
      renderList();
    });

    $('#collectorFilter').addEventListener('change', (e) => {
      state.collector = e.target.value;
      renderAll();
    });

    let clickTimer = null;
    $('#donList').addEventListener('click', (e) => {
      const card = e.target.closest('.doncard');
      if (!card) return;
      clearTimeout(clickTimer);
      clickTimer = setTimeout(() => {
        const id = card.dataset.id;
        if (state.expanded.has(id)) state.expanded.delete(id); else state.expanded.add(id);
        renderList();
      }, 220);
    });
    $('#donList').addEventListener('dblclick', (e) => {
      const card = e.target.closest('.doncard');
      if (!card) return;
      clearTimeout(clickTimer);
      openDetail(card.dataset.id);
    });

    $$('.toggle-table').forEach((b) => b.addEventListener('click', () => {
      const chart = $('#' + b.dataset.target);
      const table = $('#' + b.dataset.target + '-table');
      const show = table.hidden;
      table.hidden = !show;
      chart.hidden = show;
      b.textContent = show ? 'Graphique' : 'Tableau';
    }));

    // --- assistant ---
    $('#kindSwitch').addEventListener('click', (e) => {
      const b = e.target.closest('[data-kind]');
      if (!b) return;
      setKind(b.dataset.kind);
      if (b.dataset.kind === 'nature') setTimeout(() => $('#fUnit').focus(), 60);
    });
    $('#fUnit').addEventListener('input', syncUnitLabel);
    $('#fType').addEventListener('change', syncTypeOther);

    $('#btnNext').addEventListener('click', () => { if (validateStep1()) gotoStep(2); });
    $('#btnBack').addEventListener('click', () => { readRows(); gotoStep(1); });
    $('#btnSaveAll').addEventListener('click', saveDon);
    $('#btnAddRow').addEventListener('click', () => addRow(true));

    $('#quickAmounts').addEventListener('click', (e) => {
      const b = e.target.closest('[data-amount]');
      if (!b) return;
      $('#fAmount').value = fmtNum(parseAmount($('#fAmount').value) + Number(b.dataset.amount));
    });

    $('#fAmount').addEventListener('blur', (e) => {
      const v = parseAmount(e.target.value);
      e.target.value = v ? fmtNum(v) : '';
    });
    $('#fAmount').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); if (validateStep1()) gotoStep(2); }
    });
    $('#fDonor').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); $('#fAmount').focus(); }
    });

    $('#btnSplitEven').addEventListener('click', () => {
      readRows();
      const rows = state.draft.allocations;
      if (!rows.length) return;
      const base = Math.floor(state.draft.amount / rows.length);
      rows.forEach((r, i) => { r.amount = i === rows.length - 1 ? state.draft.amount - base * (rows.length - 1) : base; });
      renderAllocRows();
    });

    $('#btnFillLast').addEventListener('click', () => {
      readRows();
      const rows = state.draft.allocations;
      if (!rows.length) return;
      const autres = rows.slice(0, -1).reduce((a, x) => a + x.amount, 0);
      rows[rows.length - 1].amount = Math.max(0, state.draft.amount - autres);
      renderAllocRows();
    });

    $('#allocList').addEventListener('input', (e) => {
      if (e.target.matches('[data-role="amount"], [data-role="name"]')) {
        e.target.closest('.alloc-row').classList.remove('is-invalid');
        updateTotals();
      }
    });

    $('#allocList').addEventListener('click', (e) => {
      const rm = e.target.closest('[data-role="remove"]');
      if (!rm) return;
      readRows();
      state.draft.allocations.splice(Number(rm.closest('.alloc-row').dataset.idx), 1);
      renderAllocRows();
    });

    $('#allocList').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const row = e.target.closest('.alloc-row');
      if (e.target.dataset.role === 'name') $('[data-role="amount"]', row).focus();
      else if (row === $$('.alloc-row').pop()) addRow(true);
      else $('[data-role="name"]', row.nextElementSibling).focus();
    });

    // --- détail ---
    $('#btnEdit').addEventListener('click', () => {
      const d = state.donations.find((x) => x.id === state.detailId);
      closeSheet('#sheetDetail');
      if (d) openWizard(d);
    });
    $('#btnDelete').addEventListener('click', () => deleteDon(state.detailId));

    // --- utilisateurs ---
    $('#btnNewUser').addEventListener('click', () => openUserSheet(null));
    $('#btnSaveUser').addEventListener('click', saveUser);
    $('#uGenerate').addEventListener('click', () => { $('#uPassword').value = randomPassword(); });

    $('#userList').addEventListener('click', async (e) => {
      const edit = e.target.closest('[data-edit]');
      if (edit) return openUserSheet(state.users.find((u) => u.id === edit.dataset.edit));

      const toggle = e.target.closest('[data-toggle]');
      if (!toggle) return;
      const u = state.users.find((x) => x.id === toggle.dataset.toggle);
      if (!u) return;
      const ok = await confirmDialog({
        title: u.active ? 'Désactiver le compte' : 'Réactiver le compte',
        message: u.active ? `${u.name} ne pourra plus se connecter.` : `${u.name} pourra de nouveau se connecter.`,
        detail: u.active ? "Les dons qu'il a saisis sont conservés." : '',
        confirmLabel: u.active ? 'Désactiver' : 'Réactiver',
        danger: !!u.active
      });
      if (!ok) return;
      try {
        if (u.active) await api('/api/users/' + encodeURIComponent(u.id), { method: 'DELETE' });
        else await api('/api/users/' + encodeURIComponent(u.id), { method: 'PUT', body: { active: true } });
        await loadUsers();
        toast(u.active ? 'Compte désactivé.' : 'Compte réactivé.');
      } catch (e2) {
        toast(e2.message, 'error');
      }
    });

    $('#btnRefreshAudit').addEventListener('click', () => loadAudit().catch((e) => toast(e.message, 'error')));

    // --- menu utilisateur ---
    $('#userMenuBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      $('#userMenu').hidden = !$('#userMenu').hidden;
    });
    document.addEventListener('click', () => { $('#userMenu').hidden = true; });

    $('#userMenu').addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      $('#userMenu').hidden = true;
      const action = btn.dataset.action;

      if (action === 'password') return openPasswordSheet(false);
      if (action === 'theme') return applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
      if (action === 'settings') {
        $('#sOrg').value = state.settings.org || '';
        $('#sCurrency').value = currency();
        $('#settingsError').hidden = true;
        return openSheet('#sheetSettings');
      }
      if (action === 'logout') {
        try { await api('/api/auth/logout', { method: 'POST' }); } catch (_) { /* ignore */ }
        window.location.href = '/connexion';
      }
    });

    $('#btnSaveSettings').addEventListener('click', async () => {
      const err = $('#settingsError');
      err.hidden = true;
      try {
        const res = await api('/api/settings', {
          method: 'PUT',
          body: { org: $('#sOrg').value, currency: $('#sCurrency').value }
        });
        state.settings = res.settings;
        applyOrg();
        closeSheet('#sheetSettings');
        renderAll();
        toast("Paramètres enregistrés pour toute l'organisation.");
      } catch (e) {
        err.textContent = e.message;
        err.hidden = false;
      }
    });

    $('#btnSavePwd').addEventListener('click', savePassword);

    $('#btnBackup').addEventListener('click', async () => {
      const btn = $('#btnBackup');
      btn.disabled = true;
      try {
        const data = await api('/api/backup');
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `dontrack-sauvegarde-${todayIso()}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        toast(`Sauvegarde téléchargée (${data.donations.length} don(s)).`);
      } catch (e) {
        toast(e.message, 'error');
      } finally {
        btn.disabled = false;
      }
    });

    // --- rapport & export ---
    ['#repTitle', '#repOrg'].forEach((s) => $(s).addEventListener('input', renderPreview));
    ['#optSummary', '#optCharts', '#optDetail', '#optBenef', '#optSign'].forEach((s) =>
      $(s).addEventListener('change', renderPreview));
    $('#btnPdf').addEventListener('click', generatePdf);
    $('#btnCsv').addEventListener('click', exportCsv);

    // --- fermeture des feuilles ---
    $$('.sheet').forEach((sh) => sh.addEventListener('click', (e) => {
      if (e.target === sh || e.target.closest('[data-close]')) {
        if (sh.id === 'sheetPassword' && state.me && state.me.mustChange) return;
        sh.hidden = true;
        document.body.style.overflow = '';
      }
    }));

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const open = $$('.sheet').filter((s) => !s.hidden).pop();
        if (open && !(open.id === 'sheetPassword' && state.me && state.me.mustChange)) {
          open.hidden = true;
          document.body.style.overflow = '';
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n' && state.ready) {
        if (!$$('.sheet').some((s) => !s.hidden)) { e.preventDefault(); openWizard(null); }
      }
    });

    window.addEventListener('scroll', () => {
      document.body.classList.toggle('is-scrolled', window.scrollY > 4);
    }, { passive: true });

    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { if (state.screen === 'stats') renderStats(); }, 200);
    });
  }

  function buildBottomNav() {
    const items = [['dons', 'Dons'], ['stats', 'Stats'], ['rapport', 'Rapport']];
    if (isAdmin()) items.push(['users', 'Comptes'], ['journal', 'Journal']);
    $('#bottomNav').innerHTML = items.map(([key, label]) => {
      const src = $(`.navitem[data-screen="${key}"] svg`);
      return `<button class="navbtn ${key === state.screen ? 'is-active' : ''}" data-screen="${key}">
        ${src ? src.outerHTML : ''}<span>${label}</span></button>`;
    }).join('');
    $$('#bottomNav .navbtn').forEach((b) => b.addEventListener('click', () => goScreen(b.dataset.screen)));
  }

  function applyOrg() {
    $('#orgLabel').textContent = state.settings.org || 'Suivi des dons';
    $('#repOrg').value = state.settings.org || '';
    document.title = state.settings.org ? `DonTrack — ${state.settings.org}` : 'DonTrack';
    syncUnitLabel();
  }

  /* ===================================================== démarrage */

  async function boot2() {
    state.ready = true;
    document.body.classList.remove('is-loading');
    await loadDonations();
    goScreen('dons');
  }

  async function boot() {
    applyTheme(currentTheme());

    let data;
    try {
      data = await api('/api/me');
    } catch (e) {
      return;      // api() a déjà redirigé vers la page de connexion
    }

    state.me = data.user;
    state.settings = data.settings;
    state.draft = newDraft();

    const av = avatarFor(state.me.name);
    $('#meAvatar').textContent = av.initials;
    $('#meAvatar').style.background = av.color;
    $('#meName').textContent = state.me.name;
    $('#meRole').textContent = isAdmin() ? 'Administrateur' : 'Collecteur';

    $$('.admin-only').forEach((el) => { el.hidden = !isAdmin(); });
    applyOrg();
    $('#fDate').value = todayIso();

    bind();
    buildBottomNav();

    if (state.me.mustChange) {
      document.body.classList.remove('is-loading');
      openPasswordSheet(true);
      return;
    }
    await boot2();
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
