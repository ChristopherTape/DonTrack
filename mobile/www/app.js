/* =========================================================================
   DonTrack mobile — interface et interactions

   Le métier (formatage, filtres, agrégats) vient de core.js, partagé avec la
   version desktop. Ce fichier ne s'occupe que du rendu tactile et du flux
   de saisie en deux étapes.
   ========================================================================= */

(function () {
  'use strict';

  const C = window.DTCore;
  const P = window.DTPlatform;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const { TYPES, STATUS_LABEL, uid, escapeHtml, todayIso, fmtNum, fmtShort,
          fmtDate, fmtDateLong, parseAmount, given, statusOf, avatarFor } = C;

  /* ===================================================== état */

  const state = {
    data: C.normalize(null),
    screen: 'dons',
    search: '',
    period: 'all',
    status: 'all',
    expanded: new Set(),
    draft: null,
    editingId: null,
    detailId: null,
    ready: false
  };

  const currency = () => state.data.settings.currency || 'FCFA';
  const fmtMoney = (n) => C.fmtMoney(n, currency());
  const activeFilter = () => ({ period: state.period, search: state.search });
  const filtered = () => C.filterDonations(state.data.donations, activeFilter());
  const periodLabel = () => C.periodLabel(activeFilter());

  /* ===================================================== persistance */

  let saveTimer = null;
  function persist(immediate) {
    clearTimeout(saveTimer);
    const run = () => P.save(state.data).catch((e) => toast('Enregistrement impossible : ' + e.message, 'error'));
    if (immediate) run(); else saveTimer = setTimeout(run, 200);
  }

  /* ===================================================== écran : dons */

  function renderHero() {
    const list = filtered();
    const s = C.computeStats(list);
    const rate = s.total > 0 ? (s.distributed / s.total) * 100 : 0;
    // Sans aucun don, la jauge reste vide : une barre pleine « reste » serait trompeuse.
    const restPct = s.total > 0 ? Math.max(0, 100 - rate) : 0;

    $('#hero').innerHTML = `
      <div class="hero__label">Total collecté${state.period === 'all' ? '' : ' · ' + periodLabel()}</div>
      <div class="hero__value">${fmtNum(s.total)}<small>${escapeHtml(currency())}</small></div>
      <div class="hero__meta">${s.count} don${s.count > 1 ? 's' : ''}${s.count ? ` · moyenne ${fmtNum(s.avg)}` : ''}</div>
      <div class="hero__bar">
        <span style="width:${rate}%;background:var(--series-2)"></span>
        <span style="width:${restPct}%;background:var(--series-3)"></span>
      </div>
      <div class="hero__legend">
        <div><i style="background:var(--series-2)"></i>Réparti <b>${fmtNum(s.distributed)}</b></div>
        <div><i style="background:var(--series-3)"></i>Reste <b>${fmtNum(s.remaining)}</b></div>
      </div>`;
  }

  function renderList() {
    let list = filtered();
    if (state.status !== 'all') list = list.filter((d) => statusOf(d) === state.status);
    list = C.sortDonations(list, { key: 'date', dir: 'desc' });

    const box = $('#donList');
    const empty = $('#donEmpty');

    if (!list.length) {
      box.innerHTML = '';
      empty.hidden = false;
      const vierge = state.data.donations.length === 0;
      $('h3', empty).textContent = vierge ? "Aucun don pour l'instant" : 'Aucun résultat';
      $('p', empty).innerHTML = vierge
        ? 'Appuyez sur <b>+</b> pour enregistrer un premier don et suivre sa répartition.'
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

      let benef = '';
      if (open) {
        const lignes = d.allocations.map((a) => `
          <div class="benefline">
            <span class="benefline__n">${escapeHtml(a.name)}</span>
            <span class="benefline__v">${fmtMoney(a.amount)}</span>
          </div>`).join('');
        const resteLigne = rest > 0.5 ? `
          <div class="benefline benefline--rest">
            <span class="benefline__n">Reste non réparti</span>
            <span class="benefline__v">${fmtMoney(rest)}</span>
          </div>` : '';
        benef = `<div class="doncard__benef">
          ${lignes || '<div class="benefline benefline__more">Aucun bénéficiaire enregistré.</div>'}
          ${resteLigne}
          <div class="benefline benefline__more">Touchez à nouveau pour replier · appui long pour le détail</div>
        </div>`;
      } else if (d.allocations.length) {
        const noms = d.allocations.slice(0, 2).map((a) => a.name).join(', ');
        const reste = d.allocations.length > 2 ? ` +${d.allocations.length - 2}` : '';
        benef = `<div class="doncard__benef"><div class="benefline benefline__more">${escapeHtml(noms)}${reste}</div></div>`;
      }

      return `<article class="doncard" data-id="${d.id}">
        <div class="doncard__top">
          <span class="avatar" style="background:${av.color}">${av.initials}</span>
          <div class="doncard__id">
            <div class="doncard__donor">${escapeHtml(d.donor)}</div>
            <div class="doncard__sub">${fmtDateLong(d.date)} · ${TYPES[d.type] || 'Autre'}</div>
          </div>
          <div class="doncard__amt">
            <b>${fmtNum(d.amount)}</b>
            <span>${escapeHtml(currency())}</span>
          </div>
        </div>
        <div class="doncard__prog">
          <span class="prog"><span style="width:${pct}%;background:${st === 'complete' ? 'var(--good)' : 'var(--series-2)'}"></span></span>
          <span class="doncard__pct">${Math.round(pct)} % réparti</span>
        </div>
        <span class="statuspill statuspill--${st}"><i></i>${STATUS_LABEL[st]}${d.allocations.length ? ` · ${d.allocations.length} bénéf.` : ''}</span>
        ${benef}
      </article>`;
    }).join('');
  }

  /* ===================================================== écran : statistiques */

  function tile(o) {
    return `<div class="tile" style="--tile-color:${o.color}">
      <div class="tile__label">${o.label}</div>
      <div class="tile__value">${o.value}${o.unit ? `<small>${o.unit}</small>` : ''}</div>
      <div class="tile__foot">${o.foot}</div>
    </div>`;
  }

  const shorten = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

  function renderStats() {
    const list = filtered();
    const s = C.computeStats(list);
    const cur = currency();
    const c1 = DTCharts.css('--series-1');
    const c2 = DTCharts.css('--series-2');

    const best = C.topBeneficiaries(list)[0];
    const bestDonor = C.topDonors(list)[0];

    $('#statTiles').innerHTML = [
      tile({ label: 'Dons', color: 'var(--series-1)', value: fmtNum(s.count), foot: `${fmtNum(s.total)} ${cur}` }),
      tile({ label: 'Don moyen', color: 'var(--series-1)', value: fmtNum(s.avg), unit: cur, foot: s.count ? `sur ${s.count} don${s.count > 1 ? 's' : ''}` : '—' }),
      tile({ label: '1er donateur', color: 'var(--series-2)', value: bestDonor ? escapeHtml(shorten(bestDonor.name, 11)) : '—', foot: bestDonor ? `${fmtNum(bestDonor.value)} ${cur}` : 'Aucune donnée' }),
      tile({ label: '1er bénéficiaire', color: 'var(--series-3)', value: best ? escapeHtml(shorten(best.name, 11)) : '—', foot: best ? `${fmtNum(best.value)} ${cur}` : 'Aucune donnée' })
    ].join('');

    DTCharts.meter($('#chartMeter'), { value: s.distributed, total: s.total, fmt: fmtMoney, size: 190 });

    // Sur écran étroit : 6 mois lisibles valent mieux que 12 illisibles.
    const m = C.monthlySeries(list, 6);
    DTCharts.groupedBars($('#chartMonthly'), {
      labels: m.labels,
      series: [
        { key: 'collected', label: 'Collecté', color: c1, values: m.collected },
        { key: 'distributed', label: 'Réparti', color: c2, values: m.distributed }
      ],
      fmt: fmtMoney, fmtShort, height: 210
    });
    DTCharts.dataTable($('#chartMonthly-table'),
      [{ key: 'mois', label: 'Mois' }, { key: 'col', label: 'Collecté', num: true }, { key: 'dis', label: 'Réparti', num: true }],
      m.labels.map((l, i) => ({ mois: l, col: fmtMoney(m.collected[i]), dis: fmtMoney(m.distributed[i]) })));

    const benef = C.topBeneficiaries(list);
    DTCharts.hBars($('#chartBenef'), {
      rows: benef.slice(0, 7).map((b) => ({ label: b.name, value: b.value, meta: `${b.count} attribution${b.count > 1 ? 's' : ''}` })),
      color: c2, fmt: fmtShort
    });
    DTCharts.dataTable($('#chartBenef-table'),
      [{ key: 'n', label: 'Bénéficiaire' }, { key: 'c', label: 'Attr.', num: true }, { key: 'v', label: 'Total', num: true }],
      benef.map((b) => ({ n: escapeHtml(b.name), c: b.count, v: fmtMoney(b.value) })));

    const donors = C.topDonors(list);
    DTCharts.hBars($('#chartDonor'), {
      rows: donors.slice(0, 7).map((b) => ({ label: b.name, value: b.value, meta: `${b.count} don${b.count > 1 ? 's' : ''}` })),
      color: c1, fmt: fmtShort
    });
    DTCharts.dataTable($('#chartDonor-table'),
      [{ key: 'n', label: 'Donateur' }, { key: 'c', label: 'Dons', num: true }, { key: 'v', label: 'Total', num: true }],
      donors.map((b) => ({ n: escapeHtml(b.name), c: b.count, v: fmtMoney(b.value) })));
  }

  /* ===================================================== écran : rapport */

  function reportModel() {
    const list = C.sortDonations(filtered(), { key: 'date', dir: 'asc' });
    const now = new Date();
    return {
      title: $('#repTitle').value.trim() || 'Rapport de répartition des dons',
      org: $('#repOrg').value.trim(),
      logo: window.DT_LOGO || '',
      periodLabel: periodLabel(),
      searchLabel: state.search.trim(),
      generatedAt: `${fmtDate(todayIso())} à ${String(now.getHours()).padStart(2, '0')}h${String(now.getMinutes()).padStart(2, '0')}`,
      stats: C.computeStats(list),
      donations: list,
      monthly: C.monthlySeries(list, 12),
      topBenef: C.topBeneficiaries(list).slice(0, 10).map((b) => ({ label: b.name, value: b.value })),
      allBenef: C.topBeneficiaries(list),
      topDonors: C.topDonors(list),
      options: {
        summary: $('#optSummary').checked,
        charts: $('#optCharts').checked,
        detail: $('#optDetail').checked,
        benef: $('#optBenef').checked,
        sign: $('#optSign').checked
      },
      typeLabel: (t) => TYPES[t] || 'Autre',
      fmt: fmtMoney, fmtShort, fmtDate
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
      $('#reportScope').textContent = state.search.trim()
        ? `Filtré sur « ${state.search.trim()} » · ${periodLabel()}`
        : periodLabel();
    }, 80);
  }

  async function generatePdf() {
    const btn = $('#btnPdf');
    const label = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = 'Préparation…';
    try {
      const doc = DTReport.build(reportModel()).fullDoc;
      const res = await P.printPdf(doc, `DonTrack - rapport ${todayIso()}`);
      if (!res.ok) toast('Impression indisponible.', 'error');
      else if (res.native) toast('Choisissez « Enregistrer au format PDF ».', 'info');
    } catch (e) {
      toast('Erreur : ' + e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = label;
    }
  }

  /* ===================================================== rendu global */

  function renderAll() {
    if (!state.ready) return;
    if (state.screen === 'dons') { renderHero(); renderList(); }
    if (state.screen === 'stats') renderStats();
    if (state.screen === 'rapport') renderPreview();
    refreshDonorList();
  }

  function refreshDonorList() {
    const noms = Array.from(new Set(state.data.donations.map((d) => d.donor.trim()).filter(Boolean))).sort();
    $('#donorList').innerHTML = noms.map((n) => `<option value="${escapeHtml(n)}"></option>`).join('');
  }

  /* ===================================================== feuilles */

  function openSheet(id) {
    $(id).hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeSheet(id) {
    $(id).hidden = true;
    if (!$$('.sheet').some((s) => !s.hidden)) document.body.style.overflow = '';
    DTCharts.hideTip();
  }

  function topSheet() {
    const open = $$('.sheet').filter((s) => !s.hidden);
    return open.length ? open[open.length - 1] : null;
  }

  /** Confirmation en HTML : les boîtes natives ne sont pas accessibles au WebView. */
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

  function newDraft() {
    return { id: null, donor: '', amount: 0, date: todayIso(), type: 'particulier', note: '', allocations: [] };
  }

  function openWizard(existing) {
    state.draft = existing ? JSON.parse(JSON.stringify(existing)) : newDraft();
    state.editingId = existing ? existing.id : null;

    $('#fDonor').value = state.draft.donor;
    $('#fAmount').value = state.draft.amount ? fmtNum(state.draft.amount) : '';
    $('#fDate').value = state.draft.date;
    $('#fType').value = state.draft.type;
    $('#fNote').value = state.draft.note;
    $('#curLabel').textContent = currency();
    $('#donSheetTitle').textContent = existing ? 'Modifier le don' : 'Nouveau don';
    $('#donError').hidden = true;
    $('#allocError').hidden = true;

    $('#quickAmounts').innerHTML = QUICK.map((v) =>
      `<button class="chipbtn" data-amount="${v}">+ ${fmtNum(v)}</button>`).join('');

    gotoStep(1);
    openSheet('#sheetDon');
  }

  function gotoStep(n) {
    const un = n === 1;
    $('#stepDon').hidden = !un;
    $('#stepAlloc').hidden = un;
    $('#btnNext').hidden = !un;
    $('#btnSaveAll').hidden = un;
    $('#btnBack').hidden = un;
    $('#donStepLabel').textContent = `Étape ${n} / 2`;
    $('#stepFill').style.width = (n === 1 ? 50 : 100) + '%';
    $('.sheet__body:not([hidden])', $('#sheetDon')).scrollTop = 0;
    if (!un) renderAllocRows();
  }

  function validateStep1() {
    const donor = $('#fDonor').value.trim();
    const amount = parseAmount($('#fAmount').value);
    const err = $('#donError');

    if (!donor) { err.textContent = 'Indiquez le nom du donateur.'; err.hidden = false; $('#fDonor').focus(); return false; }
    if (amount <= 0) { err.textContent = 'Indiquez un montant supérieur à zéro.'; err.hidden = false; $('#fAmount').focus(); return false; }

    err.hidden = true;
    state.draft.donor = donor;
    state.draft.amount = amount;
    state.draft.date = $('#fDate').value || todayIso();
    state.draft.type = $('#fType').value;
    state.draft.note = $('#fNote').value.trim();
    return true;
  }

  /* --- étape 2 --- */

  function allocRowHtml(a, i) {
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
        <span>${escapeHtml(currency())}</span>
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
      state.data.donations.flatMap((x) => x.allocations.map((a) => a.name.trim())).filter(Boolean))).sort();
    dl.innerHTML = noms.map((n) => `<option value="${escapeHtml(n)}"></option>`).join('');

    updateTotals();
  }

  function readRows() {
    const rows = $$('.alloc-row');
    state.draft.allocations = rows.map((row, i) => ({
      id: (state.draft.allocations[i] && state.draft.allocations[i].id) || uid('ben'),
      name: $('[data-role="name"]', row).value.trim(),
      amount: parseAmount($('[data-role="amount"]', row).value),
      note: (state.draft.allocations[i] && state.draft.allocations[i].note) || ''
    }));
  }

  function updateTotals() {
    readRows();
    const total = state.draft.amount;
    const assigned = state.draft.allocations.reduce((a, x) => a + x.amount, 0);
    const left = total - assigned;
    const pct = total > 0 ? Math.min(100, (assigned / total) * 100) : 0;

    $('#allocTotal').textContent = fmtMoney(total);
    $('#allocAssigned').textContent = fmtMoney(assigned);
    $('#allocLeft').textContent = (left < 0 ? '− ' : '') + fmtMoney(Math.abs(left));
    $('#allocBarFill').style.width = (left < 0 ? 100 : pct) + '%';

    const sum = $('#allocSum');
    sum.classList.toggle('is-full', Math.abs(left) < 0.5 && assigned > 0);
    sum.classList.toggle('is-over', left < -0.5);
    $('.allocsum__left span', sum).textContent =
      Math.abs(left) < 0.5 && assigned > 0 ? 'Tout est réparti' : (left < 0 ? 'Dépassement' : 'Reste à répartir');

    // Part de chaque ligne, mise à jour en direct
    $$('.alloc-row').forEach((row, i) => {
      const a = state.draft.allocations[i];
      const el = $('[data-role="pct"]', row);
      el.textContent = a && a.amount > 0 && total > 0
        ? `${((a.amount / total) * 100).toFixed(a.amount / total < 0.1 ? 1 : 0)} % du don`
        : '';
    });

    if (left < -0.5) {
      $('#allocError').textContent = `La répartition dépasse le don de ${fmtMoney(-left)}.`;
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
    const assigned = clean.reduce((a, x) => a + x.amount, 0);
    const left = d.amount - assigned;
    if (left < -0.5) return;

    if (left > 0.5) {
      const ok = await confirmDialog({
        title: 'Répartition incomplète',
        message: clean.length
          ? `Il reste ${fmtMoney(left)} non réparti sur ce don.`
          : "Ce don n'a encore aucun bénéficiaire.",
        detail: 'Vous pourrez compléter la répartition plus tard.',
        confirmLabel: 'Enregistrer quand même'
      });
      if (!ok) return;
    }

    const now = new Date().toISOString();
    const ancien = state.editingId ? state.data.donations.find((x) => x.id === state.editingId) : null;
    const record = {
      id: state.editingId || uid('don'),
      donor: d.donor,
      type: d.type,
      amount: d.amount,
      date: d.date,
      note: d.note,
      createdAt: (ancien && ancien.createdAt) || now,
      updatedAt: now,
      allocations: clean
    };

    const idx = state.data.donations.findIndex((x) => x.id === record.id);
    if (idx >= 0) state.data.donations[idx] = record;
    else state.data.donations.unshift(record);

    persist(true);
    closeSheet('#sheetDon');
    state.expanded.add(record.id);
    const edition = !!state.editingId;
    state.editingId = null;
    renderAll();
    toast(edition
      ? 'Don modifié.'
      : `Don de ${fmtMoney(record.amount)} enregistré (${clean.length} bénéficiaire${clean.length > 1 ? 's' : ''}).`);
  }

  /* ===================================================== détail */

  function openDetail(id) {
    const d = state.data.donations.find((x) => x.id === id);
    if (!d) return;
    state.detailId = id;

    const g = given(d);
    const rest = d.amount - g;
    const av = avatarFor(d.donor);
    const st = statusOf(d);

    $('#detailBody').innerHTML = `
      <div class="detail-head">
        <span class="avatar" style="background:${av.color}">${av.initials}</span>
        <div class="detail-head__n">
          <b>${escapeHtml(d.donor)}</b>
          <span>${TYPES[d.type] || 'Autre'} · ${fmtDateLong(d.date)}</span>
        </div>
      </div>

      <div class="detail-amount">
        <b>${fmtMoney(d.amount)}</b>
        <span class="statuspill statuspill--${st}"><i></i>${STATUS_LABEL[st]}</span>
      </div>

      <div class="detail-grid">
        <div><span>Réparti</span><b>${fmtMoney(g)}</b></div>
        <div><span>Reste</span><b>${fmtMoney(Math.max(0, rest))}</b></div>
        <div><span>Bénéficiaires</span><b>${d.allocations.length}</b></div>
        <div><span>Enregistré le</span><b>${fmtDate((d.createdAt || '').slice(0, 10))}</b></div>
      </div>

      ${d.note ? `<p class="hint">« ${escapeHtml(d.note)} »</p>` : ''}

      <div class="sectionlabel">Répartition</div>
      <div class="detail-list">
        ${d.allocations.length ? d.allocations.map((a, i) => `
          <div class="detail-item">
            <span class="alloc-row__idx">${i + 1}</span>
            <div class="detail-item__n">${escapeHtml(a.name)}${a.note ? `<small>${escapeHtml(a.note)}</small>` : ''}</div>
            <div class="detail-item__v">${fmtMoney(a.amount)}<small>${d.amount > 0 ? Math.round((a.amount / d.amount) * 100) : 0} %</small></div>
          </div>`).join('') : '<div class="detail-item"><div class="detail-item__n">Aucun bénéficiaire enregistré.</div></div>'}
        ${rest > 0.5 ? `
          <div class="detail-item detail-item--rest">
            <div class="detail-item__n">Reste non réparti</div>
            <div class="detail-item__v">${fmtMoney(rest)}<small>${Math.round((rest / d.amount) * 100)} %</small></div>
          </div>` : ''}
      </div>`;

    openSheet('#sheetDetail');
  }

  async function deleteDon(id) {
    const d = state.data.donations.find((x) => x.id === id);
    if (!d) return;
    const ok = await confirmDialog({
      title: 'Supprimer le don',
      message: `Supprimer le don de ${d.donor} (${fmtMoney(d.amount)}) ?`,
      detail: `Les ${d.allocations.length} ligne(s) de répartition seront également supprimées.`,
      confirmLabel: 'Supprimer',
      danger: true
    });
    if (!ok) return;
    state.data.donations = state.data.donations.filter((x) => x.id !== id);
    state.expanded.delete(id);
    persist(true);
    closeSheet('#sheetDetail');
    renderAll();
    toast('Don supprimé.', 'info');
  }

  /* ===================================================== exports */

  async function exportCsv() {
    const list = C.sortDonations(filtered(), { key: 'date', dir: 'desc' });
    if (!list.length) { toast('Aucune donnée à exporter.', 'error'); return; }
    const res = await P.exportFile(`dons-${todayIso()}.csv`, 'text/csv', '﻿' + C.toCsv(list));
    toast(res.ok ? 'CSV enregistré dans Téléchargements.' : 'Export impossible.', res.ok ? '' : 'error');
  }

  async function exportBackup() {
    const res = await P.exportFile(`dontrack-sauvegarde-${todayIso()}.json`,
      'application/json', JSON.stringify(state.data, null, 2));
    toast(res.ok ? 'Sauvegarde enregistrée dans Téléchargements.' : 'Export impossible.', res.ok ? '' : 'error');
  }

  async function importBackup() {
    const text = await P.importFile();
    if (!text) return;
    let parsed;
    try { parsed = C.normalize(JSON.parse(text)); } catch (e) { toast('Fichier illisible.', 'error'); return; }
    const ok = await confirmDialog({
      title: 'Importer une sauvegarde',
      message: `Remplacer les données actuelles par ${parsed.donations.length} don(s) importé(s) ?`,
      detail: 'Les données actuelles de l\'appareil seront écrasées.',
      confirmLabel: 'Remplacer',
      danger: true
    });
    if (!ok) return;
    state.data = parsed;
    persist(true);
    applyTheme(state.data.settings.theme || 'dark');
    $('#orgLabel').textContent = state.data.settings.org || 'Suivi des dons';
    closeSheet('#sheetSettings');
    renderAll();
    toast(`${parsed.donations.length} don(s) importé(s).`);
  }

  /* ===================================================== toasts & thème */

  function toast(msg, kind) {
    const el = document.createElement('div');
    el.className = 'toast' + (kind ? ' toast--' + kind : '');
    el.innerHTML = `<span class="toast__dot"></span><span>${escapeHtml(msg)}</span>`;
    $('#toasts').appendChild(el);
    setTimeout(() => {
      el.classList.add('is-out');
      setTimeout(() => el.remove(), 220);
    }, 3600);
  }

  function applyTheme(theme) {
    const light = theme === 'light';
    document.documentElement.setAttribute('data-theme', light ? 'light' : 'dark');
    state.data.settings.theme = light ? 'light' : 'dark';
    // Les barres systeme suivent le theme de l'application.
    try {
      if (window.AndroidBridge && window.AndroidBridge.setThemeColor) {
        window.AndroidBridge.setThemeColor(light ? '#EEF1F7' : '#0D111B', light);
      }
    } catch (_) { /* navigateur */ }
    if (state.screen === 'stats') renderStats();
  }

  /* ===================================================== navigation */

  function goScreen(name) {
    state.screen = name;
    $$('.navbtn').forEach((b) => b.classList.toggle('is-active', b.dataset.screen === name));
    $$('.screen').forEach((s) => s.classList.toggle('is-active', s.id === 'screen-' + name));
    $('#fab').hidden = name !== 'dons';
    window.scrollTo(0, 0);
    renderAll();
  }

  /** Bouton « retour » d'Android : ferme la couche du dessus avant de quitter. */
  function handleBack() {
    const sheet = topSheet();
    if (sheet) {
      if (sheet.id === 'dialogConfirm') { $('#cfCancel').click(); return true; }
      if (sheet.id === 'sheetDon' && $('#btnBack').hidden === false) { readRows(); gotoStep(1); return true; }
      sheet.hidden = true;
      document.body.style.overflow = '';
      return true;
    }
    if (!$('#filters').hidden) { toggleFilters(false); return true; }
    if (state.screen !== 'dons') { goScreen('dons'); return true; }
    return false;
  }

  function toggleFilters(force) {
    const box = $('#filters');
    const show = force === undefined ? box.hidden : force;
    box.hidden = !show;
    document.body.classList.toggle('filters-open', show);
    if (show) setTimeout(() => $('#search').focus(), 60);
  }

  /* ===================================================== évènements */

  function bind() {
    $$('.navbtn').forEach((b) => b.addEventListener('click', () => goScreen(b.dataset.screen)));
    $('#fab').addEventListener('click', () => openWizard(null));
    $('#btnSearch').addEventListener('click', () => toggleFilters());
    $('#btnSettings').addEventListener('click', openSettings);

    let searchTimer = null;
    $('#search').addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { state.search = e.target.value; renderAll(); }, 160);
    });
    $('#btnClearSearch').addEventListener('click', () => {
      $('#search').value = '';
      state.search = '';
      renderAll();
    });

    $('#periodChips').addEventListener('click', (e) => {
      const b = e.target.closest('[data-period]');
      if (!b) return;
      state.period = b.dataset.period;
      $$('#periodChips .chipbtn').forEach((x) => x.classList.toggle('is-active', x === b));
      renderAll();
    });

    $('#statusChips').addEventListener('click', (e) => {
      const b = e.target.closest('[data-status]');
      if (!b) return;
      state.status = b.dataset.status;
      $$('#statusChips .chipbtn').forEach((x) => x.classList.toggle('is-active', x === b));
      renderList();
    });

    // Appui court : déplier / replier. Appui long : fiche détaillée.
    let longTimer = null;
    let longFired = false;
    const list = $('#donList');
    list.addEventListener('pointerdown', (e) => {
      const card = e.target.closest('.doncard');
      if (!card) return;
      longFired = false;
      longTimer = setTimeout(() => { longFired = true; openDetail(card.dataset.id); }, 520);
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) =>
      list.addEventListener(ev, () => clearTimeout(longTimer)));
    list.addEventListener('click', (e) => {
      const card = e.target.closest('.doncard');
      if (!card || longFired) return;
      const id = card.dataset.id;
      if (state.expanded.has(id)) state.expanded.delete(id); else state.expanded.add(id);
      renderList();
    });

    $$('.toggle-table').forEach((b) => b.addEventListener('click', () => {
      const chart = $('#' + b.dataset.target);
      const table = $('#' + b.dataset.target + '-table');
      const show = table.hidden;
      table.hidden = !show;
      chart.hidden = show;
      b.textContent = show ? 'Voir le graphique' : 'Voir le tableau';
    }));

    // Assistant
    $('#btnNext').addEventListener('click', () => { if (validateStep1()) gotoStep(2); });
    $('#btnBack').addEventListener('click', () => { readRows(); gotoStep(1); });
    $('#btnSaveAll').addEventListener('click', saveDon);
    $('#btnAddRow').addEventListener('click', () => addRow(true));

    $('#quickAmounts').addEventListener('click', (e) => {
      const b = e.target.closest('[data-amount]');
      if (!b) return;
      const courant = parseAmount($('#fAmount').value);
      $('#fAmount').value = fmtNum(courant + Number(b.dataset.amount));
    });

    $('#fAmount').addEventListener('blur', (e) => {
      const v = parseAmount(e.target.value);
      e.target.value = v ? fmtNum(v) : '';
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

    // Détail
    $('#btnEdit').addEventListener('click', () => {
      const d = state.data.donations.find((x) => x.id === state.detailId);
      closeSheet('#sheetDetail');
      if (d) openWizard(d);
    });
    $('#btnDelete').addEventListener('click', () => deleteDon(state.detailId));

    // Fermeture générique
    $$('.sheet').forEach((sh) => sh.addEventListener('click', (e) => {
      if (e.target === sh || e.target.closest('[data-close]')) {
        sh.hidden = true;
        document.body.style.overflow = '';
      }
    }));

    // Paramètres
    $('#btnSaveSettings').addEventListener('click', () => {
      state.data.settings.org = $('#sOrg').value.trim();
      state.data.settings.currency = $('#sCurrency').value.trim() || 'FCFA';
      applyTheme($('#sTheme').value);
      persist(true);
      $('#orgLabel').textContent = state.data.settings.org || 'Suivi des dons';
      $('#repOrg').value = state.data.settings.org;
      $('#curLabel').textContent = currency();
      closeSheet('#sheetSettings');
      renderAll();
      toast('Paramètres enregistrés.');
    });
    $('#btnImport').addEventListener('click', importBackup);

    // Rapport & exports
    ['#repTitle', '#repOrg'].forEach((s) => $(s).addEventListener('input', renderPreview));
    ['#optSummary', '#optCharts', '#optDetail', '#optBenef', '#optSign'].forEach((s) =>
      $(s).addEventListener('change', renderPreview));
    $('#btnPdf').addEventListener('click', generatePdf);
    $('#btnCsv').addEventListener('click', exportCsv);
    $('#btnBackup').addEventListener('click', exportBackup);

    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { if (state.screen === 'stats') renderStats(); }, 200);
    });
  }

  function openSettings() {
    $('#sOrg').value = state.data.settings.org || '';
    $('#sCurrency').value = currency();
    $('#sTheme').value = state.data.settings.theme || 'dark';
    $('#appVersion').textContent = P.version();
    $('#dataInfo').textContent = `${state.data.donations.length} don(s) enregistré(s) sur cet appareil.`;
    openSheet('#sheetSettings');
  }

  /* ===================================================== démarrage */

  async function boot() {
    const stored = await P.load();
    state.data = C.normalize(stored);
    state.ready = true;

    applyTheme(state.data.settings.theme || 'dark');
    $('#orgLabel').textContent = state.data.settings.org || 'Suivi des dons';
    $('#repOrg').value = state.data.settings.org || '';
    $('#curLabel').textContent = currency();
    $('#fDate').value = todayIso();

    bind();
    goScreen('dons');
  }

  // Exposé à Android (bouton retour matériel).
  window.DTApp = { back: handleBack, reload: () => renderAll() };

  document.addEventListener('DOMContentLoaded', boot);
})();
