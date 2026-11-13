/* Grok Desk iPhone app. Plain JS. Plan B: polls JSON files under d/{DATA_PATH}/ every 15s. */
(function () {
  'use strict';
  const POLL_S = 15;
  const RM = window.DeskChart.reducedMotion;
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- data path (#d=... once, then localStorage)
  (function () {
    const m = location.hash.match(/[#&]d=([A-Za-z0-9_-]{32,})/);
    if (m) { localStorage.setItem('desk_d', m[1]); history.replaceState(null, '', location.pathname + location.search); }
  })();
  const DP = localStorage.getItem('desk_d');
  const BASE = DP ? `d/${DP}/` : null;

  const S = { state: null, chart: null, activity: null, agents: null, account: null, coins: null, coin: {},
    lastOk: null, nextTry: 0, failing: false, tab: 'home', screen: 'home', range: 'LIVE', actPage: 1, coinMint: null,
    auditMint: null, played: {} };

  async function get(name) {
    if (!BASE) throw new Error('no data path');
    const r = await fetch(BASE + name + '?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error(name + ' ' + r.status);
    return r.json();
  }

  // ---------- formatting
  const usd = (v, signed) => v == null ? 'n/a' : (signed ? (v >= 0 ? '+$' : '-$') : (v < 0 ? '-$' : '$')) + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const kfmt = v => v == null ? 'n/a' : Math.abs(v) >= 1e6 ? '$' + (v / 1e6).toFixed(1) + 'M' : Math.abs(v) >= 1e3 ? '$' + (v / 1e3).toFixed(1) + 'K' : '$' + v.toFixed(0);
  const pct = (v, nd) => v == null ? 'n/a' : (v >= 0 ? '+' : '') + v.toFixed(nd == null ? 2 : nd) + '%';
  const hm = ts => ts ? new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
  const shortM = m => m ? m.slice(0, 4) + '...' + m.slice(-3) : '';
  const nm = (n, m) => esc(n || shortM(m));
  function price(p) {
    if (p == null) return 'n/a';
    if (p >= 1) return '$' + p.toFixed(4);
    const s = p.toPrecision(4);
    return '$' + (p < 1e-4 ? Number(s).toExponential(3) : Number(s).toString());
  }
  const fomoA = (href, label, cls) => href ? `<a class="${cls || ''}" href="${esc(href)}" target="_blank" rel="noopener">${label}</a>` : '';

  // ---------- odometer: each changed digit rolls 600ms ease-out, 30ms stagger right to left
  function odometer(el, text) {
    const chars = text.split('');
    if (el.dataset.v === text) return;
    const old = el.dataset.v || '';
    el.dataset.v = text;
    if (old.length !== text.length || RM) {
      el.innerHTML = chars.map(c => /\d/.test(c)
        ? `<span class="odo"><span class="col" style="transform:translateY(-${(RM ? +c : 0) * 1.05}em)">${[0,1,2,3,4,5,6,7,8,9].map(d => `<span>${d}</span>`).join('')}</span></span>`
        : `<span>${esc(c)}</span>`).join('');
      if (!RM) requestAnimationFrame(() => requestAnimationFrame(() => roll(el, chars, null)));
      else roll(el, chars, null, true);
      return;
    }
    roll(el, chars, old.split(''));
  }
  function roll(el, chars, old, instant) {
    const kids = el.children;
    let fromRight = 0;
    for (let i = chars.length - 1; i >= 0; i--) {
      const c = chars[i];
      if (!/\d/.test(c)) continue;
      const col = kids[i] && kids[i].firstChild;
      if (!col) continue;
      if (!old || old[i] !== c) {
        col.style.transitionDelay = instant ? '0ms' : (fromRight * 30) + 'ms';
        col.style.transform = `translateY(-${(+c) * 1.05}em)`;
        fromRight++;
      }
    }
  }

  // ---------- states
  const skel = (h, w, mt) => `<div class="skel" style="height:${h}px;${w ? 'width:' + w + ';' : ''}margin:${mt || 0}px 16px 0"></div>`;
  function setError() {
    const e = $('#err');
    if (!S.failing) { e.classList.remove('on'); return; }
    const n = Math.max(0, Math.ceil((S.nextTry - Date.now()) / 1000));
    e.textContent = `Desk offline · retrying in ${n}s · last update ${S.lastOk ? hm(S.lastOk / 1000) : 'never'}`;
    e.classList.add('on');
  }
  setInterval(setError, 1000);

  // ---------- navigation
  function show(screen) {
    S.screen = screen;
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === 's-' + screen));
    if (['home', 'agents', 'activity', 'account'].includes(screen)) {
      S.tab = screen;
      document.querySelectorAll('#tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === screen));
    }
    window.scrollTo(0, 0);
    render();
    if (screen === 'activity' && S.activity) loadRowCoins().then(() => { if (S.screen === 'activity') renderActivity(); });
  }
  document.querySelectorAll('#tabbar button').forEach(b => b.addEventListener('click', () => show(b.dataset.tab)));
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-go]');
    if (!t) return;
    e.preventDefault();
    const [kind, arg] = t.dataset.go.split(':');
    if (kind === 'coin') { S.coinMint = arg; show('coin'); loadCoin(arg); }
    else if (kind === 'auditor') { S.auditMint = arg || null; show('auditor'); if (arg) loadCoin(arg); }
    else if (kind === 'back') show(S.screen === S.tab ? 'home' : S.tab);
    else if (kind === 'top') window.scrollTo({ top: 0, behavior: RM ? 'auto' : 'smooth' });
    else if (kind === 'range') { S.range = arg; renderHome(); }
    else if (kind === 'more') { S.actPage++; renderActivity(); loadRowCoins().then(renderActivity); }
    else if (kind === 'search') { const s = $('#search'); s.classList.toggle('on'); if (s.classList.contains('on')) $('#search input').focus(); }
    else if (kind === 'bell') openPushes();
    else if (kind === 'invite') invite();
    else show(kind);
  });
  $('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') $('#sheet').classList.remove('on'); });

  function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); setTimeout(() => el.classList.remove('on'), 1800); }

  async function invite() {
    const url = S.account && S.account.signup_url;
    if (!url) return;
    if (navigator.share) { try { await navigator.share({ title: 'FOMO', url }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
    try { await navigator.clipboard.writeText(url); } catch (e) {
      const ta = document.createElement('textarea'); ta.value = url; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    toast('Link copied');
  }

  function openPushes() {
    const ps = (S.state && S.state.pushes) || [];
    localStorage.setItem('desk_seen', String(Date.now() / 1000));
    $('#sheetin').innerHTML = `<div class="section" style="padding-top:4px"><h2>Pushes</h2></div>` + (ps.length
      ? `<div class="list">${ps.map(p => `<div class="row"><div class="m"><div class="t" style="white-space:normal">${esc(p.text)}</div><div class="s">${hm(p.ts)} · Telegram</div></div></div>`).join('')}</div>`
      : `<div class="empty">No pushes yet</div>`);
    $('#sheet').classList.add('on');
    renderHome();
  }

  // ---------- HOME (v2 "terminal" layout)
  const ICON = {
    back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
    bell: '<svg viewBox="0 0 24 24"><path d="M6 17V11a6 6 0 0 1 12 0v6l2 2H4z"/><path d="M10 21h4"/></svg>',
    scanner: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><circle cx="12" cy="12" r="7.5"/></svg>',
    auditor: '<svg viewBox="0 0 24 24"><path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/></svg>',
    analyst: '<svg viewBox="0 0 24 24"><path d="M4 19h16"/><path d="M7 16v-4M12 16V7M17 16v-7"/></svg>',
    executor: '<svg viewBox="0 0 24 24"><path d="M13 3L5 14h6l-1 7 8-11h-6z"/></svg>',
    risk: '<svg viewBox="0 0 24 24"><path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.5"/></svg>',
  };
  const AV = (n, m, s) => window.DeskChart.avatar(n, m, s);
  const botAvatar = `<span class="botav"><svg viewBox="0 0 32 32"><path d="M9 23L21 9M13 9h10v10" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;

  function topbar(title, opts) {
    opts = opts || {};
    return `<div class="topbar"><button class="iconbtn" data-go="${opts.back || 'back'}" aria-label="Back">${ICON.back}</button>
      <div class="ttl">${esc(title)}</div>${opts.right != null ? opts.right : '<span style="width:44px"></span>'}</div>`;
  }
  function modePill(mode) {
    return mode === 'PAPER' ? '<span class="mpill paper"><i></i>Paper</span>' : mode ? '<span class="mpill live"><i></i>Live</span>' : '';
  }
  function navbar() {
    const seen = +(localStorage.getItem('desk_seen') || 0);
    const unread = ((S.state && S.state.pushes) || []).some(p => p.ts > seen);
    return `<div class="navwrap">${topbar('Grok Terminal', { back: 'top', right: '<button class="sharebtn" data-go="invite">Share</button>' })}
      <div class="botrow"><button class="botbtn" data-go="account">${botAvatar}<span class="bn">Grok Bot</span><span class="chevr">›</span></button>
        <span id="modepill">${modePill(S.state && S.state.mode)}</span><div class="grow"></div>
        <button class="iconbtn sm" data-go="search" aria-label="Search">${ICON.search}</button>
        <button class="iconbtn sm" data-go="bell" aria-label="Pushes">${ICON.bell}${unread ? '<i class="dot"></i>' : ''}</button></div>
      <div class="search" id="search"><input placeholder="Name, symbol or mint" autocomplete="off" autocapitalize="off"><div id="sres"></div></div></div>`;
  }

  function ringSvg(frac, color, icon) {
    const r = 19, c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, frac || 0));
    return `<span class="ring"><svg viewBox="0 0 46 46"><circle cx="23" cy="23" r="${r}" fill="none" stroke="rgba(255,255,255,.09)" stroke-width="3.5"/>
      <circle cx="23" cy="23" r="${r}" fill="none" stroke="${color}" stroke-width="3.5" stroke-linecap="round" stroke-opacity="${f > 0 ? 1 : 0}" stroke-dasharray="${(c * f).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 23 23)"/></svg>
      <span class="ri" style="color:${color}">${icon}</span></span>`;
  }

  const AGC = { scanner: '#64d2ff', auditor: '#00d35a', analyst: '#ffd60a', executor: '#00d35a', risk: '#ff6b9a' };
  function agentCard(n, a) {
    if (!a) return `<div class="agc skel"></div>`;
    const live = a.alive && !a.paused;
    let frac = 0, sub = '', status = '', go = 'agents', col = AGC[n];
    if (n === 'scanner') {
      const tot = (a.passed || 0) + (a.killed || 0);
      frac = tot ? a.passed / tot : (live ? 0.08 : 0);
      sub = `${a.pools} pools · ${a.room} waiting`;
      status = `${a.killed} killed · ${a.passed} passed`;
    } else if (n === 'auditor') {
      const cur = a.current;
      frac = cur && cur.layers ? cur.layers.filter(l => l.pass !== null).length / 8 : 0;
      if (cur && cur.done && !cur.passed) col = '#ff453a';
      sub = `${a.takenApart} taken apart · ${a.rejected} rejected`;
      status = !cur ? 'No coin taken apart yet' : !cur.done ? `Taking apart ${nm(cur.name, cur.mint)}` : cur.passed ? `${nm(cur.name, cur.mint)} · 8/8 cleared` : `${nm(cur.name, cur.mint)} · ${esc(cur.reason)}`;
      go = 'auditor:' + (cur ? esc(cur.mint) : '');
    } else if (n === 'analyst') {
      frac = a.last ? a.last.score / 100 : 0;
      if (a.last && !a.last.passed) col = '#ff9f0a';
      sub = `${esc(a.mode)} · min ${a.minScore} · ${a.scored} scored`;
      status = a.last ? `${nm(a.last.name, a.last.mint)} · ${a.last.score} ${a.last.passed ? 'passed' : 'rejected'}` : 'Nothing scored yet';
    } else if (n === 'executor') {
      const l = a.last;
      frac = !l ? 0 : l.status === 'bought' ? 1 : Math.min(0.99, (Date.now() / 1000 - l.ts) / 300);
      sub = `${a.trades} trade${a.trades === 1 ? '' : 's'} · size ${fmtN(a.stackPct)}%`;
      status = l ? `${l.status === 'bought' ? 'Filled' : 'Executing'} ${nm(l.name, l.mint)} · ${usd(l.size)}` : 'Waiting for a signal';
    } else if (n === 'risk') {
      frac = a.open ? 1 : 0;
      sub = `stop −${fmtN(a.stopPct)}% · trail ${fmtN(a.trailPct)}%`;
      status = `${esc(a.state)} · ${a.open} open${a.last ? ' · last ' + nm(a.last.name, a.last.mint) + ' ' + esc(a.last.reason) : ''}`;
    }
    const names = { scanner: 'Scanner', auditor: 'Auditor', analyst: 'Analyst', executor: 'Executor', risk: 'Risk' };
    return `<div class="agc ${n === 'risk' ? 'wide' : ''}" data-go="${go}">
      <div class="agtop">${ringSvg(frac, col, ICON[n])}${n === 'risk' ? `<div class="agtx"><div class="agn">${names[n]}</div><div class="ags">${sub}</div></div>` : ''}</div>
      ${n === 'risk' ? '' : `<div class="agn">${names[n]}</div><div class="ags">${sub}</div>`}
      <div class="agst ${live ? '' : 'off'}"><i></i><span>${a.paused ? 'Paused' : !a.alive ? 'Offline' : ''}${a.paused || !a.alive ? ' · ' : ''}${status}</span></div></div>`;
  }
  const fmtN = v => String(+(+v).toFixed(2));

  // activity row helpers
  const AGN = { executor: 'Executor', risk: 'Risk', auditor: 'Auditor', analyst: 'Analyst', scanner: 'Scanner' };
  function coinName(r) { return r.title.indexOf(' ') > 0 ? r.title.slice(r.title.indexOf(' ') + 1) : r.title; }
  function rowParts(r) {
    const parts = String(r.value || '').split(' · ');
    const sp = String(r.subtitle || '').split(' · ');
    let reason = sp.slice(1).filter(x => !/^\d{1,2}:\d{2}$/.test(x)).join(' · ');
    if (!reason && r.kind === 'bought') reason = parts[1] || 'entry';
    const c = S.coin[r.mint];
    const mc = c && c._ok && c.stats ? c.stats.marketCap : null;
    let under = '';
    if (r.kind === 'sold' || r.kind === 'stopped') {
      const pos = c && c.position;
      under = parts[1] || (pos && pos.pnlUsd != null && pos.sizeUsd ? pct(100 * pos.pnlUsd / pos.sizeUsd, 1) : (mc != null ? 'MC ' + kfmt(mc) : ''));
    } else if (r.kind === 'bought') under = mc != null ? 'MC ' + kfmt(mc) : '';
    return { amount: parts[0], under, reason, agent: AGN[r.agent] || sp[0] || '' };
  }
  function activityRow(r) {
    const badge = { bought: ['b', '↓'], sold: ['g', '↑'], stopped: ['r', '!'], rejected: ['x', '×'] }[r.kind] || ['x', '·'];
    const p = rowParts(r);
    const neg = String(p.amount).startsWith('-');
    const vcol = r.kind === 'sold' ? (neg ? 'down' : 'up') : r.kind === 'stopped' ? 'down' : r.kind === 'rejected' ? 'muted' : '';
    const ucol = /^\+/.test(p.under) ? 'up' : /^-/.test(p.under) ? 'down' : 'muted';
    return `<div class="arow" data-go="${r.opens}:${esc(r.mint)}"><span class="avw">${AV(coinName(r), r.mint, 40)}<span class="bdg ${badge[0]}">${badge[1]}</span></span>
      <div class="m"><div class="t">${esc(r.title)}</div><div class="s">${esc([p.agent, p.reason, hm(r.ts)].filter(Boolean).join(' · '))}</div></div>
      <div class="v"><div class="amt ${vcol}">${esc(p.amount)}</div>${p.under ? `<div class="und ${ucol}">${esc(p.under)}</div>` : ''}</div></div>`;
  }

  // chart events from activity rows (same ts as chart marks)
  function chartEvents() {
    const rows = (S.activity && S.activity.rows) || [];
    return rows.filter(r => ['bought', 'sold', 'stopped'].includes(r.kind)).map(r => {
      const amt = String(r.value || '').split(' · ')[0];
      const label = r.kind === 'bought' ? 'bought ' + amt : r.kind === 'sold' ? 'sold ' + amt : 'stop ' + amt.replace(/^-/, '−');
      const color = r.kind === 'bought' ? 'blue' : r.kind === 'stopped' || amt.startsWith('-') ? 'red' : 'green';
      return { ts: r.ts, kind: r.kind, mint: r.mint, name: coinName(r), label, color };
    });
  }

  function renderHome() {
    const el = $('#s-home');
    const st = S.state;
    if (!st) {
      el.innerHTML = navbar() + `<div style="padding-top:14px">${skel(16, '40%', 4)}${skel(64, '75%', 12)}${skel(18, '50%', 10)}</div>${skel(260, '', 16)}${skel(36, '', 12)}
        <div class="section"><h2>Agents</h2></div><div class="agrid"><div class="agc skel"></div><div class="agc skel"></div></div>
        <div class="section"><h2>Activity</h2></div>${skel(60, '', 0)}${skel(60, '', 8)}`;
      delete el.dataset.built;
      return;
    }
    const keepSearch = $('#search') && $('#search').classList.contains('on') ? $('#search input').value : null;
    if (!el.dataset.built) {
      el.innerHTML = navbar() + `<div class="hero"><div class="meta" id="meta"></div>
        <div class="balance"><span id="bal"></span><span class="cents" id="balc"></span></div>
        <div class="sub"><span id="today"></span><span class="pill mult" id="mult"></span></div></div>
        <div class="chartwrap" id="homechart"></div><div class="ranges" id="ranges"></div>
        <div class="section"><h2>Agents</h2><span class="sk up" id="agrun"></span></div><div class="agrid" id="agrid"></div>
        <div class="section"><h2>Activity</h2><button class="sk up" data-go="activity" id="trades"></button></div><div id="last5"></div>`;
      el.dataset.built = '1';
      $('#search input').addEventListener('input', searchNow);
    } else {
      const nb = document.createElement('div'); nb.innerHTML = navbar();
      el.replaceChild(nb.firstElementChild, el.firstElementChild);
      $('#search input').addEventListener('input', searchNow);
    }
    if (keepSearch != null) { $('#search').classList.add('on'); $('#search input').value = keepSearch; searchNow(); }
    const open = (st.positions || []).length;
    $('#meta').innerHTML = `fomo · ${open} open<span class="tm">${hm(st.ts)}</span>`;
    const b = usd(st.balance), dot = b.lastIndexOf('.');
    odometer($('#bal'), dot > 0 ? b.slice(0, dot) : b);
    odometer($('#balc'), dot > 0 ? b.slice(dot) : '');
    const diff = st.balance - (st.nightStartBalance || st.balance);
    $('#today').className = diff >= 0 ? 'up' : 'down';
    $('#today').textContent = `${diff >= 0 ? '▲' : '▼'} ${usd(Math.abs(diff))} (${Math.abs(st.todayPct).toFixed(2)}%)`;
    $('.balance').classList.toggle('neg', diff < 0);
    $('#mult').textContent = st.multiplier.toFixed(2) + '×';
    $('#mult').className = 'pill mult' + (st.multiplier < 1 ? ' neg' : '');
    $('#ranges').innerHTML = ['LIVE', '1H', '4H', '1D', '1W', 'ALL'].map(r => `<button data-go="range:${r}" class="${S.range === r ? 'on' : ''}">${r}</button>`).join('');
    const ch = S.chart && S.chart.ranges[S.range];
    window.DeskChart.area($('#homechart'), ch ? { points: ch.points, start: S.chart.start, events: chartEvents() } : null, { height: 290, range: S.range });
    $('#agrun').textContent = `${st.running} running`;
    $('#agrid').innerHTML = ['scanner', 'auditor', 'analyst', 'executor', 'risk'].map(n => agentCard(n, st.agents[n])).join('');
    const ex = st.agents.executor;
    $('#trades').textContent = `${ex ? ex.trades : 0} trade${ex && ex.trades === 1 ? '' : 's'}`;
    const rows = (S.activity && S.activity.rows || []).slice(0, 5);
    $('#last5').innerHTML = rows.length ? `<div class="alist">${rows.map(activityRow).join('')}</div>` : `<div class="empty">Nothing yet tonight</div>`;
  }

  function searchNow() {
    const q = $('#search input').value.trim().toLowerCase();
    const list = (S.coins && S.coins.coins) || [];
    const hits = !q ? [] : list.filter(c => (c.name || '').toLowerCase().includes(q) || (c.symbol || '').toLowerCase().includes(q) || c.mint.toLowerCase() === q || c.mint.toLowerCase().startsWith(q)).slice(0, 8);
    $('#sres').innerHTML = !q ? '' : hits.length ? `<div class="list" style="margin:8px 0 0">${hits.map(c => c.file
      ? `<div class="row" data-go="coin:${esc(c.mint)}"><div class="m"><div class="t">${nm(c.name, c.mint)} <span class="muted">${esc(c.symbol || '')}</span></div><div class="s">${shortM(c.mint)}</div></div><span class="chev">›</span></div>`
      : `<a class="row" href="${esc(c.link)}" target="_blank" rel="noopener"><div class="m"><div class="t">${nm(c.name, c.mint)} <span class="muted">${esc(c.symbol || '')}</span></div><div class="s">${shortM(c.mint)} · seen by Scanner</div></div><span class="chev">›</span></a>`).join('')}</div>`
      : `<div class="empty">No coin tonight matches</div>`;
  }

  // ---------- AGENTS TAB
  function renderAgents() {
    const el = $('#s-agents');
    const st = S.state, ag = S.agents;
    let h = topbar('', { right: modePill(st && st.mode) || undefined }) + `<div class="lgtitle">Agents${st ? ` <span class="sk up">${st.running} running</span>` : ''}</div>`;
    if (!st || !ag) { el.innerHTML = h + [1, 2, 3].map(() => skel(220, '', 12)).join(''); return; }
    const names = { scanner: 'Scanner', auditor: 'Auditor', analyst: 'Analyst', executor: 'Executor', risk: 'Risk' };
    const colors = { scanner: '#64d2ff', auditor: '#fff', analyst: '#ffd60a', executor: '#00d35a', risk: '#ff6b9a' };
    h += ['scanner', 'auditor', 'analyst', 'executor', 'risk'].map(n => {
      const a = st.agents[n], d = ag[n];
      const locked = n === 'risk' && a.locked;
      const decs = d.decisions.length ? d.decisions.map(x => `<div class="dec"><span class="tm">${hm(x.ts)}</span>
          ${x.link ? `<a class="cn" href="${esc(x.link)}" target="_blank" rel="noopener">${nm(x.name, x.mint)}</a>` : `<span class="cn">${nm(x.name, x.mint)}</span>`}
          <span class="vd">${esc(x.verdict)} · ${esc(x.reason)}</span></div>`).join('')
        : `<div class="empty" style="padding:14px">${n === 'scanner' ? 'Listening for graduations' : n === 'auditor' ? 'No coin taken apart yet' : 'Nothing yet tonight'}</div>`;
      return `<div class="bigcard"><div class="hd"><i class="sdot ${a.alive && !a.paused ? '' : 'off'}"></i><span class="nm" style="color:${colors[n]}">${names[n]}</span>
          <span class="muted">${d.today} today</span></div>
        <div class="kv" style="padding:12px 0"><span class="k">${a.paused ? 'Paused' : 'Running'}${locked ? ' · locked while a position is open' : ''}</span>
          <span class="toggle ro ${a.paused ? '' : 'on'}" title="Read-only on this hosting: send “${a.paused ? 'resume' : 'pause'} ${names[n]}” to the Telegram bot"></span></div>
        <div class="muted" style="font-size:13px;margin-bottom:6px">Pause and resume go through Telegram: “${a.paused ? 'resume' : 'pause'} ${names[n]}”</div>
        <div>${decs}</div>
        <button data-go="account" style="color:#0a84ff;min-height:44px;margin-top:6px">Settings</button></div>`;
    }).join('');
    el.innerHTML = h;
  }

  // ---------- ACTIVITY
  function renderActivity() {
    const el = $('#s-activity');
    const tr = S.state && S.state.agents.executor ? S.state.agents.executor.trades : null;
    let h = topbar('') + `<div class="lgtitle">Activity${tr != null ? ` <span class="sk up">${tr} trade${tr === 1 ? '' : 's'}</span>` : ''}</div>`;
    if (!S.activity) { el.innerHTML = h + [1, 2, 3, 4].map(() => skel(60, '', 8)).join(''); return; }
    const rows = S.activity.rows, n = S.actPage * (S.activity.pageSize || 30);
    h += rows.length ? `<div class="alist">${rows.slice(0, n).map(activityRow).join('')}</div>` + (rows.length > n ? `<button class="cta ghost" data-go="more">Show more</button>` : '')
      : `<div class="empty">Nothing yet tonight</div>`;
    el.innerHTML = h;
  }

  // ---------- ACCOUNT
  function renderAccount() {
    const el = $('#s-account');
    const a = S.account;
    let h = topbar('', { right: '<button class="sharebtn" data-go="invite">Share</button>' }) + `<div class="botrow big">${botAvatar}<div><div class="bn">Grok Bot</div><div class="muted" style="font-size:13px">FOMO desk · @Grokeasybot</div></div><div class="grow"></div>${modePill(a && a.mode)}</div>`;
    if (!a) { el.innerHTML = h + skel(160, '', 8) + skel(300, '', 16); return; }
    const labels = { scanner: 'Scanner', auditor: 'Auditor', analyst: 'Analyst', executor: 'Executor', risk: 'Risk', desk: 'Desk' };
    const val = (k, v) => typeof v === 'boolean' ? (v ? 'on' : 'off') : (k === 'stop_pct' ? '-' + v + '%' : k.endsWith('_pct') ? v + '%' : k.endsWith('_usd') ? '$' + v : String(v));
    h += `<div class="list">
      <div class="kv"><span class="k">Mode</span><span class="val">${modePill(a.mode)}</span></div>
      <div class="kv"><span class="k">Stack</span><span class="val">${usd(a.stack)}</span></div>
      <a class="kv" href="${esc(a.profile_url)}" target="_blank" rel="noopener"><span>Your FOMO profile</span><span class="val muted">@${esc(a.fomo_handle)} ›</span></a>
      <button class="kv" style="width:100%" data-go="invite"><span>Invite a friend</span><span class="val muted">Share ›</span></button>
      <div class="kv"><span class="k">Telegram</span><span class="val ${a.telegram.connected ? 'up' : 'down'}">${a.telegram.connected ? 'Connected · ' + esc(a.telegram.bot) : 'Not connected'}</span></div>
      <div class="kv"><span class="k">Web push</span><span class="val muted" style="max-width:60%">${esc(a.webpush)}</span></div>
    </div>
    <div class="grp">Settings are read-only here. Change them in Telegram, e.g. “set stop to -8%”.</div>`;
    for (const g of ['scanner', 'auditor', 'analyst', 'executor', 'risk', 'desk']) {
      const s = a.settings[g] || {};
      h += `<div class="grp">${labels[g]}</div><div class="list">${Object.keys(s).map(k => `<div class="kv"><span class="k">${esc(k)}</span><span class="val" style="font-family:var(--mono);font-size:13px;word-break:break-all">${esc(val(k, s[k]))}</span></div>`).join('')}</div>`;
    }
    el.innerHTML = h + '<div style="height:20px"></div>';
  }

  // ---------- COIN
  async function loadCoin(m) {
    try { S.coin[m] = await get('coin/' + m + '.json'); S.coin[m]._ok = true; }
    catch (e) { if (!S.coin[m]) S.coin[m] = { _missing: true, mint: m }; }
    render();
  }

  function renderCoin() {
    const el = $('#s-coin');
    const m = S.coinMint, c = S.coin[m];
    let h = topbar(c && c.symbol ? '$' + c.symbol : 'Coin', { right: modePill(S.state && S.state.mode) || undefined });
    if (!c) { el.innerHTML = h + skel(40, '60%', 4) + skel(70, '70%', 10) + skel(240, '', 14) + skel(120, '', 12); return; }
    if (c._missing) { el.innerHTML = h + `<div class="empty">This coin has no desk data yet</div>`; return; }
    const au = c.audit;
    const shield = au ? `<span class="chip ${au.passed ? '' : 'bad'}">🛡 ${au.partsPassed}/8</span>` : '';
    const age = c.ageH == null ? '' : c.ageH < 1 ? Math.round(c.ageH * 60) + 'm old' : Math.round(c.ageH) + 'h old';
    const pos = c.position;
    const open = pos && pos.open;
    h += `<div style="padding:4px 16px 0"><div style="display:flex;align-items:center;gap:12px">${AV(c.name || c.mint, c.mint, 44)}<span style="font-size:22px;font-weight:700;flex:1">${nm(c.name, c.mint)}</span>${shield}</div>
      <div class="muted" style="margin-top:2px">${esc(c.symbol || '')} · Solana${age ? ' · ' + age : ''}</div>${c.tag ? `<div class="tag">${esc(c.tag)}</div>` : ''}</div>
      <div class="price">${price(c.price)}</div>
      ${c.sinceEntryPct != null ? `<div style="padding:0 16px" class="${c.sinceEntryPct >= 0 ? 'up' : 'down'}">${c.sinceEntryPct >= 0 ? '▲' : '▼'} ${Math.abs(c.sinceEntryPct).toFixed(2)}% since entry</div>` : ''}
      <div class="chartwrap"><canvas id="candles"></canvas></div>
      <div class="grid2" style="margin-top:14px">
        <div class="cell"><div class="k">Market cap</div><div class="val">${kfmt(c.stats.marketCap)}</div></div>
        <div class="cell"><div class="k">Liquidity</div><div class="val">${kfmt(c.stats.liquidity)}</div></div>
        <div class="cell"><div class="k">24h volume</div><div class="val">${kfmt(c.stats.volume24h)}</div></div>
        <div class="cell"><div class="k">Holders</div><div class="val">${c.stats.holders == null ? 'n/a' : c.stats.holders}</div></div>
      </div>`;
    if (pos) {
      h += `<div class="grp">${open ? 'Your position' : 'Closed position'}</div><div class="list">
        <div class="kv"><span>${open ? 'Your position · ' + usd(pos.sizeUsd) + ' in · Executor' : 'Was ' + usd(pos.sizeUsd) + ' · ' + esc(pos.exitReason)}</span><span class="val ${pos.pnlUsd >= 0 ? 'up' : 'down'}">${open ? '' : usd(pos.pnlUsd, true)}</span></div></div>`;
    }
    if (open && c.exit) {
      const left = Math.max(0, c.exit.timeoutAt - Date.now() / 1000);
      h += `<div class="grp">Exit</div><div class="list">
        <div class="kv"><span class="k">Stop line</span><span class="val"><span class="tp r">-${fmtN(pos.stopPct)}%</span> ${price(c.exit.stop)}</span></div>
        <div class="kv"><span class="k">Trail line</span><span class="val">${c.exit.trailActive ? '<span class="tp g">trailing</span> ' : 'starts at '}${price(c.exit.trail)}</span></div>
        <div class="kv"><span class="k">Time to timeout</span><span class="val">${Math.floor(left / 3600)}h ${Math.floor(left % 3600 / 60)}m</span></div></div>`;
    }
    h += fomoA(c.coin_url, open ? 'Sell on FOMO' : 'Buy on FOMO', 'cta' + (open ? ' sell' : ''));
    if (au) h += `<button class="cta ghost" data-go="auditor:${esc(c.mint)}">See the audit</button>`;
    el.innerHTML = h;
    window.DeskChart.candles($('#candles'), c.candles, open && c.exit ? { exit: c.exit.line } : null, { height: 240 });
  }

  // ---------- AUDITOR SCREEN
  function renderAuditor() {
    const el = $('#s-auditor');
    let m = S.auditMint;
    if (!m && S.state && S.state.agents.auditor.current) { m = S.auditMint = S.state.agents.auditor.current.mint; loadCoin(m); }
    const c = m && S.coin[m];
    let h = topbar('Auditor');
    if (!m) { el.innerHTML = h + `<div class="empty">No coin taken apart yet</div>`; return; }
    if (!c) { el.innerHTML = h + `<div class="discs">${Array.from({ length: 8 }, () => '<div class="disc skel"></div>').join('')}</div>`; return; }
    const au = c.audit;
    if (!au) { el.innerHTML = h + `<div class="empty">No coin taken apart yet</div>`; return; }
    const key = m + ':' + au.ts;
    const play = !RM && !S.played[key];
    h += `<div style="text-align:center;font-size:20px;font-weight:700">${nm(c.name, c.mint)}</div>
      <div class="discs" id="discs">${au.layers.map((l, i) => `<div class="disc ${play ? '' : (l.pass === true ? 'ok' : l.pass === false ? 'bad' : 'grey')}" data-i="${i}">${l.pass === true && !play ? '✓ ' : l.pass === false && !play ? '✕ ' : ''}${esc(l.name)}</div>`).join('')}</div>
      <div class="verdict" id="verdict" style="${play ? 'visibility:hidden' : ''}">${au.passed
        ? `<div class="v1 up">Cleared · 8/8 parts</div><div class="v2">${au.sentUsd != null ? 'Sent to Executor · ' + usd(au.sentUsd) : 'Sent to Analyst'}</div>`
        : `<div class="v1 down">Rejected · ${esc(au.reason)}</div><div class="v2">Grok Bot won't buy ${nm(c.name, c.mint)}</div>`}</div>
      <div class="list" style="margin-top:12px">${au.layers.map(l => `<div class="kv"><span class="k">${l.n} · ${esc(l.name)}</span><span class="val ${l.pass === true ? 'up' : l.pass === false ? 'down' : 'muted'}">${esc(l.value)}</span></div>`).join('')}</div>
      <div class="list" style="margin-top:12px"><div class="kv"><span>Take apart before buying</span><span class="toggle ro ${au.enabled ? 'on' : ''}"></span></div></div>
      <div class="grp">Read-only here. Telegram: “set auditor off”.</div>
      ${fomoA(au.link, 'Open on FOMO', 'cta')}`;
    el.innerHTML = h;
    if (play) { S.played[key] = 1; beam(au); }
  }

  function beam(au) {
    // cyan beam reads each layer top to bottom: 350ms per layer, then 150ms to green or red
    const discs = Array.from(document.querySelectorAll('#discs .disc'));
    let i = 0;
    function step() {
      if (i >= discs.length) { $('#verdict').style.visibility = 'visible'; return; }
      const d = discs[i], l = au.layers[i];
      if (l.pass === null) { d.className = 'disc grey'; i++; step(); return; }
      d.className = 'disc beam';
      setTimeout(() => {
        d.className = 'disc ' + (l.pass ? 'ok' : 'bad');
        d.textContent = (l.pass ? '✓ ' : '✕ ') + l.name;
        setTimeout(() => { i++; step(); }, 150);
      }, 350);
    }
    step();
  }

  // ---------- render + poll
  function render() {
    const s = S.screen;
    if (s === 'home') renderHome();
    else if (s === 'agents') renderAgents();
    else if (s === 'activity') renderActivity();
    else if (s === 'account') renderAccount();
    else if (s === 'coin') renderCoin();
    else if (s === 'auditor') renderAuditor();
  }

  // coin files behind activity rows: refresh the home five each poll, fetch others once
  S.noCoin = {};
  async function loadRowCoins() {
    const rows = ((S.activity && S.activity.rows) || []).filter(r => r.opens === 'coin' && r.mint);
    const home = new Set(rows.slice(0, 5).map(r => r.mint));
    const lim = S.screen === 'activity' ? S.actPage * (S.activity.pageSize || 30) : 5;
    const want = [...new Set(rows.slice(0, lim).map(r => r.mint))].filter(m => !S.noCoin[m] && (home.has(m) || !(S.coin[m] && S.coin[m]._ok)));
    await Promise.all(want.map(m => get('coin/' + m + '.json').then(c => { c._ok = true; S.coin[m] = c; }).catch(() => { S.noCoin[m] = 1; })));
  }

  async function poll() {
    try {
      const [state, chart, activity, agents, account, coins] = await Promise.all(
        ['state.json', 'chart.json', 'activity.json', 'agents.json', 'account.json', 'coins.json'].map(get));
      if (Date.now() / 1000 - state.ts > 20 * 60) throw new Error('stale');
      Object.assign(S, { state, chart, activity, agents, account, coins });
      S.lastOk = state.ts * 1000; S.failing = false;
      if (S.screen === 'coin' && S.coinMint) await loadCoin(S.coinMint);
      if (S.screen === 'auditor' && S.auditMint) await loadCoin(S.auditMint);
    } catch (e) {
      S.failing = true;
      if (!S.lastOk && S.state) S.lastOk = S.state.ts * 1000;
    }
    S.nextTry = Date.now() + POLL_S * 1000;
    setError();
    render();
    if (!S.failing) { await loadRowCoins(); render(); }
    setTimeout(poll, POLL_S * 1000);
  }

  if (!BASE) {
    $('#err').textContent = 'Desk offline · open the desk link from Telegram once · retrying in 15s · last update never';
    $('#err').classList.add('on');
  }
  render();
  poll();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
