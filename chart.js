/* Hand-drawn <canvas> charts. No chart library. devicePixelRatio aware. */
(function (W) {
  const RM = W.matchMedia && W.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const C = { green: '#00d35a', red: '#ff453a', blue: '#0a84ff', orange: '#ff9f0a', cyan: '#64d2ff', ter: 'rgba(235,235,245,0.3)', sec: 'rgba(235,235,245,0.6)', sep: 'rgba(84,84,88,0.55)' };

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
    g.addColorStop(0, 'rgba(0,211,90,0.28)'); g.addColorStop(1, 'rgba(0,211,90,0)');
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

  W.DeskChart = { line, candles, ring, reducedMotion: RM };
})(window);
