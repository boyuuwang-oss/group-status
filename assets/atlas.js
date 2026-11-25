/* The atlas of the paper, drawn in the browser from data (website/atlas.json, imported from fig_atlas.py by
   website/atlas_import.py). Same geometry as the paper's figure: figure units of 1/100 inch on an 11 x 7.5 inch page,
   the main axes and the side valleys at the figure's fractions, flows as quadratic Bezier "rivers" bent by `rad`,
   tapered from 0.8 to 2.4 pt with a white halo and an arrowhead, nodes as the figure's markers, labels in white boxes,
   and the terrain (Gaussian massifs, hill shading, contours) painted on a canvas under the vectors.
   Atlas.geom(spec) gives positions for overlays: pos(key) and path(src, dst) in figure units.
   Atlas.svg(spec) returns the markup; Atlas.finish(svg) sizes the label boxes and lays out the legend once the SVG is
   in the page (text has to be measured). No libraries. */
(() => {
  'use strict';
  const PT = 100 / 72;                                   // figure units per point
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const f1 = (v) => (Math.round(v * 10) / 10).toString();

  // ------------------------------------------------------------------ geometry
  function geom(spec) {
    const W = 100 * spec.figure.w_in, H = 100 * spec.figure.h_in;
    const warp = spec.warp;
    const Fy = (F) => {
      if (F <= warp[0][0]) return warp[0][1];
      for (let i = 1; i < warp.length; i++) {
        if (F <= warp[i][0]) { const [a, ya] = warp[i - 1], [b, yb] = warp[i]; return ya + (yb - ya) * (F - a) / (b - a); }
      }
      return warp[warp.length - 1][1];
    };
    const axis = (rect, yr) => {
      const [l, b, w, h] = rect, [x0, x1] = spec.x, [y0, y1] = yr;
      return {
        l: W * l, r: W * (l + w), t: H * (1 - b - h), b: H * (1 - b), x0, x1, y0, y1,
        X: (x) => W * (l + w * (x - x0) / (x1 - x0)),
        Y: (y) => H * (1 - (b + h * (y - y0) / (y1 - y0))),
      };
    };
    const main = axis(spec.main.rect, spec.y), val = axis(spec.valleys.rect, spec.valleys.y);
    const nodeY = (n) => (n.y !== undefined ? n.y : Fy(n.F));
    const nodes = {};
    for (const [k, n] of Object.entries(spec.nodes)) nodes[k] = { ...n, y: nodeY(n), ax: main, key: k };
    for (const [k, n] of Object.entries(spec.vnodes || {})) nodes[k] = { ...n, y: nodeY(n), ax: val, key: k };
    const pos = (k) => { const n = nodes[k]; return n ? [n.ax.X(n.x), n.ax.Y(n.y)] : null; };

    // a flow's centreline: the figure's quadratic Bezier in data coordinates, trimmed at both ends by a physical length
    function river(a, b, rad) {
      const A = nodes[a], B = nodes[b], ax = A.ax;
      const dx = B.x - A.x, dy = B.y - A.y, cx = (A.x + B.x) / 2 + rad * dy, cy = (A.y + B.y) / 2 - rad * dx;
      const pts = [];
      for (let i = 0; i < 80; i++) {
        const t = i / 79, u = 1 - t;
        pts.push([ax.X(u * u * A.x + 2 * u * t * cx + t * t * B.x), ax.Y(u * u * A.y + 2 * u * t * cy + t * t * B.y)]);
      }
      const r0 = 7.5, r1 = B.kind === 'sink' ? 3 : 8.5, P0 = pts[0], P1 = pts[79];
      return pts.filter((p) => Math.hypot(p[0] - P0[0], p[1] - P0[1]) > r0 && Math.hypot(p[0] - P1[0], p[1] - P1[1]) > r1);
    }
    const flows = [...(spec.flows || []).map((f) => ({ ...f, v: false })), ...(spec.vflows || []).map((f) => ({ ...f, v: true }))]
      .filter((f) => nodes[f.src] && nodes[f.dst]);
    flows.forEach((f) => { f.pts = river(f.src, f.dst, f.rad); });
    // a path between two nodes for an overlay: the flow if the figure has one, else the straight link (trimmed)
    function path(a, b) {
      const f = flows.find((x) => x.src === a && x.dst === b);
      if (f) return f.pts;
      const P = pos(a), Q = pos(b);
      if (!P || !Q) return null;
      const L = Math.hypot(Q[0] - P[0], Q[1] - P[1]), out = [];
      for (let i = 0; i <= 10; i++) { const s = (9 + (L - 18) * i / 10) / L; out.push([P[0] + (Q[0] - P[0]) * s, P[1] + (Q[1] - P[1]) * s]); }
      return out;
    }
    return { W, H, Fy, main, val, nodes, flows, pos, path };
  }

  // ------------------------------------------------------------------ text: TeX-like labels as SVG tspans
  const SYM = {
    sigma: 'σ', alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', nu: 'ν', mu: 'μ', epsilon: 'ϵ', varepsilon: 'ε', phi: 'ϕ', varphi: 'φ',
    psi: 'ψ', chi: 'χ', eta: 'η', lambda: 'λ', kappa: 'κ', omega: 'ω', pi: 'π', theta: 'θ', tau: 'τ', rho: 'ρ', zeta: 'ζ',
    Delta: 'Δ', Gamma: 'Γ', Lambda: 'Λ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω', Sigma: 'Σ', Theta: 'Θ',
    to: '→', rightarrow: '→', infty: '∞', approx: '≈', simeq: '≃', sim: '∼', equiv: '≡', neq: '≠', ne: '≠', leq: '≤', geq: '≥',
    times: '×', pm: '±', cdot: '·', ldots: '…', dots: '…', log: 'log', ln: 'ln', langle: '⟨', rangle: '⟩', partial: '∂',
  };
  const UPRIGHT = new Set(['log', 'ln', 'Delta', 'Gamma', 'Lambda', 'Phi', 'Psi', 'Omega', 'Sigma', 'Theta']);
  // TeX spacing: a thin space each side of a relation, and of a binary + or −, except in scripts and in a bare {=}
  const REL = new Set(['=', '<', '>', '≈', '≃', '∼', '≡', '≠', '≤', '≥', '→']);
  const THIN = '\u2009';
  /** Runs of {t, it, sh} from a label: $...$ is math (letters italic), ^ and _ raise and lower one group. */
  function runs(src, italicText) {
    const out = [];
    let i = 0, math = false;
    const push = (t, it, sh) => { if (!t) return; const last = out[out.length - 1]; if (last && last.it === it && last.sh === sh) last.t += t; else out.push({ t, it, sh }); };
    function group(s, sh) {                                // parse one math group string into runs
      let j = 0;
      const one = () => {                                  // the next atom (spaces before it do not count, as in TeX)
        while (s[j] === ' ') j++;
        const c = s[j];
        if (c === '{') {
          let depth = 1, k = j + 1;
          while (k < s.length && depth) { if (s[k] === '{') depth++; else if (s[k] === '}') depth--; k++; }
          const inner = s.slice(j + 1, k - 1); j = k; return { g: inner };
        }
        if (c === '\\') {
          let k = j + 1;
          if (/[a-zA-Z]/.test(s[k] || '')) { while (k < s.length && /[a-zA-Z]/.test(s[k])) k++; } else k++;
          const cmd = s.slice(j + 1, k); j = k; return { cmd };
        }
        j++; return { ch: c };
      };
      const lastCh = () => { const r = out[out.length - 1]; return r ? r.t.slice(-1) : ''; };
      const spaced = (c, sh2) => {                          // relation or binary operator, with TeX's spacing
        const binary = c === '+' || c === '−';
        const operand = /[\p{L}\p{N})\]′'*\u0302\u0304]/u.test(lastCh());
        if (sh2 || (binary && !operand)) { push(c, false, sh2); return; }
        push(THIN + c + THIN, false, sh2);
      };
      const atom = (a, sh2) => {
        if (a.g !== undefined) {
          const bare = a.g.trim().replace(/^\\(approx|simeq|sim|equiv|neq|ne|leq|geq|to|rightarrow)$/, (m, k) => SYM[k]).replace(/^-$/, '−');
          if (REL.has(bare) || bare === '+' || bare === '−') { push(bare, false, sh2); return; }   // {=}: no space
          group(a.g, sh2); return;
        }
        if (a.ch !== undefined) {
          const c = a.ch === '-' ? '−' : a.ch;
          if (REL.has(c) || c === '+' || c === '−') { spaced(c, sh2); return; }
          push(c, /[a-zA-Z]/.test(a.ch), sh2);
          return;
        }
        const cmd = a.cmd;
        if (cmd === ',' || cmd === ';' || cmd === ' ') { push(' ', false, sh2); return; }
        if (cmd === '|') { push('‖', false, sh2); return; }
        if (cmd === 'frac') {
          const num = one(), den = one();
          const txt = (x) => (x.g !== undefined ? x.g : x.ch || '');
          const wrap = (x) => (/[-+ ]|\\/.test(txt(x).replace(/^\\[a-z]+$/, '')) && txt(x).length > 1 ? 1 : 0);
          if (wrap(num)) push('(', false, sh2); atom(num, sh2); if (wrap(num)) push(')', false, sh2);
          push('/', false, sh2);
          if (wrap(den)) push('(', false, sh2); atom(den, sh2); if (wrap(den)) push(')', false, sh2);
          return;
        }
        if (cmd === 'hat' || cmd === 'bar' || cmd === 'tilde' || cmd === 'dot') {
          const mark = { hat: '̂', bar: '̄', tilde: '̃', dot: '̇' }[cmd];
          const arg = one();
          atom(arg, sh2);
          const last = out[out.length - 1]; if (last) last.t += mark;
          return;
        }
        if (cmd === 'left' || cmd === 'right' || cmd === 'mathrm' || cmd === 'text') return;
        const sym = SYM[cmd];
        if (sym && REL.has(sym)) spaced(sym, sh2);
        else if (cmd === 'log' || cmd === 'ln') push(sym + THIN, false, sh2);
        else if (sym) push(sym, !UPRIGHT.has(cmd) && /^[a-z]/.test(cmd), sh2);
        else push(cmd, false, sh2);
      };
      while (j < s.length) {
        const c = s[j];
        if (c === '^' || c === '_') { j++; atom(one(), c === '^' ? 'sup' : 'sub'); continue; }
        if (c === ' ') { j++; continue; }
        atom(one(), sh);
      }
    }
    while (i < src.length) {
      const k = src.indexOf('$', i);
      const piece = src.slice(i, k < 0 ? src.length : k);
      if (math) group(piece, 0); else push(piece, !!italicText, 0);
      if (k < 0) break;
      math = !math; i = k + 1;
    }
    return out;
  }
  /** One text block: lines at a given anchor, aligned like matplotlib (ha, va); optional white box sized later. */
  function text(x, y, str, o = {}) {
    const fs = (o.fs || 8) * PT, lines = String(str).split('\n'), lh = 1.16 * fs, asc = 0.77 * fs, desc = 0.23 * fs;
    const blockH = (lines.length - 1) * lh + asc + desc;
    const top = o.va === 'top' ? y : o.va === 'bottom' ? y - blockH : o.va === 'baseline' ? y - asc : y - blockH / 2;
    const anchor = o.ha === 'left' ? 'start' : o.ha === 'right' ? 'end' : 'middle';
    const halo = o.halo ? ` stroke="#fff" stroke-width="${f1(3 * PT)}" stroke-opacity=".8" stroke-linejoin="round" paint-order="stroke"` : '';
    const tl = lines.map((ln, li) => {
      let sh = 0;
      const spans = runs(ln, o.italic).map((r) => {
        const want = r.sh === 'sup' ? -0.36 * fs : r.sh === 'sub' ? 0.2 * fs : 0;
        const dy = want - sh; sh = want;
        const size = r.sh ? ` font-size="${f1(0.7 * fs)}"` : '';
        return `<tspan${dy ? ` dy="${f1(dy)}"` : ''}${size}${r.it ? ' font-style="italic"' : ' font-style="normal"'}>${esc(r.t)}</tspan>`;
      }).join('');
      return `<text x="${f1(x)}" y="${f1(top + asc + li * lh)}" text-anchor="${anchor}" font-size="${f1(fs)}"${o.italic ? ' font-style="italic"' : ''} fill="${o.color || '#1d2733'}" style="white-space:pre"${halo}>${spans}</text>`;
    }).join('');
    const box = o.box ? ` data-box="${o.box.pad * fs},${o.box.fc},${o.box.ec || 'none'},${o.box.lw || 0},${o.box.alpha}"` : '';
    return `<g class="tx"${box}>${tl}</g>`;
  }

  // ------------------------------------------------------------------ drawing
  const MARK = {
    u: { s: 6.5, fc: 'node_u', ec: '#fff', ew: 1.0 }, free: { s: 5.0, fc: 'node_free', ec: '#fff', ew: 0.9 },
    nu: { s: 5.2, fc: 'node_nu', ec: '#fff', ew: 0.9, shape: 'D' }, q: { s: 6.2, fc: '#fff', ec: 'node_u', ew: 1.1, dot: 2.2 },
    src: { s: 6.5, fc: '#6d7f8e', ec: '#fff', ew: 0.9, shape: '^' }, sea: { s: 5.5, fc: '#4f7f9c', ec: '#fff', ew: 0.9 },
  };
  function marker(x, y, kind, colors) {
    if (kind === 'sink') return `<line x1="${f1(x - 3.5 * PT)}" y1="${f1(y)}" x2="${f1(x + 3.5 * PT)}" y2="${f1(y)}" stroke="#4f7f9c" stroke-width="${f1(1.2 * PT)}"/>`;
    const m = MARK[kind] || MARK.u, col = (c) => colors[c] || c, r = (m.s / 2) * PT;
    const st = `fill="${col(m.fc)}" stroke="${col(m.ec)}" stroke-width="${f1(m.ew * PT)}"`;
    let s;
    if (m.shape === 'D') s = `<path d="M${f1(x)},${f1(y - r)}L${f1(x + r * 0.78)},${f1(y)}L${f1(x)},${f1(y + r)}L${f1(x - r * 0.78)},${f1(y)}Z" ${st}/>`;
    else if (m.shape === '^') s = `<path d="M${f1(x)},${f1(y - r)}L${f1(x + r * 0.87)},${f1(y + r * 0.5)}L${f1(x - r * 0.87)},${f1(y + r * 0.5)}Z" ${st}/>`;
    else s = `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(r)}" ${st}/>`;
    if (m.dot) s += `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1((m.dot / 2) * PT)}" fill="${col('node_u')}"/>`;
    return s;
  }
  /** A river: tapered body (or dashes) with a white halo, and the arrowhead. */
  function riverSVG(pts, status, colors, lw0 = 0.8, lw1 = 2.4) {
    if (pts.length < 6) return '';
    const col = colors[status];
    const n = pts.length, tip = pts[n - 1], from = pts[n - 6];
    const d = [tip[0] - from[0], tip[1] - from[1]], L = Math.hypot(...d), u = [d[0] / L, d[1] / L], nv = [-u[1], u[0]];
    const hl = 4.2 * PT, hw = 2.4 * PT;
    const base = [tip[0] - u[0] * hl, tip[1] - u[1] * hl];
    const head = `<path d="M${f1(tip[0])},${f1(tip[1])}L${f1(base[0] + nv[0] * hw)},${f1(base[1] + nv[1] * hw)}L${f1(base[0] - nv[0] * hw)},${f1(base[1] - nv[1] * hw)}Z" fill="${col}" stroke="${col}" stroke-width="${f1(0.8 * PT)}" stroke-linejoin="miter"/>`
      + `<line x1="${f1(from[0])}" y1="${f1(from[1])}" x2="${f1(base[0])}" y2="${f1(base[1])}" stroke="${col}" stroke-width="${f1(0.8 * PT)}"/>`;
    if (status === 'hard' || status === 'sign') {
      const dash = status === 'hard' ? [4.0, 2.2] : [1.0, 1.6];
      const lw = 1.5 * PT, da = dash.map((v) => f1(v * lw)).join(' ');
      const dd = 'M' + pts.slice(0, n - 3).map((p) => `${f1(p[0])},${f1(p[1])}`).join('L');
      return `<path d="${dd}" fill="none" stroke="#fff" stroke-opacity=".85" stroke-width="${f1(4 * PT)}" stroke-dasharray="${da}" stroke-linecap="round"/>`
        + `<path d="${dd}" fill="none" stroke="${col}" stroke-width="${f1(lw)}" stroke-dasharray="${da}" stroke-linecap="round"/>` + head;
    }
    const body = pts.slice(0, n - 3), m = body.length - 1;
    const outline = (extra) => {
      const left = [], right = [];
      body.forEach((p, i) => {
        const a = body[Math.max(0, i - 1)], b = body[Math.min(m, i + 1)];
        const tx = b[0] - a[0], ty = b[1] - a[1], tl = Math.hypot(tx, ty) || 1, nx = -ty / tl, ny = tx / tl;
        const w = ((lw0 + (lw1 - lw0) * i / m) * PT + extra) / 2;
        left.push([p[0] + nx * w, p[1] + ny * w]); right.push([p[0] - nx * w, p[1] - ny * w]);
      });
      return 'M' + [...left, ...right.reverse()].map((p) => `${f1(p[0])},${f1(p[1])}`).join('L') + 'Z';
    };
    return `<path d="${outline(2.6 * PT)}" fill="#fff" fill-opacity=".85" stroke="#fff" stroke-opacity=".85" stroke-width="${f1(0.6 * PT)}" stroke-linejoin="round"/>`
      + `<path d="${outline(0)}" fill="${col}" stroke="${col}" stroke-width="${f1(0.25 * PT)}" stroke-linejoin="round"/>` + head;
  }
  function flowLabel(f, colors, fs) {
    if (!f.label || !f.pts.length) return '';
    const i = Math.max(0, Math.min(f.pts.length - 1, Math.floor(f.t * (f.pts.length - 1))));
    const [x, y] = f.pts[i];
    return text(x + f.off[0] * PT, y - f.off[1] * PT, f.label, { fs, ha: f.ha, va: 'center', color: colors[f.status], box: { pad: 0.16, fc: '#fff', alpha: 0.72 } });
  }
  function nodeLabel(n, x, y, fs) {
    if (!n.label) return '';
    return text(x + n.off[0] * PT, y - n.off[1] * PT, n.label, { fs, ha: n.ha, va: n.va, color: '#1d2733', box: { pad: 0.2, fc: '#fff', ec: '#c9d2da', lw: 0.4, alpha: 0.8 } });
  }
  // Catmull-Rom through points (the real-Q family line)
  function smooth(P) {
    let d = `M${f1(P[0][0])},${f1(P[0][1])}`;
    for (let i = 0; i < P.length - 1; i++) {
      const p0 = P[i - 1] || P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] || p2;
      d += ` C${f1(p1[0] + (p2[0] - p0[0]) / 6)},${f1(p1[1] + (p2[1] - p0[1]) / 6)} ${f1(p2[0] - (p3[0] - p1[0]) / 6)},${f1(p2[1] - (p3[1] - p1[1]) / 6)} ${f1(p2[0])},${f1(p2[1])}`;
    }
    return d;
  }

  // ------------------------------------------------------------------ terrain: Gaussian massifs, hill shading, contours
  const hexrgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  function cmapAt(stops, t) {
    t = Math.min(1, Math.max(0, t)) * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(t)), u = t - i, a = stops[i], b = stops[i + 1];
    return [0, 1, 2].map((k) => a[k] + (b[k] - a[k]) * u);
  }
  function terrain(ax, massifs, base, cmapHex, nx, ny, levels) {
    const xs = Array.from({ length: nx }, (_, i) => ax.x0 + (ax.x1 - ax.x0) * i / (nx - 1));
    const ys = Array.from({ length: ny }, (_, j) => ax.y0 + (ax.y1 - ax.y0) * j / (ny - 1));
    const Z = new Float64Array(nx * ny);
    let zmin = Infinity, zmax = -Infinity;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const X = xs[i], Y = ys[j];
        let z = base * (Y - ys[0]) / (ys[ny - 1] - ys[0]);
        for (const [x0, y0, sx, sy, A, p] of massifs) { const r2 = ((X - x0) / sx) ** 2 + ((Y - y0) / sy) ** 2; z += A * Math.exp(-0.5 * r2 ** p); }
        z += 0.03 * Math.sin(1.3 * X + 0.7 * Y) * Math.cos(0.6 * X - 1.1 * Y);
        Z[j * nx + i] = z; if (z < zmin) zmin = z; if (z > zmax) zmax = z;
      }
    }
    // hill shade (light from the north-west, 38 degrees up, vertical exaggeration 6), soft-light blend on the colours
    const dx = xs[1] - xs[0], dy = ys[1] - ys[0], az = (90 - 315) * Math.PI / 180, alt = 38 * Math.PI / 180;
    const L = [Math.cos(az) * Math.cos(alt), Math.sin(az) * Math.cos(alt), Math.sin(alt)];
    const I = new Float64Array(nx * ny);
    let imin = Infinity, imax = -Infinity;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const zx = 6 * (Z[j * nx + Math.min(nx - 1, i + 1)] - Z[j * nx + Math.max(0, i - 1)]) / (dx * (i > 0 && i < nx - 1 ? 2 : 1));
        const zy = 6 * (Z[Math.min(ny - 1, j + 1) * nx + i] - Z[Math.max(0, j - 1) * nx + i]) / (dy * (j > 0 && j < ny - 1 ? 2 : 1));
        const nl = Math.hypot(zx, zy, 1), v = (-zx * L[0] - zy * L[1] + L[2]) / nl;
        I[j * nx + i] = v; if (v < imin) imin = v; if (v > imax) imax = v;
      }
    }
    const stops = cmapHex.map(hexrgb), vmax = zmax * 1.05;
    const cv = document.createElement('canvas'); cv.width = nx; cv.height = ny;
    const cx = cv.getContext('2d'), img = cx.createImageData(nx, ny);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i, it = (I[k] - imin) / ((imax - imin) || 1), rgb = cmapAt(stops, (Z[k] - zmin) / (vmax - zmin));
        const o = ((ny - 1 - j) * nx + i) * 4;                     // row 0 of the image is the top
        for (let c = 0; c < 3; c++) img.data[o + c] = 255 * Math.min(1, Math.max(0, 2 * it * rgb[c] + (1 - 2 * it) * rgb[c] * rgb[c]));
        img.data[o + 3] = 255;
      }
    }
    cx.putImageData(img, 0, 0);
    // contours by marching squares, in figure units
    const segs = [];
    const X = (i) => ax.X(xs[0] + i * dx), Y = (j) => ax.Y(ys[0] + j * dy);
    for (let l = 1; l <= levels; l++) {
      const v = zmin + (zmax - zmin) * l / (levels + 1);
      for (let j = 0; j < ny - 2; j += 2) {
        for (let i = 0; i < nx - 2; i += 2) {
          const a = Z[j * nx + i], b = Z[j * nx + i + 2], c = Z[(j + 2) * nx + i + 2], d = Z[(j + 2) * nx + i];
          const idx = (a > v) | ((b > v) << 1) | ((c > v) << 2) | ((d > v) << 3);
          if (idx === 0 || idx === 15) continue;
          const e = [];                                    // crossings on the four edges
          if ((a > v) !== (b > v)) e.push([X(i + 2 * (v - a) / (b - a)), Y(j)]);
          if ((b > v) !== (c > v)) e.push([X(i + 2), Y(j + 2 * (v - b) / (c - b))]);
          if ((d > v) !== (c > v)) e.push([X(i + 2 * (v - d) / (c - d)), Y(j + 2)]);
          if ((a > v) !== (d > v)) e.push([X(i), Y(j + 2 * (v - a) / (d - a))]);
          for (let q = 0; q + 1 < e.length; q += 2) segs.push(`M${f1(e[q][0])},${f1(e[q][1])}L${f1(e[q + 1][0])},${f1(e[q + 1][1])}`);
        }
      }
    }
    return { url: cv.toDataURL('image/png'), contours: segs.join('') };
  }

  // ------------------------------------------------------------------ the whole figure
  function svg(spec, opts = {}) {
    const G = geom(spec), { W, H, main, val, nodes } = G;
    const colors = { ...spec.colors };
    const fsN = spec.fs.node, fsF = spec.fs.flow;
    const out = [];
    const rect = (ax) => `x="${f1(ax.l)}" y="${f1(ax.t)}" width="${f1(ax.r - ax.l)}" height="${f1(ax.b - ax.t)}"`;
    out.push(`<defs><clipPath id="atl-main"><rect ${rect(main)}/></clipPath><clipPath id="atl-val"><rect ${rect(val)}/></clipPath>`
      + `<linearGradient id="atl-sea" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${spec.sea.colors[0]}"/><stop offset="1" stop-color="${spec.sea.colors[1]}"/></linearGradient></defs>`);
    out.push(`<rect width="${W}" height="${H}" fill="#fff"/>`);
    // terrain
    const R = spec.relief, T = terrain(main, spec.massifs, R.base, spec.terrain, opts.nx || 320, opts.ny || 170, R.levels);
    out.push(`<g clip-path="url(#atl-main)"><image href="${T.url}" ${rect(main)} preserveAspectRatio="none" opacity="${R.alpha}"/>`
      + `<path d="${T.contours}" fill="none" stroke="#5b6b78" stroke-width="${f1(0.35 * PT)}" stroke-opacity=".28"/></g>`);
    // plateau
    const pl = spec.plateau, px0 = main.X(pl.x), px1 = main.X(pl.x + pl.w), py0 = main.Y(pl.y + pl.h), py1 = main.Y(pl.y);
    out.push(`<rect x="${f1(px0)}" y="${f1(py0)}" width="${f1(px1 - px0)}" height="${f1(py1 - py0)}" rx="${f1(main.X(pl.r) - main.X(0))}" ry="${f1(main.Y(0) - main.Y(pl.r))}" fill="${pl.fc}" fill-opacity="${pl.alpha}" stroke="${pl.ec}" stroke-opacity="${pl.alpha}" stroke-width="${f1(0.9 * PT)}" stroke-dasharray="${f1(5 * 0.9 * PT)} ${f1(3 * 0.9 * PT)}"/>`);
    // sea and its waves
    const sy0 = main.Y(spec.sea.top), sy1 = main.Y(main.y0);
    out.push(`<rect x="${f1(main.l)}" y="${f1(sy0)}" width="${f1(main.r - main.l)}" height="${f1(sy1 - sy0)}" fill="url(#atl-sea)" opacity="${spec.sea.alpha}"/>`);
    spec.sea.waves.forEach(([a0, yy], k) => {
      const P = []; for (let i = 0; i <= 200; i++) { const x = main.x0 + (main.x1 - main.x0) * i / 200; P.push(`${f1(main.X(x))},${f1(main.Y(yy + a0 * Math.sin(2.2 * x + k)))}`); }
      out.push(`<polyline points="${P.join(' ')}" fill="none" stroke="#fff" stroke-width="${f1(0.8 * PT)}" stroke-opacity=".7"/>`);
    });
    // real-Q family line and identifications
    const fam = (spec.family || []).map((k) => G.pos(k)).filter(Boolean);
    if (fam.length > 1) {
      const lw = 1.0 * PT;
      out.push(`<path d="${smooth(fam)}" fill="none" stroke="${colors.id}" stroke-opacity=".9" stroke-width="${f1(lw)}" stroke-dasharray="${[6, 2, 1, 2].map((v) => f1(v * lw)).join(' ')}"/>`);
    }
    for (const [a, b] of spec.ident || []) {
      if (!nodes[a] || !nodes[b]) continue;
      const pts = (() => { const f = { src: a, dst: b }; const A = nodes[a], B = nodes[b], ax = A.ax, dx = B.x - A.x, dy = B.y - A.y, cx = (A.x + B.x) / 2 + 0.12 * dy, cy = (A.y + B.y) / 2 - 0.12 * dx, P = []; for (let i = 0; i < 80; i++) { const t = i / 79, u = 1 - t; P.push([ax.X(u * u * A.x + 2 * u * t * cx + t * t * B.x), ax.Y(u * u * A.y + 2 * u * t * cy + t * t * B.y)]); } void f; return P.filter((p) => Math.hypot(p[0] - P[0][0], p[1] - P[0][1]) > 7.5 && Math.hypot(p[0] - P[79][0], p[1] - P[79][1]) > 8.5); })();
      if (pts.length > 1) out.push(`<polyline points="${pts.map((p) => `${f1(p[0])},${f1(p[1])}`).join(' ')}" fill="none" stroke="${colors.id}" stroke-width="${f1(0.9 * PT)}" stroke-dasharray="${f1(0.9 * PT)} ${f1(2.2 * 0.9 * PT)}"/>`);
    }
    // rivers, then nodes
    const mainFlows = G.flows.filter((f) => !f.v);
    mainFlows.forEach((f) => out.push(riverSVG(f.pts, f.status, colors)));
    for (const n of Object.values(nodes)) if (n.ax === main) out.push(marker(main.X(n.x), main.Y(n.y), n.kind, colors));
    // axis: spine, ticks, labels
    const xs = main.l;
    out.push(`<line x1="${f1(xs)}" y1="${f1(main.Y(spec.axis.spine[0]))}" x2="${f1(xs)}" y2="${f1(main.Y(spec.axis.spine[1]))}" stroke="#6c7680" stroke-width="${f1(0.6 * PT)}"/>`);
    for (const [F, lab] of spec.ticks) {
      const y = main.Y(G.Fy(F));
      out.push(`<line x1="${f1(xs - 3 * PT)}" y1="${f1(y)}" x2="${f1(xs)}" y2="${f1(y)}" stroke="#3c4650" stroke-width="${f1(0.5 * PT)}"/>`);
      out.push(text(xs - 5 * PT, y, lab, { fs: 8, ha: 'right', va: 'center', color: '#3c4650' }));
    }
    const ymid = (main.t + main.b) / 2;
    out.push(`<g transform="translate(${f1(xs - 52)},${f1(ymid)}) rotate(-90)">${text(0, 0, spec.axis.label, { fs: 8.5, ha: 'center', va: 'center', color: '#2a333c' })}</g>`);
    // free texts, flow labels, node labels, title
    const colorOf = (c) => colors[c] || c || '#1d2733';
    for (const t of spec.texts || []) out.push(text(main.X(t.x), main.Y(t.y), t.t, { fs: t.fs, ha: t.ha || 'center', va: 'center', italic: t.italic, color: colorOf(t.color), halo: t.halo, box: t.box ? { pad: 0.16, fc: '#fff', alpha: 0.72 } : null }));
    mainFlows.forEach((f) => out.push(flowLabel(f, colors, fsF)));
    for (const n of Object.values(nodes)) if (n.ax === main) out.push(nodeLabel(n, main.X(n.x), main.Y(n.y), fsN));
    out.push(text(main.r, main.t - 3 * PT, spec.title, { fs: 12, ha: 'right', va: 'bottom', color: '#1d2733' }));
    // legend (laid out by finish(), once its text can be measured)
    out.push(`<g class="atl-legend" data-cx="${f1(0.525 * W)}" data-cy="${f1((1 - 0.2455) * H)}">`
      + spec.legend.map((it) => `<g class="li" data-kind="${it.kind}" data-status="${esc(it.status || '')}" data-node="${esc(it.node || '')}">${text(0, 0, it.t, { fs: 8, ha: 'left', va: 'center', color: '#1d2733' })}</g>`).join('') + '</g>');

    // side valleys
    const V = spec.valley_relief, vm = spec.valley_titles.map(([x]) => [x, V.y0, V.sx, V.sy, V.A, V.p]);
    const TV = terrain(val, vm, V.base, spec.terrain, opts.nx || 320, 48, V.levels);
    out.push(`<g clip-path="url(#atl-val)"><image href="${TV.url}" ${rect(val)} preserveAspectRatio="none" opacity="${V.alpha}"/>`
      + `<path d="${TV.contours}" fill="none" stroke="#5b6b78" stroke-width="${f1(0.35 * PT)}" stroke-opacity=".28"/></g>`);
    for (let k = 1; k < spec.valley_titles.length; k++) {
      const xm = val.X(0.5 * (spec.valley_titles[k - 1][0] + spec.valley_titles[k][0]));
      out.push(`<line x1="${f1(xm)}" y1="${f1(val.Y(-0.6))}" x2="${f1(xm)}" y2="${f1(val.Y(3.75))}" stroke="#fff" stroke-width="${f1(1.2 * PT)}" stroke-opacity=".9"/>`);
    }
    for (const [x, t] of spec.valley_titles) out.push(text(val.X(x), val.Y(3.55), t, { fs: 8.5, ha: 'center', va: 'center', italic: true, color: '#33414d', halo: true }));
    const vFlows = G.flows.filter((f) => f.v);
    vFlows.forEach((f) => out.push(riverSVG(f.pts, f.status, colors, 0.7, 2.0)));
    for (const n of Object.values(nodes)) if (n.ax === val) out.push(marker(val.X(n.x), val.Y(n.y), n.kind, colors));
    for (const t of spec.valley_texts || []) out.push(text(val.X(t.x), val.Y(t.y), t.t, { fs: t.fs, ha: t.ha || 'center', va: 'center', color: colorOf(t.color), box: t.box ? { pad: 0.16, fc: '#fff', alpha: 0.72 } : null }));
    vFlows.forEach((f) => out.push(flowLabel(f, colors, fsF)));
    for (const n of Object.values(nodes)) if (n.ax === val) out.push(nodeLabel(n, val.X(n.x), val.Y(n.y), fsN));
    out.push(`<line x1="${f1(val.l)}" y1="${f1(val.t)}" x2="${f1(val.l)}" y2="${f1(val.b)}" stroke="#6c7680" stroke-width="${f1(0.6 * PT)}"/>`);
    out.push(`<g transform="translate(${f1(val.l - 14)},${f1((val.t + val.b) / 2)}) rotate(-90)">${text(0, 0, spec.valley_axis.label, { fs: 8.5, ha: 'center', va: 'center', color: '#2a333c' })}</g>`);

    return `<svg class="atlas-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(spec.title)}" font-family="Newsreader, 'Latin Modern Roman', 'CMU Serif', Georgia, serif">${out.join('')}</svg>`;
  }

  /** After the SVG is in the page: white boxes behind boxed labels, and the legend's columns. */
  function finish(root, spec) {
    if (!root) return;
    root.querySelectorAll('g.tx[data-box]').forEach((g) => {
      if (g.querySelector('rect.box')) return;
      const [pad, fc, ec, lw, alpha] = g.dataset.box.split(',');
      const bb = g.getBBox(), p = +pad;
      const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      r.setAttribute('class', 'box');
      r.setAttribute('x', f1(bb.x - p)); r.setAttribute('y', f1(bb.y - p));
      r.setAttribute('width', f1(bb.width + 2 * p)); r.setAttribute('height', f1(bb.height + 2 * p));
      r.setAttribute('rx', f1(p)); r.setAttribute('fill', fc); r.setAttribute('fill-opacity', alpha);
      if (ec !== 'none') { r.setAttribute('stroke', ec); r.setAttribute('stroke-width', f1(+lw * PT)); r.setAttribute('stroke-opacity', alpha); }
      g.insertBefore(r, g.firstChild);
    });
    const lg = root.querySelector('g.atl-legend');
    if (!lg || lg.dataset.done) return;
    const colors = spec.colors, fs = 8 * PT, items = [...lg.querySelectorAll('g.li')];
    const rows = 2, cols = Math.ceil(items.length / rows), handle = 2.3 * fs, gap = 0.5 * fs, colgap = 1.1 * fs, rowh = 1.3 * fs, pad = 0.45 * fs;
    const widths = items.map((g) => g.getBBox().width);
    const colW = Array.from({ length: cols }, (_, c) => Math.max(...items.slice(c * rows, c * rows + rows).map((_, k) => widths[c * rows + k])) + handle + gap);
    const totalW = colW.reduce((a, b) => a + b, 0) + colgap * (cols - 1) + 2 * pad, totalH = rows * rowh + 2 * pad;
    const x0 = +lg.dataset.cx - totalW / 2, y0 = +lg.dataset.cy - totalH / 2;
    const NS = 'http://www.w3.org/2000/svg';
    const frame = document.createElementNS(NS, 'rect');
    Object.entries({ x: x0, y: y0, width: totalW, height: totalH, rx: 0.5 * fs, fill: '#fff', 'fill-opacity': 0.92, stroke: '#c3ccd4', 'stroke-width': 0.5 * PT }).forEach(([k, v]) => frame.setAttribute(k, typeof v === 'number' ? f1(v) : v));
    lg.insertBefore(frame, lg.firstChild);
    let cx = x0 + pad;
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const g = items[c * rows + r];
        if (!g) continue;
        const cy = y0 + pad + rowh * (r + 0.5);
        g.setAttribute('transform', `translate(${f1(cx + handle + gap)},${f1(cy)})`);
        let h = '';
        if (g.dataset.kind === 'line') {
          const st = g.dataset.status, col = colors[st];
          const dash = st === 'hard' ? `stroke-dasharray="${f1(4 * 1.6 * PT)} ${f1(2.2 * 1.6 * PT)}"` : st === 'sign' ? `stroke-dasharray="${f1(1.6 * PT)} ${f1(1.6 * 1.6 * PT)}"` : st === 'id' ? `stroke-dasharray="${f1(1 * PT)} ${f1(2.2 * PT)}"` : '';
          const lw = st === 'hard' || st === 'sign' ? 1.6 : st === 'id' ? 1.0 : 2.4;
          h = `<line x1="${f1(-handle - gap)}" y1="0" x2="${f1(-gap)}" y2="0" stroke="${col}" stroke-width="${f1(lw * PT)}" ${dash}/>`;
        } else {
          h = marker(-gap - handle / 2, 0, g.dataset.node, colors);
        }
        g.insertAdjacentHTML('afterbegin', h);
      }
      cx += colW[c] + colgap;
    }
    lg.dataset.done = '1';
  }

  window.Atlas = { geom, svg, finish };
})();
