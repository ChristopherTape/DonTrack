/* =========================================================================
   DonTrack — graphiques SVG (aucune dépendance externe)

   Regles appliquees :
   - marques fines, extremites arrondies 4px ancrees a la ligne de base
   - ecart de 2px entre barres adjacentes (pas de bordure autour des marques)
   - grille et axes en filets pleins, discrets
   - legende des qu'il y a 2 series, etiquettes directes selectives
   - couche de survol (tooltip) + vue tableau equivalente pour chaque graphe
   ========================================================================= */

(function (global) {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const tooltipEl = () => document.getElementById('tooltip');

  function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function el(tag, attrs, parent) {
    const node = document.createElementNS(NS, tag);
    for (const k in attrs) {
      if (attrs[k] === null || attrs[k] === undefined) continue;
      node.setAttribute(k, attrs[k]);
    }
    if (parent) parent.appendChild(node);
    return node;
  }

  /** Rectangle a extremite superieure arrondie, ancre a la ligne de base. */
  function barPathV(x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, w / 2, h));
    return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
  }

  /** Rectangle a extremite droite arrondie (barres horizontales). */
  function barPathH(x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, h / 2, w));
    return `M${x},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h - rr} Q${x + w},${y + h} ${x + w - rr},${y + h} L${x},${y + h} Z`;
  }

  /** Maximum "rond" au-dessus de la valeur max, pour des graduations lisibles. */
  function niceMax(value, ticks) {
    if (!value || value <= 0) return 1;
    const raw = value / (ticks || 4);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
    return Math.ceil(value / step) * step;
  }

  function truncate(text, max) {
    return text.length > max ? text.slice(0, max - 1) + '…' : text;
  }

  /* ----------------------------------------------------------- tooltip */

  function showTip(evt, html) {
    const tip = tooltipEl();
    tip.innerHTML = html;
    tip.hidden = false;
    moveTip(evt);
  }

  function moveTip(evt) {
    const tip = tooltipEl();
    if (tip.hidden) return;
    const box = tip.getBoundingClientRect();
    let x = evt.clientX + 14;
    let y = evt.clientY - box.height - 12;
    if (x + box.width > window.innerWidth - 10) x = evt.clientX - box.width - 14;
    if (y < 10) y = evt.clientY + 18;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  }

  function hideTip() {
    tooltipEl().hidden = true;
  }

  function bindTip(node, htmlFn) {
    node.addEventListener('mouseenter', (e) => showTip(e, htmlFn()));
    node.addEventListener('mousemove', moveTip);
    node.addEventListener('mouseleave', hideTip);

    // Tactile : l'appui affiche l'infobulle, un appui ailleurs la referme.
    node.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      e.stopPropagation();
      showTip(e, htmlFn());
      clearTimeout(touchTimer);
      touchTimer = setTimeout(hideTip, 2600);
    });
  }

  let touchTimer = null;
  if (typeof document !== 'undefined') {
    document.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse') hideTip();
    }, true);
  }

  function tipRows(title, rows) {
    const body = rows.map((r) =>
      `<div class="tooltip__row">${r.color ? `<span class="tooltip__sw" style="background:${r.color}"></span>` : ''}${r.label}<b>${r.value}</b></div>`
    ).join('');
    return `<div class="tooltip__title">${title}</div>${body}`;
  }

  /* ----------------------------------------------------------- socle commun */

  /**
   * Largeur utile reelle du conteneur (padding deduit) : la viewBox est calee
   * dessus pour que le SVG s'affiche a l'echelle 1 — ni texte etire, ni marque
   * deformee. Les graphiques sont re-rendus au redimensionnement.
   */
  function innerWidth(container) {
    const cs = getComputedStyle(container);
    const w = container.clientWidth - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0);
    return Math.max(300, Math.round(w) || 520);
  }

  function emptyState(container, message) {
    container.innerHTML = `<div class="chart-empty">${message}</div>`;
  }

  function legend(container, series) {
    const box = document.createElement('div');
    box.className = 'legend';
    box.innerHTML = series.map((s) =>
      `<span class="legend__item"><span class="legend__swatch" style="background:${s.color}"></span>${s.label}</span>`
    ).join('');
    container.appendChild(box);
  }

  /* ----------------------------------------------------------- barres groupees */

  /**
   * @param {HTMLElement} container
   * @param {{labels:string[], series:{key:string,label:string,color:string,values:number[]}[], fmt:Function, fmtShort:Function}} opts
   */
  function groupedBars(container, opts) {
    container.innerHTML = '';
    const { labels, series, fmt, fmtShort } = opts;
    if (!labels.length) return emptyState(container, 'Aucune donnée sur la période sélectionnée.');

    legend(container, series);

    const H = opts.height || 250;
    // `width` permet au conteneur de défiler horizontalement quand les
    // périodes sont nombreuses : on garde un pas lisible plutôt que
    // d'écraser les barres.
    const W = opts.width || innerWidth(container);
    const pad = { t: 12, r: 10, b: 30, l: 56 };
    const plotW = W - pad.l - pad.r;
    const plotH = H - pad.t - pad.b;

    const max = niceMax(Math.max(...series.flatMap((s) => s.values), 0), 4);
    const y = (v) => pad.t + plotH - (v / max) * plotH;

    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, height: H }, container);
    if (opts.width) { svg.setAttribute('width', W); svg.style.width = W + 'px'; }

    // Grille + graduations
    for (let i = 0; i <= 4; i++) {
      const v = (max / 4) * i;
      const yy = y(v);
      el('line', { x1: pad.l, x2: W - pad.r, y1: yy, y2: yy, class: i === 0 ? 'baseline' : 'grid-line' }, svg);
      const t = el('text', { x: pad.l - 9, y: yy + 4, class: 'axis-label', 'text-anchor': 'end' }, svg);
      t.textContent = fmtShort(v);
    }

    const band = plotW / labels.length;
    const gap = 2;                                            // ecart de surface entre barres adjacentes
    const barW = Math.max(4, Math.min(16, (band * 0.62 - gap * (series.length - 1)) / series.length));
    const groupW = barW * series.length + gap * (series.length - 1);

    labels.forEach((label, i) => {
      const gx = pad.l + band * i + (band - groupW) / 2;
      const group = el('g', { class: 'bar-group' }, svg);

      series.forEach((s, si) => {
        const v = s.values[i] || 0;
        const h = Math.max(v > 0 ? 2 : 0, plotH - (y(v) - pad.t));
        if (h > 0) {
          el('path', {
            d: barPathV(gx + si * (barW + gap), pad.t + plotH - h, barW, h, 4),
            fill: s.color,
            stroke: 'none',
            class: 'bar-rect'
          }, group);
        }
      });

      // Zone de survol large (>= 24px) couvrant toute la bande
      const hit = el('rect', { x: pad.l + band * i, y: pad.t, width: band, height: plotH, class: 'chart-hit' }, group);
      const titre = (opts.fullLabels && opts.fullLabels[i]) || label;
      bindTip(hit, () => tipRows(titre, series.map((s) => ({
        color: s.color, label: s.label, value: fmt(s.values[i] || 0)
      }))));

      const tx = el('text', {
        x: pad.l + band * i + band / 2,
        y: H - 10,
        class: 'axis-label',
        'text-anchor': 'middle'
      }, svg);
      // Une étiquette sur N selon la place : la dernière est toujours écrite.
      const every = Math.max(1, Math.ceil(44 / band));
      const garder = i % every === 0 || i === labels.length - 1;
      tx.textContent = garder ? label : '';
    });
  }

  /* ----------------------------------------------------------- barres horizontales */

  /**
   * @param {{rows:{label:string,value:number,meta?:string}[], color:string, fmt:Function}} opts
   */
  function hBars(container, opts) {
    container.innerHTML = '';
    const { rows, color, fmt } = opts;
    if (!rows.length) return emptyState(container, 'Aucune donnée sur la période sélectionnée.');

    const rowH = 30;
    const H = rows.length * rowH + 12;
    const W = innerWidth(container);
    const labelW = Math.min(150, Math.max(88, W * 0.28));
    const valueW = Math.min(96, Math.max(58, W * 0.2));
    const plotX = labelW + 10;
    const plotW = Math.max(40, W - plotX - valueW);

    const max = Math.max(...rows.map((r) => r.value), 1);
    const maxChars = Math.max(7, Math.floor(labelW / 6.4));   // ~6.4px par caractere a 12px
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, height: H }, container);

    rows.forEach((row, i) => {
      const yTop = i * rowH + 6;
      const barH = 14;
      const yBar = yTop + (rowH - 12 - barH) / 2 + 2;
      const w = Math.max(row.value > 0 ? 3 : 0, (row.value / max) * plotW);

      const g = el('g', { class: 'bar-group' }, svg);

      const lab = el('text', { x: labelW, y: yBar + barH / 2 + 4, class: 'axis-name', 'text-anchor': 'end' }, g);
      // La troncature suit la largeur reelle de la colonne : sur un ecran
      // etroit, un nom trop long deborderait a gauche et serait coupe.
      lab.textContent = truncate(row.label, maxChars);

      el('path', { d: barPathH(plotX, yBar, w, barH, 4), fill: color, stroke: 'none', class: 'bar-rect' }, g);

      // Etiquette directe : la valeur est lisible sans survol (releve du contraste)
      const val = el('text', { x: plotX + w + 9, y: yBar + barH / 2 + 4, class: 'value-label' }, g);
      val.textContent = fmt(row.value);

      const hit = el('rect', { x: 0, y: yTop, width: W, height: rowH, class: 'chart-hit' }, g);
      bindTip(hit, () => tipRows(row.label, [
        { color, label: 'Montant', value: fmt(row.value) }
      ].concat(row.meta ? [{ label: 'Détail', value: row.meta }] : [])));
    });
  }

  /* ----------------------------------------------------------- jauge (taux) */

  /**
   * Jauge en arc + chiffre héros. Ce n'est pas un camembert : une seule
   * proportion, lue d'un coup d'oeil, avec les deux montants en clair dessous.
   */
  function meter(container, opts) {
    container.innerHTML = '';
    const { value, total, fmt } = opts;
    const ratio = total > 0 ? Math.min(1, value / total) : 0;

    const size = opts.size || 210;
    const stroke = Math.round(size * 0.076);
    const r = (size - stroke) / 2 - 4;
    const cx = size / 2;
    const cy = size / 2 + 12;
    const startA = Math.PI * 0.78;
    const sweep = Math.PI * 1.44;

    const pt = (a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    const arc = (a0, a1) => {
      const [x0, y0] = pt(a0);
      const [x1, y1] = pt(a1);
      const large = a1 - a0 > Math.PI ? 1 : 0;
      return `M${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1}`;
    };

    const svg = el('svg', { viewBox: `0 0 ${size} ${size}`, height: size, width: size }, container);
    svg.style.width = size + 'px';

    el('path', {
      d: arc(startA, startA + sweep),
      stroke: css('--surface-3'), 'stroke-width': stroke, 'stroke-linecap': 'round', fill: 'none'
    }, svg);

    if (ratio > 0.002) {
      const p = el('path', {
        d: arc(startA, startA + sweep * ratio),
        stroke: css('--series-2'), 'stroke-width': stroke, 'stroke-linecap': 'round', fill: 'none'
      }, svg);
      p.style.transition = 'stroke-dasharray .6s ease';
    }

    const pct = el('text', {
      x: cx, y: cy + 2, 'text-anchor': 'middle',
      fill: css('--text-1'), stroke: 'none'
    }, svg);
    pct.setAttribute('font-size', String(Math.round(size * 0.18)));
    pct.setAttribute('font-weight', '660');
    pct.textContent = (total > 0 ? Math.round(ratio * 100) : 0) + ' %';

    const sub = el('text', {
      x: cx, y: cy + 26, 'text-anchor': 'middle',
      fill: css('--text-3'), stroke: 'none'
    }, svg);
    sub.setAttribute('font-size', String(Math.max(11, Math.round(size * 0.057))));
    sub.textContent = 'des fonds répartis';

    const box = document.createElement('div');
    box.className = 'legend';
    box.style.justifyContent = 'center';
    box.style.padding = '4px 0 0';
    box.innerHTML =
      `<span class="legend__item"><span class="legend__swatch" style="background:${css('--series-2')}"></span>Réparti&nbsp;<b style="color:var(--text-1)">${fmt(value)}</b></span>` +
      `<span class="legend__item"><span class="legend__swatch" style="background:${css('--surface-3')}"></span>Reste&nbsp;<b style="color:var(--text-1)">${fmt(Math.max(0, total - value))}</b></span>`;
    container.appendChild(box);
  }

  /* ----------------------------------------------------------- vue tableau */

  function dataTable(container, columns, rows) {
    const head = columns.map((c) => `<th class="${c.num ? 'num' : ''}">${c.label}</th>`).join('');
    const body = rows.map((r) =>
      '<tr>' + columns.map((c) => `<td class="${c.num ? 'num' : ''}">${r[c.key]}</td>`).join('') + '</tr>'
    ).join('');
    container.innerHTML = `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  }

  global.DTCharts = { groupedBars, hBars, meter, dataTable, css, niceMax, hideTip };
})(window);
