/* Minimal dependency-free canvas plotter. drawPlot(canvas, cfg).
   cfg = {
     title, xlabel, ylabel, xlog, ylog,
     series: [{x:[], y:[], color, dash:[], width, label, points:false}],
     vlines: [{x, color, label, dash}], hlines: [{y, color, label, dash}],
     bands:  [{x0, x1, color}],
     marks:  [{x, y, color, label}],
     xmin,xmax,ymin,ymax  // optional overrides
   }
*/
(function (root) {
  "use strict";
  function niceTicks(min, max, n) {
    if (!isFinite(min) || !isFinite(max) || min === max) { min = 0; max = 1; }
    const span = max - min, step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const norm = step0 / mag, step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
    const ticks = []; let t = Math.ceil(min / step) * step;
    for (; t <= max + 1e-9; t += step) ticks.push(t);
    return ticks;
  }
  function logTicks(min, max) {
    const ticks = []; const a = Math.floor(min), b = Math.ceil(max);
    for (let e = a; e <= b; e++) ticks.push(Math.pow(10, e));
    return ticks;
  }
  function fmt(v) {
    if (v === 0) return "0";
    const a = Math.abs(v);
    if (a >= 1e5 || a < 1e-2) return v.toExponential(0);
    if (a >= 100) return v.toFixed(0);
    if (a >= 1) return v.toFixed(1);
    return v.toFixed(2);
  }

  function drawPlot(canvas, cfg) {
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.font = "11px system-ui, sans-serif";

    const m = { l: 56, r: 12, t: 26, b: 40 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;

    // collect data extents
    const xs = [], ys = [];
    (cfg.series || []).forEach(s => s.x.forEach((xv, i) => {
      const yv = s.y[i];
      if (isFinite(xv) && (!cfg.xlog || xv > 0)) xs.push(xv);
      if (isFinite(yv) && (!cfg.ylog || yv > 0)) ys.push(yv);
    }));
    (cfg.vlines || []).forEach(v => xs.push(v.x));
    (cfg.bands || []).forEach(b => { xs.push(b.x0); xs.push(b.x1); });
    (cfg.hlines || []).forEach(h => ys.push(h.y));
    (cfg.marks || []).forEach(p => { xs.push(p.x); ys.push(p.y); });

    let xmin = cfg.xmin != null ? cfg.xmin : Math.min(...xs);
    let xmax = cfg.xmax != null ? cfg.xmax : Math.max(...xs);
    let ymin = cfg.ymin != null ? cfg.ymin : Math.min(...ys);
    let ymax = cfg.ymax != null ? cfg.ymax : Math.max(...ys);
    if (!cfg.ylog && cfg.ymin == null) ymin = Math.min(ymin, 0);
    if (xmin === xmax) xmax = xmin + 1;
    if (ymin === ymax) ymax = ymin + 1;
    if (!cfg.ylog) ymax += (ymax - ymin) * 0.06;

    const lx = cfg.xlog ? Math.log10(xmin) : xmin, hx = cfg.xlog ? Math.log10(xmax) : xmax;
    const ly = cfg.ylog ? Math.log10(ymin) : ymin, hy = cfg.ylog ? Math.log10(ymax) : ymax;
    const X = v => m.l + ( (cfg.xlog ? Math.log10(v) : v) - lx) / (hx - lx) * pw;
    const Y = v => m.t + ph - ((cfg.ylog ? Math.log10(v) : v) - ly) / (hy - ly) * ph;

    // grid + ticks
    ctx.strokeStyle = "#e6e6e6"; ctx.fillStyle = "#444"; ctx.lineWidth = 1;
    const xt = cfg.xlog ? logTicks(lx, hx) : niceTicks(xmin, xmax, 6);
    xt.forEach(t => {
      const px = X(t); if (px < m.l - 1 || px > W - m.r + 1) return;
      ctx.beginPath(); ctx.moveTo(px, m.t); ctx.lineTo(px, m.t + ph); ctx.stroke();
      ctx.textAlign = "center"; ctx.fillText(fmt(t), px, m.t + ph + 14);
    });
    const yt = cfg.ylog ? logTicks(ly, hy) : niceTicks(ymin, ymax, 6);
    yt.forEach(t => {
      const py = Y(t); if (py < m.t - 1 || py > m.t + ph + 1) return;
      ctx.beginPath(); ctx.moveTo(m.l, py); ctx.lineTo(m.l + pw, py); ctx.stroke();
      ctx.textAlign = "right"; ctx.fillText(fmt(t), m.l - 6, py + 3);
    });

    // bands
    (cfg.bands || []).forEach(b => {
      ctx.fillStyle = b.color; ctx.globalAlpha = 0.18;
      ctx.fillRect(X(b.x0), m.t, X(b.x1) - X(b.x0), ph); ctx.globalAlpha = 1;
    });

    // axes box
    ctx.strokeStyle = "#888"; ctx.strokeRect(m.l, m.t, pw, ph);

    // clip to plot area for series
    ctx.save(); ctx.beginPath(); ctx.rect(m.l, m.t, pw, ph); ctx.clip();

    (cfg.series || []).forEach(s => {
      ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 2;
      ctx.setLineDash(s.dash || []);
      ctx.beginPath(); let started = false;
      for (let i = 0; i < s.x.length; i++) {
        const xv = s.x[i], yv = s.y[i];
        if (!isFinite(xv) || !isFinite(yv) || (cfg.xlog && xv <= 0) || (cfg.ylog && yv <= 0)) { started = false; continue; }
        const px = X(xv), py = Y(yv);
        if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
      }
      ctx.stroke(); ctx.setLineDash([]);
      if (s.points) { ctx.fillStyle = s.color; for (let i = 0; i < s.x.length; i++) { const px = X(s.x[i]), py = Y(s.y[i]); ctx.beginPath(); ctx.arc(px, py, 2, 0, 7); ctx.fill(); } }
    });

    // vlines / hlines
    (cfg.vlines || []).forEach(v => {
      ctx.strokeStyle = v.color; ctx.lineWidth = 1.5; ctx.setLineDash(v.dash || [4, 3]);
      ctx.beginPath(); ctx.moveTo(X(v.x), m.t); ctx.lineTo(X(v.x), m.t + ph); ctx.stroke(); ctx.setLineDash([]);
    });
    (cfg.hlines || []).forEach(h => {
      ctx.strokeStyle = h.color; ctx.lineWidth = 1.5; ctx.setLineDash(h.dash || [4, 3]);
      ctx.beginPath(); ctx.moveTo(m.l, Y(h.y)); ctx.lineTo(m.l + pw, Y(h.y)); ctx.stroke(); ctx.setLineDash([]);
    });
    // marks
    (cfg.marks || []).forEach(p => {
      ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), 5, 0, 7); ctx.fill();
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 1; ctx.stroke();
    });
    ctx.restore();

    // vline/hline labels (outside clip)
    (cfg.vlines || []).forEach(v => { if (!v.label) return; ctx.fillStyle = v.color; ctx.textAlign = "left"; ctx.fillText(v.label, X(v.x) + 3, m.t + 10); });

    // title + axis labels
    ctx.fillStyle = "#111"; ctx.textAlign = "center"; ctx.font = "bold 12px system-ui, sans-serif";
    ctx.fillText(cfg.title || "", m.l + pw / 2, 16);
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillText(cfg.xlabel || "", m.l + pw / 2, H - 6);
    ctx.save(); ctx.translate(13, m.t + ph / 2); ctx.rotate(-Math.PI / 2);
    ctx.fillText(cfg.ylabel || "", 0, 0); ctx.restore();

    // legend
    const leg = (cfg.series || []).filter(s => s.label);
    if (leg.length) {
      ctx.font = "10px system-ui, sans-serif"; ctx.textAlign = "left";
      let ly2 = m.t + 4;
      const lw = 116, lx2 = m.l + pw - lw - 4;
      ctx.fillStyle = "rgba(255,255,255,0.82)"; ctx.fillRect(lx2, ly2, lw, leg.length * 13 + 4);
      ctx.strokeStyle = "#ccc"; ctx.strokeRect(lx2, ly2, lw, leg.length * 13 + 4);
      leg.forEach(s => {
        ly2 += 13;
        ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 2; ctx.setLineDash(s.dash || []);
        ctx.beginPath(); ctx.moveTo(lx2 + 4, ly2 - 3); ctx.lineTo(lx2 + 20, ly2 - 3); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = "#222"; ctx.fillText(s.label, lx2 + 24, ly2);
      });
    }
  }
  root.drawPlot = drawPlot;
})(window);
