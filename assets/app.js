/* Research status site.
   Renders data/status.json (written by collect.py) as four views: Live, Map, Paper, Activity. No build step, no libraries. */
(() => {
  'use strict';

  const POLL_MS = 60_000;
  const H = 3600e3, D = 24 * H;
  const S = { data: null, view: 'live', sel: null, feedFilter: 'all', feedWs: null, mode: null, keyinfo: null, key: null, atlas: null, atlasUrl: null };
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
  const kindChip = (e) => `<span class="chip k-${e.kind}">${e.kind === 'paper' ? 'Overleaf' : e.kind === 'export' ? 'export' : 'commit'}</span>`;
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

  /** Minimal markdown: paragraphs, lists, tables, `code`, **bold**, links. Input is escaped first. */
  function md(src) {
    if (!src) return '';
    const inline = (s) => {
      const codes = [];
      s = esc(s).replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
      s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
      return s.replace(/\u0000(\d+)\u0000/g, (_, k) => `<code>${codes[+k]}</code>`);
    };
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

  async function load(first = false) {
    try {
      const d = await fetchStatus();
      // no key yet, or the saved key no longer opens the data; keep a lock screen that is already up (and its typing)
      if (!d) { if (!$('#unlock')) showLock(S.data ? 'The password has changed; enter the new one.' : ''); return; }
      const changed = !S.data || d.generated !== S.data.generated;
      S.data = d;
      S.atlasUrl = await atlasUrl(d);
      if (changed || first) render();
    } catch (err) {
      if (first) $('#view').innerHTML = `<div class="warn">Could not read the data (${esc(err.message)}). Run <code>python3 website/collect.py --fetch</code>, then serve this folder, for example with <code>website/serve.sh</code>.</div>`;
    }
  }

  function showLock(msgText = '') {
    S.data = null;
    document.body.classList.add('locked');
    $('#foot').innerHTML = '';
    $('#ticker').hidden = true;
    $$('.nav a').forEach((a) => a.classList.remove('on'));
    $('#view').innerHTML = `<section class="lock"><form class="lock-card" id="unlock">
      <h1>Research status</h1>
      <p>This page is for the members of the group. Its data is encrypted; enter the team password to read it.</p>
      <label class="sr" for="pw">Team password</label>
      <input type="password" id="pw" autocomplete="current-password" placeholder="Team password" required>
      <label class="remember"><input type="checkbox" id="remember" checked> Remember on this device</label>
      <button class="btn-dark" type="submit" id="unlock-btn">Unlock</button>
      <p class="lock-err" id="lock-err" role="alert">${esc(msgText)}</p>
    </form></section>`;
    $('#pw').focus();
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
      render();
    } catch (e) {
      err.textContent = e.message === 'wrong password' ? 'That password does not open the data.' : `Could not unlock: ${e.message}`;
      btn.disabled = false; btn.textContent = 'Unlock';
    }
  }

  // ------------------------------------------------------------------ router
  function route() {
    const [, view = 'live', sel = null] = (location.hash || '#/live').split('/');
    S.view = ['live', 'map', 'paper', 'activity'].includes(view) ? view : 'live';
    S.sel = sel ? decodeURIComponent(sel) : null;
  }
  function go(view, sel = null) { location.hash = `#/${view}${sel ? '/' + encodeURIComponent(sel) : ''}`; }

  // ------------------------------------------------------------------ shell
  function render() {
    if (!S.data) return;
    route();
    const d = S.data;
    document.body.classList.remove('locked');
    $$('.nav a').forEach((a) => a.classList.toggle('on', a.dataset.view === S.view));
    $('#repo-link').href = d.project.github || '#';
    $('#repo-link').hidden = !d.project.github;
    $('#lock').hidden = S.mode !== 'enc';
    $('#brand-title').textContent = d.project.title || 'Research status';
    $('#tagline').textContent = d.project.tagline || '';
    document.title = `${d.project.title} · ${S.view[0].toUpperCase()}${S.view.slice(1)}`;
    renderTicker();
    const v = $('#view');
    const keep = window.scrollY;
    v.innerHTML = ({ live: viewLive, map: viewMap, paper: viewPaper, activity: viewActivity })[S.view]();
    if (S.view === 'live') requestAnimationFrame(drawWires);
    if (S.view === 'map') requestAnimationFrame(fitMap);
    window.scrollTo(0, keep);
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
    return `${warn}
    <section class="hero">
      <div class="hero-title"><h1>Live research map</h1>${fresh()}</div>
      <div class="stats">${stats.map(([n, l]) => `<div class="stat"><b>${esc(n)}</b><span>${esc(l)}</span></div>`).join('')}</div>
    </section>
    <section class="board" id="board" aria-label="Workstreams around the paper">
      <svg class="wires" id="wires" aria-hidden="true"></svg>
      <div class="grid9">${d.clusters.map(clusterCell).join('')}${hubCell()}</div>
    </section>
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

  function clusterCell(c) {
    const items = S.data.workstreams.filter((w) => w.cluster === c.id);
    if (!items.length) return `<div class="cl s-${c.slot}" style="grid-area:${c.slot};--hue:${hue(c.id)}"></div>`;
    return `<div class="cl s-${c.slot}" style="grid-area:${c.slot};--hue:${hue(c.id)}">
      <div class="cl-h"><b>${esc(c.title)}</b><span>${esc(c.sub)}</span></div>
      ${items.map(seat).join('')}
    </div>`;
  }

  function seat(w) {
    const a = act(w.last && w.last.t);
    const lw = w.last_work, lp = w.last_paper;
    const work = w.planned ? '<span class="what">planned · no work yet</span>'
      : lw ? `<span class="when">${short(lw.t)}</span><span class="what">${esc(lw.who)}: ${esc(what(lw, false, w.id))}</span>`
        : '<span class="what">no commits yet</span>';
    // a paper edit newer than the latest work gets its own line
    const paper = lp && (!lw || lp.t > lw.t) ? `<div class="seat-line paper"><span class="when">${short(lp.t)}</span><span class="what">paper · ${esc(lp.who)}: ${esc(what(lp, false, w.id))}</span></div>` : '';
    return `<button class="seat${a === 'quiet' ? ' quiet' : ''}${w.planned ? ' planned' : ''}" data-ws="${esc(w.id)}" data-act="${a}" title="${esc(w.title)} — ${esc(ACT_LABEL[a])}">
      <div class="seat-top"><span class="dot a-${a}"></span><span class="seat-name">${esc(w.title)}</span>${stChip(w, true)}</div>
      <div class="seat-line">${work}</div>${paper}
    </button>`;
  }

  function hubCell() {
    const p = S.data.paper;
    const units = p.units || [];
    const written = units.filter((u) => u.status === 'written' || u.status === 'draft').length;
    const last = S.data.events.find((e) => e.kind === 'paper');
    return `<div class="hub">
      <button class="hub-disc a-${act(p.updated)}" id="hub" aria-label="Open the paper progress"><span><b>PAPER</b><small>${esc(p.title || '')}</small></span></button>
      <div class="hub-cap">${last ? `edited ${ago(last.t)} by ${esc(last.who)}<br>` : ''}${written}/${units.length} parts written · ${plural(p.macros ? p.macros.length : 0, 'tracked number')}</div>
    </div>`;
  }

  function drawWires() {
    const board = $('#board'), svg = $('#wires'), hub = $('#hub');
    if (!board || !svg || !hub || getComputedStyle(svg).display === 'none') return;
    const b = board.getBoundingClientRect();
    const hr = hub.getBoundingClientRect();
    const hx = hr.left + hr.width / 2 - b.left, hy = hr.top + hr.height / 2 - b.top, R = hr.width / 2 + 4;
    svg.setAttribute('viewBox', `0 0 ${b.width} ${b.height}`);
    const paths = $$('.seat', board).map((el) => {
      const w = wsById(el.dataset.ws);
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2 - b.left, cy = r.top + r.height / 2 - b.top;
      let ax, ay;
      if (Math.abs(cx - hx) < r.width / 2) { ax = cx; ay = cy < hy ? r.bottom - b.top : r.top - b.top; }
      else { ax = cx < hx ? r.right - b.left : r.left - b.left; ay = cy; }
      const ang = Math.atan2(ay - hy, ax - hx);
      const ex = hx + R * Math.cos(ang), ey = hy + R * Math.sin(ang);
      const horiz = Math.abs(cx - hx) >= r.width / 2;
      const c1x = horiz ? ax + (ex - ax) * 0.45 : ax, c1y = horiz ? ay : ay + (ey - ay) * 0.45;
      const c2x = ex + (ax - ex) * 0.35, c2y = ey + (ay - ey) * 0.35;
      const a = el.dataset.act;
      const op = { now: 0.95, today: 0.7, week: 0.4, quiet: 0.2, none: 0.12 }[a];
      const col = hue(w ? w.cluster : 'beyond');
      const inPaper = w && ['written', 'draft'].includes(st(w));
      const dash = a === 'now' ? '' : inPaper ? '' : ' stroke-dasharray="2 4"';
      return `<path class="${a === 'now' ? 'w-now' : ''}" d="M${ax.toFixed(1)},${ay.toFixed(1)} C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)}" style="stroke:${col};opacity:${op}"${dash}/>
        <circle class="tick" cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="2" style="fill:${col};opacity:${op}"/>`;
    });
    svg.innerHTML = paths.join('');
  }

  function msg(e) {
    const to = (e.ws || []).map((id) => wsById(id)).filter(Boolean);
    const target = e.kind === 'paper' ? 'paper' : to.length ? to.map((w) => w.title).slice(0, 2).join(', ') : (e.branches || []).join(', ');
    let files = '';
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
      <div class="msg-f">${kindChip(e)}${(e.ws || []).slice(0, 3).map(wsChip).join('')}<span class="num">+${e.add} −${e.del}</span>${link}</div>
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
    return `<button class="node${w.planned ? ' planned' : ''}${S.sel === w.id ? ' sel' : ''}" data-ws="${esc(w.id)}" style="left:${p.x}px;top:${p.y}px;width:${CW}px;height:${CH}px;--hue:${hue(w.cluster)};--c:var(--st-${s === 'none' ? 'out' : s})">
      <div class="node-top"><span class="node-cl">${esc(c.title)}</span>${stChip(w)}</div>
      <h3>${esc(w.title)}</h3>
      <p>${esc(w.summary || '')}</p>
      <div class="node-foot"><span class="dot a-${a}"></span><span class="who">${esc(who)}</span>${spark(w.daily)}</div>
    </button>`;
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
        <div class="filters" role="group" aria-label="Filter">${[['all', 'All'], ['paper', 'Paper'], ['export', 'Exports'], ['commit', 'Branch commits']].map(([k, l]) => `<button data-filter="${k}" class="${filt === k ? 'on' : ''}">${l}</button>`).join('')}
        ${fw ? `<button data-filter-ws="" class="on">${esc(fw.title)} ✕</button>` : ''}</div>
        ${fw && fw.n_events > fw.events.length ? `<p class="panel-sub">The latest ${fw.events.length} of ${fw.n_events} changes.</p>` : ''}
        ${evs.slice(0, 80).map(msg).join('') || '<p class="muted">Nothing in this filter.</p>'}</div>`;
  }

  // ------------------------------------------------------------------ drawer
  function renderDrawer() {
    if (!S.data) return;
    const dr = $('#drawer'), scrim = $('#scrim');
    const w = S.sel && wsById(S.sel);
    if (!w) { dr.hidden = true; scrim.hidden = true; document.body.style.overflow = ''; return; }
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
    dr.hidden = false; scrim.hidden = false;
    document.body.style.overflow = 'hidden';
    if (reopened) dr.scrollTop = 0;
    $$('.node').forEach((n) => n.classList.toggle('sel', n.dataset.ws === w.id));
  }

  // ------------------------------------------------------------------ events
  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-ws],[data-filter],[data-filter-ws],[data-filter-go],[data-go],#hub,#close,#scrim');
    if (!t) return;
    if (t.id === 'close' || t.id === 'scrim') { go(S.view); return; }
    if (t.id === 'hub' || t.dataset.go === 'paper') { go('paper'); return; }
    if (t.dataset.filterGo !== undefined) {
      ev.preventDefault(); S.feedWs = t.dataset.filterGo; S.feedFilter = 'all';
      location.hash = '#/activity'; render(); window.scrollTo(0, 0); return;
    }
    if (t.dataset.filter !== undefined) { S.feedFilter = t.dataset.filter; render(); return; }
    if (t.dataset.filterWs !== undefined) { S.feedWs = null; render(); return; }
    if (t.dataset.ws) { ev.preventDefault(); go(S.view, t.dataset.ws); }
  });
  document.addEventListener('submit', (ev) => { if (ev.target.id === 'unlock') unlock(ev); });
  $('#lock').addEventListener('click', () => {
    forgetKey(); S.atlasUrl = null; $('#lock').hidden = true;
    $('#drawer').hidden = true; $('#scrim').hidden = true; document.body.style.overflow = '';
    showLock();
  });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && S.sel && S.data) go(S.view); });
  window.addEventListener('hashchange', () => {
    if (!S.data) return;
    const before = S.view;
    route();
    if (before !== S.view) { render(); window.scrollTo(0, 0); } else { renderDrawer(); }
  });
  let rt;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (S.view === 'live') drawWires(); if (S.view === 'map') fitMap(); }, 80); });
  setInterval(() => $$('[data-ago]').forEach((el) => { el.textContent = ago(el.dataset.ago); }), 15_000);

  // theme: follow the system unless the viewer picked one
  const themeKey = 'pc-theme';
  try { const t = localStorage.getItem(themeKey); if (t) document.documentElement.dataset.theme = t; } catch (_) { /* storage unavailable */ }
  $('#theme').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem(themeKey, document.documentElement.dataset.theme); } catch (_) { /* ignore */ }
    if (S.view === 'live') drawWires();
  });

  route();
  load(true);
  setInterval(load, POLL_MS);
})();
