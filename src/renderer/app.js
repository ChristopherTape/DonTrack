/* =========================================================================
   DonTrack — logique de l'application (renderer)
   ========================================================================= */

(function () {
  'use strict';

  const api = window.dontrack;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /* ===================================================== état */

  const state = {
    data: { version: 1, settings: { org: '', currency: 'FCFA', theme: 'dark' }, donations: [] },
    info: { logo: '', dataFile: '', version: '' },
    view: 'dashboard',
    search: '',
    period: 'all',
    from: '',
    to: '',
    status: 'all',
    sort: { key: 'date', dir: 'desc' },
    expanded: new Set(),
    draft: null,
    editingId: null,
    detailId: null
  };

  /* ===================================================== noyau partagé */

  // Formatage, filtres et agrégats vivent dans src/shared/core.js, utilisés
  // tels quels par la version mobile. On garde ici des alias courts.
  const C = window.DTCore;
  const { TYPES, STATUS_LABEL, uid, escapeHtml, todayIso, fmtNum, fmtShort,
          fmtDate, parseAmount, given, statusOf, computeStats, monthlySeries,
          topBeneficiaries, topDonors, avatarFor } = C;

  const currency = () => state.data.settings.currency || 'FCFA';
  const fmtMoney = (n) => C.fmtMoney(n, currency());

  const activeFilter = () => ({
    period: state.period, from: state.from, to: state.to, search: state.search
  });

  const periodLabel = () => C.periodLabel(activeFilter());
  const filtered = () => C.filterDonations(state.data.donations, activeFilter());
  const sortList = (list) => C.sortDonations(list, state.sort);

  /* ===================================================== persistance */

  let saveTimer = null;
  function persist(immediate) {
    clearTimeout(saveTimer);
    const run = () => api.write(state.data).catch((e) => toast('Enregistrement impossible : ' + e.message, 'error'));
    if (immediate) run(); else saveTimer = setTimeout(run, 250);
  }

  /* ===================================================== rendu : tuiles */

  function tile(o) {
    return `<div class="tile" style="--tile-color:${o.color}">
      <div class="tile__label"><span class="dot"></span>${o.label}</div>
      <div class="tile__value">${o.value}${o.unit ? `<small>${o.unit}</small>` : ''}</div>
      ${o.foot ? `<div class="tile__foot">${o.foot}</div>` : ''}
      ${o.bar !== undefined ? `<div class="tile__bar"><span style="width:${Math.max(0, Math.min(100, o.bar))}%"></span></div>` : ''}
    </div>`;
  }

  function renderTiles() {
    const list = filtered();
    const s = computeStats(list);
    const rate = s.total > 0 ? (s.distributed / s.total) * 100 : 0;
    const cur = currency();

    $('#tiles').innerHTML = [
      tile({
        label: 'Total collecté', color: 'var(--series-1)',
        value: fmtNum(s.total), unit: cur,
        foot: `${s.count} don${s.count > 1 ? 's' : ''} · moyenne ${fmtNum(s.avg)} ${cur}`
      }),
      tile({
        label: 'Total réparti', color: 'var(--series-2)',
        value: fmtNum(s.distributed), unit: cur,
        foot: `${rate.toFixed(0)} % des fonds distribués`, bar: rate
      }),
      tile({
        label: 'Reste à répartir', color: 'var(--series-3)',
        value: fmtNum(s.remaining), unit: cur,
        foot: s.partialCount ? `${s.partialCount} don${s.partialCount > 1 ? 's' : ''} à compléter` : 'Tout est réparti'
      }),
      tile({
        label: 'Bénéficiaires', color: 'var(--text-3)',
        value: fmtNum(s.beneficiaries),
        foot: `${s.allocations} attribution${s.allocations > 1 ? 's' : ''} au total`
      })
    ].join('');

    $('#filterCount').textContent = `${s.count} don${s.count > 1 ? 's' : ''} · ${fmtMoney(s.total)}`;
  }

  /* ===================================================== rendu : tableau */

  function renderTable() {
    let list = filtered();
    if (state.status !== 'all') list = list.filter((d) => statusOf(d) === state.status);
    list = sortList(list);

    const tbody = $('#donTbody');
    const empty = $('#donEmpty');
    const table = $('#donTable');

    if (!list.length) {
      tbody.innerHTML = '';
      table.hidden = true;
      empty.hidden = false;
      const noData = state.data.donations.length === 0;
      $('h3', empty).textContent = noData ? "Aucun don pour l'instant" : 'Aucun résultat';
      $('p', empty).textContent = noData
        ? 'Enregistrez un premier don pour démarrer le suivi de sa répartition.'
        : 'Aucun don ne correspond aux filtres actifs.';
      $('button', empty).hidden = !noData;
      return;
    }
    table.hidden = false;
    empty.hidden = true;

    const rows = [];
    list.forEach((d) => {
      const g = Math.min(given(d), d.amount);
      const pct = d.amount > 0 ? (g / d.amount) * 100 : 0;
      const st = statusOf(d);
      const av = avatarFor(d.donor);
      const open = state.expanded.has(d.id);

      rows.push(`<tr data-id="${d.id}" class="${open ? 'is-open' : ''}">
        <td>${fmtDate(d.date)}</td>
        <td>
          <div class="cell-donor">
            <span class="avatar" style="background:${av.color}">${av.initials}</span>
            <div>
              <div class="cell-donor__name">${escapeHtml(d.donor)}</div>
              ${d.note ? `<div class="cell-donor__note">${escapeHtml(d.note)}</div>` : ''}
            </div>
          </div>
        </td>
        <td><span class="chip">${TYPES[d.type] || 'Autre'}</span></td>
        <td class="num"><b>${fmtNum(d.amount)}</b></td>
        <td class="num">${fmtNum(g)}</td>
        <td>
          <div class="progress">
            <span class="progress__track"><span class="progress__fill" style="width:${pct}%;background:${st === 'complete' ? 'var(--good)' : 'var(--series-2)'}"></span></span>
            <span class="progress__pct">${Math.round(pct)}%</span>
          </div>
        </td>
        <td class="num">${d.allocations.length}</td>
        <td class="col-actions">
          <button class="iconbtn" data-detail="${d.id}" title="Détail et modification" aria-label="Détail">
            <svg viewBox="0 0 20 20"><circle cx="4.5" cy="10" r="1.3"/><circle cx="10" cy="10" r="1.3"/><circle cx="15.5" cy="10" r="1.3"/></svg>
          </button>
        </td>
      </tr>`);

      if (open) {
        const rest = d.amount - given(d);
        const lines = d.allocations.map((a) => `<div class="detail-line">
            <span class="detail-line__name">${escapeHtml(a.name)}${a.note ? ` <span style="color:var(--text-3)">— ${escapeHtml(a.note)}</span>` : ''}</span>
            <span class="detail-line__amt">${fmtMoney(a.amount)}</span>
            <span class="detail-line__pct">${d.amount > 0 ? Math.round((a.amount / d.amount) * 100) : 0} %</span>
          </div>`).join('');
        const restLine = rest > 0.5
          ? `<div class="detail-line detail-line--rest">
               <span class="detail-line__name">Reste non réparti</span>
               <span class="detail-line__amt">${fmtMoney(rest)}</span>
               <span class="detail-line__pct">${Math.round((rest / d.amount) * 100)} %</span>
             </div>` : '';
        rows.push(`<tr class="row-detail"><td colspan="8"><div class="detail-inner">
          ${lines || '<div class="detail-line" style="color:var(--text-3)">Aucun bénéficiaire enregistré pour ce don.</div>'}
          ${restLine}
        </div></td></tr>`);
      }
    });

    tbody.innerHTML = rows.join('');
    $('#tableSub').textContent = `${list.length} don${list.length > 1 ? 's' : ''} affiché${list.length > 1 ? 's' : ''} · cliquez sur une ligne pour voir la répartition`;

    $$('.th-sort').forEach((th) => {
      const on = th.dataset.sort === state.sort.key;
      th.classList.toggle('is-sorted', on);
      th.classList.toggle('is-asc', on && state.sort.dir === 'asc');
    });
  }

  /* ===================================================== rendu : statistiques */

  function renderStats() {
    const list = filtered();
    const s = computeStats(list);
    const cur = currency();
    const c1 = DTCharts.css('--series-1');
    const c2 = DTCharts.css('--series-2');

    const best = topBeneficiaries(list)[0];
    const bestDonor = topDonors(list)[0];
    $('#statTiles').innerHTML = [
      tile({ label: 'Dons sur la période', color: 'var(--series-1)', value: fmtNum(s.count), foot: `${fmtNum(s.total)} ${cur} collectés` }),
      tile({ label: 'Don moyen', color: 'var(--series-1)', value: fmtNum(s.avg), unit: cur, foot: s.count ? `sur ${s.count} don${s.count > 1 ? 's' : ''}` : '—' }),
      tile({ label: 'Premier donateur', color: 'var(--series-2)', value: bestDonor ? escapeHtml(shorten(bestDonor.name, 14)) : '—', foot: bestDonor ? `${fmtNum(bestDonor.value)} ${cur} · ${bestDonor.count} don${bestDonor.count > 1 ? 's' : ''}` : 'Aucune donnée' }),
      tile({ label: 'Premier bénéficiaire', color: 'var(--series-3)', value: best ? escapeHtml(shorten(best.name, 14)) : '—', foot: best ? `${fmtNum(best.value)} ${cur} · ${best.count} attribution${best.count > 1 ? 's' : ''}` : 'Aucune donnée' })
    ].join('');

    const m = monthlySeries(list, 12);
    DTCharts.groupedBars($('#chartMonthly'), {
      labels: m.labels,
      series: [
        { key: 'collected', label: 'Collecté', color: c1, values: m.collected },
        { key: 'distributed', label: 'Réparti', color: c2, values: m.distributed }
      ],
      fmt: fmtMoney, fmtShort
    });
    DTCharts.dataTable($('#chartMonthly-table'),
      [{ key: 'mois', label: 'Mois' }, { key: 'col', label: 'Collecté', num: true }, { key: 'dis', label: 'Réparti', num: true }],
      m.labels.map((l, i) => ({ mois: l, col: fmtMoney(m.collected[i]), dis: fmtMoney(m.distributed[i]) }))
    );

    DTCharts.meter($('#chartMeter'), { value: s.distributed, total: s.total, fmt: fmtMoney });

    const benef = topBeneficiaries(list);
    DTCharts.hBars($('#chartBenef'), {
      rows: benef.slice(0, 10).map((b) => ({ label: b.name, value: b.value, meta: `${b.count} attribution${b.count > 1 ? 's' : ''}` })),
      color: c2, fmt: fmtShort
    });
    DTCharts.dataTable($('#chartBenef-table'),
      [{ key: 'n', label: 'Bénéficiaire' }, { key: 'c', label: 'Attributions', num: true }, { key: 'v', label: 'Total reçu', num: true }],
      benef.map((b) => ({ n: escapeHtml(b.name), c: b.count, v: fmtMoney(b.value) }))
    );

    const donors = topDonors(list);
    DTCharts.hBars($('#chartDonor'), {
      rows: donors.slice(0, 10).map((b) => ({ label: b.name, value: b.value, meta: `${b.count} don${b.count > 1 ? 's' : ''}` })),
      color: c1, fmt: fmtShort
    });
    DTCharts.dataTable($('#chartDonor-table'),
      [{ key: 'n', label: 'Donateur' }, { key: 'c', label: 'Dons', num: true }, { key: 'v', label: 'Total donné', num: true }],
      donors.map((b) => ({ n: escapeHtml(b.name), c: b.count, v: fmtMoney(b.value) }))
    );
  }

  function shorten(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  /* ===================================================== rendu : rapport */

  function reportOptions() {
    return {
      summary: $('#optSummary').checked,
      charts: $('#optCharts').checked,
      detail: $('#optDetail').checked,
      benef: $('#optBenef').checked,
      sign: $('#optSign').checked
    };
  }

  function buildReportModel() {
    const list = sortList(filtered()).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const s = computeStats(list);
    const now = new Date();
    return {
      title: $('#repTitle').value.trim() || 'Rapport de répartition des dons',
      org: $('#repOrg').value.trim(),
      logo: state.info.logo,
      periodLabel: periodLabel(),
      searchLabel: state.search.trim(),
      generatedAt: `${fmtDate(todayIso())} à ${String(now.getHours()).padStart(2, '0')}h${String(now.getMinutes()).padStart(2, '0')}`,
      stats: s,
      donations: list,
      monthly: monthlySeries(list, 12),
      topBenef: topBeneficiaries(list).slice(0, 10).map((b) => ({ label: b.name, value: b.value })),
      allBenef: topBeneficiaries(list),
      topDonors: topDonors(list),
      options: reportOptions(),
      typeLabel: (t) => TYPES[t] || 'Autre',
      fmt: fmtMoney, fmtShort, fmtDate
    };
  }

  let previewTimer = null;
  function renderPreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      const model = buildReportModel();
      const r = DTReport.build(model);
      $('#repPreview').innerHTML = `<style>${r.css}</style><div class="rpt">${r.body}</div>`;
      $('#previewSub').textContent = `${model.donations.length} don${model.donations.length > 1 ? 's' : ''} · ${periodLabel()}`;
    }, 60);
  }

  /* ===================================================== rendu global */

  function renderAll() {
    renderTiles();
    if (state.view === 'dashboard') renderTable();
    if (state.view === 'stats') renderStats();
    if (state.view === 'reports') renderPreview();
    refreshDonorList();
  }

  function refreshDonorList() {
    const names = Array.from(new Set(state.data.donations.map((d) => d.donor.trim()).filter(Boolean))).sort();
    $('#donorList').innerHTML = names.map((n) => `<option value="${escapeHtml(n)}"></option>`).join('');
  }

  /* ===================================================== modales : socle */

  function openModal(id) {
    const m = $(id);
    m.hidden = false;
    const first = m.querySelector('input, select, button.btn--primary');
    if (first) setTimeout(() => first.focus(), 40);
  }

  function closeModal(id) {
    $(id).hidden = true;
    DTCharts.hideTip();
  }

  function topModal() {
    const open = $$('.overlay').filter((o) => !o.hidden);
    return open.length ? open[open.length - 1] : null;
  }

  /* ===================================================== assistant : don */

  function newDraft() {
    return {
      id: null,
      donor: '',
      amount: 0,
      date: todayIso(),
      type: 'particulier',
      note: '',
      allocations: []
    };
  }

  function openDonWizard(existing) {
    state.draft = existing ? structuredClone(existing) : newDraft();
    state.editingId = existing ? existing.id : null;

    $('#fDonor').value = state.draft.donor;
    $('#fAmount').value = state.draft.amount ? fmtNum(state.draft.amount) : '';
    $('#fDate').value = state.draft.date;
    $('#fType').value = state.draft.type;
    $('#fNote').value = state.draft.note;
    $('#curLabel').textContent = currency();
    $('#donModalTitle').textContent = existing ? 'Modifier le don' : 'Enregistrer un don';
    $('#donError').hidden = true;
    $('#allocError').hidden = true;

    gotoStep(1);
    openModal('#modalDon');
  }

  function gotoStep(n) {
    const isOne = n === 1;
    $('#stepDon').hidden = !isOne;
    $('#stepAlloc').hidden = isOne;
    $('#btnNext').hidden = !isOne;
    $('#btnSaveAll').hidden = isOne;
    $('#btnBack').hidden = isOne;

    $$('.step').forEach((s) => {
      const idx = Number(s.dataset.step);
      s.classList.toggle('is-active', idx === n);
      s.classList.toggle('is-done', idx < n);
    });

    if (isOne) {
      setTimeout(() => $('#fDonor').focus(), 40);
    } else {
      renderAllocRows();
      setTimeout(() => {
        const first = $('.alloc-row input[data-role="name"]');
        if (first) first.focus();
      }, 40);
    }
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

  /* --- étape 2 : lignes de répartition --- */

  function allocRowHtml(a, i) {
    return `<div class="alloc-row" data-idx="${i}">
      <span class="alloc-row__idx">${i + 1}</span>
      <input type="text" data-role="name" placeholder="Nom du bénéficiaire ${i + 1}" value="${escapeHtml(a.name)}" autocomplete="off" list="benefList" />
      <div class="amount-input">
        <input type="text" inputmode="numeric" data-role="amount" placeholder="0" value="${a.amount ? fmtNum(a.amount) : ''}" />
        <span class="amount-input__cur">${escapeHtml(currency())}</span>
      </div>
      <button class="iconbtn" data-role="remove" title="Retirer" aria-label="Retirer">
        <svg viewBox="0 0 20 20"><path d="M5 5l10 10M15 5L5 15"/></svg>
      </button>
    </div>`;
  }

  function renderAllocRows() {
    const d = state.draft;
    if (!d.allocations.length) d.allocations = [{ id: uid('ben'), name: '', amount: 0, note: '' }];

    $('#allocDonor').textContent = `${d.donor} · ${fmtMoney(d.amount)} · ${fmtDate(d.date)}`;
    $('#allocList').innerHTML = d.allocations.map(allocRowHtml).join('');

    // Suggestions de bénéficiaires déjà connus
    const names = Array.from(new Set(
      state.data.donations.flatMap((x) => x.allocations.map((a) => a.name.trim())).filter(Boolean)
    )).sort();
    let dl = $('#benefList');
    if (!dl) {
      dl = document.createElement('datalist');
      dl.id = 'benefList';
      document.body.appendChild(dl);
    }
    dl.innerHTML = names.map((n) => `<option value="${escapeHtml(n)}"></option>`).join('');

    updateAllocTotals();
  }

  function readAllocRows() {
    const rows = $$('.alloc-row');
    state.draft.allocations = rows.map((row, i) => ({
      id: state.draft.allocations[i] && state.draft.allocations[i].id ? state.draft.allocations[i].id : uid('ben'),
      name: $('[data-role="name"]', row).value.trim(),
      amount: parseAmount($('[data-role="amount"]', row).value),
      note: (state.draft.allocations[i] && state.draft.allocations[i].note) || ''
    }));
  }

  function updateAllocTotals() {
    readAllocRows();
    const total = state.draft.amount;
    const assigned = state.draft.allocations.reduce((a, x) => a + x.amount, 0);
    const left = total - assigned;
    const pct = total > 0 ? Math.min(100, (assigned / total) * 100) : 0;

    $('#allocTotal').textContent = fmtNum(total);
    $('#allocAssigned').textContent = fmtNum(assigned);
    $('#allocLeft').textContent = (left < 0 ? '−' : '') + fmtNum(Math.abs(left));

    const box = $('#allocLeftBox');
    box.classList.toggle('is-zero', Math.abs(left) < 0.5);
    box.classList.toggle('is-over', left < -0.5);

    const bar = $('.allocbar');
    bar.classList.toggle('is-over', left < -0.5);
    bar.classList.toggle('is-full', Math.abs(left) < 0.5 && assigned > 0);
    $('#allocBarFill').style.width = (left < 0 ? 100 : pct) + '%';

    if (left < -0.5) {
      $('#allocError').textContent = `La répartition dépasse le montant du don de ${fmtMoney(-left)}.`;
      $('#allocError').hidden = false;
    } else {
      $('#allocError').hidden = true;
    }
    $('#btnSaveAll').disabled = left < -0.5;
  }

  function addAllocRow(focus) {
    readAllocRows();
    state.draft.allocations.push({ id: uid('ben'), name: '', amount: 0, note: '' });
    renderAllocRows();
    if (focus !== false) {
      const rows = $$('.alloc-row');
      const last = rows[rows.length - 1];
      if (last) $('[data-role="name"]', last).focus();
    }
  }

  async function saveDon() {
    readAllocRows();
    const d = state.draft;

    // Lignes incomplètes : un nom sans montant ou un montant sans nom.
    const bad = d.allocations.findIndex((a) => (a.name && a.amount <= 0) || (!a.name && a.amount > 0));
    if (bad >= 0) {
      const row = $$('.alloc-row')[bad];
      if (row) { row.classList.add('is-invalid'); $('[data-role="name"]', row).focus(); }
      $('#allocError').textContent = `Ligne ${bad + 1} : indiquez à la fois un nom et un montant.`;
      $('#allocError').hidden = false;
      return;
    }

    const clean = d.allocations.filter((a) => a.name && a.amount > 0);
    const assigned = clean.reduce((a, x) => a + x.amount, 0);
    const left = d.amount - assigned;

    if (left < -0.5) return;

    if (left > 0.5) {
      const ok = await api.confirm({
        title: 'Répartition incomplète',
        message: clean.length
          ? `Il reste ${fmtMoney(left)} non réparti sur ce don.`
          : `Ce don n'a encore aucun bénéficiaire.`,
        detail: 'Vous pourrez compléter la répartition plus tard depuis le tableau de bord.',
        confirmLabel: 'Enregistrer quand même'
      });
      if (!ok) return;
    }

    const now = new Date().toISOString();
    const record = {
      id: state.editingId || uid('don'),
      donor: d.donor,
      type: d.type,
      amount: d.amount,
      date: d.date,
      note: d.note,
      createdAt: state.editingId ? (state.data.donations.find((x) => x.id === state.editingId) || {}).createdAt || now : now,
      updatedAt: now,
      allocations: clean
    };

    const idx = state.data.donations.findIndex((x) => x.id === record.id);
    if (idx >= 0) state.data.donations[idx] = record;
    else state.data.donations.unshift(record);

    persist(true);
    closeModal('#modalDon');
    state.expanded.add(record.id);
    renderAll();
    toast(state.editingId ? 'Don modifié.' : `Don de ${fmtMoney(record.amount)} enregistré (${clean.length} bénéficiaire${clean.length > 1 ? 's' : ''}).`);
    state.editingId = null;
  }

  /* ===================================================== modale : détail */

  function openDetail(id) {
    const d = state.data.donations.find((x) => x.id === id);
    if (!d) return;
    state.detailId = id;

    const g = given(d);
    const rest = d.amount - g;
    const av = avatarFor(d.donor);
    const st = statusOf(d);
    const stLabel = STATUS_LABEL[st];

    $('#detailBody').innerHTML = `
      <div class="detail-head">
        <span class="avatar" style="background:${av.color};width:40px;height:40px;border-radius:12px;font-size:14px">${av.initials}</span>
        <div>
          <div style="font-size:16px;font-weight:640">${escapeHtml(d.donor)}</div>
          <div style="color:var(--text-3);font-size:12.5px">${TYPES[d.type] || 'Autre'} · ${fmtDate(d.date)}</div>
        </div>
        <div class="detail-head__amt">
          <b>${fmtMoney(d.amount)}</b>
          <span class="chip chip--${st}">${stLabel}</span>
        </div>
      </div>
      <div class="detail-meta">
        <div><span>Réparti</span>${fmtMoney(g)}</div>
        <div><span>Reste</span>${fmtMoney(Math.max(0, rest))}</div>
        <div><span>Bénéficiaires</span>${d.allocations.length}</div>
        <div><span>Enregistré le</span>${fmtDate((d.createdAt || '').slice(0, 10))}</div>
      </div>
      ${d.note ? `<p class="hint" style="margin-bottom:14px">« ${escapeHtml(d.note)} »</p>` : ''}
      <div class="detail-inner" style="border-left-color:var(--series-2)">
        ${d.allocations.length ? d.allocations.map((a, i) => `<div class="detail-line">
            <span class="alloc-row__idx">${i + 1}</span>
            <span class="detail-line__name">${escapeHtml(a.name)}</span>
            <span class="detail-line__amt">${fmtMoney(a.amount)}</span>
            <span class="detail-line__pct">${d.amount > 0 ? Math.round((a.amount / d.amount) * 100) : 0} %</span>
          </div>`).join('') : '<div class="detail-line" style="color:var(--text-3)">Aucun bénéficiaire enregistré.</div>'}
        ${rest > 0.5 ? `<div class="detail-line detail-line--rest">
            <span class="alloc-row__idx" style="background:transparent"></span>
            <span class="detail-line__name">Reste non réparti</span>
            <span class="detail-line__amt">${fmtMoney(rest)}</span>
            <span class="detail-line__pct">${Math.round((rest / d.amount) * 100)} %</span>
          </div>` : ''}
      </div>`;

    openModal('#modalDetail');
  }

  async function deleteDon(id) {
    const d = state.data.donations.find((x) => x.id === id);
    if (!d) return;
    const ok = await api.confirm({
      title: 'Supprimer le don',
      message: `Supprimer définitivement le don de ${d.donor} (${fmtMoney(d.amount)}) ?`,
      detail: `Les ${d.allocations.length} ligne(s) de répartition associées seront également supprimées.`,
      confirmLabel: 'Supprimer',
      danger: true
    });
    if (!ok) return;
    state.data.donations = state.data.donations.filter((x) => x.id !== id);
    state.expanded.delete(id);
    persist(true);
    closeModal('#modalDetail');
    renderAll();
    toast('Don supprimé.', 'info');
  }

  /* ===================================================== export / rapport */

  const toCsv = () => C.toCsv(sortList(filtered()));

  async function generatePdf() {
    const btn = $('#btnPdf');
    btn.disabled = true;
    const label = btn.innerHTML;
    btn.innerHTML = 'Génération en cours…';
    try {
      const model = buildReportModel();
      const doc = DTReport.build(model).fullDoc;
      const name = `rapport-dons-${todayIso()}.pdf`;
      const res = await api.generatePdf({ html: doc, suggestedName: name });
      if (res.canceled) return;
      if (res.error) { toast('Échec de la génération : ' + res.error, 'error'); return; }
      toastLink('Rapport PDF enregistré.', res.path);
    } catch (e) {
      toast('Erreur : ' + e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = label;
    }
  }

  /* ===================================================== toasts */

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

  function toastLink(msg, path) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `<span class="toast__dot"></span><span>${escapeHtml(msg)} <a>Ouvrir</a></span>`;
    $('a', el).addEventListener('click', () => api.openPath(path));
    $('#toasts').appendChild(el);
    setTimeout(() => {
      el.classList.add('is-out');
      setTimeout(() => el.remove(), 220);
    }, 7000);
  }

  /* ===================================================== thème */

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
    state.data.settings.theme = theme;
    if (state.view === 'stats') renderStats();
  }

  /* ===================================================== évènements */

  function bindEvents() {
    // Fenêtre
    $('#winMin').addEventListener('click', () => api.minimize());
    $('#winMax').addEventListener('click', () => api.toggleMaximize());
    $('#winClose').addEventListener('click', () => api.close());

    // Onglets
    $$('.tab').forEach((t) => t.addEventListener('click', () => {
      state.view = t.dataset.view;
      $$('.tab').forEach((x) => {
        const on = x === t;
        x.classList.toggle('is-active', on);
        x.setAttribute('aria-selected', String(on));
      });
      $$('.view').forEach((v) => v.classList.toggle('is-active', v.id === 'view-' + state.view));
      $('#filterbar').style.display = 'flex';
      renderAll();
    }));

    // Recherche & filtres
    let searchTimer = null;
    $('#search').addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { state.search = e.target.value; renderAll(); }, 140);
    });

    $$('#periodSeg .seg').forEach((b) => b.addEventListener('click', () => {
      state.period = b.dataset.period;
      $$('#periodSeg .seg').forEach((x) => x.classList.toggle('is-active', x === b));
      $('#dateRange').hidden = state.period !== 'custom';
      renderAll();
    }));
    $('#dateFrom').addEventListener('change', (e) => { state.from = e.target.value; renderAll(); });
    $('#dateTo').addEventListener('change', (e) => { state.to = e.target.value; renderAll(); });

    $$('#statusSeg .seg').forEach((b) => b.addEventListener('click', () => {
      state.status = b.dataset.status;
      $$('#statusSeg .seg').forEach((x) => x.classList.toggle('is-active', x === b));
      renderTable();
    }));

    // Tri
    $$('.th-sort').forEach((th) => th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (state.sort.key === key) state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
      else state.sort = { key, dir: key === 'donor' ? 'asc' : 'desc' };
      renderTable();
    }));

    // Tableau : dépliage + détail
    $('#donTbody').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-detail]');
      if (btn) { e.stopPropagation(); openDetail(btn.dataset.detail); return; }
      const tr = e.target.closest('tr[data-id]');
      if (!tr) return;
      const id = tr.dataset.id;
      if (state.expanded.has(id)) state.expanded.delete(id); else state.expanded.add(id);
      renderTable();
    });

    // Vue tableau des graphiques
    $$('.toggle-table').forEach((b) => b.addEventListener('click', () => {
      const chart = $('#' + b.dataset.target);
      const table = $('#' + b.dataset.target + '-table');
      const showTable = table.hidden;
      table.hidden = !showTable;
      chart.hidden = showTable;
      b.textContent = showTable ? 'Graphique' : 'Tableau';
    }));

    // Nouveau don
    const newDon = () => openDonWizard(null);
    $('#btnNewDon').addEventListener('click', newDon);
    $('#donEmpty').addEventListener('click', (e) => {
      if (e.target.closest('[data-action="new-don"]')) newDon();
    });

    // Assistant
    $('#btnNext').addEventListener('click', () => { if (validateStep1()) gotoStep(2); });
    $('#btnBack').addEventListener('click', () => { readAllocRows(); gotoStep(1); });
    $('#btnSaveAll').addEventListener('click', saveDon);
    $('#btnAddRow').addEventListener('click', () => addAllocRow(true));

    $('#btnSplitEven').addEventListener('click', () => {
      readAllocRows();
      const rows = state.draft.allocations;
      const n = rows.length;
      if (!n) return;
      const base = Math.floor(state.draft.amount / n);
      rows.forEach((r, i) => { r.amount = i === n - 1 ? state.draft.amount - base * (n - 1) : base; });
      renderAllocRows();
    });

    $('#btnFillLast').addEventListener('click', () => {
      readAllocRows();
      const rows = state.draft.allocations;
      if (!rows.length) return;
      const others = rows.slice(0, -1).reduce((a, x) => a + x.amount, 0);
      rows[rows.length - 1].amount = Math.max(0, state.draft.amount - others);
      renderAllocRows();
    });

    $('#allocList').addEventListener('input', (e) => {
      if (e.target.matches('[data-role="amount"], [data-role="name"]')) {
        e.target.closest('.alloc-row').classList.remove('is-invalid');
        updateAllocTotals();
      }
    });

    $('#allocList').addEventListener('click', (e) => {
      const rm = e.target.closest('[data-role="remove"]');
      if (!rm) return;
      readAllocRows();
      const idx = Number(rm.closest('.alloc-row').dataset.idx);
      state.draft.allocations.splice(idx, 1);
      renderAllocRows();
    });

    // Entrée = ligne suivante dans la répartition
    $('#allocList').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const row = e.target.closest('.alloc-row');
      const isLast = row === $$('.alloc-row').pop();
      if (e.target.dataset.role === 'name') {
        $('[data-role="amount"]', row).focus();
      } else if (isLast) {
        addAllocRow(true);
      } else {
        const next = row.nextElementSibling;
        if (next) $('[data-role="name"]', next).focus();
      }
    });

    // Formatage souple du montant du don
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

    // Détail
    $('#btnEdit').addEventListener('click', () => {
      const d = state.data.donations.find((x) => x.id === state.detailId);
      closeModal('#modalDetail');
      if (d) openDonWizard(d);
    });
    $('#btnDelete').addEventListener('click', () => deleteDon(state.detailId));

    // Fermeture des modales
    $$('.overlay').forEach((ov) => {
      ov.addEventListener('click', (e) => {
        if (e.target === ov || e.target.closest('[data-close]')) ov.hidden = true;
      });
    });

    // Paramètres
    $('#btnSettings').addEventListener('click', () => {
      $('#sOrg').value = state.data.settings.org || '';
      $('#sCurrency').value = currency();
      $('#sTheme').value = state.data.settings.theme || 'dark';
      $('#dataPathLabel').textContent = state.info.dataFile;
      openModal('#modalSettings');
    });

    $('#btnSaveSettings').addEventListener('click', () => {
      state.data.settings.org = $('#sOrg').value.trim();
      state.data.settings.currency = $('#sCurrency').value.trim() || 'FCFA';
      applyTheme($('#sTheme').value);
      persist(true);
      $('#orgLabel').textContent = state.data.settings.org;
      $('#repOrg').value = state.data.settings.org;
      $('#curLabel').textContent = currency();
      closeModal('#modalSettings');
      renderAll();
      toast('Paramètres enregistrés.');
    });

    $('#btnTheme').addEventListener('click', () => {
      applyTheme(state.data.settings.theme === 'light' ? 'dark' : 'light');
      persist();
    });

    $('#btnReveal').addEventListener('click', () => api.revealData());

    $('#btnExportJson').addEventListener('click', async () => {
      const res = await api.exportBackup(state.data);
      if (!res.canceled) toastLink('Sauvegarde exportée.', res.path);
    });

    $('#btnImportJson').addEventListener('click', async () => {
      const res = await api.importBackup();
      if (res.canceled) return;
      const ok = await api.confirm({
        title: 'Importer une sauvegarde',
        message: `Remplacer les données actuelles par ${res.data.donations.length} don(s) importé(s) ?`,
        detail: 'Une sauvegarde automatique de vos données actuelles sera créée avant le remplacement.',
        confirmLabel: 'Remplacer',
        danger: true
      });
      if (!ok) return;
      await api.snapshot();
      state.data = res.data;
      persist(true);
      applyTheme(state.data.settings.theme || 'dark');
      $('#orgLabel').textContent = state.data.settings.org || '';
      closeModal('#modalSettings');
      renderAll();
      toast(`${res.data.donations.length} don(s) importé(s).`);
    });

    // Export CSV
    $('#btnExportCsv').addEventListener('click', async () => {
      const list = filtered();
      if (!list.length) { toast('Aucune donnée à exporter sur cette période.', 'error'); return; }
      const res = await api.exportCsv({ csv: toCsv(), suggestedName: `dons-${todayIso()}.csv` });
      if (!res.canceled) toastLink('Export CSV terminé.', res.path);
    });

    // Rapports
    ['#repTitle', '#repOrg'].forEach((sel) => $(sel).addEventListener('input', renderPreview));
    ['#optSummary', '#optCharts', '#optDetail', '#optBenef', '#optSign'].forEach((sel) =>
      $(sel).addEventListener('change', renderPreview));
    $('#btnPdf').addEventListener('click', generatePdf);

    // Raccourcis clavier
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const m = topModal();
        if (m) { m.hidden = true; return; }
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        if (!topModal()) openDonWizard(null);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        $('#search').focus();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        const m = topModal();
        if (m && m.id === 'modalDon') {
          e.preventDefault();
          if ($('#btnNext').hidden) saveDon(); else if (validateStep1()) gotoStep(2);
        }
      }
    });

    // Redimensionnement : les SVG sont recalculés (pas d'étirement)
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { if (state.view === 'stats') renderStats(); }, 160);
    });

    api.onWindowState((s) => {
      $('#winMax').innerHTML = s.maximized
        ? '<svg viewBox="0 0 12 12"><rect x="2" y="4" width="6" height="6" rx="1"/><path d="M4 4V2.5h5.5V8H8"/></svg>'
        : '<svg viewBox="0 0 12 12"><rect x="2.5" y="2.5" width="7" height="7" rx="1"/></svg>';
    });
  }

  /* ===================================================== démarrage */

  async function boot() {
    try {
      state.data = await api.read();
      state.info = await api.info();
    } catch (e) {
      toast('Chargement des données impossible : ' + e.message, 'error');
    }

    if (state.info.logo) {
      $('#brandLogo').src = state.info.logo;
      $('#emptyLogo').src = state.info.logo;
    }

    applyTheme(state.data.settings.theme || 'dark');
    $('#orgLabel').textContent = state.data.settings.org || '';
    $('#repOrg').value = state.data.settings.org || '';
    $('#curLabel').textContent = currency();
    $('#fDate').value = todayIso();

    bindEvents();
    renderAll();

    // Sauvegarde datée à chaque démarrage (rotation de 30 fichiers)
    api.snapshot().catch(() => {});
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
