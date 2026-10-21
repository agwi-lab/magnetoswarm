/* MagnetoSwarm — canvas renderer. */
(function (global) {
  'use strict';
  const MS = global.MS = global.MS || {};
  const S = MS.sources;
  const fmtSI = MS.util.fmtSI;

  const COLORS = {
    bg: '#0E141B', wall: '#46525E', wallEdge: '#6B7A89', lumen: 'rgba(93,169,201,0.16)', lumenLine: 'rgba(157,210,233,0.55)',
    north: '#E8604C', south: '#4F86E0', copper: '#C98A4B', copperDark: '#8A5B2D', accent: '#F2B33D',
    flowing: '#9EDCEF', retained: '#F2B33D', contact: '#FFB08A', stream: 'rgba(230,235,240,0.33)', text: '#E6EBF0', muted: '#93A0AE',
    ctrl: '#5DA9C9',
  };

  /* magma-like colour map (dark → bright) */
  const MAGMA = [[0, 0, 4], [27, 12, 65], [74, 12, 107], [120, 28, 109], [165, 44, 96], [207, 68, 70], [237, 105, 37], [251, 154, 6], [247, 209, 61], [252, 255, 164]];
  const LUT = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const f = i / 255 * (MAGMA.length - 1), k = Math.min(MAGMA.length - 2, Math.floor(f)), a = f - k;
    for (let c = 0; c < 3; c++) LUT[3 * i + c] = MAGMA[k][c] + a * (MAGMA[k + 1][c] - MAGMA[k][c]);
  }

  class Renderer {
    constructor(canvas, sim) {
      this.canvas = canvas; this.sim = sim;
      this.ctx = canvas.getContext('2d');
      this.view = { scale: 5000, cx: 0, cy: 0 };     // px per metre, world centre
      this.opts = { heatmap: true, bmin: 1e-3, bmax: 1.0, streamlines: true, streamDensity: 1, flowGlyphs: true, colorMode: 'state', showMoments: true, showForces: false, particleBoost: 1, showInteractions: true, trails: false };
      this.heat = { canvas: document.createElement('canvas'), gw: 0, gh: 0, bx: null, by: null, x0: 0, y0: 0, x1: 0, y1: 0, key: '', time: -1, img: null, streams: [] };
      this.selected = null; this.hover = null; this.probe = null; this.editTube = false;
      this.dpr = 1; this.w = 0; this.h = 0;
      this._dirty = true;
      this.resize();
    }

    /* ------------------------------------------------------------ view */
    resize() {
      const c = this.canvas, r = c.getBoundingClientRect();
      this.dpr = Math.min(2, window.devicePixelRatio || 1);
      this.w = Math.max(1, Math.round(r.width)); this.h = Math.max(1, Math.round(r.height));
      c.width = Math.round(this.w * this.dpr); c.height = Math.round(this.h * this.dpr);
      this.invalidate();
    }
    invalidate() { this._dirty = true; }
    w2s(x, y, out) { out = out || {}; out.x = (x - this.view.cx) * this.view.scale + this.w / 2; out.y = this.h / 2 - (y - this.view.cy) * this.view.scale; return out; }
    s2w(sx, sy, out) { out = out || {}; out.x = (sx - this.w / 2) / this.view.scale + this.view.cx; out.y = (this.h / 2 - sy) / this.view.scale + this.view.cy; return out; }
    fitToScene(margin, tubeOnly) {
      const b = this.sim.tube.bounds(0);
      let x0 = b.x0, y0 = b.y0, x1 = b.x1, y1 = b.y1;
      if (!tubeOnly) for (const s of this.sim.field.sources) {
        const r = S.size(s) * 0.75;
        x0 = Math.min(x0, s.x - r); x1 = Math.max(x1, s.x + r); y0 = Math.min(y0, s.y - r); y1 = Math.max(y1, s.y + r);
      }
      margin = margin || 0.12;
      const wx = (x1 - x0) * (1 + 2 * margin) || 1e-3, wy = (y1 - y0) * (1 + 2 * margin) || 1e-3;
      this.view.scale = Math.min(this.w / wx, this.h / wy);
      this.view.cx = 0.5 * (x0 + x1); this.view.cy = 0.5 * (y0 + y1);
      this.invalidate();
    }
    zoomAt(sx, sy, factor) {
      const w = this.s2w(sx, sy);
      this.view.scale *= factor;
      const w2 = this.s2w(sx, sy);
      this.view.cx += w.x - w2.x; this.view.cy += w.y - w2.y;
      this.invalidate();
    }
    pan(dsx, dsy) { this.view.cx -= dsx / this.view.scale; this.view.cy += dsy / this.view.scale; this.invalidate(); }

    /* ------------------------------------------------------------ heat map */
    rebuildHeat(t) {
      const field = this.sim.field, H = this.heat;
      const tv = field.isTimeVarying();
      const gw = tv ? 112 : 160, gh = Math.max(16, Math.round(gw * this.h / this.w));
      const a = this.s2w(0, this.h), b = this.s2w(this.w, 0);
      const key = `${field.version}|${this.view.scale.toExponential(4)}|${this.view.cx.toExponential(6)}|${this.view.cy.toExponential(6)}|${gw}x${gh}|${this.w}x${this.h}`;
      const now = performance.now();
      if (key === H.key && !(tv && now - H.time > 150)) return;
      H.key = key; H.time = now;
      if (H.gw !== gw || H.gh !== gh) { H.gw = gw; H.gh = gh; H.bx = new Float32Array(gw * gh); H.by = new Float32Array(gw * gh); H.canvas.width = gw; H.canvas.height = gh; H.img = H.canvas.getContext('2d').createImageData(gw, gh); }
      H.x0 = a.x; H.y0 = a.y; H.x1 = b.x; H.y1 = b.y;
      field.sampleGrid(a.x, a.y, b.x, b.y, gw, gh, t, H.bx, H.by);
      // colourize (log scale), row 0 = bottom of the world → draw flipped
      const d = H.img.data, lo = Math.log10(this.opts.bmin), hi = Math.log10(this.opts.bmax);
      for (let j = 0; j < gh; j++) {
        const row = (gh - 1 - j) * gw;
        for (let i = 0; i < gw; i++) {
          const k = j * gw + i;
          const B = Math.hypot(H.bx[k], H.by[k]);
          let v = B > 0 ? (Math.log10(B) - lo) / (hi - lo) : 0;
          v = v < 0 ? 0 : v > 1 ? 1 : v;
          const ci = Math.round(v * 255) * 3, o = (row + i) * 4;
          d[o] = LUT[ci]; d[o + 1] = LUT[ci + 1]; d[o + 2] = LUT[ci + 2]; d[o + 3] = 255;
        }
      }
      H.canvas.getContext('2d').putImageData(H.img, 0, 0);
      this.buildStreamlines();
    }
    sampleHeat(x, y, out) {
      const H = this.heat;
      const fx = (x - H.x0) / (H.x1 - H.x0) * (H.gw - 1), fy = (y - H.y0) / (H.y1 - H.y0) * (H.gh - 1);
      if (fx < 0 || fy < 0 || fx > H.gw - 1 || fy > H.gh - 1) { out.x = 0; out.y = 0; return false; }
      const i = Math.min(H.gw - 2, Math.floor(fx)), j = Math.min(H.gh - 2, Math.floor(fy)), a = fx - i, b = fy - j;
      const k = j * H.gw + i;
      out.x = (1 - a) * (1 - b) * H.bx[k] + a * (1 - b) * H.bx[k + 1] + (1 - a) * b * H.bx[k + H.gw] + a * b * H.bx[k + H.gw + 1];
      out.y = (1 - a) * (1 - b) * H.by[k] + a * (1 - b) * H.by[k + 1] + (1 - a) * b * H.by[k + H.gw] + a * b * H.by[k + H.gw + 1];
      return true;
    }
    buildStreamlines() {
      const H = this.heat, lines = [];
      const spacing = 34 / Math.max(0.25, this.opts.streamDensity);
      const o = { x: 0, y: 0 };
      const stepPx = 3, maxSteps = 260;
      const seen = new Uint8Array(Math.ceil(this.w / 8) * Math.ceil(this.h / 8));
      const sw8 = Math.ceil(this.w / 8);
      const mark = (sx, sy) => { const i = Math.floor(sx / 8), j = Math.floor(sy / 8); if (i < 0 || j < 0 || i >= sw8 || j * sw8 + i >= seen.length) return true; const k = j * sw8 + i; if (seen[k]) return true; seen[k] = 1; return false; };
      for (let sy = spacing / 2; sy < this.h; sy += spacing) for (let sx = spacing / 2; sx < this.w; sx += spacing) {
        const pts = [];
        for (let dir = -1; dir <= 1; dir += 2) {
          let p = this.s2w(sx, sy), seg = [];
          for (let n = 0; n < maxSteps; n++) {
            if (!this.sampleHeat(p.x, p.y, o)) break;
            let B = Math.hypot(o.x, o.y); if (B < 1e-9) break;
            // RK2 midpoint in screen units
            const hx = o.x / B * dir * stepPx / this.view.scale, hy = o.y / B * dir * stepPx / this.view.scale;
            if (!this.sampleHeat(p.x + 0.5 * hx, p.y + 0.5 * hy, o)) break;
            B = Math.hypot(o.x, o.y); if (B < 1e-9) break;
            p = { x: p.x + o.x / B * dir * stepPx / this.view.scale, y: p.y + o.y / B * dir * stepPx / this.view.scale };
            const s = this.w2s(p.x, p.y);
            if (s.x < -10 || s.y < -10 || s.x > this.w + 10 || s.y > this.h + 10) break;
            if (n > 4 && mark(s.x, s.y)) break;
            seg.push(s.x, s.y);
          }
          if (dir < 0) seg = seg.reverse ? (function (sg) { const r = []; for (let i = sg.length - 2; i >= 0; i -= 2) r.push(sg[i], sg[i + 1]); return r; })(seg) : seg;
          pts.push(...seg);
        }
        if (pts.length > 12) lines.push(pts);
      }
      H.streams = lines;
    }

    /* ------------------------------------------------------------ drawing */
    draw(t) {
      const ctx = this.ctx, sim = this.sim;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.fillStyle = COLORS.bg; ctx.fillRect(0, 0, this.w, this.h);
      if (this.opts.heatmap) {
        this.rebuildHeat(t);
        ctx.imageSmoothingEnabled = true;
        ctx.globalAlpha = 0.85;
        ctx.drawImage(this.heat.canvas, 0, 0, this.w, this.h);
        ctx.globalAlpha = 1;
        if (this.opts.streamlines) this.drawStreamlines();
      }
      this.drawTube();
      this.drawSources(t);
      this.drawParticles();
      if (this.editTube) this.drawTubeHandles();
      this.drawOverlay(t);
    }
    drawStreamlines() {
      const ctx = this.ctx;
      ctx.strokeStyle = COLORS.stream; ctx.lineWidth = 1;
      ctx.beginPath();
      for (const L of this.heat.streams) { ctx.moveTo(L[0], L[1]); for (let i = 2; i < L.length; i += 2) ctx.lineTo(L[i], L[i + 1]); }
      ctx.stroke();
      // direction ticks (small arrowheads) at line midpoints
      ctx.fillStyle = 'rgba(230,235,240,0.5)';
      for (const L of this.heat.streams) {
        const m = (L.length / 2 >> 1) * 2; if (m < 4) continue;
        const x = L[m], y = L[m + 1], dx = L[m] - L[m - 2], dy = L[m + 1] - L[m - 1], n = Math.hypot(dx, dy) || 1;
        const ux = dx / n, uy = dy / n;
        ctx.beginPath(); ctx.moveTo(x + 4 * ux, y + 4 * uy); ctx.lineTo(x - 2 * ux + 2.5 * uy, y - 2 * uy - 2.5 * ux); ctx.lineTo(x - 2 * ux - 2.5 * uy, y - 2 * uy + 2.5 * ux); ctx.closePath(); ctx.fill();
      }
    }
    drawTube() {
      const ctx = this.ctx, tube = this.sim.tube, h = tube.params.h0;
      const [oa, ob] = tube.wallPolylines(h / Math.max(1, tube.lambda[0]));   // outer wall (thinner when stretched)
      const [ia, ib] = tube.wallPolylines(0);
      const poly = (A, B, fill, stroke, lw) => {
        ctx.beginPath();
        let p = this.w2s(A[0][0], A[0][1]); ctx.moveTo(p.x, p.y);
        for (let i = 1; i < A.length; i++) { p = this.w2s(A[i][0], A[i][1]); ctx.lineTo(p.x, p.y); }
        for (let i = B.length - 1; i >= 0; i--) { p = this.w2s(B[i][0], B[i][1]); ctx.lineTo(p.x, p.y); }
        ctx.closePath();
        if (fill) { ctx.fillStyle = fill; ctx.fill(); }
        if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.stroke(); }
      };
      poly(oa, ob, COLORS.wall, COLORS.wallEdge, 1);
      poly(ia, ib, COLORS.lumen, COLORS.lumenLine, 1);
      // inlet / outlet marks
      ctx.fillStyle = COLORS.muted; ctx.font = '11px IBM Plex Sans, system-ui, sans-serif'; ctx.textAlign = 'center';
      const pin = this.w2s(tube.sx[0] - tube.tx[0] * (tube.R[0] + h) * 0.9, tube.sy[0] - tube.ty[0] * (tube.R[0] + h) * 0.9);
      ctx.fillText('inlet', pin.x, pin.y + 4);
      const N = tube.N - 1;
      const pout = this.w2s(tube.sx[N] + tube.tx[N] * (tube.R[N] + h) * 0.9, tube.sy[N] + tube.ty[N] * (tube.R[N] + h) * 0.9);
      ctx.fillText('outlet', pout.x, pout.y + 4);
      if (this.opts.flowGlyphs) this.drawFlowGlyphs();
    }
    drawFlowGlyphs() {
      const ctx = this.ctx, tube = this.sim.tube, flow = this.sim.flow, fo = this.sim.dyn.fo;
      const stations = [Math.round(tube.N * 0.12), Math.round(tube.N * 0.5), Math.round(tube.N * 0.88)];
      const uRef = Math.abs(flow.meanVelocity(tube.Rref)) * 2.5 + 1e-12;
      const Lpx = Math.min(70, 0.9 * tube.Rref * this.view.scale * 3);
      ctx.strokeStyle = 'rgba(157,210,233,0.9)'; ctx.lineWidth = 1.2;
      for (const j of stations) {
        const R = tube.R[j], tx = tube.tx[j], ty = tube.ty[j], nx = tube.nx[j], ny = tube.ny[j];
        ctx.beginPath();
        let first = true;
        for (let k = -10; k <= 10; k++) {
          const n = k / 10 * R * 0.98;
          flow.axial(n, R, fo);
          const len = fo.u / uRef * Lpx / this.view.scale;
          const x = tube.sx[j] + nx * n + tx * len, y = tube.sy[j] + ny * n + ty * len;
          const p = this.w2s(x, y);
          if (first) { ctx.moveTo(p.x, p.y); first = false; } else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
        // baseline
        const a = this.w2s(tube.sx[j] + nx * R, tube.sy[j] + ny * R), b = this.w2s(tube.sx[j] - nx * R, tube.sy[j] - ny * R);
        ctx.save(); ctx.setLineDash([2, 3]); ctx.strokeStyle = 'rgba(157,210,233,0.45)'; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.restore();
      }
    }
    drawTubeHandles() {
      const ctx = this.ctx, pts = this.sim.tube.params.points;
      ctx.strokeStyle = COLORS.ctrl; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
      ctx.beginPath();
      pts.forEach((p, i) => { const s = this.w2s(p[0], p[1]); if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y); });
      ctx.stroke(); ctx.setLineDash([]);
      for (const p of pts) { const s = this.w2s(p[0], p[1]); ctx.fillStyle = COLORS.ctrl; ctx.beginPath(); ctx.arc(s.x, s.y, 6, 0, 2 * Math.PI); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.stroke(); }
    }
    drawSources(t) {
      const ctx = this.ctx;
      for (const s of this.sim.field.sources) this.drawSource(s, t, s === this.selected);
      if (this.opts.showInteractions && this.sim.field.sources.length > 1) this.drawInteractions(t);
    }
    drawSource(src, t, selected) {
      const ctx = this.ctx, sc = this.view.scale;
      const c = this.w2s(src.x, src.y);
      const ang = S.angleAt(src, t);
      ctx.save();
      ctx.translate(c.x, c.y); ctx.rotate(-ang);
      ctx.globalAlpha = src.enabled ? 1 : 0.35;
      const f = S.driveFactor(src, t);
      const flip = f < 0;
      const north = flip ? COLORS.south : COLORS.north, south = flip ? COLORS.north : COLORS.south;
      if (src.type === 'cuboid' || src.type === 'cylinder') {
        const L = (src.type === 'cuboid' ? src.Lx : src.L) * sc, W = (src.type === 'cuboid' ? src.Ly : 2 * src.R) * sc;
        ctx.fillStyle = south; ctx.fillRect(-L / 2, -W / 2, L / 2, W);
        ctx.fillStyle = north; ctx.fillRect(0, -W / 2, L / 2, W);
        ctx.strokeStyle = selected ? COLORS.accent : 'rgba(255,255,255,0.75)'; ctx.lineWidth = selected ? 2.5 : 1.2;
        if (src.type === 'cylinder') { ctx.beginPath(); ctx.ellipse(-L / 2, 0, Math.max(1, W * 0.08), W / 2, 0, 0, 2 * Math.PI); ctx.stroke(); ctx.beginPath(); ctx.ellipse(L / 2, 0, Math.max(1, W * 0.08), W / 2, 0, 0, 2 * Math.PI); ctx.stroke(); }
        ctx.strokeRect(-L / 2, -W / 2, L, W);
        if (L > 26 && W > 14) {
          ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.font = `600 ${Math.min(14, W * 0.5)}px IBM Plex Sans, system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          for (const [tx, lab] of [[L / 4, flip ? 'S' : 'N'], [-L / 4, flip ? 'N' : 'S']]) { ctx.save(); ctx.translate(tx, 0); ctx.rotate(ang); ctx.fillText(lab, 0, 0); ctx.restore(); }
        }
        this._arrow(ctx, -L * 0.3, 0, L * 0.3, 0, 'rgba(255,255,255,0.8)');
      } else if (src.type === 'coil') {
        const R = src.R * sc, L = Math.max(src.L * sc, Math.max(4, R * 0.12)), th = Math.max(4, R * 0.1);
        ctx.strokeStyle = selected ? COLORS.accent : 'rgba(255,255,255,0.35)'; ctx.lineWidth = selected ? 2 : 1;
        ctx.setLineDash([3, 4]); ctx.strokeRect(-L / 2, -R, L, 2 * R); ctx.setLineDash([]);
        for (const sgn of [-1, 1]) {
          ctx.fillStyle = COLORS.copper; ctx.fillRect(-L / 2, sgn * R - th / 2, L, th);
          ctx.strokeStyle = COLORS.copperDark; ctx.lineWidth = 1; ctx.strokeRect(-L / 2, sgn * R - th / 2, L, th);
          // current direction symbol: ⊙ (towards viewer) / ⊗ ; current flows +φ about the axis for I>0
          const toward = (sgn * (f >= 0 ? 1 : -1)) < 0;
          if (th >= 7) {
            ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(0, sgn * R, th * 0.3, 0, 2 * Math.PI); ctx.stroke();
            if (toward) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, sgn * R, th * 0.1, 0, 2 * Math.PI); ctx.fill(); }
            else { ctx.beginPath(); ctx.moveTo(-th * 0.2, sgn * R - th * 0.2); ctx.lineTo(th * 0.2, sgn * R + th * 0.2); ctx.moveTo(-th * 0.2, sgn * R + th * 0.2); ctx.lineTo(th * 0.2, sgn * R - th * 0.2); ctx.stroke(); }
          }
        }
        this._arrow(ctx, -R * 0.35, 0, R * 0.35, 0, 'rgba(255,255,255,0.6)');
      } else if (src.type === 'dipole') {
        const r = Math.max(5, src.rcore * sc);
        ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.beginPath(); ctx.arc(0, 0, r, 0, 2 * Math.PI); ctx.fill();
        ctx.strokeStyle = selected ? COLORS.accent : 'rgba(255,255,255,0.7)'; ctx.lineWidth = selected ? 2 : 1; ctx.stroke();
        this._arrow(ctx, -r, 0, r, 0, north);
      } else if (src.type === 'linear') {
        const r = 18;
        ctx.strokeStyle = selected ? COLORS.accent : 'rgba(255,255,255,0.5)'; ctx.lineWidth = selected ? 2 : 1; ctx.setLineDash([3, 3]);
        ctx.strokeRect(-r, -r, 2 * r, 2 * r); ctx.setLineDash([]);
        this._arrow(ctx, -r * 0.8, 0, r * 0.8, 0, COLORS.accent);
      }
      ctx.restore();
      // rotation handle
      if (selected && src.type !== 'linear') {
        const d = this.handleDist(src);
        const hx = c.x + d * Math.cos(ang), hy = c.y - d * Math.sin(ang);
        ctx.strokeStyle = COLORS.accent; ctx.lineWidth = 1; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(hx, hy); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = COLORS.accent; ctx.beginPath(); ctx.arc(hx, hy, 6, 0, 2 * Math.PI); ctx.fill();
      }
      // label
      ctx.fillStyle = selected ? COLORS.accent : COLORS.muted; ctx.font = '11px IBM Plex Sans, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      const ext = S.size(src) * sc * 0.55 + 6;
      ctx.fillText(src.label + (src.locked ? ' 🔒' : ''), c.x, c.y + ext);
    }
    handleDist(src) { return Math.max(28, S.size(src) * this.view.scale * 0.7); }
    _arrow(ctx, x0, y0, x1, y1, color) {
      ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      const dx = x1 - x0, dy = y1 - y0, n = Math.hypot(dx, dy) || 1, ux = dx / n, uy = dy / n, h = Math.min(8, n * 0.4);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 - h * ux + 0.5 * h * uy, y1 - h * uy - 0.5 * h * ux); ctx.lineTo(x1 - h * ux - 0.5 * h * uy, y1 - h * uy + 0.5 * h * ux); ctx.closePath(); ctx.fill();
    }
    drawInteractions(t) {
      const ctx = this.ctx, list = this.sim.field.interactions(t);
      let Fmax = 0; for (const it of list) Fmax = Math.max(Fmax, Math.hypot(it.fx, it.fy));
      if (Fmax <= 0) return;
      for (const it of list) {
        const c = this.w2s(it.src.x, it.src.y);
        const F = Math.hypot(it.fx, it.fy), len = 40 * F / Fmax;
        if (len < 2) continue;
        this._arrow(ctx, c.x, c.y, c.x + len * it.fx / F, c.y - len * it.fy / F, 'rgba(242,179,61,0.9)');
        if (it.src === this.selected) {
          ctx.fillStyle = COLORS.accent; ctx.font = '11px IBM Plex Sans, system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
          ctx.fillText('F ' + fmtSI(F, 'N') + (Math.abs(it.tz) > 0 ? ', τ ' + fmtSI(it.tz, 'N·m') : '') + ' (from other sources)', c.x + len * it.fx / F + 6, c.y - len * it.fy / F - 2);
        }
      }
    }
    particleColor(i) {
      const sw = this.sim.swarm;
      if (this.opts.colorMode === 'speed') {
        const u = Math.abs(this.sim.flow.meanVelocity(this.sim.tube.Rref)) * 2 + 1e-12;
        const v = Math.min(1, Math.hypot(sw.vx[i], sw.vy[i]) / u);
        return `hsl(${200 - 160 * v}, 85%, ${55 + 20 * v}%)`;
      }
      if (this.opts.colorMode === 'moment') {
        const m = Math.hypot(sw.mx[i], sw.my[i]), mref = this.sim.diag.meanMoment || 1e-30;
        const v = Math.min(1, m / (2 * mref));
        return `hsl(${280 - 200 * v}, 80%, 60%)`;
      }
      if (sw.st[i]) return COLORS.retained;
      if (sw.contact[i]) return COLORS.contact;
      return COLORS.flowing;
    }
    drawParticles() {
      const ctx = this.ctx, sw = this.sim.swarm, sc = this.view.scale, boost = this.opts.particleBoost;
      const p = {};
      for (let i = 0; i < sw.n; i++) {
        this.w2s(sw.x[i], sw.y[i], p);
        if (p.x < -10 || p.y < -10 || p.x > this.w + 10 || p.y > this.h + 10) continue;
        const r = Math.max(2.0, sw.a[i] * sc * boost);
        ctx.fillStyle = this.particleColor(i);
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 2 * Math.PI); ctx.fill();
        if (r > 5) {
          ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1; ctx.stroke();
          if (this.opts.showMoments) {
            const m = Math.hypot(sw.mx[i], sw.my[i]);
            if (m > 0) { const ux = sw.mx[i] / m, uy = sw.my[i] / m; this._arrow(ctx, p.x - 0.7 * r * ux, p.y + 0.7 * r * uy, p.x + 0.7 * r * ux, p.y - 0.7 * r * uy, 'rgba(0,0,0,0.75)'); }
          }
        }
        if (this.opts.showForces) {
          const fx = sw.jxx[i] * sw.mx[i] + sw.jxy[i] * sw.my[i], fy = sw.jxy[i] * sw.mx[i] + sw.jyy[i] * sw.my[i];
          const F = Math.hypot(fx, fy), Fref = this.sim.diag.Fmax || 1e-30;
          const len = 18 * Math.min(1, F / Fref);
          if (len > 2) this._arrow(ctx, p.x, p.y, p.x + len * fx / F, p.y - len * fy / F, 'rgba(242,179,61,0.8)');
        }
      }
    }
    drawOverlay(t) {
      const ctx = this.ctx;
      // colour bar
      if (this.opts.heatmap) {
        const x = 14, y = this.h - 26, w = 150, h = 10;
        for (let i = 0; i < w; i++) { const ci = Math.round(i / (w - 1) * 255) * 3; ctx.fillStyle = `rgb(${LUT[ci]},${LUT[ci + 1]},${LUT[ci + 2]})`; ctx.fillRect(x + i, y, 1, h); }
        ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.strokeRect(x, y, w, h);
        ctx.fillStyle = COLORS.text; ctx.font = '11px IBM Plex Sans, system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
        ctx.fillText(fmtSI(this.opts.bmin, 'T'), x, y - 2);
        ctx.textAlign = 'right'; ctx.fillText(fmtSI(this.opts.bmax, 'T'), x + w, y - 2);
        ctx.textAlign = 'center'; ctx.fillText('|B| (log)', x + w / 2, y - 2);
      }
      // scale bar
      const target = 80 / this.view.scale;   // metres for ~80 px
      const pow = Math.pow(10, Math.floor(Math.log10(target)));
      const nice = [1, 2, 5, 10].map(k => k * pow).reduce((a, b) => Math.abs(b - target) < Math.abs(a - target) ? b : a);
      const px = nice * this.view.scale, x1 = this.w - 20, y1 = this.h - 20;
      ctx.strokeStyle = COLORS.text; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x1 - px, y1); ctx.lineTo(x1, y1); ctx.stroke();
      ctx.fillStyle = COLORS.text; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.font = '11px IBM Plex Sans, system-ui, sans-serif';
      ctx.fillText(fmtSI(nice, 'm'), x1, y1 - 4);
      // probe
      if (this.probe) {
        const pr = this.probe, s = this.w2s(pr.x, pr.y);
        ctx.strokeStyle = COLORS.accent; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(s.x, s.y, 5, 0, 2 * Math.PI); ctx.stroke();
        const lines = [`B = ${fmtSI(pr.B, 'T')}  (${fmtSI(pr.bx, 'T')}, ${fmtSI(pr.by, 'T')})`, `|∇|B|| = ${fmtSI(pr.G, 'T/m')}`, `F on reference particle = ${fmtSI(pr.F, 'N')}`];
        if (pr.u !== undefined) lines.push(`fluid u = ${fmtSI(pr.u, 'm/s')}  r/R = ${pr.xi.toFixed(2)}`);
        ctx.font = '11px IBM Plex Sans, system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        const bw = 250, bh = 14 * lines.length + 8; let bx = s.x + 12, by = s.y + 12;
        if (bx + bw > this.w) bx = s.x - bw - 12; if (by + bh > this.h) by = s.y - bh - 12;
        ctx.fillStyle = 'rgba(14,20,27,0.85)'; ctx.fillRect(bx, by, bw, bh); ctx.strokeStyle = 'rgba(242,179,61,0.6)'; ctx.strokeRect(bx, by, bw, bh);
        ctx.fillStyle = COLORS.text; lines.forEach((l, i) => ctx.fillText(l, bx + 6, by + 4 + 14 * i));
      }
      // legend of particle colours
      if (this.opts.colorMode === 'state') {
        const items = [[COLORS.flowing, 'flowing'], [COLORS.contact, 'at wall'], [COLORS.retained, 'retained']];
        let x = 14, y = 14;
        ctx.font = '11px IBM Plex Sans, system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        for (const [c, l] of items) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x + 5, y, 4, 0, 2 * Math.PI); ctx.fill(); ctx.fillStyle = COLORS.text; ctx.fillText(l, x + 14, y); x += 14 + ctx.measureText(l).width + 16; }
      }
    }

    /* ------------------------------------------------------------ hit testing */
    hitSource(sx, sy, t) {
      const list = this.sim.field.sources;
      // handles first (selected source only)
      if (this.selected && this.selected.type !== 'linear') {
        const s = this.selected, c = this.w2s(s.x, s.y), ang = S.angleAt(s, t), d = this.handleDist(s);
        const hx = c.x + d * Math.cos(ang), hy = c.y - d * Math.sin(ang);
        if (Math.hypot(sx - hx, sy - hy) < 10) return { src: s, part: 'rotate' };
      }
      for (let i = list.length - 1; i >= 0; i--) {
        const s = list[i], w = this.s2w(sx, sy);
        if (S.contains(s, w.x, w.y, t)) return { src: s, part: 'body' };
        const c = this.w2s(s.x, s.y);
        const r = Math.max(10, S.size(s) * this.view.scale * (s.type === 'coil' ? 0.08 : 0.5));
        if (Math.hypot(sx - c.x, sy - c.y) < r) return { src: s, part: 'body' };
      }
      return null;
    }
    hitTubePoint(sx, sy) {
      const pts = this.sim.tube.params.points;
      for (let i = 0; i < pts.length; i++) { const s = this.w2s(pts[i][0], pts[i][1]); if (Math.hypot(sx - s.x, sy - s.y) < 9) return i; }
      return -1;
    }
  }
  MS.Renderer = Renderer;
  MS.COLORS = COLORS;
})(typeof window !== 'undefined' ? window : globalThis);
