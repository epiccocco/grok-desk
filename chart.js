/* Hand-drawn <canvas> charts. No chart library. devicePixelRatio aware. */
(function (W) {
  const RM = W.matchMedia && W.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const C = { green: '#16e08a', red: '#ff3b30', blue: '#0a84ff', orange: '#ff9f0a', cyan: '#64d2ff', ter: 'rgba(235,235,245,0.3)', sec: 'rgba(235,235,245,0.6)', sep: 'rgba(84,84,88,0.55)' };

  function setup(cv, h) {
    const dpr = W.devicePixelRatio || 1;
    const w = cv.clientWidth || cv.parentNode.clientWidth;
    cv.style.height = h + 'px';
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  function font(ctx, px, weight) { ctx.font = `${weight || 600} ${px}px -apple-system, "SF Pro Text", BlinkMacSystemFont, sans-serif`; }

  const lineState = new WeakMap();

  // points [[ts, v]], marks [{ts, text, color}], start value
  function line(cv, data, opt) {
    opt = opt || {};
    const st = lineState.get(cv) || {};
    const pts = (data && data.points) || [];
    const prevLast = st.last;
    const last = pts.length ? pts[pts.length - 1] : null;
    const animate = !RM && prevLast && last && last[0] !== prevLast[0] && opt.range === st.range;
    lineState.set(cv, { last, range: opt.range });
    const t0 = performance.now();
    const marksNew = animate || !st.drawn;
    function frame(now) {
      const k = animate ? Math.min(1, (now - t0) / 250) : 1;
      const mk = marksNew && !RM ? Math.min(1, (now - t0) / 200) : 1;
      draw(cv, data, opt, k, mk);
      if (k < 1 || mk < 1) requestAnimationFrame(frame);
    }
    st.drawn = true;
    requestAnimationFrame(frame);
  }

  function draw(cv, data, opt, k, mk) {
    const H = opt.height || 220;
    const { ctx, w, h } = setup(cv, H);
    const pts = (data && data.points) || [];
    const start = data && data.start;
    const top = 34, bot = h - 8;
    if (pts.length < 2) {
      // empty: dashed start line + message
      ctx.setLineDash([4, 5]); ctx.strokeStyle = C.ter; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke(); ctx.setLineDash([]);
      font(ctx, 15, 500); ctx.fillStyle = C.sec; ctx.textAlign = 'center';
      ctx.fillText('Waiting for the first trade', w / 2, h / 2 - 14);
      return;
    }
    let xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    if (start != null) ys = ys.concat([start]);
    let minX = xs[0], maxX = xs[xs.length - 1];
    let minY = Math.min(...ys), maxY = Math.max(...ys);
    if (maxY - minY < 1e-9) { minY -= 1; maxY += 1; }
    const pad = (maxY - minY) * 0.12; minY -= pad; maxY += pad;
    const X = t => (maxX === minX ? w : (t - minX) / (maxX - minX) * w);
    const Y = v => bot - (v - minY) / (maxY - minY) * (bot - top);
    // slide-in of the newest point
    const n = pts.length;
    const drawPts = pts.map((p, i) => [X(p[0]), Y(p[1])]);
    if (k < 1 && n >= 2) {
      const a = drawPts[n - 2], b = drawPts[n - 1];
      drawPts[n - 1] = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
    }
    // dashed start line
    if (start != null) {
      ctx.setLineDash([4, 5]); ctx.strokeStyle = C.ter; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, Y(start)); ctx.lineTo(w, Y(start)); ctx.stroke(); ctx.setLineDash([]);
    }
    // gradient fill under the line
    const g = ctx.createLinearGradient(0, top, 0, bot);
    g.addColorStop(0, 'rgba(22,224,138,0.28)'); g.addColorStop(1, 'rgba(22,224,138,0)');
    ctx.beginPath(); ctx.moveTo(drawPts[0][0], bot);
    drawPts.forEach(p => ctx.lineTo(p[0], p[1]));
    ctx.lineTo(drawPts[n - 1][0], bot); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
    ctx.beginPath(); drawPts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
    ctx.strokeStyle = C.green; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
    // marks above the line, never overlapping (later mark moves up a row)
    const marks = ((data && data.marks) || []).filter(m => m.ts >= minX && m.ts <= maxX);
    font(ctx, 11, 600); ctx.textAlign = 'center'; ctx.globalAlpha = mk;
    const placed = [];
    marks.forEach(m => {
      const v = valueAt(pts, m.ts);
      const x = X(m.ts), yLine = Y(v);
      const tw = ctx.measureText(m.text).width + 12;
      let row = 0, box;
      while (true) {
        const y = Math.max(14, yLine - 14 - row * 20);
        box = { x0: x - tw / 2, x1: x + tw / 2, y };
        if (!placed.some(b => Math.abs(b.y - box.y) < 18 && !(box.x1 < b.x0 || box.x0 > b.x1))) break;
        row++;
        if (row > 6) break;
      }
      placed.push(box);
      const col = m.color === 'green' ? C.green : m.color === 'red' ? C.red : C.blue;
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, yLine, 3, 0, 7); ctx.fill();
      const bx = Math.max(2, Math.min(w - tw - 2, box.x0));
      ctx.fillStyle = 'rgba(28,28,30,0.95)'; roundRect(ctx, bx, box.y - 9, tw, 18, 9); ctx.fill();
      ctx.fillStyle = col; ctx.fillText(m.text, bx + tw / 2, box.y + 4);
    });
    ctx.globalAlpha = 1;
  }

  function valueAt(pts, t) {
    let best = pts[0];
    for (const p of pts) { if (p[0] <= t) best = p; else break; }
    return best[1];
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // candles [[t,o,h,l,c,vol]]; lines {exit: price, entry: price}
  function candles(cv, cs, lines, opt) {
    opt = opt || {};
    const { ctx, w, h } = setup(cv, opt.height || 240);
    if (!cs || !cs.length) {
      font(ctx, 15, 500); ctx.fillStyle = C.sec; ctx.textAlign = 'center';
      ctx.fillText('No price data yet', w / 2, h / 2); return;
    }
    const volH = 44, top = 10, bot = h - volH - 10;
    let lo = Math.min(...cs.map(c => c[3])), hi = Math.max(...cs.map(c => c[2]));
    if (lines && lines.exit) { lo = Math.min(lo, lines.exit); hi = Math.max(hi, lines.exit); }
    if (hi - lo < hi * 1e-6) { hi *= 1.01; lo *= 0.99; }
    const pad = (hi - lo) * 0.08; hi += pad; lo -= pad;
    const Y = v => bot - (v - lo) / (hi - lo) * (bot - top);
    const n = Math.min(cs.length, 80), list = cs.slice(-n);
    const cw = w / n, bw = Math.max(1.5, cw * 0.62);
    const maxV = Math.max(1e-9, ...list.map(c => c[5] || 0));
    list.forEach((c, i) => {
      const x = i * cw + cw / 2, up = c[4] >= c[1], col = up ? C.green : C.red;
      ctx.strokeStyle = col; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, Y(c[2])); ctx.lineTo(x, Y(c[3])); ctx.stroke();
      const y0 = Y(Math.max(c[1], c[4])), y1 = Y(Math.min(c[1], c[4]));
      ctx.fillStyle = col; ctx.fillRect(x - bw / 2, y0, bw, Math.max(1, y1 - y0));
      const vh = (c[5] || 0) / maxV * volH;
      ctx.globalAlpha = 0.45; ctx.fillRect(x - bw / 2, h - vh, bw, vh); ctx.globalAlpha = 1;
    });
    if (lines && lines.exit) {
      const y = Y(lines.exit);
      ctx.setLineDash([6, 5]); ctx.strokeStyle = C.orange; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); ctx.setLineDash([]);
      font(ctx, 11, 600); ctx.fillStyle = C.orange; ctx.textAlign = 'right';
      ctx.fillText('Risk trailing stop', w - 4, y - 5);
    }
  }

  // score ring 0-100; green from threshold
  function ring(cv, score, threshold, size) {
    size = size || 120;
    cv.style.width = size + 'px';
    const { ctx, w, h } = setup(cv, size);
    const r = size / 2 - 8, cx = w / 2, cy = h / 2;
    ctx.lineWidth = 10; ctx.lineCap = 'round';
    ctx.strokeStyle = '#2c2c2e'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    if (score != null) {
      ctx.strokeStyle = score >= threshold ? C.green : '#ffd60a';
      ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, Math.min(100, score)) / 100); ctx.stroke();
    }
    font(ctx, size * 0.28, 700); ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(score == null ? '–' : String(score), cx, cy);
  }

  // ---------- SVG area chart with event bubbles (v2 home)
  // data {points:[[ts,v]], start, events:[{ts, kind, name, mint, label, color}]}
  const BCOL = { green: '#16e08a', red: '#ff3b30', blue: '#0a84ff' };
  function hue(s) { let h = 0; for (const c of String(s || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; }
  function initials(n) { const w = String(n || '?').replace(/[^A-Za-z0-9 ]/g, '').trim().split(/\s+/); return ((w[0] || '?')[0] + (w[1] ? w[1][0] : (w[0] || '').slice(1, 2))).toUpperCase(); }
  function avatar(name, mint, size) {
    const h = hue(mint || name);
    return `<span class="cav" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px;background:linear-gradient(135deg,hsl(${h},70%,52%),hsl(${(h + 40) % 360},70%,34%))">${initials(name).replace(/[<>&]/g, '')}</span>`;
  }
  const escH = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // v3: sharp neon line with glow, LIVE slide-left, leading dot pulse, glass bubbles that spring in when new.
  // Rebuilds only when the data really changes, so loops (pulse) and pops never restart on an unchanged poll.
  const GREEN = '#16e08a', RED = '#ff3b30';
  function area(el, data, opt) {
    opt = opt || {};
    const w = el.clientWidth || 358, H = opt.height || 300;
    const pts = (data && data.points) || [];
    const prev = el._st || null;
    if (pts.length < 2) {
      el._st = { range: opt.range, empty: true };
      if (prev && prev.empty && prev.w === w) return;
      el.style.height = H + 'px';
      el.innerHTML = `<svg width="${w}" height="${H}" viewBox="0 0 ${w} ${H}"><line x1="0" x2="${w}" y1="${H * 0.62}" y2="${H * 0.62}" stroke="rgba(255,255,255,.18)" stroke-dasharray="3 5"/></svg>
        <div class="chartmsg" style="top:${H * 0.62 - 44}px">Waiting for the first trade</div>`;
      el._st.w = w;
      return;
    }
    const evAll = ((data.events) || []);
    const minX = pts[0][0], maxX = pts[pts.length - 1][0];
    const evs = evAll.filter(e => e.ts >= minX - 1 && e.ts <= maxX + 1).sort((a, b) => b.ts - a.ts).slice(0, 8);
    const ekey = e => e.kind + ':' + e.mint + ':' + Math.round(e.ts);
    const sig = [opt.range, w, H, pts.length, pts[0][0], pts[0][1], maxX, pts[pts.length - 1][1], data.start, evs.map(e => ekey(e) + e.label).join('|')].join(';');
    if (prev && prev.sig === sig) return;
    const sameRange = prev && !prev.empty && prev.range === opt.range && prev.w === w;
    const X = t => maxX === minX ? w - 6 : 4 + (t - minX) / (maxX - minX) * (w - 10);
    const BH = 40, GAP = 8, LANE = BH + 10, LANES = 3;
    const lanes = Array.from({ length: LANES }, () => []);
    const placed = [];
    for (const e of evs) {
      const txt = Math.max(String(e.name).length, String(e.label).length);
      const bw = Math.min(156, Math.max(98, 44 + txt * 6.6));
      const cx = X(e.ts);
      const x0 = Math.max(0, Math.min(w - bw, cx - bw / 2));
      let lane = -1;
      for (let i = 0; i < LANES; i++) {
        if (!lanes[i].some(b => !(x0 + bw + GAP <= b.x0 || x0 >= b.x0 + b.w + GAP))) { lane = i; break; }
      }
      if (lane < 0) continue;
      const b = { x0, w: bw, lane, e, cx };
      lanes[lane].push(b); placed.push(b);
    }
    const used = placed.length ? Math.max(...placed.map(b => b.lane)) + 1 : 0;
    const top = used ? used * LANE + 26 : 26, bot = H - 6;
    let ys = pts.map(p => p[1]);
    if (data.start != null) ys = ys.concat([data.start]);
    let lo = Math.min(...ys), hi = Math.max(...ys);
    if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.1; lo -= pad; hi += pad;
    const Y = v => bot - (v - lo) / (hi - lo) * (bot - top);
    // LIVE: new points arrived in the same window -> slide the whole line left so the latest point lands on the right edge
    const lastPrev = prev && prev.last;
    const slide = !RM && sameRange && opt.range === 'LIVE' && lastPrev && maxX > lastPrev[0] && lastPrev[0] >= minX - 3600;
    // keep the points that just scrolled off the left so the left edge has no gap while sliding
    let drawPts = pts;
    if (slide && prev.pts) drawPts = prev.pts.filter(p => p[0] < minX).concat(pts);
    const P = drawPts.map(p => [X(p[0]), Y(p[1])]);
    const line = P.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');
    const areaD = line + `L${P[P.length - 1][0].toFixed(1)} ${H}L${P[0][0].toFixed(1)} ${H}Z`;
    const up = pts[pts.length - 1][1] >= (data.start != null ? data.start : pts[0][1]);
    const col = up ? GREEN : RED;
    const gid = 'g' + Math.random().toString(36).slice(2, 7);
    const valueAt = t => { let b = pts[0]; for (const p of pts) { if (p[0] <= t) b = p; else break; } return b[1]; };
    let svg = `<svg width="${w}" height="${H}" viewBox="0 0 ${w} ${H}"><defs>
      <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".26"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient>
      <filter id="${gid}f" x="-10%" y="-30%" width="120%" height="160%"><feGaussianBlur stdDeviation="3.2"/></filter>
      <clipPath id="${gid}c"><rect x="0" y="-40" width="${w + 40}" height="${H + 80}"/></clipPath></defs>`;
    if (data.start != null) svg += `<line x1="0" x2="${w}" y1="${Y(data.start).toFixed(1)}" y2="${Y(data.start).toFixed(1)}" stroke="rgba(255,255,255,.16)" stroke-dasharray="3 5"/>`;
    svg += `<g clip-path="url(#${gid}c)"><g class="cmove">`;
    svg += `<path d="${areaD}" fill="url(#${gid})"/>`;
    svg += `<path d="${line}" fill="none" stroke="${col}" stroke-width="5" stroke-opacity=".75" stroke-linejoin="miter" stroke-miterlimit="3" filter="url(#${gid}f)"/>`;
    svg += `<path class="cline" d="${line}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="miter" stroke-miterlimit="3" stroke-linecap="butt"/>`;
    let html = '';
    const seen = (sameRange && prev.seen) || null;    // null: first draw or new range -> every bubble pops
    const nowSeen = new Set();
    let k = 0;
    for (const b of placed.slice().sort((a, b2) => a.e.ts - b2.e.ts)) {
      const c = BCOL[b.e.color] || BCOL.blue;
      const dy = Y(valueAt(b.e.ts)), by = 6 + b.lane * LANE + BH;
      const lx = Math.max(b.x0 + 14, Math.min(b.x0 + b.w - 14, b.cx));
      svg += `<path d="M${lx.toFixed(1)} ${by}L${b.cx.toFixed(1)} ${(dy - 5).toFixed(1)}" stroke="${c}" stroke-opacity=".6" stroke-width="1.2" stroke-dasharray="1.5 3.5" fill="none" stroke-linecap="round"/>`;
      svg += `<circle cx="${b.cx.toFixed(1)}" cy="${dy.toFixed(1)}" r="4.5" fill="#000" stroke="${c}" stroke-width="2"/>`;
      const key = ekey(b.e); nowSeen.add(key);
      const isNew = !seen || !seen.has(key);
      const delay = !isNew ? 0 : (seen ? (slide ? 260 : 0) : 120 + k++ * 90);
      html += `<div class="bub${isNew && !RM ? ' pop' : ''}" data-go="coin:${escH(b.e.mint)}" style="left:${b.x0.toFixed(1)}px;top:${6 + b.lane * LANE}px;width:${b.w.toFixed(0)}px;--d:${delay}ms;transform-origin:${Math.max(10, Math.min(b.w - 10, b.cx - b.x0)).toFixed(0)}px 100%">
        ${avatar(b.e.name, b.e.mint, 26)}<span class="bt"><b>${escH(b.e.name)}</b><i style="color:${c}">${escH(b.e.label)}</i></span></div>`;
    }
    const L = P[P.length - 1];
    svg += `<circle class="pring" cx="${L[0].toFixed(1)}" cy="${L[1].toFixed(1)}" r="7" fill="none" stroke="${col}" stroke-width="2"/>
      <circle cx="${L[0].toFixed(1)}" cy="${L[1].toFixed(1)}" r="7" fill="${col}" fill-opacity=".22"/>
      <circle class="pdot" cx="${L[0].toFixed(1)}" cy="${L[1].toFixed(1)}" r="4" fill="${col}" style="color:${col}"/></g></g></svg>`;
    el.style.height = H + 'px';
    el.innerHTML = svg + html;
    el.classList.toggle('down', !up);
    if (slide) {
      // the previous latest point sat on the right edge: start shifted by that distance, then glide to 0
      const shift = (w - 6) - X(lastPrev[0]);
      const g = el.querySelector('.cmove');
      if (shift > 0.5 && g) {
        g.style.transform = `translateX(${shift.toFixed(1)}px)`;
        g.getBoundingClientRect();
        requestAnimationFrame(() => { g.style.transition = 'transform 600ms cubic-bezier(.25,.8,.25,1)'; g.style.transform = 'translateX(0)'; });
      }
    }
    el._st = { sig, range: opt.range, w, last: pts[pts.length - 1], pts, seen: nowSeen };
  }

  W.DeskChart = { line, area, avatar, candles, ring, reducedMotion: RM };
})(window);
