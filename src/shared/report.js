/* =========================================================================
   DonTrack — construction du rapport (aperçu écran + document PDF)

   Le même HTML sert aux deux usages : l'aperçu l'injecte dans la page,
   le PDF l'imprime tel quel. Toutes les règles CSS sont préfixées par .rpt
   pour ne jamais fuiter dans l'interface de l'application.
   ========================================================================= */

(function (global) {
  'use strict';

  // Palette claire validée : le rapport s'imprime toujours sur fond blanc.
  const C = {
    ink: '#12161d',
    ink2: '#4b5464',
    ink3: '#79839a',
    line: '#e2e6ee',
    s1: '#2a78d6',   // collecté
    s2: '#1baf7a',   // réparti
    s3: '#eda100'    // reste
  };

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function niceMax(v, ticks) {
    if (!v || v <= 0) return 1;
    const raw = v / (ticks || 4);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / mag;
    const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
    return Math.ceil(v / step) * step;
  }

  function barPathV(x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, w / 2, h));
    return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
  }

  function barPathH(x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, h / 2, w));
    return `M${x},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h - rr} Q${x + w},${y + h} ${x + w - rr},${y + h} L${x},${y + h} Z`;
  }

  /* ------------------------------------------------------- graphiques statiques */

  function svgMonthly(labels, collected, distributed, fmtShort) {
    if (!labels.length) return '';
    const W = 700, H = 210;
    const pad = { t: 10, r: 8, b: 26, l: 58 };
    const plotW = W - pad.l - pad.r;
    const plotH = H - pad.t - pad.b;
    const max = niceMax(Math.max(...collected, ...distributed, 0), 4);
    const y = (v) => pad.t + plotH - (v / max) * plotH;

    let out = '';
    for (let i = 0; i <= 4; i++) {
      const v = (max / 4) * i;
      const yy = y(v);
      out += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${yy}" y2="${yy}" stroke="${i === 0 ? '#c9d0dd' : C.line}" stroke-width="1"/>`;
      out += `<text x="${pad.l - 8}" y="${yy + 3.5}" text-anchor="end" font-size="9.5" fill="${C.ink3}">${esc(fmtShort(v))}</text>`;
    }

    const band = plotW / labels.length;
    const gap = 2;
    const barW = Math.max(4, Math.min(15, (band * 0.62 - gap) / 2));

    labels.forEach((label, i) => {
      const gx = pad.l + band * i + (band - (barW * 2 + gap)) / 2;
      const h1 = plotH - (y(collected[i]) - pad.t);
      const h2 = plotH - (y(distributed[i]) - pad.t);
      if (h1 > 0) out += `<path d="${barPathV(gx, pad.t + plotH - h1, barW, h1, 3)}" fill="${C.s1}"/>`;
      if (h2 > 0) out += `<path d="${barPathV(gx + barW + gap, pad.t + plotH - h2, barW, h2, 3)}" fill="${C.s2}"/>`;
      out += `<text x="${pad.l + band * i + band / 2}" y="${H - 8}" text-anchor="middle" font-size="9" fill="${C.ink3}">${esc(label)}</text>`;
    });

    return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}">${out}</svg>`;
  }

  function svgHBars(rows, color, fmt) {
    if (!rows.length) return '';
    const rowH = 22;
    const W = 700, H = rows.length * rowH + 6;
    const labelW = 150, valueW = 92;
    const plotX = labelW + 8;
    const plotW = W - plotX - valueW;
    const max = Math.max(...rows.map((r) => r.value), 1);

    let out = '';
    rows.forEach((row, i) => {
      const yTop = i * rowH + 3;
      const barH = 12;
      const yBar = yTop + (rowH - 6 - barH) / 2;
      const w = Math.max(row.value > 0 ? 2 : 0, (row.value / max) * plotW);
      const raw = String(row.label || row.name || '');
      const label = raw.length > 26 ? raw.slice(0, 25) + '…' : raw;
      out += `<text x="${labelW}" y="${yBar + barH / 2 + 3.5}" text-anchor="end" font-size="10" fill="${C.ink2}">${esc(label)}</text>`;
      out += `<path d="${barPathH(plotX, yBar, w, barH, 3)}" fill="${color}"/>`;
      out += `<text x="${plotX + w + 7}" y="${yBar + barH / 2 + 3.5}" font-size="9.5" font-weight="600" fill="${C.ink2}">${esc(fmt(row.value))}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}">${out}</svg>`;
  }

  /* ------------------------------------------------------- feuille de style */

  function reportCss() {
    return `
.rpt { font-family: "Segoe UI", system-ui, -apple-system, sans-serif; color: ${C.ink}; font-size: 10.5px; line-height: 1.5; }
.rpt * { box-sizing: border-box; }
.rpt h1, .rpt h2, .rpt h3 { margin: 0; font-weight: 660; letter-spacing: -0.2px; }
.rpt-head { display: flex; align-items: flex-start; gap: 14px; padding-bottom: 14px; border-bottom: 2px solid ${C.ink}; }
.rpt-head__logo { width: 46px; height: 46px; object-fit: contain; flex: none; }
.rpt-head__txt { flex: 1; }
.rpt-head h1 { font-size: 17px; }
.rpt-head .org { font-size: 11px; color: ${C.ink2}; font-weight: 600; margin-top: 2px; }
.rpt-head .meta { font-size: 9.5px; color: ${C.ink3}; margin-top: 4px; }
.rpt-head__right { text-align: right; font-size: 9.5px; color: ${C.ink3}; flex: none; }

.rpt-sec { margin-top: 18px; page-break-inside: auto; }
.rpt-sec__title { font-size: 12px; margin-bottom: 9px; padding-bottom: 5px; border-bottom: 1px solid ${C.line}; }
.rpt-sec__title small { font-weight: 500; color: ${C.ink3}; font-size: 9.5px; margin-left: 6px; }

.rpt-kpis { display: flex; gap: 8px; }
.rpt-kpi { flex: 1; border: 1px solid ${C.line}; border-radius: 7px; padding: 9px 10px; border-left: 3px solid ${C.s1}; }
.rpt-kpi:nth-child(2) { border-left-color: ${C.s2}; }
.rpt-kpi:nth-child(3) { border-left-color: ${C.s3}; }
.rpt-kpi:nth-child(4) { border-left-color: ${C.ink3}; }
.rpt-kpi__label { font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.4px; color: ${C.ink3}; font-weight: 700; }
.rpt-kpi__value { font-size: 16px; font-weight: 680; margin-top: 3px; letter-spacing: -0.3px; }
.rpt-kpi__foot { font-size: 9px; color: ${C.ink3}; margin-top: 2px; }

.rpt-legend { display: flex; gap: 14px; font-size: 9.5px; color: ${C.ink2}; margin: 2px 0 6px; }
.rpt-legend i { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; }

.rpt-table { width: 100%; border-collapse: collapse; font-size: 10px; }
.rpt-table th { text-align: left; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.3px; color: ${C.ink3}; padding: 5px 6px; border-bottom: 1px solid ${C.line}; }
.rpt-table td { padding: 5px 6px; border-bottom: 1px solid #f0f2f7; vertical-align: top; }
.rpt-table .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.rpt-table tfoot td { font-weight: 700; border-top: 1.5px solid ${C.ink}; border-bottom: 0; padding-top: 6px; }

.rpt-don { border: 1px solid ${C.line}; border-radius: 8px; padding: 10px 12px; margin-bottom: 8px; page-break-inside: avoid; }
.rpt-don__head { display: flex; align-items: baseline; gap: 8px; border-bottom: 1px solid ${C.line}; padding-bottom: 6px; margin-bottom: 6px; }
.rpt-don__donor { font-weight: 680; font-size: 11.5px; }
.rpt-don__date { font-size: 9px; color: ${C.ink3}; }
.rpt-don__amt { margin-left: auto; font-weight: 700; font-size: 12px; white-space: nowrap; }
.rpt-don__note { font-size: 9px; color: ${C.ink3}; font-style: italic; margin-top: 4px; }
.rpt-alloc { width: 100%; border-collapse: collapse; font-size: 9.5px; }
.rpt-alloc td { padding: 3px 5px; border-bottom: 1px dotted #e8ebf2; }
.rpt-alloc td:first-child { width: 16px; color: ${C.ink3}; }
.rpt-alloc .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.rpt-alloc .pct { color: ${C.ink3}; width: 44px; text-align: right; }
.rpt-alloc tr.rest td { color: #b07500; font-weight: 600; }
.rpt-empty { font-size: 9.5px; color: ${C.ink3}; font-style: italic; padding: 3px 0; }

.rpt-sign { display: flex; gap: 40px; margin-top: 26px; page-break-inside: avoid; }
.rpt-sign div { flex: 1; }
.rpt-sign span { display: block; font-size: 9.5px; color: ${C.ink3}; margin-bottom: 34px; }
.rpt-sign b { display: block; border-top: 1px solid ${C.ink3}; padding-top: 4px; font-weight: 500; font-size: 9.5px; color: ${C.ink2}; }

.rpt-foot { margin-top: 22px; padding-top: 8px; border-top: 1px solid ${C.line}; font-size: 8.5px; color: ${C.ink3}; display: flex; justify-content: space-between; }
.rpt-break { page-break-before: always; }
`;
  }

  /* ------------------------------------------------------- corps du rapport */

  /**
   * @param {object} o  { title, org, logo, periodLabel, searchLabel, generatedAt,
   *                      stats, donations, monthly, topBenef, topDonors,
   *                      options:{summary,charts,detail,benef,sign}, fmt, fmtShort, fmtDate }
   */
  function buildBody(o) {
    const f = o.fmt, fs = o.fmtShort, fd = o.fmtDate;
    // Un don en nature se compte en sacs ou en têtes, pas en francs.
    const fq = o.fmtFor || ((n) => f(n));
    const fn = o.fmtNum || ((n) => String(Math.round(Number(n) || 0)));
    const s = o.stats;
    let h = '';

    h += `<div class="rpt-head">
      ${o.logo ? `<img class="rpt-head__logo" src="${o.logo}" alt="" />` : ''}
      <div class="rpt-head__txt">
        <h1>${esc(o.title)}</h1>
        ${o.org ? `<div class="org">${esc(o.org)}</div>` : ''}
        <div class="meta">Période : ${esc(o.periodLabel)}${o.searchLabel ? ` &nbsp;·&nbsp; Filtre : « ${esc(o.searchLabel)} »` : ''}</div>
      </div>
      <div class="rpt-head__right">
        Édité le ${esc(o.generatedAt)}<br/>DonTrack
      </div>
    </div>`;

    if (o.options.summary) {
      const rate = s.total > 0 ? Math.round((s.distributed / s.total) * 100) : 0;
      h += `<div class="rpt-sec">
        <h2 class="rpt-sec__title">Synthèse</h2>
        <div class="rpt-kpis">
          <div class="rpt-kpi"><div class="rpt-kpi__label">Total collecté</div><div class="rpt-kpi__value">${esc(f(s.total))}</div><div class="rpt-kpi__foot">${s.moneyCount !== undefined ? s.moneyCount : s.count} don${(s.moneyCount !== undefined ? s.moneyCount : s.count) > 1 ? 's' : ''} en argent</div></div>
          <div class="rpt-kpi"><div class="rpt-kpi__label">Total réparti</div><div class="rpt-kpi__value">${esc(f(s.distributed))}</div><div class="rpt-kpi__foot">${rate} % des fonds</div></div>
          <div class="rpt-kpi"><div class="rpt-kpi__label">Reste à répartir</div><div class="rpt-kpi__value">${esc(f(s.remaining))}</div><div class="rpt-kpi__foot">${s.partialCount} don${s.partialCount > 1 ? 's' : ''} incomplet${s.partialCount > 1 ? 's' : ''}</div></div>
          <div class="rpt-kpi"><div class="rpt-kpi__label">Bénéficiaires</div><div class="rpt-kpi__value">${s.beneficiaries}</div><div class="rpt-kpi__foot">${s.allocations} attribution${s.allocations > 1 ? 's' : ''}</div></div>
        </div>
      </div>`;

      if (s.nature && s.nature.length) {
        h += `<div class="rpt-sec">
          <h2 class="rpt-sec__title">Dons en nature <small>non convertis en argent</small></h2>
          <table class="rpt-table">
            <thead><tr><th>Nature</th><th class="num">Dons</th><th class="num">Reçu</th><th class="num">Réparti</th><th class="num">Reste</th></tr></thead>
            <tbody>${s.nature.map((n) => `<tr>
              <td>${esc(n.unit)}</td>
              <td class="num">${n.count}</td>
              <td class="num">${esc(fn(n.total))}</td>
              <td class="num">${esc(fn(n.distributed))}</td>
              <td class="num">${esc(fn(n.remaining))}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>`;
      }
    }

    if (o.options.charts && o.monthly.labels.length) {
      h += `<div class="rpt-sec">
        <h2 class="rpt-sec__title">${esc(o.seriesTitle || "Évolution mensuelle")}</h2>
        <div class="rpt-legend">
          <span><i style="background:${C.s1}"></i>Collecté</span>
          <span><i style="background:${C.s2}"></i>Réparti</span>
        </div>
        ${svgMonthly(o.monthly.labels, o.monthly.collected, o.monthly.distributed, fs)}
      </div>`;
    }

    if (o.options.charts && o.topBenef.length) {
      h += `<div class="rpt-sec">
        <h2 class="rpt-sec__title">Principaux bénéficiaires <small>10 premiers</small></h2>
        ${svgHBars(o.topBenef.slice(0, 10), C.s2, fs)}
      </div>`;
    }

    if (o.options.benef && o.allBenef.length) {
      h += `<div class="rpt-sec">
        <h2 class="rpt-sec__title">Récapitulatif par bénéficiaire</h2>
        <table class="rpt-table">
          <thead><tr><th>Bénéficiaire</th><th class="num">Attributions</th><th class="num">Total reçu</th><th class="num">Part</th></tr></thead>
          <tbody>${o.allBenef.map((b) => `<tr>
            <td>${esc(b.name)}</td>
            <td class="num">${b.count}</td>
            <td class="num">${esc(f(b.value))}</td>
            <td class="num">${s.distributed > 0 ? ((b.value / s.distributed) * 100).toFixed(1) : '0.0'} %</td>
          </tr>`).join('')}</tbody>
          <tfoot><tr><td>Total</td><td class="num">${s.allocations}</td><td class="num">${esc(f(s.distributed))}</td><td class="num">100 %</td></tr></tfoot>
        </table>
      </div>`;
    }

    if (o.collectors && o.collectors.length) {
      h += `<div class="rpt-sec">
        <h2 class="rpt-sec__title">Collecte par utilisateur</h2>
        <table class="rpt-table">
          <thead><tr><th>Utilisateur</th><th class="num">Dons saisis</th><th class="num">Montant collecté</th><th class="num">Part</th></tr></thead>
          <tbody>${o.collectors.map((c) => `<tr>
            <td>${esc(c.name)}</td>
            <td class="num">${c.count}</td>
            <td class="num">${esc(f(c.value))}</td>
            <td class="num">${s.total > 0 ? ((c.value / s.total) * 100).toFixed(1) : '0.0'} %</td>
          </tr>`).join('')}</tbody>
          <tfoot><tr><td>Total</td><td class="num">${s.count}</td><td class="num">${esc(f(s.total))}</td><td class="num">100 %</td></tr></tfoot>
        </table>
      </div>`;
    }

    if (o.options.detail) {
      h += `<div class="rpt-sec">
        <h2 class="rpt-sec__title">Détail des dons et de leur répartition <small>${o.donations.length} don${o.donations.length > 1 ? 's' : ''}</small></h2>`;
      if (!o.donations.length) {
        h += `<p class="rpt-empty">Aucun don sur la période sélectionnée.</p>`;
      }
      o.donations.forEach((d) => {
        const given = d.allocations.reduce((a, x) => a + x.amount, 0);
        const rest = d.amount - given;
        h += `<div class="rpt-don">
          <div class="rpt-don__head">
            <span class="rpt-don__donor">${esc(d.donor)}</span>
            <span class="rpt-don__date">${esc(fd(d.date))} · ${esc(o.typeLabel ? o.typeLabel(d.type) : d.type)}${d.created_by_name ? ' · saisi par ' + esc(d.created_by_name) : ''}</span>
            <span class="rpt-don__amt">${esc(fq(d.amount, d))}</span>
          </div>`;
        if (d.allocations.length) {
          h += `<table class="rpt-alloc"><tbody>${d.allocations.map((a, i) => `<tr>
            <td>${i + 1}</td>
            <td>${esc(a.name)}${a.note ? ` <span style="color:${C.ink3}">— ${esc(a.note)}</span>` : ''}</td>
            <td class="pct">${d.amount > 0 ? Math.round((a.amount / d.amount) * 100) : 0} %</td>
            <td class="num">${esc(fq(a.amount, d))}</td>
          </tr>`).join('')}${rest > 0.5 ? `<tr class="rest"><td></td><td>Reste non réparti</td><td class="pct">${Math.round((rest / d.amount) * 100)} %</td><td class="num">${esc(fq(rest, d))}</td></tr>` : ''}</tbody></table>`;
        } else {
          h += `<p class="rpt-empty">Don non encore réparti — ${esc(fq(d.amount, d))} en attente d'attribution.</p>`;
        }
        if (d.note) h += `<div class="rpt-don__note">${esc(d.note)}</div>`;
        h += `</div>`;
      });
      h += `</div>`;
    }

    if (o.options.sign) {
      h += `<div class="rpt-sign">
        <div><span>Établi par</span><b>Nom, fonction et signature</b></div>
        <div><span>Validé par</span><b>Nom, fonction et signature</b></div>
      </div>`;
    }

    h += `<div class="rpt-foot">
      <span>${esc(o.org || 'DonTrack')} — document généré avec DonTrack</span>
      <span>${esc(o.generatedAt)}</span>
    </div>`;

    return h;
  }

  function build(o) {
    const body = buildBody(o);
    const css = reportCss();
    const fullDoc = `<!doctype html><html lang="fr"><head><meta charset="utf-8" />
<title>${esc(o.title)}</title>
<style>
@page { size: A4; }
html, body { margin: 0; padding: 0; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
${css}
</style></head><body><div class="rpt">${body}</div></body></html>`;
    return { css, body, fullDoc };
  }

  global.DTReport = { build, css: reportCss };
})(window);
