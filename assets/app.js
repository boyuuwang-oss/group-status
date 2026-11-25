/* Research status site.
   Renders data/status.json (written by collect.py) as four views: Live, Map, Paper, Activity. No build step, no libraries. */
(() => {
  'use strict';

  const POLL_MS = 60_000;
  // run after the browser has laid the page out; the timer covers background tabs, where frames are paused
  const afterLayout = (fn) => { let done = false; const run = () => { if (!done) { done = true; fn(); } }; requestAnimationFrame(run); setTimeout(run, 120); };
  const H = 3600e3, D = 24 * H;
  const S = { data: null, view: 'live', sel: null, feedFilter: 'all', feedWs: null, mode: null, keyinfo: null, key: null, atlas: null, atlasUrl: null, atlasBare: false, lattice: null, cover: false, loadedAt: 0 };
  const $ = (q, el = document) => el.querySelector(q);
  const $$ = (q, el = document) => [...el.querySelectorAll(q)];

  // ------------------------------------------------------------------ helpers
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const age = (t) => Date.now() - Date.parse(t);
  function ago(t) {
    if (!t) return '—';
    const s = Math.max(0, age(t) / 1000);
    if (s < 60) return `${Math.max(1, Math.round(s))} s ago`;
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    const d = Math.round(s / 86400);
    return d === 1 ? '1 day ago' : `${d} days ago`;
  }
  const short = (t) => { const s = age(t) / 1000; return s < 3600 ? `${Math.max(1, Math.round(s / 60))}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`; };
  const when = (t) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const base = (p) => String(p).split('/').pop();
  const plural = (n, a, b = a + 's') => `${n} ${n === 1 ? a : b}`;

  function act(t) {
    if (!t) return 'none';
    const a = age(t);
    return a < 6 * H ? 'now' : a < D ? 'today' : a < 7 * D ? 'week' : 'quiet';
  }
  const ACT_LABEL = { now: 'Working now', today: 'Active today', week: 'This week', quiet: 'Quiet', none: 'Not started' };
  const ST_LABEL = { written: 'In paper', draft: 'Drafting', empty: 'To write', out: 'Not in this draft', none: 'Not in paper' };
  const st = (w) => (w.paper && w.paper.status) || 'none';

  const cluster = (id) => S.data.clusters.find((c) => c.id === id) || { id, title: id, sub: '' };
  const hue = (cid) => { const i = S.data.clusters.findIndex((c) => c.id === cid); return `var(--c${i >= 0 && i < 8 ? i + 1 : 8})`; };
  const wsById = (id) => S.data.workstreams.find((w) => w.id === id);

  /** One line saying what an event did. */
  function what(e, html = false, wid = null) {
    if (!e) return '';
    const sc = (s) => (html ? `<span class="sc">${esc(s)}</span>` : s);
    if (e.kind === 'paper') {
      if (e.subject && !/^Update on Overleaf\.?$/.test(e.subject)) return html ? esc(e.subject) : e.subject;
      const touched = e.touched || [];
      const t = touched.find((x) => wid && (x.ws || []).includes(wid)) || touched[0];
      const txt = t ? `edited ${t.unit}${t.lines ? ` (${plural(t.lines, 'line')})` : ''}` : 'edited on Overleaf';
      return html ? esc(txt) : txt;
    }
    if (e.kind === 'agent') return html ? esc(e.subject) : e.subject;
    if (e.kind === 'export') {
      const n = (e.new || [])[0];
      if (n) {
        const d = n.doc || {};
        const head = d.title ? sc(d.title) : (html ? esc(d.text || '') : d.text || '');
        return html ? `new <code>${esc(base(n.path))}</code>${head ? ' — ' + head : ''}` : `new ${base(n.path)}${d.title ? ' — ' + d.title : ''}`;
      }
      const ed = (e.edited || []).map((f) => base(f.path || f));
      const txt = ed.length ? `edited ${ed.slice(0, 3).join(', ')}` : e.subject;
      return html ? esc(txt) : txt;
    }
    return html ? esc(e.subject) : e.subject;
  }
  const whoTag = (e) => `${esc(e.who)}${e.ai ? ' <span class="chip ai">AI</span>' : ''}`;
  const kindChip = (e) => `<span class="chip k-${e.kind}">${({ paper: 'Overleaf', export: 'export', agent: 'agent report' })[e.kind] || 'commit'}</span>`;

  // agents: their state, and how fresh their report is
  const agentById = (id) => (S.data.agents || []).find((a) => a.id === id);
  const STATE_LABEL = { working: 'working', blocked: 'blocked', waiting: 'waiting', done: 'done', idle: 'idle' };
  function agentDot(a) {
    if (a.state === 'working') { const x = act(a.updated); return x === 'week' || x === 'quiet' ? 'stale' : x; }
    return a.state;
  }
  const staleNote = (a) => (a.state === 'working' && a.updated && age(a.updated) > D ? ' · not updated for a day' : '');
  const mdA = (s) => mdi(s).replace(/<code>([a-z0-9][a-z0-9._-]+)<\/code>/g, (m, id) => (agentById(id) ? agentChip(id) : m));
  const askText = (t) => String(t || '').replace(/^\s*(@[a-z0-9._-]+[\s,:;]*)+/, '');
  const agentChip = (id) => { const a = agentById(id); return a ? `<button class="chip agent-chip" data-agent="${esc(id)}"><span class="dot a-${agentDot(a)}"></span>${esc(id)}</button>` : `<span class="chip">@${esc(id)}</span>`; };
  const wsChip = (id) => { const w = wsById(id); return w ? `<button class="chip ws" style="--hue:${hue(w.cluster)}" data-ws="${esc(id)}">${esc(w.title)}</button>` : ''; };
  const ST_SHORT = { written: 'in paper', draft: 'drafting', empty: 'to write', out: 'not in draft', none: '' };
  const stChip = (w, small = false) => (small && !ST_SHORT[st(w)] ? '' : `<span class="chip st-${st(w)}">${(small ? ST_SHORT : ST_LABEL)[st(w)]}</span>`);

  function spark(daily, w = 66, h = 16) {
    const max = Math.max(1, ...daily);
    const bw = w / daily.length;
    return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">${daily.map((v, i) => {
      const bh = v ? Math.max(2, (h - 1) * Math.sqrt(v / max)) : 1.5;
      return `<rect class="${v ? '' : 'z'}" x="${(i * bw + 0.5).toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${Math.max(1, bw - 1.2).toFixed(1)}" height="${bh.toFixed(1)}" rx="0.6"/>`;
    }).join('')}</svg>`;
  }

  /** Inline markdown: `code`, **bold**, [text](https://…). Input is escaped first. */
  function mdi(s) {
    const codes = [];
    s = esc(s).replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
    s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    return s.replace(/\u0000(\d+)\u0000/g, (_, k) => `<code>${codes[+k]}</code>`);
  }
  const plainMd = (s) => String(s || '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[`*]/g, '');

  /** Minimal markdown: paragraphs, lists, tables, `code`, **bold**, links. Input is escaped first. */
  function md(src) {
    if (!src) return '';
    const inline = mdi;
    return src.split(/\n{2,}/).map((block) => {
      const lines = block.split('\n');
      if (lines.every((l) => l.trim().startsWith('|'))) {
        const rows = lines.filter((l) => !/^\s*\|[\s:|-]+\|\s*$/.test(l)).map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
        const [head, ...body] = rows;
        return `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
      }
      if (/^\s*([-*]|\d+\.)\s/.test(lines[0])) {
        const ordered = /^\s*\d+\./.test(lines[0]);
        const items = [];
        for (const l of lines) {
          if (/^\s*([-*]|\d+\.)\s/.test(l)) items.push(l.replace(/^\s*([-*]|\d+\.)\s/, ''));
          else if (items.length) items[items.length - 1] += ' ' + l.trim();
        }
        const tag = ordered ? 'ol' : 'ul';
        return `<${tag}>${items.map((i) => `<li>${inline(i)}</li>`).join('')}</${tag}>`;
      }
      if (lines[0].startsWith('```')) return `<pre class="md-pre"><code>${esc(lines.filter((l) => !l.startsWith('```')).join('\n'))}</code></pre>`;
      return `<p>${inline(lines.join(' '))}</p>`;
    }).join('');
  }

  // ------------------------------------------------------------------ data
  // Plain mode reads data/status.json. The published copy (pages.py) has none: it holds data/status.enc, encrypted
  // with the team password (PBKDF2-SHA256 -> AES-256-CBC, HMAC-SHA256 over iv + ciphertext), decrypted here.
  const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const b64e = (u) => btoa(String.fromCharCode(...u));
  const keyName = () => `rs-key:${S.keyinfo.salt}`;
  const store = (fn) => { try { return fn(); } catch (_) { return null; } };

  async function deriveKey(password) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: b64d(S.keyinfo.salt), iterations: S.keyinfo.iter }, base, 512));
  }
  async function decrypt(buf, raw) {
    const data = new Uint8Array(buf);
    const body = data.slice(0, -32), tag = data.slice(-32);
    const hk = await crypto.subtle.importKey('raw', raw.slice(32), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    if (!(await crypto.subtle.verify('HMAC', hk, tag, body))) throw new Error('wrong password');
    const ak = await crypto.subtle.importKey('raw', raw.slice(0, 32), 'AES-CBC', false, ['decrypt']);
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv: body.slice(0, 16) }, ak, body.slice(16)));
  }
  async function fetchEnc(path, raw) {
    const r = await fetch(`${path}?ts=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${path}`);
    return decrypt(await r.arrayBuffer(), raw);
  }

  async function fetchStatus() {
    if (S.mode !== 'enc') {
      const r = await fetch(`data/status.json?ts=${Date.now()}`, { cache: 'no-store' });
      if (r.ok) { S.mode = 'plain'; return r.json(); }
      if (S.mode === 'plain') throw new Error(`HTTP ${r.status}`);
      const k = await fetch(`data/keyinfo.json?ts=${Date.now()}`, { cache: 'no-store' });
      if (!k.ok) throw new Error(`no data/status.json (HTTP ${r.status}) and no encrypted copy`);
      S.keyinfo = await k.json();
      S.mode = 'enc';
    }
    if (!S.key) {
      const saved = store(() => localStorage.getItem(keyName())) || store(() => sessionStorage.getItem(keyName()));
      if (!saved) return null;
      S.key = b64d(saved);
    }
    try {
      return JSON.parse(new TextDecoder().decode(await fetchEnc('data/status.enc', S.key)));
    } catch (err) {
      if (err.message !== 'wrong password') throw err;
      forgetKey();
      return null;
    }
  }

  function forgetKey() {
    S.key = null;
    if (S.keyinfo) { store(() => localStorage.removeItem(keyName())); store(() => sessionStorage.removeItem(keyName())); }
  }

  async function atlasUrl(d) {
    if (!d.atlas) return null;
    if (S.mode !== 'enc') return `data/${d.atlas}`;
    if (S.atlas && S.atlas.gen === d.generated) return S.atlas.url;
    try {
      const bytes = await fetchEnc('data/atlas.enc', S.key);
      if (S.atlas) URL.revokeObjectURL(S.atlas.url);
      S.atlas = { gen: d.generated, url: URL.createObjectURL(new Blob([bytes], { type: 'image/png' })) };
      return S.atlas.url;
    } catch (_) { return null; }
  }

  // The published copy is cached by browsers for up to 10 minutes. When a newer build is out, open the page again under
  // a new URL, which no cache holds, so the new code is loaded (at most once per build, in case a cache lags).
  async function checkBuild() {
    if (!window.SITE_BUILD) return;
    try {
      const r = await fetch(`data/build.json?ts=${Date.now()}`, { cache: 'no-store' });
      if (!r.ok) return;
      const { build } = await r.json();
      if (!build || build === window.SITE_BUILD) return;
      if (store(() => sessionStorage.getItem('rs-build-reload')) === build) return;
      store(() => sessionStorage.setItem('rs-build-reload', build));
      location.replace(`${location.pathname}?v=${encodeURIComponent(build)}${location.hash}`);
    } catch (_) { /* offline: try again at the next poll */ }
  }

  async function load(first = false) {
    S.loadedAt = Date.now();
    checkBuild();
    try {
      const d = await fetchStatus();
      // no key yet, or the saved key no longer opens the data; keep a lock screen that is already up (and its typing)
      if (!d) { if (!$('#unlock')) showLock(S.data ? 'The password has changed; enter the new one.' : ''); return; }
      const changed = !S.data || d.generated !== S.data.generated;
      S.data = d;
      S.atlasUrl = await atlasUrl(d);
      if (changed || first) render();
    } catch (err) {
      document.body.classList.remove('booting');
      if (first) $('#view').innerHTML = `<div class="warn">Could not read the data (${esc(err.message)}). Run <code>python3 website/collect.py --fetch</code>, then serve this folder, for example with <code>website/serve.sh</code>.</div>`;
    }
  }

  // The home page is the 3dCFT.com logo (the radial random lattice, re-sampled live) with one card under it: the
  // password form while the data are locked, an "Enter" button once they are open. Unlocking turns the form into that
  // button, and the button opens Live (or the page that was asked for). The lattice stops while the page is hidden or
  // idle, and on request.
  const WORDMARK = '<span class="d">3d</span>CFT<span class="com">.com</span>';
  const openCard = () => (S.mode === 'enc' ? '<p class="lock-ok"><i aria-hidden="true"></i>Unlocked on this device</p>' : '')
    + '<button class="lock-btn enter" type="submit" id="enter-btn">Enter <span aria-hidden="true">→</span></button>'
    + (S.mode === 'enc' ? '<button class="lock-forget" type="button" id="forget">Lock this device</button>' : '');
  const lockCard = (msgText) => `<label class="lock-label" for="pw">Team password</label>
        <div class="lock-row"><input type="password" id="pw" autocomplete="current-password" required>
        <button class="lock-btn" type="submit" id="unlock-btn">Unlock</button></div>
        <label class="remember"><input type="checkbox" id="remember" checked> Remember on this device</label>
        <p class="lock-err" id="lock-err" role="alert">${esc(msgText)}</p>
        <p class="lock-fine">For members of the group. The data are decrypted only in your browser.</p>`;
  function showCover(open, msgText = '') {
    document.body.classList.remove('booting');
    document.body.classList.toggle('locked', !open);
    document.body.classList.toggle('home', open);
    $('#drawer').hidden = true; $('#scrim').hidden = true;
    document.title = '3dCFT.com';
    const card = $('#unlock');
    if (card && $('#rrl')) {                                 // the logo is up already: change only the card
      if (card.dataset.state !== (open ? 'open' : 'locked')) {
        card.dataset.state = open ? 'open' : 'locked';
        card.innerHTML = open ? openCard() : lockCard(msgText);
        (open ? $('#enter-btn') : $('#pw')).focus();
      } else if (!open) $('#lock-err').textContent = msgText;
      return;
    }
    $('#view').innerHTML = `<section class="lock">
      <div class="lockup">
        <div class="lock-mark" id="lock-mark" tabindex="0" role="img" aria-label="3dCFT.com logo: a radial random lattice, re-sampled continuously, coloured from gold at the centre to cyan at the rim"><canvas id="rrl" aria-hidden="true"></canvas></div>
        <div class="lock-word"><h1 class="wordmark">${WORDMARK}</h1><p class="motto">Interactively solving conformal field theory in three dimensions</p>
          <form class="lock-card" id="unlock" data-state="${open ? 'open' : 'locked'}">${open ? openCard() : lockCard(msgText)}</form></div>
      </div>
      <button class="lock-ctl" id="lock-anim" type="button" aria-pressed="false">Pause animation</button>
    </section>`;
    if (S.lattice) S.lattice.stop();
    S.lattice = lattice($('#rrl'), $('#lock-anim'));
    $('#lock-mark').addEventListener('click', () => S.lattice && S.lattice.toggle());
    $('#lock-mark').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); S.lattice && S.lattice.toggle(); } });
    $('#lock-anim').addEventListener('click', () => S.lattice && S.lattice.toggle());
    (open ? $('#enter-btn') : $('#pw')).focus({ preventScroll: true });
  }
  function showLock(msgText = '') {
    S.data = null; S.cover = false;
    $('#foot').innerHTML = '';
    $('#ticker').hidden = true;
    $$('.nav a').forEach((a) => a.classList.remove('on'));
    showCover(false, msgText);
  }
  // Enter: Live from the home page, or the page that was asked for when the password was
  function enter() {
    S.cover = false;
    if (S.view === 'home') go('live'); else { render(); window.scrollTo(0, 0); }
  }

  // ------------------------------------------------------------------ the 3dCFT.com lattice (from the logo file)
  // Poisson points uniform in (log r, angle), Delaunay-joined, drifting outward in radial time and diffusing, so every
  // few seconds it is a new mesh; edges gold at the origin through pink and violet to cyan at the rim.
  // Incremental Bowyer-Watson triangulation with triangle adjacency and walking point location:
  // triangulate(n, xs, ys, order, cx, cy, span) -> { tv, tn, alive, nt }; xs, ys hold n + 3 slots (the last three take
  // the super-triangle, whose triangles the caller skips); tn[3t+i] is the neighbour opposite vertex i (-1: none).
  function makeDelaunay() {
    let CAP = 0, tv, tn, alive, stamp, freeList, byFirst, bySecond, X, Y;
    function ensure(nTri, nPts) {
      if (nTri > CAP) {
        CAP = Math.ceil(nTri * 1.5);
        tv = new Int32Array(3 * CAP); tn = new Int32Array(3 * CAP);
        alive = new Uint8Array(CAP); stamp = new Int32Array(CAP); freeList = new Int32Array(CAP);
      }
      if (!byFirst || byFirst.length < nPts) { byFirst = new Int32Array(nPts); bySecond = new Int32Array(nPts); }
    }
    const orient = (a, b, px, py) => (X[b] - X[a]) * (py - Y[a]) - (Y[b] - Y[a]) * (px - X[a]);
    function inCircle(t, px, py) {
      const a = tv[3 * t], b = tv[3 * t + 1], c = tv[3 * t + 2];
      const adx = X[a] - px, ady = Y[a] - py, bdx = X[b] - px, bdy = Y[b] - py, cdx = X[c] - px, cdy = Y[c] - py;
      return (adx * adx + ady * ady) * (bdx * cdy - cdx * bdy)
        + (bdx * bdx + bdy * bdy) * (cdx * ady - adx * cdy)
        + (cdx * cdx + cdy * cdy) * (adx * bdy - bdx * ady) > 0;
    }
    const bad = [], eA = [], eB = [], eN = [], made = [], stack = [];
    let st = 0;
    return function triangulate(n, xs, ys, order, cx, cy, span) {
      const N = n + 3;
      ensure(2 * N + 8, N);
      X = xs; Y = ys;
      xs[n] = cx - 30 * span; ys[n] = cy - 30 * span;
      xs[n + 1] = cx + 30 * span; ys[n + 1] = cy - 30 * span;
      xs[n + 2] = cx; ys[n + 2] = cy + 30 * span;
      stamp.fill(0);
      st = 0;
      let nt = 1, nfree = 0, last = 0;
      tv[0] = n; tv[1] = n + 1; tv[2] = n + 2; tn[0] = tn[1] = tn[2] = -1; alive[0] = 1;
      for (let k = 0; k < n; k++) {
        const p = order ? order[k] : k, px = xs[p], py = ys[p];
        let t = alive[last] ? last : 0, steps = 0, ok = false;         // 1. walk to a triangle holding p
        while (steps++ < 3 * N) {
          let moved = false;
          for (let i = 0; i < 3; i++) {
            if (orient(tv[3 * t + (i + 1) % 3], tv[3 * t + (i + 2) % 3], px, py) < 0) {
              const nb = tn[3 * t + i];
              if (nb >= 0) { t = nb; moved = true; break; }
            }
          }
          if (!moved) { ok = true; break; }
        }
        if (!ok || !inCircle(t, px, py)) {
          for (let q = 0; q < nt; q++) if (alive[q] && inCircle(q, px, py)) { t = q; break; }
        }
        st++;                                                          // 2. the cavity, grown from t
        bad.length = eA.length = eB.length = eN.length = made.length = 0;
        stack.length = 0; stack.push(t); stamp[t] = st;
        while (stack.length) {
          const u = stack.pop();
          bad.push(u);
          for (let i = 0; i < 3; i++) {
            const nb = tn[3 * u + i];
            if (nb >= 0 && stamp[nb] === st) continue;
            if (nb >= 0 && stamp[nb] !== -st && inCircle(nb, px, py)) { stamp[nb] = st; stack.push(nb); continue; }
            if (nb >= 0) stamp[nb] = -st;
            eA.push(tv[3 * u + (i + 1) % 3]); eB.push(tv[3 * u + (i + 2) % 3]); eN.push(nb);
          }
        }
        for (const u of bad) { alive[u] = 0; freeList[nfree++] = u; }
        for (let e = 0; e < eA.length; e++) {                          // 3. fan of new triangles over the boundary
          const id = nfree > 0 ? freeList[--nfree] : nt++;
          made.push(id);
          const a = eA[e], b = eB[e], nb = eN[e];
          tv[3 * id] = a; tv[3 * id + 1] = b; tv[3 * id + 2] = p;
          tn[3 * id + 2] = nb; alive[id] = 1; stamp[id] = 0;
          if (nb >= 0) {
            for (let i = 0; i < 3; i++) {
              if (tv[3 * nb + (i + 1) % 3] === b && tv[3 * nb + (i + 2) % 3] === a) { tn[3 * nb + i] = id; break; }
            }
          }
          byFirst[a] = id; bySecond[b] = id;
        }
        for (let e = 0; e < made.length; e++) {
          const id = made[e];
          tn[3 * id] = byFirst[eB[e]];
          tn[3 * id + 1] = bySecond[eA[e]];
        }
        last = made[made.length - 1];
      }
      return { tv, tn, alive, nt };
    };
  }

  /** The logo's lattice on a canvas: live with a play/pause button, or one still frame (animate: false; px: a fixed
   *  size in pixels for a canvas that is not on the page). Returns { toggle, stop, still(on) }. */
  function lattice(cv, btn, { animate = true, px = 0 } = {}) {
    const SZ = 512, C = 256, R = 236, RMIN = 7, DENS = 44, TPOW = 0.85;
    const U0 = Math.log(RMIN), U1 = Math.log(R * 1.15), SPAN_U = U1 - U0;
    const DRIFT = 0.075, SIGMA = 0.075;            // outward flow (e-folds per second) and diffusion per sqrt(second)
    const STOPS = [[0, '#FFE14D'], [0.18, '#FF9F1C'], [0.38, '#FF4F7B'], [0.58, '#C640E8'], [0.78, '#5A5CFF'], [1, '#12C2E9']];
    const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const grad = (t) => {
      t = Math.min(Math.max(t, 0), 1);
      for (let k = 1; k < STOPS.length; k++) {
        if (t <= STOPS[k][0]) {
          const [a, ca] = STOPS[k - 1], [b, cb] = STOPS[k], u = (t - a) / (b - a), x = hex(ca), y = hex(cb);
          return 'rgb(' + x.map((v, i) => Math.round(v + (y[i] - v) * u)).join(',') + ')';
        }
      }
      return STOPS[STOPS.length - 1][1];
    };
    const NB = 64, BAND = Array.from({ length: NB + 1 }, (_, k) => grad(k / NB));
    const gauss = () => { let u = 0, v = 0; while (u === 0) u = Math.random(); while (v === 0) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    const lam = DENS * 2 * Math.PI * SPAN_U;
    const n = 1 + Math.max(1, Math.round(lam + Math.sqrt(lam) * gauss()));   // index 0: the origin
    const Uc = new Float64Array(n), TH = new Float64Array(n);
    for (let i = 1; i < n; i++) { Uc[i] = U0 + SPAN_U * Math.random(); TH[i] = 2 * Math.PI * Math.random(); }
    const xs = new Float64Array(n + 3), ys = new Float64Array(n + 3), key = new Float64Array(n);
    const order = Array.from({ length: n }, (_, i) => i);
    const triangulate = makeDelaunay();
    const ctx = cv.getContext('2d');
    function step(dt) {
      const sd = SIGMA * Math.sqrt(dt);
      for (let i = 1; i < n; i++) {
        let u = Uc[i] + DRIFT * dt + sd * gauss();
        if (u >= U1) u -= SPAN_U; else if (u < U0) u += SPAN_U;            // radial time is periodic: S^2 x S^1
        Uc[i] = u;
        TH[i] = (TH[i] + sd * gauss()) % (2 * Math.PI);
      }
    }
    function place() {
      xs[0] = C; ys[0] = C; key[0] = 0;
      for (let i = 1; i < n; i++) {
        const r = Math.exp(Uc[i]);
        xs[i] = C + r * Math.cos(TH[i]); ys[i] = C + r * Math.sin(TH[i]);
        const cx = Math.floor(xs[i] / 24), cy = (ys[i] + 400) / 24;       // snake order keeps the walk short
        key[i] = cx * 1e4 + (cx % 2 ? 1e4 - cy : cy);
      }
      order.sort((a, b) => key[a] - key[b]);
    }
    function draw() {
      const W = cv.width, sc = W / SZ;
      if (!W) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, W);
      ctx.setTransform(sc, 0, 0, sc, 0, 0);
      const { tv, tn, alive, nt } = triangulate(n, xs, ys, order, C, C, 300);
      const sup = (t) => tv[3 * t] >= n || tv[3 * t + 1] >= n || tv[3 * t + 2] >= n;
      const paths = Array.from({ length: NB + 1 }, () => new Path2D());
      for (let t = 0; t < nt; t++) {
        if (!alive[t] || sup(t)) continue;
        for (let i = 0; i < 3; i++) {
          const nb = tn[3 * t + i];
          if (nb >= 0 && nb < t && alive[nb] && !sup(nb)) continue;            // each edge once
          const a = tv[3 * t + (i + 1) % 3], b = tv[3 * t + (i + 2) % 3];
          const x = Math.pow(Math.hypot((xs[a] + xs[b]) / 2 - C, (ys[a] + ys[b]) / 2 - C) / R, TPOW);
          if (x > 1.2) continue;
          const k = Math.min(NB, Math.floor(x * NB));
          paths[k].moveTo(xs[a], ys[a]); paths[k].lineTo(xs[b], ys[b]);
        }
      }
      const g = ctx.createRadialGradient(C, C, 0, C, C, 40);                  // glow at the origin
      g.addColorStop(0, 'rgba(255,225,77,0.95)'); g.addColorStop(1, 'rgba(255,225,77,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(C, C, 40, 0, 2 * Math.PI); ctx.fill();
      ctx.save();
      ctx.beginPath(); ctx.arc(C, C, R, 0, 2 * Math.PI); ctx.clip();
      ctx.lineCap = 'round'; ctx.globalAlpha = 0.9;
      for (let k = 0; k <= NB; k++) { ctx.strokeStyle = BAND[k]; ctx.lineWidth = 0.5 + 1.5 * Math.min(1, (k + 0.5) / NB); ctx.stroke(paths[k]); }
      ctx.globalAlpha = 1;
      const dots = Array.from({ length: NB + 1 }, () => new Path2D());
      for (let i = 0; i < n; i++) {
        const x = Math.pow(Math.hypot(xs[i] - C, ys[i] - C) / R, TPOW);
        if (x > 1) continue;
        const k = Math.min(NB, Math.floor(x * NB)), rr = 0.8 + 2.4 * x;
        dots[k].moveTo(xs[i] + rr, ys[i]); dots[k].arc(xs[i], ys[i], rr, 0, 2 * Math.PI);
      }
      for (let k = 0; k <= NB; k++) { ctx.fillStyle = BAND[k]; ctx.fill(dots[k]); }
      ctx.restore();
      ctx.strokeStyle = 'rgba(18,194,233,0.85)'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(C, C, R, 0, 2 * Math.PI); ctx.stroke();
      ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.arc(C, C, 4.5, 0, 2 * Math.PI); ctx.fill();
    }
    function size() {
      const w = px || Math.max(1, Math.round(cv.clientWidth * (window.devicePixelRatio || 1)));
      if (cv.width !== w) { cv.width = w; cv.height = w; }
      draw();
    }
    // runs only while wanted (not paused, no reduced motion) and while someone is looking (page shown, not idle)
    let wanted = animate && !matchMedia('(prefers-reduced-motion: reduce)').matches, held = document.documentElement.classList.contains('still') || document.hidden;
    let raf = 0, lastT = 0, dead = false;
    function frame(now) {
      raf = 0;
      if (dead || !wanted || held) return;
      const dt = lastT ? Math.min((now - lastT) / 1000, 0.05) : 0;
      lastT = now;
      if (dt > 0) { step(dt); place(); }
      draw();
      raf = requestAnimationFrame(frame);
    }
    function sync() {
      if (btn) {
        btn.textContent = wanted ? 'Pause animation' : 'Play animation';
        btn.setAttribute('aria-pressed', wanted ? 'false' : 'true');
      }
      if (wanted && !held && !raf && !dead) { lastT = 0; raf = requestAnimationFrame(frame); }
    }
    const ro = window.ResizeObserver && !px ? new ResizeObserver(size) : null;
    if (ro) ro.observe(cv);
    place(); size(); sync();
    return {
      toggle() { wanted = animate && !wanted; sync(); },
      still(on) { held = on; sync(); },
      stop() { dead = true; if (raf) cancelAnimationFrame(raf); raf = 0; if (ro) ro.disconnect(); },
    };
  }

  async function unlock(ev) {
    ev.preventDefault();
    const btn = $('#unlock-btn'), err = $('#lock-err');
    btn.disabled = true; err.textContent = ''; btn.textContent = 'Unlocking…';
    try {
      const raw = await deriveKey($('#pw').value);
      const d = JSON.parse(new TextDecoder().decode(await fetchEnc('data/status.enc', raw)));
      S.key = raw;
      const where = $('#remember').checked ? localStorage : sessionStorage;
      store(() => where.setItem(keyName(), b64e(raw)));
      S.data = d;
      S.atlasUrl = await atlasUrl(d);
      S.cover = true;                                   // stay on the logo until Enter
      showCover(true);
    } catch (e) {
      err.textContent = e.message === 'wrong password' ? 'That password does not open the data.' : `Could not unlock: ${e.message}`;
      btn.disabled = false; btn.textContent = 'Unlock';
    }
  }

  // ------------------------------------------------------------------ router
  function route() {
    const [, view = 'home', sel = null] = (location.hash || '#/home').split('/');
    S.view = ['home', 'live', 'agents', 'map', 'paper', 'activity'].includes(view) ? view : view ? 'live' : 'home';
    S.sel = sel ? decodeURIComponent(sel) : null;
  }
  function go(view, sel = null) { location.hash = `#/${view}${sel ? '/' + encodeURIComponent(sel) : ''}`; }

  // ------------------------------------------------------------------ shell
  function render() {
    if (!S.data) return;
    route();
    if (S.view === 'home' || S.cover) { showCover(true); return; }
    document.body.classList.remove('booting', 'home');
    if (S.lattice) { S.lattice.stop(); S.lattice = null; }
    const d = S.data;
    document.body.classList.remove('locked');
    $$('.nav a').forEach((a) => a.classList.toggle('on', a.dataset.view === S.view));
    $('#repo-link').href = d.project.github || '#';
    $('#repo-link').hidden = !d.project.github;
    $('#lock').hidden = S.mode !== 'enc';
    $('#brand-title').textContent = d.project.title || '';
    $('#tagline').textContent = d.project.tagline || '';
    document.title = `${S.view[0].toUpperCase()}${S.view.slice(1)} · ${d.project.title} · 3dCFT.com`;
    renderTicker();
    const v = $('#view');
    const keep = window.scrollY;
    v.innerHTML = ({ live: viewLive, agents: viewAgents, map: viewMap, paper: viewPaper, activity: viewActivity })[S.view]();
    if (S.view === 'live') afterLayout(atlasMounted);
    if (S.view === 'map') afterLayout(() => { fitMap(); focusNode(); });
    window.scrollTo(0, keep);
    if (S.view === 'live') afterLayout(focusSpot);
    renderDrawer();
    $('#foot').innerHTML = `Snapshot ${esc(when(d.generated))} · paper ${esc(d.paper.head || '—')} · ${esc(d.project.repo)} · refreshed by <code>website/collect.py</code>`;
  }

  function renderTicker() {
    const d = S.data;
    const e = d.events.find((x) => x.kind === 'paper' && !/^Update on Overleaf/.test(x.subject)) || d.events[0];
    const tk = $('#ticker');
    if (!e) { tk.hidden = true; return; }
    tk.hidden = false;
    tk.innerHTML = `<b>Just in:</b><span class="t-text">${e.kind === 'paper' ? 'Paper — ' : ''}${what(e, true)}</span><span class="t-when">${esc(e.who)} · ${ago(e.t)}</span><a href="#/${e.kind === 'paper' ? 'paper' : 'activity'}">${e.kind === 'paper' ? 'Open the paper' : 'All activity'} →</a>`;
  }

  function fresh() {
    const g = S.data.generated;
    return `<span class="fresh${age(g) > 2 * H ? ' stale' : ''}" title="Data written ${esc(when(g))}"><i></i>updated <span data-ago="${esc(g)}">${ago(g)}</span></span>`;
  }

  // ------------------------------------------------------------------ Live
  function viewLive() {
    const d = S.data;
    const ws = d.workstreams;
    const active24 = ws.filter((w) => w.last && age(w.last.t) < D).length;
    const commits7 = new Set(d.events.filter((e) => e.kind !== 'paper' && age(e.t) < 7 * D).map((e) => e.sha)).size;
    const units = d.paper.units || [];
    const written = units.filter((u) => u.status === 'written' || u.status === 'draft').length;
    const warn = d.paper.error ? `<div class="warn">Paper not read: ${esc(d.paper.error)}</div>` : '';
    const stats = [
      [ws.filter((w) => !w.planned).length, 'workstreams'],
      [active24, 'active in the last 24 h'],
      [commits7, 'commits in 7 days'],
      [`${written}/${units.length}`, 'paper parts written'],
      [d.stats.values, 'numbers quoted in the paper'],
    ];
    if ((d.agents || []).length) stats.splice(1, 0, [d.agents.length, 'agents reporting']);
    return `${warn}
    <section class="hero">
      <div class="hero-title"><h1>Live research map</h1>${fresh()}</div>
      <div class="stats">${stats.map(([n, l]) => `<div class="stat"><b>${esc(n)}</b><span>${esc(l)}</span></div>`).join('')}</div>
    </section>
    ${atlasPanel()}
    <section class="two">
      <div class="panel">
        <div class="panel-h"><h2>Inside the project</h2><span class="live-pill">LIVE</span></div>
        <p class="panel-sub">Commits on every branch, exports of the working repository and edits of the paper, newest first.</p>
        ${d.events.slice(0, 14).map(msg).join('')}
        <a class="more" href="#/activity">All activity →</a>
      </div>
      <div class="panel">${numbersPanel()}</div>
    </section>`;
  }

  // The paper's atlas with a ring at each line of work and a tag naming the agents on it. Positions are fractions of the
  // image, in map.json: a workstream's atlas.at (points; the first carries the tag; mini = small rings), atlas.tag with
  // side (r/l), v (t = top-aligned) and row (names side by side), atlas.via / from / end (the leader's path; line = false
  // leaves it out), atlas.label (text for spots the figure names differently); project.atlas_agents places agents that
  // report no workstream. An RG flow has atlas.paths instead of rings: points along the figure's own arrows, from the UV
  // fixed point to the IR one. Nothing is drawn over the arrow; the path only catches the pointer, and a tag's leader
  // ends on the arrow with a small dot.
  const hasPins = (w) => !!(w.atlas && ((w.atlas.at || []).length || (w.atlas.paths || []).length));
  const RING_R = 12, MINI_R = 8.5;                     // ring radii in CSS pixels (style.css .apin, .apin.mini)
  function atlasSpots() {
    const d = S.data;
    const spots = d.workstreams.filter(hasPins).map((w) => ({
      key: w.id, ws: w, ...w.atlas, agents: (w.agents || []).map(agentById).filter(Boolean),
    }));
    Object.entries(d.project.atlas_agents || {}).forEach(([id, p]) => {
      const a = agentById(id);
      if (a && (p.at || []).length) spots.push({ key: 'a:' + id, ws: null, ...p, agents: [a] });
    });
    return spots;
  }

  // busiest first: working, then waiting or blocked, idle, done; the most recent report first within each
  const RANK = { now: 0, today: 1, stale: 2, waiting: 3, blocked: 3, idle: 4, done: 5 };
  const byBusy = (ags) => [...ags].sort((x, y) => (RANK[agentDot(x)] ?? 6) - (RANK[agentDot(y)] ?? 6) || String(y.updated || '').localeCompare(String(x.updated || '')));
  const pill = (a, cls = '') => `<button class="atag-a${cls}" data-agent="${esc(a.id)}" title="${esc(a.id)} · ${esc(STATE_LABEL[a.state] || a.state)}${esc(staleNote(a))}: ${esc(a.task)}"><span class="dot a-${agentDot(a)}"></span>${esc(a.id)}</button>`;

  function atlasPanel() {
    const d = S.data;
    if (!S.atlasUrl) return '';
    const spots = atlasSpots();
    const pct = (v) => `${(100 * v).toFixed(2)}%`;
    const tagged = spots.filter((s) => s.tag && s.agents.length);
    const mid = (s) => { const p = s.paths[0]; return p[Math.floor((p.length - 1) / 2)]; };
    // leaders are laid out in pixels by layoutLeaders(), which stops them at the edge of the ring
    const lines = tagged.filter((s) => s.line !== false).map((s) => {
      const start = s.from || (s.at && s.at[0]) || mid(s);
      const r = s.from || !s.at ? 0 : s.mini ? MINI_R : RING_R;
      const dot = s.at ? '' : '<circle class="foot" r="3"/>';      // a flow: the leader's foot sits on the arrow
      return `<g class="lead" data-spot="${esc(s.key)}" data-pts="${esc(JSON.stringify([start, ...(s.via || []), s.end || s.tag]))}" data-r="${r}"><polyline class="case"/><polyline class="ink"/>${dot}</g>`;
    }).join('');
    const about = (s) => {
      const a = act(s.ws ? s.ws.last && s.ws.last.t : s.agents[0].updated);
      const name = s.ws ? s.ws.title : `${s.agents[0].id}${s.label ? ' · ' + s.label : ''}`;
      const when = s.ws ? ACT_LABEL[a] : `${STATE_LABEL[s.agents[0].state] || s.agents[0].state}, report ${ago(s.agents[0].updated)}`;
      const attr = s.ws ? `data-ws="${esc(s.ws.id)}"` : `data-agent="${esc(s.agents[0].id)}"`;
      return { a, name, when, attr };
    };
    const pins = spots.filter((s) => s.at).map((s) => {
      const { a, name, when, attr } = about(s);
      return s.at.map((p, i) => `<button class="apin p-${a}${i ? ' extra' : s.mini ? ' mini' : ''}" ${attr} data-spot="${esc(s.key)}" data-name="${esc(name)}" data-when="${esc(when)}" style="left:${pct(p[0])};top:${pct(p[1])}" aria-label="${esc(name)}: ${esc(when)}"></button>`).join('');
    }).join('');
    // RG flows: an invisible hit area along each arrow of the figure; pointing at it names the flow, clicking opens it
    const flows = spots.filter((s) => (s.paths || []).length).map((s) => {
      const { a, name, when, attr } = about(s);
      const [tx, ty] = mid(s);
      return `<g class="aflow p-${a}" ${attr} data-spot="${esc(s.key)}" data-name="${esc(name)}" data-when="${esc(when)}" data-tx="${pct(tx)}" data-ty="${pct(ty)}" data-paths="${esc(JSON.stringify(s.paths))}">${s.paths.map(() => '<path class="band"/>').join('')}<title>${esc(name)}</title></g>`;
    }).join('');
    // a tag shows at most four names and opens to all of them on hover or focus
    const tags = tagged.map((s) => {
      const ags = byBusy(s.agents);
      const shown = ags.length > 4 ? 3 : ags.length;
      const more = ags.length - shown;
      const cls = `atag side-${s.side === 'l' ? 'l' : 'r'}${s.v === 't' ? ' v-t' : ''}${s.row ? ' row' : ''}${more ? ' has-more' : ''}`;
      const width = s.row && s.side === 'l' ? `;max-width:${pct(s.tag[0])}` : '';
      return `<div class="${cls}" data-spot="${esc(s.key)}" style="left:${pct(s.tag[0])};top:${pct(s.tag[1])}${width}">
        ${s.label ? `<span class="atag-l">${esc(s.label)}</span>` : ''}${ags.map((a, i) => pill(a, i < shown ? '' : ' rest')).join('')}${more ? `<span class="atag-more" aria-hidden="true">+${more}</span>` : ''}</div>`;
    }).join('');
    // what the figure has no place for: lines of work without pins, and agents that report no workstream
    const placed = new Set(spots.flatMap((s) => s.agents.map((a) => a.id)));
    const off = d.workstreams.filter((w) => !hasPins(w));
    const loose = (d.agents || []).filter((a) => !placed.has(a.id) && !(a.workstream && wsById(a.workstream)));
    const offItem = (w) => {
      const ags = byBusy((w.agents || []).map(agentById).filter(Boolean));
      return `<span class="off-g${ags.length ? '' : ' none'}"><button class="off-ws" data-ws="${esc(w.id)}">${esc(w.title)}</button>${ags.map((a) => pill(a)).join('')}</span>`;
    };
    const legend = [['working', 'working'], ['waiting', 'waiting, or no report for a day'], ['blocked', 'blocked'], ['idle', 'idle'], ['done', 'done']]
      .map(([k, l]) => `<span><i class="ldot l-${k}"></i>${l}</span>`).join('');
    const rings = [['today', 'changed today'], ['week', 'this week'], ['quiet', 'quiet'], ['now', 'changed in the last 6 h']]
      .map(([k, l]) => `<span><i class="ring p-${k}"></i>${l}</span>`).join('') + '<span><i class="ring extra"></i>the same line of work, elsewhere</span>'
      + '<span><i class="flowsw"></i>an RG flow: the figure\'s own arrow</span>';
    const stale = d.atlas_sha && d.project.atlas_pins_sha && d.atlas_sha !== d.project.atlas_pins_sha;
    const ratio = d.atlas_size ? ` style="aspect-ratio:${d.atlas_size[0]} / ${d.atlas_size[1]}"` : '';
    return `<section class="panel atlas-live" aria-label="Who works where on the atlas">
      <div class="panel-h"><h2>Who works where</h2><button class="btn-ghost" id="atlas-toggle" type="button" aria-pressed="${S.atlasBare ? 'true' : 'false'}">${S.atlasBare ? 'Show agents' : 'Hide agents'}</button></div>
      <p class="panel-sub">The atlas from the paper. A ring marks each line of work at a fixed point, stronger the more recently it changed; an RG flow is the figure's own arrow between two fixed points. The dark tags name the agents working there. Point at a ring or an arrow for its name; click it or a name for the details.</p>
      <div class="atlas-legend"><div><span class="kicker">Agents</span>${legend}</div><div><span class="kicker">On the figure</span>${rings}</div></div>
      ${stale ? `<div class="warn">The figure in the paper has changed since these pins were placed, so some may be off. Their positions are <code>atlas</code> in <code>map.json</code>.</div>` : ''}
      <p class="atlas-hint">Scroll sideways for the whole atlas.</p>
      <div class="atlas-wrap"><div class="atlas-scroll" id="atlas-scroll"><div class="atlas-stage${S.atlasBare ? ' bare' : ''}" id="atlas-stage"${ratio}>
        <img src="${esc(S.atlasUrl)}" alt="${esc(d.project.atlas_caption || 'The atlas figure of the paper')}">
        <svg class="atlas-lines" id="atlas-lines" aria-hidden="true">${flows}${lines}</svg>
        ${pins}${tags}<div class="atip" id="atip" hidden></div>
      </div></div></div>
      ${off.length || loose.length ? `<div class="atlas-off"><span class="kicker">Not on the atlas</span>${off.map(offItem).join('')}${loose.length ? `<span class="off-g"><span class="off-ws plain">No workstream</span>${byBusy(loose).map((a) => pill(a)).join('')}</span>` : ''}</div>` : ''}
    </section>`;
  }

  // Leaders in pixels: from the edge of the ring (2 px out) through the bends to the tag, drawn twice (a white casing
  // under a thin ink line) so they do not read as lines of the figure. Run on every size change of the figure.
  function layoutLeaders() {
    const st = $('#atlas-stage'), svg = $('#atlas-lines');
    if (!st || !svg) return;
    const W = st.clientWidth, H = st.clientHeight;
    if (!W || !H) return;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    $$('g[data-pts]', svg).forEach((g) => {
      const pts = JSON.parse(g.dataset.pts).map(([x, y]) => [x * W, y * H]);
      const r = +g.dataset.r;
      if (r && pts.length > 1) {
        const [a, b] = pts, len = Math.hypot(b[0] - a[0], b[1] - a[1]), cut = Math.min(r + 2, len);
        if (len) pts[0] = [a[0] + (b[0] - a[0]) * cut / len, a[1] + (b[1] - a[1]) * cut / len];
      }
      const attr = pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
      g.querySelectorAll('polyline').forEach((l) => l.setAttribute('points', attr));
      const foot = g.querySelector('circle.foot');
      if (foot) { foot.setAttribute('cx', pts[0][0].toFixed(1)); foot.setAttribute('cy', pts[0][1].toFixed(1)); }
    });
    $$('g.aflow', svg).forEach((g) => {
      const bands = g.querySelectorAll('path.band');
      JSON.parse(g.dataset.paths).forEach((path, k) => {
        const P = path.map(([x, y]) => [x * W, y * H]);
        let d = `M${P[0][0].toFixed(1)},${P[0][1].toFixed(1)}`;
        for (let i = 0; i < P.length - 1; i++) {
          const p0 = P[i - 1] || P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] || p2;
          const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
          d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
        }
        if (bands[k]) bands[k].setAttribute('d', d);
      });
    });
  }
  const atlasRO = window.ResizeObserver ? new ResizeObserver(() => layoutLeaders()) : null;
  function atlasMounted() {
    const st = $('#atlas-stage');
    if (!st) return;
    if (atlasRO) { atlasRO.disconnect(); atlasRO.observe(st); }
    layoutLeaders();
    const sc = $('#atlas-scroll');
    const edge = () => sc.parentElement.classList.toggle('at-end', sc.scrollLeft + sc.clientWidth >= sc.scrollWidth - 2);
    sc.addEventListener('scroll', edge, { passive: true });
    edge();
  }

  // hovering a ring, its tag or its leader lights up the three together; a ring also shows its name at once
  function atlasHot(key, ring) {
    const stage = $('#atlas-stage');
    if (!stage) return;
    stage.classList.toggle('focus', !!key);
    $$('[data-spot]', stage).forEach((el) => el.classList.toggle('hot', !!key && el.dataset.spot === key));
    const tip = $('#atip');
    if (!tip) return;
    if (ring) {
      tip.innerHTML = `<b>${esc(ring.dataset.name)}</b><span>${esc(ring.dataset.when)}</span>`;
      tip.style.left = ring.dataset.tx || ring.style.left; tip.style.top = ring.dataset.ty || ring.style.top;
      tip.classList.toggle('below', parseFloat(tip.style.top) < 12);
      tip.hidden = false;
    } else tip.hidden = true;
  }
  document.addEventListener('pointerover', (ev) => {
    const t = ev.target.closest && ev.target.closest('#atlas-stage [data-spot]');
    if (t) atlasHot(t.dataset.spot, t.classList.contains('apin') || t.classList.contains('aflow') ? t : null);
  });
  document.addEventListener('pointerout', (ev) => {     // entering another spot is handled by its pointerover
    const t = ev.target.closest && ev.target.closest('#atlas-stage [data-spot]');
    const to = ev.relatedTarget && ev.relatedTarget.closest && ev.relatedTarget.closest('#atlas-stage [data-spot]');
    if (t && !to) atlasHot(null);
  });

  function msg(e) {
    const to = (e.ws || []).map((id) => wsById(id)).filter(Boolean);
    const target = e.kind === 'paper' ? 'paper' : to.length ? to.map((w) => w.title).slice(0, 2).join(', ') : e.kind === 'agent' ? 'agents board' : (e.branches || []).join(', ');
    let files = '';
    if (e.kind === 'agent' && e.changes) files = `<div class="msg-files">${esc(e.changes.join(' · '))}${e.owner ? ` · ${esc(e.owner)}` : ''}</div>`;
    if (e.kind === 'export' && e.new && e.new.length) {
      const d = e.new[0].doc;
      files = d && d.text ? `<div class="msg-files">${esc(d.text)}</div>` : '';
      if (e.new.length > 1) files += `<div class="msg-files">also new: ${e.new.slice(1).map((n) => esc(base(n.path))).join(', ')}</div>`;
    } else if (e.kind === 'export' && e.edited && e.edited.length) {
      files = `<div class="msg-files">${e.edited.map((f) => `${esc(f.path)} <span>+${f.add} −${f.del}</span>${f.title ? ` · <span class="sc">${esc(f.title)}</span>` : ''}`).join('<br>')}</div>`;
    } else if (e.kind === 'paper' && e.touched && e.touched.length) {
      files = `<div class="msg-files">${e.touched.slice(0, 4).map((t) => `${esc(t.unit)} (${t.lines})`).join(' · ')}</div>`;
    }
    const link = e.url ? `<a class="num" href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.sha)}</a>` : `<span class="num">${esc(e.sha)}</span>`;
    return `<article class="msg">
      <div class="msg-h"><span><span class="who">${whoTag(e)}</span> → ${esc(target)}</span><time datetime="${esc(e.t)}" title="${esc(when(e.t))}" data-ago="${esc(e.t)}">${ago(e.t)}</time></div>
      <p class="msg-q">${what(e, true)}</p>${files}
      <div class="msg-f">${kindChip(e)}${e.kind === 'agent' ? agentChip(e.who) : ''}${(e.ws || []).slice(0, 3).map(wsChip).join('')}${e.kind === 'agent' ? '' : `<span class="num">+${e.add} −${e.del}</span>`}${link}</div>
    </article>`;
  }

  function numbersPanel() {
    const MODEL = S.data.project.number_groups || {};
    const ms = S.data.paper.macros || [];
    if (!ms.length) return `<div class="panel-h"><h2>Numbers in the paper</h2></div><p class="panel-sub">No tracked numbers found in the paper's preamble.</p>`;
    const rounds = [...new Set(ms.map((m) => m.round))];
    const groups = {};
    ms.forEach((m) => { const k = Object.keys(MODEL).find((p) => m.name.startsWith(p)) || 'other'; (groups[k] = groups[k] || []).push(m); });
    const unused = ms.filter((m) => !m.uses).length;
    return `<div class="panel-h"><h2>Numbers in the paper</h2><span class="kicker">${esc(rounds.join(' · '))}</span></div>
      <p class="panel-sub">Values defined as macros in the paper's preamble, with the result file they come from. ${unused ? `${unused} not yet used in the text.` : 'All are used in the text.'}</p>
      <div class="scroll-y"><table class="t"><thead><tr><th>Quantity</th><th>Value</th><th>In text</th></tr></thead><tbody>
      ${Object.entries(groups).map(([k, list]) => `<tr class="grp"><td colspan="3">${esc(MODEL[k] || 'Other')}</td></tr>` + list.map((m) =>
        `<tr title="${esc(m.source)}"><td>${esc(m.label || m.name)}</td><td class="v">${esc(m.value)}</td><td class="v ${m.uses ? '' : 'faint'}">${m.uses ? '×' + m.uses : 'unused'}</td></tr>`).join('')).join('')}
      </tbody></table></div>`;
  }

  // ------------------------------------------------------------------ Map
  const CW = 236, CH = 150, GX = 70, GY = 24;
  function viewMap() {
    const ws = S.data.workstreams;
    const pos = (w) => ({ x: w.map.col * (CW + GX), y: w.map.row * (CH + GY) });
    const W = Math.max(...ws.map((w) => pos(w).x)) + CW, Hh = Math.max(...ws.map((w) => pos(w).y)) + CH;
    const edges = [];
    ws.forEach((w) => (w.after || []).forEach((src) => {
      const s = wsById(src); if (!s) return;
      const a = pos(s), b = pos(w);
      const x1 = a.x + CW, y1 = a.y + CH / 2, x2 = b.x - 6, y2 = b.y + CH / 2, mx = (x1 + x2) / 2;
      edges.push(`<path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" marker-end="url(#arr)"/>`);
    }));
    const legend = ['written', 'draft', 'empty', 'out', 'none'].map((k) => `<span><i class="bar" style="--c:var(--st-${k === 'none' ? 'out' : k})"></i>${ST_LABEL[k]}</span>`).join('') +
      ['now', 'today', 'week', 'quiet'].map((k) => `<span><i class="dot a-${k}"></i>${ACT_LABEL[k]}</span>`).join('');
    return `<section class="page-h"><div><h1>Research map</h1><p>Every line of work, left to right from the method to what it opens up. Arrows run from a prerequisite to the work that uses it. The bar on each card is its state in the paper; the dot and the bars at the bottom are its activity over the last ${S.data.days.length} days.</p></div>${fresh()}</section>
      <div class="legend" style="margin-bottom:12px">${legend}</div>
      <div class="map-wrap" id="map-wrap"><div class="map-canvas" id="map-canvas" style="width:${W}px;height:${Hh}px">
        <svg width="${W}" height="${Hh}" viewBox="0 0 ${W} ${Hh}"><defs><marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" style="fill:var(--ink-3);stroke:none"/></marker></defs>${edges.join('')}</svg>
        ${ws.map((w) => node(w, pos(w))).join('')}
      </div></div>`;
  }

  function node(w, p) {
    const a = act(w.last && w.last.t);
    const c = cluster(w.cluster);
    const s = st(w);
    const who = w.last ? `${short(w.last.t)} · ${w.last.who}` : w.planned ? 'planned' : '—';
    const ag = (w.agents || []).map(agentById).filter(Boolean);
    return `<button class="node${w.planned ? ' planned' : ''}${ag.length ? ' has-agent' : ''}${S.sel === w.id ? ' sel' : ''}" data-ws="${esc(w.id)}" style="left:${p.x}px;top:${p.y}px;width:${CW}px;height:${CH}px;--hue:${hue(w.cluster)};--c:var(--st-${s === 'none' ? 'out' : s})">
      <div class="node-top"><span class="node-cl">${esc(c.title)}</span>${stChip(w)}</div>
      <h3>${esc(w.title)}</h3>
      <p>${esc(w.summary || '')}</p>
      ${ag.length ? `<div class="node-agent"><span class="dot a-${agentDot(ag[0])}"></span>${esc(ag.map((x) => x.id).join(', '))} · ${esc(ag[0].state)}</div>` : ''}
      <div class="node-foot"><span class="dot a-${a}"></span><span class="who">${esc(who)}</span>${spark(w.daily)}</div>
    </button>`;
  }

  // the workstream a link points at: a card id, or the workstream of an agent
  const selWs = () => (!S.sel ? null : S.sel.startsWith('a:') ? (agentById(S.sel.slice(2)) || {}).workstream : S.sel);
  function flash(el) { el.classList.toggle('flash', false); void el.offsetWidth; el.classList.toggle('flash', true); }

  function focusNode() {
    const id = selWs();
    const node = id && document.querySelector(`.node[data-ws="${CSS.escape(id)}"]`);
    const wrap = $('#map-wrap'), cv = $('#map-canvas');
    if (!node || !wrap || !cv) return;
    const m = /scale\(([\d.]+)\)/.exec(cv.style.transform || '');
    const s = m ? parseFloat(m[1]) : 1;
    const dr = $('#drawer');
    const wr = wrap.getBoundingClientRect();
    const covered = !dr.hidden && innerWidth >= 900 ? Math.max(0, wr.right - dr.getBoundingClientRect().left) : 0;
    const visible = Math.max(240, wrap.clientWidth - covered);
    const x = 28 + (parseFloat(node.style.left) + CW / 2) * s;
    wrap.scrollTo({ left: Math.max(0, x - visible / 2), behavior: 'auto' });
    const r = node.getBoundingClientRect();
    if (r.top < 70 || r.bottom > innerHeight) window.scrollTo({ top: scrollY + r.top - Math.max(80, (innerHeight - r.height) / 2), behavior: 'auto' });
    flash(node);
  }

  // Live with a workstream (or agent) selected: mark its rings and tags, and bring the first ring into view
  function focusSpot() {
    const id = selWs();
    if (S.keepScroll) { S.keepScroll = false; return; }   // opened from the atlas: stay there
    const ring = id && document.querySelector(`#atlas-stage .apin[data-spot="${CSS.escape(id)}"], #atlas-stage .aflow[data-spot="${CSS.escape(id)}"]`);
    if (!ring) return;
    const r = ring.getBoundingClientRect();
    if (r.top < 90 || r.bottom > innerHeight - 20) window.scrollTo({ top: scrollY + r.top - innerHeight / 2, behavior: 'auto' });
  }

  function fitMap() {
    const wrap = $('#map-wrap'), cv = $('#map-canvas');
    if (!wrap || !cv) return;
    const W = parseFloat(cv.style.width), Hh = parseFloat(cv.style.height);
    const s = Math.min(1, Math.max(0.72, (wrap.clientWidth - 56) / W));
    cv.style.transform = `scale(${s})`;
    cv.style.marginBottom = `${28 - Hh * (1 - s)}px`;
    cv.style.marginRight = `${28 - W * (1 - s)}px`;
  }

  // ------------------------------------------------------------------ Paper
  function viewPaper() {
    const p = S.data.paper;
    if (p.error) return `<section class="page-h"><div><h1>Paper</h1></div></section><div class="warn">${esc(p.error)}</div>`;
    const units = p.units || [];
    const maxW = Math.max(1, ...units.map((u) => u.words));
    const counts = units.reduce((a, u) => ((a[u.status] = (a[u.status] || 0) + 1), a), {});
    let prevWs = '';
    const rows = units.map((u) => {
      const lv = u.para ? 2 : u.sub ? 1 : 0;
      const name = u.para || u.sub || u.sec;
      const num = u.para ? '' : u.num || '';
      const cnt = [u.words ? `${u.words} w` : '', u.figs ? `${u.figs} fig` : '', u.tables ? `${u.tables} tab` : '', u.values ? `${u.values} val` : '', u.notes.length ? `${u.notes.length} note` : ''].filter(Boolean).join(' · ');
      const key = (u.ws || []).join(',');
      const chips = key && key !== prevWs ? `<div class="u-ws">${u.ws.map(wsChip).join('')}</div>` : '';
      prevWs = key;
      return `<tr class="lv${lv} st-${u.status}"><td class="name"><span class="n">${esc(num)}</span>${esc(name)}${chips}</td>
        <td><span class="chip st-${u.status}">${ST_SHORT[u.status]}</span></td>
        <td class="bar"><div class="wbar"><i style="width:${(100 * u.words / maxW).toFixed(1)}%;--c:var(--st-${u.status === 'out' ? 'out' : u.status})"></i></div></td>
        <td class="cnt">${esc(cnt)}</td></tr>`;
    }).join('');
    const notes = units.flatMap((u) => u.notes.map((n) => ({ ...n, where: u.label })));
    const edits = (p.commits || []).slice(0, 12);
    const words = units.reduce((a, u) => a + u.words, 0);
    return `<section class="page-h"><div><h1>${esc(p.title)}</h1><div class="authors">${esc((p.authors || []).join(', '))}</div></div>
        <div style="display:flex;gap:10px;align-items:center">${fresh()}<a class="btn-dark" href="${esc(S.data.project.overleaf)}" target="_blank" rel="noopener">Open in Overleaf</a></div></section>
      <div class="stats" style="margin-bottom:22px">
        <div class="stat"><b>${(counts.written || 0) + (counts.draft || 0)}/${units.length}</b><span>parts written</span></div>
        <div class="stat"><b>${counts.empty || 0}</b><span>parts still empty</span></div>
        <div class="stat"><b>${words.toLocaleString()}</b><span>words</span></div>
        <div class="stat"><b>${units.reduce((a, u) => a + u.figs, 0)}</b><span>figures</span></div>
        <div class="stat"><b>${S.data.stats.values}</b><span>numbers quoted</span></div>
        <div class="stat"><b>${p.n_commits}</b><span>edits so far</span></div>
      </div>
      <div class="paper-grid">
        <div class="panel"><div class="panel-h"><h2>Outline</h2><span class="kicker">last edit ${ago(p.updated)}</span></div>
          <p class="panel-sub">Each section, subsection and titled paragraph of <code>${esc(S.data.project.paper_tex)}</code>, with its length and what it contains. Chips link the part to the work that feeds it.</p>
          <div class="scroll-x"><table class="outline">${rows}</table></div></div>
        <div>
          ${S.atlasUrl ? `<div class="panel" style="margin-bottom:22px"><figure class="atlas"><a href="${esc(S.atlasUrl)}" target="_blank" rel="noopener"><img src="${esc(S.atlasUrl)}" alt="${esc(S.data.project.atlas_caption || 'Figure from the paper')}" loading="lazy"></a><figcaption>${esc(S.data.project.atlas_caption || '')}</figcaption></figure></div>` : ''}
          <div class="panel" style="margin-bottom:22px"><div class="panel-h"><h2>Recent edits</h2></div>
            ${edits.map((c) => `<div class="edit"><div class="s">${esc(/^Update on Overleaf/.test(c.subject) ? 'Edited on Overleaf' : c.subject)}</div>
              <div class="u">${esc(c.who)} · ${ago(c.t)} · +${c.add} −${c.del}${c.touched.length ? ' · ' + c.touched.slice(0, 3).map((t) => esc(t.unit)).join(' · ') : ''}</div></div>`).join('')}</div>
          <div class="panel"><div class="panel-h"><h2>Notes in the source</h2><span class="kicker">${notes.length}</span></div>
            <p class="panel-sub">Comments between the authors, written with their note macros in the source.</p>
            ${notes.length ? notes.map((n) => `<div class="note"><div class="who">${esc(n.who)} · ${esc(n.where)} · line ${n.line}${n.commented ? ' · commented out' : ''}</div><p>${esc(n.text)}</p></div>`).join('') : '<p class="muted">None.</p>'}</div>
        </div>
      </div>`;
  }

  // ------------------------------------------------------------------ Agents
  const JOIN = `git fetch -q origin agents && git show origin/agents:agent_status.py > /tmp/agent_status.py
python3 /tmp/agent_status.py template YOUR-AGENT --owner "Your Name" --workstream WORKSTREAM > status.md
# edit status.md: task, what you are trying to do, plan, results, needs
python3 /tmp/agent_status.py publish status.md -m "what changed"
python3 /tmp/agent_status.py list            # everyone
python3 /tmp/agent_status.py inbox YOUR-AGENT  # requests to you`;

  function viewAgents() {
    const d = S.data;
    const ag = d.agents || [];
    const reqs = ag.flatMap((a) => a.needs.map((n) => ({ from: a, ...n })));
    const quiet = d.quiet_agents || [];
    const stats = [
      [ag.length, 'agents reporting'],
      [ag.filter((a) => a.state === 'working' && age(a.updated) < D).length, 'working, updated today'],
      [ag.filter((a) => a.state === 'blocked' || a.state === 'waiting').length, 'blocked or waiting'],
      [reqs.length, 'requests between agents'],
    ];
    const ws = (d.workstreams || []).map((w) => `<code>${esc(w.id)}</code>`).join(' ');
    const join = `<details class="panel join"${ag.length ? '' : ' open'}><summary><h2>How an agent joins</h2></summary>
      <p class="panel-sub">Each agent keeps one file, <code>agents/AGENT.md</code>, on the <code>agents</code> branch. The tool commits it there without touching the agent's own checkout, so it works from any branch. Ask your agent to publish when it starts a task, after each milestone or result, when it is blocked, and when it finishes; and to read <code>inbox</code> before it starts.</p>
      <pre class="code">${esc(JOIN)}</pre>
      <p class="panel-sub">In Results, write a file as <code>\`branch:path\`</code> (for example <code>\`on:on_models/README.md\`</code>) and the site links it. In Needs, address another agent as <code>@agent-id</code>. Workstream ids: ${ws}.</p></details>`;
    return `<section class="page-h"><div><h1>Agents</h1><p>What each agent is trying to do, its plan, what it has found and where to check it, and what it needs from the others. Every agent reports through one file on the <code>agents</code> branch of the repository.</p></div>${fresh()}</section>
      <div class="stats" style="margin-bottom:22px">${stats.map(([n, l]) => `<div class="stat"><b>${esc(n)}</b><span>${esc(l)}</span></div>`).join('')}</div>
      ${ag.length ? `<div class="agents">${ag.map(agentCard).join('')}</div>` : `<div class="panel empty-agents"><h2>No agent has reported yet</h2><p class="panel-sub">${d.agents_branch ? 'The agents branch exists but holds no status file.' : 'The agents branch does not exist yet; the first publish creates it.'} The commits below still show what the agents change.</p></div>`}
      <section class="two">
        <div class="panel"><div class="panel-h"><h2>Requests between agents</h2><span class="kicker">${reqs.length}</span></div>
          ${reqs.length ? reqs.map((r) => `<div class="req"><div class="m">${agentChip(r.from.id)} → ${r.to.length ? r.to.map(agentChip).join(' ') : '<span class="chip">anyone</span>'}</div><p>${mdA(askText(r.text))}</p></div>`).join('') : '<p class="muted">None open.</p>'}
          ${quiet.length ? `<h3 class="sub-h">Committing without a status file</h3>${quiet.map((q) => `<div class="req"><div class="m"><b>${esc(q.who)}</b>${q.owner && q.owner !== q.who ? ` · ${esc(q.owner)}` : ''} · ${plural(q.n_week, 'change')} this week · last ${ago(q.last.t)}</div><p>${what(q.last, true)}</p>${(q.ws || []).slice(0, 2).map(wsChip).join(' ')}</div>`).join('')}` : ''}
        </div>
        <div class="panel"><div class="panel-h"><h2>Reports</h2><span class="live-pill">LIVE</span></div>
          <p class="panel-sub">Every published update of a status file, newest first.</p>
          ${(d.agent_events || []).slice(0, 20).map(msg).join('') || '<p class="muted">No reports yet.</p>'}</div>
      </section>
      ${join}`;
  }

  function agentCard(a) {
    const done = a.plan.filter((s) => s.done).length;
    const next = a.plan.find((s) => !s.done);
    const w = a.workstream && wsById(a.workstream);
    return `<article class="agent-card s-${esc(a.state)}" data-agent="${esc(a.id)}" tabindex="0" role="button" aria-label="${esc(a.id)}: ${esc(a.task)}">
      <div class="agent-top"><span class="dot a-${agentDot(a)}"></span><code class="agent-id">${esc(a.id)}</code><span class="faint small">${esc(a.owner)}</span><span class="chip state s-${esc(a.state)}">${STATE_LABEL[a.state] || esc(a.state)}</span></div>
      <h3>${esc(a.task)}</h3>
      ${a.trying ? `<p class="agent-try">${esc(plainMd(a.trying))}</p>` : ''}
      ${a.plan.length ? `<div class="agent-plan"><div class="wbar"><i style="width:${(100 * done / a.plan.length).toFixed(0)}%;--c:var(--live)"></i></div><span class="small faint">${done}/${a.plan.length}${next ? ` · next: ${esc(plainMd(next.text))}` : ' · plan complete'}</span></div>` : ''}
      ${a.results.length || a.results_intro ? `<div class="agent-res"><span class="kicker">${a.results.length ? plural(a.results.length, 'result') : 'results'}</span><p>${mdA(a.results[0] || a.results_intro)}</p></div>` : ''}
      ${a.needs.length ? `<div class="agent-needs">${a.needs.slice(0, 2).map((n) => `<p><span class="faint">→ ${n.to.map((t) => '@' + esc(t)).join(' ') || 'anyone'}:</span> ${esc(plainMd(askText(n.text)))}</p>`).join('')}</div>` : ''}
      <div class="agent-foot"><span>updated ${a.updated ? ago(a.updated) : '—'}${esc(staleNote(a))}</span>${w ? wsChip(w.id) : a.workstream_raw ? `<span class="chip">${esc(a.workstream_raw)}</span>` : ''}</div>
    </article>`;
  }

  /** Links from a details panel to the same thing elsewhere on the site. */
  function navLinks(w, fromAgent) {
    const links = [];
    if (fromAgent) links.push(`<button class="nav-link" data-ws="${esc(w.id)}">◧ ${esc(w.title)}</button>`);
    if (hasPins(w) && (S.view !== 'live' || fromAgent)) links.push(`<a class="nav-link" href="#/live/${esc(encodeURIComponent(w.id))}">◎ On the atlas</a>`);
    if (S.view !== 'map' || fromAgent) links.push(`<a class="nav-link" href="#/map/${esc(encodeURIComponent(w.id))}">⌗ Show on map</a>`);
    if (!fromAgent) (w.agents || []).forEach((id) => links.push(`<button class="nav-link" data-agent="${esc(id)}">◉ Agent card: ${esc(id)}</button>`));
    if (!fromAgent && (w.paper.units || []).length) links.push(`<a class="nav-link" href="#/paper">¶ In the paper</a>`);
    return `<nav class="nav-links" aria-label="Open elsewhere">${links.join('')}</nav>`;
  }

  /** The agents that report on a workstream, with their plans, and what other agents' reports say about it. */
  function agentsOn(w) {
    const ags = (w.agents || []).map(agentById).filter(Boolean);
    let html = `<h3>Agents working on this</h3>`;
    html += ags.length ? ags.map((a) => {
      const done = a.plan.filter((x) => x.done).length;
      return `<div class="ag-sum s-${esc(a.state)}">
        <div class="ag-h">${agentChip(a.id)}<span class="chip state s-${esc(a.state)}">${STATE_LABEL[a.state] || esc(a.state)}</span><span class="faint small">${esc(a.owner)} · updated ${a.updated ? ago(a.updated) : '—'}${esc(staleNote(a))}</span></div>
        <p class="ag-task">${esc(a.task)}</p>
        ${a.plan.length ? `<div class="kicker">Plan · ${done}/${a.plan.length}</div><ul class="plan">${a.plan.map((x) => `<li class="${x.done ? 'done' : ''}"><span>${x.done ? '✓' : '○'}</span>${mdA(x.text)}</li>`).join('')}</ul>` : ''}
        ${a.needs.length ? `<div class="kicker" style="margin-top:8px">Needs</div>${a.needs.map((n) => `<p class="ag-need">→ ${n.to.length ? n.to.map(agentChip).join(' ') : 'anyone'} ${mdA(askText(n.text))}</p>`).join('')}` : ''}
        <button class="nav-link" data-agent="${esc(a.id)}">Full report: what it is trying to do, ${plural(a.results.length, 'result')}, history →</button>
      </div>`;
    }).join('') : `<p class="muted small">No agent publishes a status file for this line of work yet.</p>`;
    if ((w.quiet_agents || []).length) html += `<p class="small faint">Also committing here without a status file: ${esc(w.quiet_agents.join(', '))}.</p>`;
    if ((w.related || []).length) {
      html += `<h3>In other agents' reports</h3>` + w.related.map((r) => `<div class="rel"><div class="m">${agentChip(r.agent)}<span class="faint">${r.kind === 'plan' ? (r.done ? '✓ plan step' : '○ plan step') : r.kind === 'need' ? 'request' : r.kind}</span></div><p>${mdA(r.kind === 'need' ? askText(r.text) : r.text)}</p></div>`).join('');
    }
    return html;
  }

  function agentDrawer(a) {
    const done = a.plan.filter((s) => s.done).length;
    const w = a.workstream && wsById(a.workstream);
    return `<button class="btn-icon x" id="close" aria-label="Close">✕</button>
      <div class="kicker">Agent${a.owner ? ' · ' + esc(a.owner) : ''}</div>
      <h2 class="mono-h">${esc(a.id)}</h2>
      <div class="chips"><span class="chip state s-${esc(a.state)}">${STATE_LABEL[a.state] || esc(a.state)}</span>${w ? wsChip(w.id) : ''}<span class="chip">updated ${a.updated ? ago(a.updated) : '—'}${esc(staleNote(a))}</span></div>
      <p class="sum">${esc(a.task)}</p>
      ${w ? navLinks(w, a) : ''}
      ${a.trying ? `<h3>Trying to do</h3><div class="md">${md(a.trying)}</div>` : ''}
      ${a.plan.length ? `<h3>Plan · ${done}/${a.plan.length}</h3><ul class="plan">${a.plan.map((s) => `<li class="${s.done ? 'done' : ''}"><span>${s.done ? '✓' : '○'}</span>${mdA(s.text)}</li>`).join('')}</ul>` : ''}
      ${a.results.length || a.results_intro ? `<h3>Results</h3>${a.results_intro ? `<p class="res-intro">${mdA(a.results_intro)}</p>` : ''}<ul class="res">${a.results.map((r) => `<li>${mdA(r)}</li>`).join('')}</ul>` : ''}
      ${!a.needs.length ? '<h3>Needs from others</h3><p class="muted small">None.</p>' : ''}
      ${a.needs.length ? `<h3>Needs from others</h3>${a.needs.map((n) => `<div class="req"><div class="m">→ ${n.to.length ? n.to.map(agentChip).join(' ') : '<span class="chip">anyone</span>'}</div><p>${mdA(askText(n.text))}</p></div>`).join('')}` : ''}
      ${a.other.map((o) => `<h3>${esc(o.heading)}</h3><div class="md">${md(o.text)}</div>`).join('')}
      ${a.history.length ? `<h3>History</h3>${a.history.map((h) => `<div class="ev"><div class="m">${ago(h.t)} · ${esc(when(h.t))}</div>${esc(h.subject)}${h.changes ? `<div class="small faint">${esc(h.changes.join(' · '))}</div>` : ''}</div>`).join('')}` : ''}
      ${a.docs && a.docs.length ? `<h3>Documents</h3><ul class="res">${a.docs.map((doc) => `<li><a href="${esc(doc.url)}" target="_blank" rel="noopener">${esc(doc.name)} ↗</a></li>`).join('')}</ul>` : ''}
      <p class="small" style="margin-top:22px"><a href="${esc(a.url)}" target="_blank" rel="noopener">agents/${esc(a.id)}.md on GitHub ↗</a></p>`;
  }

  // ------------------------------------------------------------------ Activity
  function viewActivity() {
    const d = S.data;
    const days = d.days;
    const level = (n) => (n <= 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : n <= 7 ? 3 : 4);
    const rows = [{ id: '_paper', title: 'Paper (Overleaf)', cluster: null, daily: d.paper.daily || [], paper: true },
      ...d.workstreams.filter((w) => !w.planned)];
    const head = `<tr><th></th>${days.map((x, i) => `<th>${i % 3 === 0 || i === days.length - 1 ? esc(x.slice(5).replace('-', '/')) : ''}</th>`).join('')}<th></th></tr>`;
    const body = rows.map((w) => `<tr style="--hue:${w.paper ? 'var(--ink-2)' : hue(w.cluster)}"><td class="lab"><button ${w.paper ? 'data-go="paper"' : `data-ws="${esc(w.id)}"`}><span class="dot a-${w.paper ? act(d.paper.updated) : act(w.last && w.last.t)}"></span>${esc(w.title)}</button></td>
      ${days.map((x, i) => `<td class="cell" data-l="${level(w.daily[i] || 0)}" title="${esc(w.title)} · ${esc(x)} · ${w.daily[i] || 0}"></td>`).join('')}
      <td class="tot">${w.daily.reduce((a, b) => a + b, 0)}</td></tr>`).join('');
    const filt = S.feedFilter;
    const fw = S.feedWs && wsById(S.feedWs);
    // a workstream's own list reaches further back than the global feed
    let evs = (fw ? fw.events : d.events).filter((e) => filt === 'all' || e.kind === filt);
    return `<section class="page-h"><div><h1>Activity</h1><p>What changed, day by day, in each line of work. Counts are commits and exports on the repository's branches, and edits of the paper.</p></div>${fresh()}</section>
      <div class="panel" style="margin-bottom:22px"><div class="heat-wrap"><table class="heat">${head}${body}</table></div></div>
      <div class="panel"><div class="panel-h"><h2>Everything, newest first</h2><span class="kicker">${evs.length} shown</span></div>
        <div class="filters" role="group" aria-label="Filter">${[['all', 'All'], ['agent', 'Agent reports'], ['paper', 'Paper'], ['export', 'Exports'], ['commit', 'Branch commits']].map(([k, l]) => `<button data-filter="${k}" class="${filt === k ? 'on' : ''}">${l}</button>`).join('')}
        ${fw ? `<button data-filter-ws="" class="on">${esc(fw.title)} ✕</button>` : ''}</div>
        ${fw && fw.n_events > fw.events.length ? `<p class="panel-sub">The latest ${fw.events.length} of ${fw.n_events} changes.</p>` : ''}
        ${evs.slice(0, 80).map(msg).join('') || '<p class="muted">Nothing in this filter.</p>'}</div>`;
  }

  // ------------------------------------------------------------------ drawer
  // Wide screens: the panel sits beside the page, which narrows (and stays scrollable). Narrow screens: it covers the page.
  const wide = () => matchMedia('(min-width: 1200px)').matches;
  function panelLayout(open) {
    const was = document.body.classList.contains('panel-open');
    document.documentElement.style.setProperty('--hdr', `${$('.top').offsetHeight}px`);
    document.body.classList.toggle('panel-open', open);
    document.body.style.overflow = open && !wide() ? 'hidden' : '';
    if (was !== open) relayout();
  }
  function relayout() {
    if (S.view === 'live') afterLayout(layoutLeaders);
    if (S.view === 'map') afterLayout(() => { fitMap(); focusNode(); });
  }

  function renderDrawer() {
    if (!S.data) return;
    const dr = $('#drawer'), scrim = $('#scrim');
    const agent = S.sel && S.sel.startsWith('a:') && agentById(S.sel.slice(2));
    const w = !agent && S.sel && wsById(S.sel);
    // the atlas spot of what the panel shows: the workstream, or the agent's own spot or workstream
    const spot = w ? w.id : agent ? ((S.data.project.atlas_agents || {})[agent.id] ? 'a:' + agent.id : agent.workstream) : null;
    $$('#atlas-stage [data-spot]').forEach((n) => n.classList.toggle('sel', !!spot && n.dataset.spot === spot));
    if (!w && !agent) { dr.hidden = true; scrim.hidden = true; panelLayout(false); return; }
    if (agent) {
      const reopenedA = dr.hidden;
      dr.innerHTML = agentDrawer(agent);
      dr.hidden = false; scrim.hidden = false; panelLayout(true);
      if (reopenedA) dr.scrollTop = 0;
      return;
    }
    const d = S.data;
    const a = act(w.last && w.last.t);
    const c = cluster(w.cluster);
    const units = (w.paper.units || []).map((k) => d.paper.units[k]).filter(Boolean);
    const macros = (d.paper.macros || []).filter((m) => (w.macros || []).includes(m.name));
    const last = w.last;
    dr.innerHTML = `<button class="btn-icon x" id="close" aria-label="Close">✕</button>
      <div class="kicker" style="color:${hue(w.cluster)}">${esc(c.title)} · ${esc(c.sub)}</div>
      <h2>${esc(w.title)}</h2>
      <div class="chips">${stChip(w)}<span class="chip"><span class="dot a-${a}"></span>${ACT_LABEL[a]}</span>${w.auto ? '<span class="chip st-empty">not yet in map.json</span>' : ''}${(w.people || []).map((p) => `<span class="chip">${esc(p)}</span>`).join('')}</div>
      <p class="sum">${esc(w.summary || '')}</p>
      ${navLinks(w, null)}
      ${agentsOn(w)}
      ${[[w.last_work, 'Latest work'], [w.last_paper, 'Latest paper edit']].filter(([e]) => e).map(([e, label]) => `<h3>${label}</h3><div class="now-box"><div class="meta">${whoTag(e)} · ${ago(e.t)} · ${esc(when(e.t))}</div><p class="q">${what(e, true, w.id)}</p>
        ${e.new && e.new[0] && e.new[0].doc && e.new[0].doc.text ? `<p class="muted small" style="margin:6px 0 0">${esc(e.new[0].doc.text)}</p>` : ''}
        ${e.url ? `<div class="meta" style="margin-top:6px"><a href="${esc(e.url)}" target="_blank" rel="noopener">${e.kind === 'paper' ? 'Overleaf' : esc(e.sha)} ↗</a></div>` : ''}</div>`).join('')}
      <h3>Last ${d.days.length} days</h3><div style="--hue:${hue(w.cluster)}">${spark(w.daily, 480, 34)}</div>
      <div class="small faint">${plural(w.n_week, 'change')} this week · ${plural(w.n_events, 'change')} recorded</div>
      <h3>In the paper</h3>
      ${units.length ? `<table class="t">${units.map((u) => `<tr><td>${esc(u.label)}</td><td><span class="chip st-${u.status}">${ST_LABEL[u.status]}</span></td><td class="v faint">${u.words} w${u.figs ? ' · ' + u.figs + ' fig' : ''}${u.values ? ' · ' + u.values + ' val' : ''}</td></tr>`).join('')}</table>` : '<p class="muted small">Not part of the current draft.</p>'}
      ${macros.length ? `<h3>Numbers in the paper</h3><table class="t">${macros.map((m) => `<tr title="${esc(m.source)}"><td>${esc(m.label || m.name)}</td><td class="v">${esc(m.value)}</td><td class="v faint">${esc(m.round)}</td></tr>`).join('')}</table>` : ''}
      ${w.doc ? `<h3>${esc(w.doc.title)}</h3><div class="md">${md(w.doc.lead)}</div>${w.doc.status ? `<div class="kicker" style="margin:12px 0 6px">${esc(w.doc.status_heading || '')}</div><div class="md">${md(w.doc.status)}</div>` : ''}<a class="small" href="${esc(w.doc.url)}" target="_blank" rel="noopener">${esc(w.doc.path)} on ${esc(w.doc.branch)} ↗</a>` : ''}
      ${w.branches && w.branches.length ? `<h3>Branches</h3><dl class="kv">${w.branches.map((b) => `<dt><a href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.name)}</a></dt><dd>${esc(b.who)} · ${ago(b.t)}${b.name !== 'main' ? ` · ${b.ahead} ahead, ${b.behind} behind main` : ''}</dd>`).join('')}</dl>` : ''}
      ${w.events && w.events.length ? `<h3>Recent changes</h3>${w.events.slice(0, 10).map((e) => `<div class="ev"><div class="m">${whoTag(e)} · ${ago(e.t)} · ${kindChip(e)}</div>${what(e, true)}</div>`).join('')}` : ''}
      ${w.sources && w.sources.length ? `<h3>Where it lives</h3><div class="small mono faint">${w.sources.map((s) => `${esc(s.branch)}: ${esc((s.paths || []).join(', '))}`).join('<br>')}</div>` : ''}
      <p class="small faint" style="margin-top:22px"><a href="#/activity" data-filter-go="${esc(w.id)}">Show all its activity →</a></p>`;
    const reopened = dr.hidden;
    dr.hidden = false; scrim.hidden = false; panelLayout(true);
    if (reopened) dr.scrollTop = 0;
    $$('.node').forEach((n) => n.classList.toggle('sel', n.dataset.ws === w.id));
  }

  // ------------------------------------------------------------------ events
  document.addEventListener('click', (ev) => {
    if (ev.target.closest('a[target="_blank"]')) return;
    const t = ev.target.closest('[data-agent],[data-ws],[data-filter],[data-filter-ws],[data-filter-go],[data-go],#close,#scrim,#atlas-toggle');
    if (!t) return;
    if (t.id === 'atlas-toggle') {
      S.atlasBare = !S.atlasBare;
      $('#atlas-stage').classList.toggle('bare', S.atlasBare);
      t.setAttribute('aria-pressed', String(S.atlasBare));
      t.textContent = S.atlasBare ? 'Show agents' : 'Hide agents';
      return;
    }
    S.keepScroll = !!t.closest('#atlas-stage');
    if (t.dataset.agent) { ev.preventDefault(); go(S.view, 'a:' + t.dataset.agent); return; }
    if (t.id === 'close' || t.id === 'scrim') { go(S.view); return; }
    if (t.dataset.go === 'paper') { go('paper'); return; }
    if (t.dataset.filterGo !== undefined) {
      ev.preventDefault(); S.feedWs = t.dataset.filterGo; S.feedFilter = 'all';
      location.hash = '#/activity'; render(); window.scrollTo(0, 0); return;
    }
    if (t.dataset.filter !== undefined) { S.feedFilter = t.dataset.filter; render(); return; }
    if (t.dataset.filterWs !== undefined) { S.feedWs = null; render(); return; }
    if (t.dataset.ws) { ev.preventDefault(); go(S.view, t.dataset.ws); }
  });
  document.addEventListener('submit', (ev) => {
    if (ev.target.id !== 'unlock') return;
    if (ev.target.dataset.state === 'open') { ev.preventDefault(); enter(); } else unlock(ev);
  });
  function lockDevice() {
    forgetKey(); S.atlasUrl = null; $('#lock').hidden = true;
    $('#drawer').hidden = true; $('#scrim').hidden = true; panelLayout(false);
    showLock();
  }
  $('#lock').addEventListener('click', lockDevice);
  document.addEventListener('click', (ev) => { if (ev.target.closest && ev.target.closest('#forget')) lockDevice(); });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && S.sel && S.data) go(S.view);
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches && ev.target.matches('article[data-agent]')) { ev.preventDefault(); go(S.view, 'a:' + ev.target.dataset.agent); }
  });
  window.addEventListener('hashchange', () => {
    if (!S.data) return;
    const before = S.view;
    route();
    if (before !== S.view) { render(); if (!S.sel) window.scrollTo(0, 0); } else {
      renderDrawer();
      if (S.view === 'map') afterLayout(focusNode);
      if (S.view === 'live') afterLayout(focusSpot);
    }
  });
  let rt;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (!$('#drawer').hidden) panelLayout(true); relayout(); }, 80); });
  setInterval(() => {
    if (document.hidden) return;
    $$('[data-ago]').forEach((el) => { const t = ago(el.dataset.ago); if (el.textContent !== t) el.textContent = t; });
  }, 15_000);

  // The flowing wires and the pulsing dots repaint the board on every frame, which costs the machine's GPU as long as
  // the page is open. Run them only while someone is looking: stop when the page is hidden or after IDLE_MS without
  // input (html.still), start again on the next input. A hidden page also stops polling and catches up when shown.
  const IDLE_MS = 3 * 60_000;
  let idleTimer = 0, lastWake = 0;
  const setStill = (still) => { document.documentElement.classList.toggle('still', still); if (S.lattice) S.lattice.still(still || document.hidden); };
  function wake() {
    if (document.hidden) return;
    const now = Date.now();
    if (now - lastWake < 1000 && !document.documentElement.classList.contains('still')) return;
    lastWake = now;
    setStill(false);
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => setStill(true), IDLE_MS);
  }
  ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart', 'focus']
    .forEach((t) => window.addEventListener(t, wake, { capture: true, passive: true }));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { clearTimeout(idleTimer); setStill(true); return; }
    wake();
    if (Date.now() - S.loadedAt >= POLL_MS) load();
  });
  if (document.hidden) setStill(true); else wake();

  // theme: follow the system unless the viewer picked one
  const themeKey = 'pc-theme';
  try { const t = localStorage.getItem(themeKey); if (t) document.documentElement.dataset.theme = t; } catch (_) { /* storage unavailable */ }
  $('#theme').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem(themeKey, document.documentElement.dataset.theme); } catch (_) { /* ignore */ }
  });

  route();
  load(true);
  setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
})();
