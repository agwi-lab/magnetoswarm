/* MagnetoSwarm — application entry point. */
(function (global) {
  'use strict';
  const MS = global.MS;
  const S = MS.sources;

  class App {
    constructor() {
      this.sim = new MS.Simulation();
      this.canvas = document.getElementById('view');
      this.renderer = new MS.Renderer(this.canvas, this.sim);
      this.tubeShape = 'straight'; this.tubeMat = 'silicone';
      this.controls = new MS.Controls(this.sim, this.renderer, this);
      this.bindTransport();
      this.loadPreset(MS.PRESETS[0].key);
      this.lastFrame = performance.now(); this.lastDiag = 0; this.fps = 0;
      window.addEventListener('resize', () => this.renderer.resize());
      requestAnimationFrame((t) => this.frame(t));
    }

    /* ---------------------------------------------------------- transport */
    bindTransport() {
      const $ = (id) => document.getElementById(id);
      this.btnPlay = $('btn-play');
      this.btnPlay.addEventListener('click', () => this.toggle());
      $('btn-step').addEventListener('click', () => this.stepOnce());
      $('btn-reset').addEventListener('click', () => this.reset());
      $('btn-fit').addEventListener('click', () => this.renderer.fitToScene());
      $('btn-theory').addEventListener('click', () => this.showTheory(true));
      $('theory-close').addEventListener('click', () => this.showTheory(false));
      $('btn-panel').addEventListener('click', () => document.body.classList.toggle('panel-collapsed'));
      const ts = $('timescale'), tsv = $('timescale-val');
      const toVal = (p) => 0.01 * Math.pow(1000, p / 1000);
      const toPos = (v) => 1000 * Math.log(v / 0.01) / Math.log(1000);
      ts.addEventListener('input', () => { this.sim.timeScale = toVal(Number(ts.value)); tsv.textContent = this.sim.timeScale.toPrecision(2) + '×'; });
      this.syncTimeScale = () => { ts.value = toPos(this.sim.timeScale); tsv.textContent = this.sim.timeScale.toPrecision(2) + '×'; };
      this.timeLabel = $('time-label');
      this.theoryShown = false;
    }
    toggle() { this.sim.running = !this.sim.running; this.btnPlay.textContent = this.sim.running ? 'Pause' : 'Run'; this.btnPlay.classList.toggle('primary', !this.sim.running); }
    stepOnce() { this.sim.running = false; this.btnPlay.textContent = 'Run'; this.sim.advance(this.sim.dtMax()); this.controls.updateDiagnostics(); }
    reset() { this.sim.reset(); this.renderer.invalidate(); this.controls.updateDiagnostics(); }
    showTheory(on) { const m = document.getElementById('theory'); m.classList.toggle('open', on); if (on && window.renderMathInElement && !m._rendered) { try { window.renderMathInElement(m, { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '\\(', right: '\\)', display: false }] }); m._rendered = true; } catch (e) { /* KaTeX unavailable: raw TeX stays visible */ } } }

    /* ---------------------------------------------------------- main loop */
    frame(now) {
      const dtReal = Math.min(0.05, (now - this.lastFrame) / 1000); this.lastFrame = now;
      this.fps = 0.9 * this.fps + 0.1 / Math.max(dtReal, 1e-3);
      if (this.sim.running) this.sim.advance(this.sim.timeScale * dtReal);
      this.renderer.draw(this.sim.time);
      if (now - this.lastDiag > 250) { this.lastDiag = now; this.controls.updateDiagnostics(); this.timeLabel.textContent = 't = ' + this.sim.time.toFixed(3) + ' s · ' + Math.round(this.fps) + ' fps'; }
      requestAnimationFrame((t) => this.frame(t));
    }

    /* ---------------------------------------------------------- scenarios */
    loadPreset(key) {
      const p = MS.presetByKey(key); if (!p) return;
      this.sim.running = false; this.btnPlay.textContent = 'Run';
      this.sim.load(JSON.parse(JSON.stringify(p.cfg)));
      this.tubeShape = this.guessShape(p.cfg.tube.points);
      this.tubeMat = this.guessTubeMat(p.cfg.tube);
      this.renderer.selected = null; this.renderer.editTube = false;
      this.renderer.opts.bmax = this.autoBmax();
      this.renderer.opts.bmin = this.renderer.opts.bmax * 1e-3;
      this.controls.presetSelect.value = key; this.controls.presetDesc.textContent = p.description;
      this.controls.refreshAll(); this.syncTimeScale();
      this.renderer.fitToScene(p.cfg.view === 'tube' ? 0.35 : 0.12, p.cfg.view === 'tube');
      this.renderer.heat.key = '';
      this.controls.updateDiagnostics();
    }
    autoBmax() {
      // 95th percentile of |B| over the tube bounding box → nice upper limit
      const t = this.sim.tube, b = t.bounds(0), f = this.sim.field;
      const vals = []; const o = { x: 0, y: 0 };
      for (let i = 0; i <= 24; i++) for (let j = 0; j <= 12; j++) { f.evalB(b.x0 + (b.x1 - b.x0) * i / 24, b.y0 + (b.y1 - b.y0) * j / 12, 0, o); vals.push(Math.hypot(o.x, o.y)); }
      vals.sort((a, c) => a - c);
      const v = vals[Math.floor(vals.length * 0.97)] || 0.1;
      const pow = Math.pow(10, Math.ceil(Math.log10(Math.max(3 * v, 1e-6))));
      return Math.min(5, Math.max(1e-3, pow));
    }
    guessShape(pts) { if (pts.length === 2) return 'straight'; if (pts.length === 5 && Math.abs(pts[1][1] + pts[3][1]) < 1e-9 && pts[1][1] !== 0) return 'sbend'; if (pts.length === 5) return 'arc'; return 'custom'; }
    guessTubeMat(tp) { for (const [k, m] of Object.entries(MS.TUBE_MATERIALS)) if (Math.abs(m.G - tp.G) < 1e-6 && Math.abs(m.Jm - tp.Jm) < 1e-6) return tp.elastic === false && k !== 'rigid' ? k : k; return 'silicone'; }
    setTubeShape(shape) {
      this.tubeShape = shape;
      const L = this.sim.tube.L;
      let pts;
      if (shape === 'straight') pts = [[-L / 2, 0], [L / 2, 0]];
      else if (shape === 'arc') { const sag = 0.08 * L; pts = [[-L / 2, 0], [-L / 4, sag * 0.75], [0, sag], [L / 4, sag * 0.75], [L / 2, 0]]; }
      else if (shape === 'sbend') { const a = 0.08 * L; pts = [[-L / 2, 0], [-L / 4, a], [0, 0], [L / 4, -a], [L / 2, 0]]; }
      else if (shape === 'sinuous') { pts = []; for (let k = 0; k <= 8; k++) pts.push([-L / 2 + L * k / 8, 0.05 * L * Math.sin(k * Math.PI / 2)]); }
      else { this.renderer.editTube = true; this.controls.refreshAll(); return; }
      this.controls.afterTube({ points: pts }); this.controls.refreshAll(); this.renderer.fitToScene();
    }
    setTubeLength(Lnew) {
      const t = this.sim.tube, f = Lnew / t.L;
      const pts = t.params.points.map(p => [p[0] * f, p[1] * f]);
      this.controls.afterTube({ points: pts, stenosisWidth: t.params.stenosisWidth }); this.controls.refreshAll(); this.renderer.fitToScene();
    }
    /* push every particle back inside the lumen after a geometry change */
    reproject() {
      const sw = this.sim.swarm, t = this.sim.tube, loc = { idx: 0, s: 0, n: 0 };
      for (let i = sw.n - 1; i >= 0; i--) {
        t.locate(sw.x[i], sw.y[i], -1, loc);
        if (loc.s < 0 || loc.s > t.L) { sw.remove(i); continue; }
        const lim = Math.max(0, t.R[loc.idx] - sw.a[i]);
        if (Math.abs(loc.n) > lim) { const n = Math.sign(loc.n) * lim; sw.x[i] = t.sx[loc.idx] + t.tx[loc.idx] * (loc.s - t.s[loc.idx]) + t.nx[loc.idx] * n; sw.y[i] = t.sy[loc.idx] + t.ty[loc.idx] * (loc.s - t.s[loc.idx]) + t.ny[loc.idx] * n; }
        sw.station[i] = loc.idx;
      }
    }
    /* add a source near the tube, scaled to the scene */
    addSource(type, extra) {
      const t = this.sim.tube, size = Math.max(4 * t.Rref, 0.002);
      const b = t.bounds(0);
      const src = S.create(type, Object.assign({ x: 0.5 * (b.x0 + b.x1), y: b.y0 - 1.2 * size, angle: Math.PI / 2 }, extra || {}));
      if (type === 'cuboid') { src.Lx = src.Ly = src.Lz = size; }
      if (type === 'cylinder') { src.R = size / 2; src.L = size; }
      if (type === 'coil') { src.R = 3 * size; src.L = 0; src.y = 0.5 * (b.y0 + b.y1); src.x = 0.5 * (b.x0 + b.x1) - 1.5 * size; src.angle = 0; }
      if (type === 'dipole') { src.rcore = size / 4; src.m = (1.2 / MS.CONST.MU0) * size * size * size; }
      if (type === 'linear') { src.x = 0.5 * (b.x0 + b.x1); src.y = b.y1 + 1.5 * size; src.angle = 0; }
      this.sim.field.add(src); this.renderer.selected = src; this.controls.rebuildSources(); this.renderer.fitToScene();
    }
    addPair(kind) {
      const t = this.sim.tube, b = t.bounds(0), cx = 0.5 * (b.x0 + b.x1), cy = 0.5 * (b.y0 + b.y1);
      const R = Math.max(2 * t.L / 3, 6 * t.Rref), N = 200, I = 5;
      const f = this.sim.field;
      if (kind === 'helmholtz' || kind === 'maxwell') {
        f.add(S.create('coil', { x: cx - R / 2, y: cy, angle: 0, R, L: 0, N, I, label: kind + ' A' }));
        f.add(S.create('coil', { x: cx + R / 2, y: cy, angle: 0, R, L: 0, N, I: kind === 'maxwell' ? -I : I, label: kind + ' B' }));
      } else if (kind === 'rotating') {
        const d = { mode: 'ac', amp: 1, freq: 5, phase: 0 };
        f.add(S.create('coil', { x: cx - R / 2, y: cy, angle: 0, R, L: 0, N, I, drive: Object.assign({}, d), label: 'X coil A' }));
        f.add(S.create('coil', { x: cx + R / 2, y: cy, angle: 0, R, L: 0, N, I, drive: Object.assign({}, d), label: 'X coil B' }));
        f.add(S.create('coil', { x: cx, y: cy - R / 2, angle: Math.PI / 2, R, L: 0, N, I, drive: Object.assign({}, d, { phase: Math.PI / 2 }), label: 'Y coil A' }));
        f.add(S.create('coil', { x: cx, y: cy + R / 2, angle: Math.PI / 2, R, L: 0, N, I, drive: Object.assign({}, d, { phase: Math.PI / 2 }), label: 'Y coil B' }));
      }
      this.controls.rebuildSources(); this.renderer.fitToScene();
    }
    saveJSON() {
      const blob = new Blob([JSON.stringify(this.sim.serialize(), null, 2)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'magnetoswarm-scenario.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
    loadJSONFile() {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json';
      inp.addEventListener('change', () => {
        const f = inp.files[0]; if (!f) return;
        f.text().then(txt => { try { const cfg = JSON.parse(txt); this.sim.running = false; this.sim.load(cfg); this.tubeShape = 'custom'; this.renderer.selected = null; this.controls.presetDesc.textContent = 'Loaded ' + f.name; this.controls.refreshAll(); this.syncTimeScale(); this.renderer.fitToScene(); this.renderer.heat.key = ''; } catch (e) { alert('Could not read scenario: ' + e.message); } });
      });
      inp.click();
    }
  }

  window.addEventListener('DOMContentLoaded', () => { window.app = new App(); });
})(typeof window !== 'undefined' ? window : globalThis);
