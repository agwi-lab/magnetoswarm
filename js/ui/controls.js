/* MagnetoSwarm — control panel and canvas interaction. */
(function (global) {
  'use strict';
  const MS = global.MS = global.MS || {};
  const S = MS.sources, fmtSI = MS.util.fmtSI, fmt = MS.util.fmt;
  const d2r = Math.PI / 180, r2d = 180 / Math.PI;

  function el(tag, attrs, children) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'text') e.textContent = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
      else if (k === 'style') e.setAttribute('style', attrs[k]);
      else e.setAttribute(k, attrs[k]);
    }
    if (children) for (const c of children) if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    return e;
  }

  /* schema-driven control row */
  function ctl(spec) {
    const scale = spec.scale || 1;
    const lbl = el('span', { class: 'lbl', text: spec.label, title: spec.title || '' });
    const unit = el('span', { class: 'unit', text: spec.unit || '' });
    let input, num, refresh;
    const fire = (v) => { spec.set(v); if (spec.after) spec.after(v); };
    if (spec.type === 'range') {
      const lo = spec.min, hi = spec.max, log = !!spec.log;
      const toPos = (v) => log ? 1000 * Math.log(v / lo) / Math.log(hi / lo) : 1000 * (v - lo) / (hi - lo);
      const toVal = (p) => log ? lo * Math.pow(hi / lo, p / 1000) : lo + (hi - lo) * p / 1000;
      input = el('input', { type: 'range', min: 0, max: 1000, step: 1 });
      num = el('input', { type: 'number', step: spec.step || 'any' });
      input.addEventListener('input', () => { const v = toVal(Number(input.value)); num.value = fmt(v * scale, 4); fire(v); });
      num.addEventListener('change', () => { let v = Number(num.value) / scale; if (!isFinite(v)) return; if (spec.clampNum !== false) v = Math.min(hi, Math.max(lo, v)); input.value = toPos(v); num.value = fmt(v * scale, 4); fire(v); });
      refresh = () => { const v = spec.get(); input.value = toPos(Math.min(hi, Math.max(lo, v))); num.value = fmt(v * scale, 4); };
    } else if (spec.type === 'number') {
      input = el('input', { type: 'number', step: spec.step || 'any', class: 'num-only' });
      input.addEventListener('change', () => { const v = Number(input.value) / scale; if (isFinite(v)) fire(v); });
      refresh = () => { input.value = fmt(spec.get() * scale, 5); };
    } else if (spec.type === 'select') {
      input = el('select');
      for (const [v, t] of spec.options) input.appendChild(el('option', { value: v, text: t }));
      input.addEventListener('change', () => fire(input.value));
      refresh = () => { input.value = String(spec.get()); };
    } else if (spec.type === 'check') {
      input = el('input', { type: 'checkbox' });
      input.addEventListener('change', () => fire(input.checked));
      refresh = () => { input.checked = !!spec.get(); };
    } else if (spec.type === 'text') {
      input = el('input', { type: 'text' });
      input.addEventListener('change', () => fire(input.value));
      refresh = () => { input.value = spec.get(); };
    }
    const row = el('div', { class: 'ctl ' + spec.type }, [lbl, input, num, unit]);
    refresh();
    return { root: row, refresh };
  }

  function section(title, open) {
    const body = el('div', { class: 'sec-body' });
    const d = el('details', { class: 'sec' }, [el('summary', { text: title }), body]);
    if (open) d.open = true;
    return { root: d, body };
  }

  class Controls {
    constructor(sim, renderer, app) {
      this.sim = sim; this.renderer = renderer; this.app = app;
      this.refreshers = [];
      this.panel = document.getElementById('panel');
      this.build();
      this.bindCanvas();
    }
    add(parent, spec) { const c = ctl(spec); parent.appendChild(c.root); this.refreshers.push(c.refresh); return c; }
    refreshAll() { for (const r of this.refreshers) r(); this.rebuildSources(); }
    afterTube(patch) { this.sim.tube.setParams(patch); this.sim.rebuildFlow(); this.sim.pArr = new Float64Array(this.sim.tube.N); this.sim.computePressure(); this.sim.tube.updateElastic(this.sim.pArr, 0); this.app.reproject(); this.renderer.invalidate(); }

    /* ------------------------------------------------------------ panel */
    build() {
      const sim = this.sim, R = this.renderer, app = this.app, P = sim.P;
      const panel = this.panel; panel.innerHTML = '';

      /* scenario */
      {
        const sec = section('Scenario', true);
        const sel = el('select', { class: 'preset' });
        for (const p of MS.PRESETS) sel.appendChild(el('option', { value: p.key, text: p.name }));
        sel.addEventListener('change', () => app.loadPreset(sel.value));
        this.presetSelect = sel;
        this.presetDesc = el('p', { class: 'desc' });
        const btns = el('div', { class: 'btnrow' }, [
          el('button', { text: 'Reload scenario', onclick: () => app.loadPreset(sel.value) }),
          el('button', { text: 'Save JSON', onclick: () => app.saveJSON() }),
          el('button', { text: 'Load JSON', onclick: () => app.loadJSONFile() }),
        ]);
        sec.body.append(sel, this.presetDesc, btns);
        panel.appendChild(sec.root);
      }

      /* sources */
      {
        const sec = section('Field sources', true);
        this.sourceList = el('div', { class: 'srclist' });
        const mk = (type, extra) => () => app.addSource(type, extra);
        const addrow = el('div', { class: 'btnrow wrap' }, [
          el('button', { text: '+ Block magnet', onclick: mk('cuboid') }),
          el('button', { text: '+ Cylinder magnet', onclick: mk('cylinder') }),
          el('button', { text: '+ Coil', onclick: mk('coil') }),
          el('button', { text: '+ Dipole', onclick: mk('dipole') }),
          el('button', { text: '+ Ideal field', onclick: mk('linear') }),
          el('button', { text: '+ Helmholtz pair', onclick: () => app.addPair('helmholtz') }),
          el('button', { text: '+ Maxwell pair', onclick: () => app.addPair('maxwell') }),
          el('button', { text: '+ Rotating field', onclick: () => app.addPair('rotating') }),
        ]);
        sec.body.append(el('p', { class: 'hint', text: 'Drag a source on the canvas to move it, drag the amber handle to rotate it. Fields of all sources superpose exactly.' }), this.sourceList, addrow);
        panel.appendChild(sec.root);
      }

      /* tube */
      {
        const sec = section('Elastic tube', false);
        const tp = () => sim.tube.params;
        this.add(sec.body, { label: 'Shape', type: 'select', options: [['straight', 'Straight'], ['arc', 'Arc'], ['sbend', 'S-bend'], ['sinuous', 'Sinuous'], ['custom', 'Custom (drag points)']], get: () => app.tubeShape, set: v => app.setTubeShape(v) });
        this.add(sec.body, { label: 'Length', type: 'range', min: 1e-4, max: 1, log: true, scale: 1e3, unit: 'mm', get: () => sim.tube.L, set: v => app.setTubeLength(v) });
        this.add(sec.body, { label: 'Inlet radius', type: 'range', min: 1e-6, max: 0.05, log: true, scale: 1e3, unit: 'mm', get: () => tp().Rin, set: v => this.afterTube({ Rin: v }) });
        this.add(sec.body, { label: 'Outlet radius', type: 'range', min: 1e-6, max: 0.05, log: true, scale: 1e3, unit: 'mm', get: () => tp().Rout, set: v => this.afterTube({ Rout: v }) });
        this.add(sec.body, { label: 'Wall thickness', type: 'range', min: 1e-7, max: 0.01, log: true, scale: 1e3, unit: 'mm', get: () => tp().h0, set: v => this.afterTube({ h0: v }) });
        this.add(sec.body, { label: 'Edit control points', type: 'check', get: () => R.editTube, set: v => { R.editTube = v; if (v) app.tubeShape = 'custom'; this.refreshAll(); } });
        this.add(sec.body, { label: 'Stenosis severity', type: 'range', min: 0, max: 0.9, unit: '', get: () => tp().stenosisSeverity, set: v => this.afterTube({ stenosisSeverity: v }) });
        this.add(sec.body, { label: 'Stenosis position', type: 'range', min: 0, max: 1, unit: 'L', get: () => tp().stenosisPos, set: v => this.afterTube({ stenosisPos: v }) });
        this.add(sec.body, { label: 'Stenosis width', type: 'range', min: 1e-6, max: 0.05, log: true, scale: 1e3, unit: 'mm', get: () => tp().stenosisWidth, set: v => this.afterTube({ stenosisWidth: v }) });
        this.add(sec.body, { label: 'Corrugation amplitude', type: 'range', min: 0, max: 0.2, unit: 'R', get: () => tp().corrugAmp, set: v => this.afterTube({ corrugAmp: v }) });
        this.add(sec.body, { label: 'Corrugation periods', type: 'range', min: 1, max: 40, step: 1, unit: '', get: () => tp().corrugPeriods, set: v => this.afterTube({ corrugPeriods: Math.round(v) }) });
        sec.body.appendChild(el('h4', { text: 'Wall mechanics (Gent / neo-Hookean membrane)' }));
        this.add(sec.body, { label: 'Wall material', type: 'select', options: Object.entries(MS.TUBE_MATERIALS).map(([k, m]) => [k, m.name]), get: () => app.tubeMat, set: v => { app.tubeMat = v; const m = MS.TUBE_MATERIALS[v]; this.afterTube({ G: m.G, Jm: m.Jm, elastic: v !== 'rigid' }); this.refreshAll(); } });
        this.add(sec.body, { label: 'Elastic wall', type: 'check', get: () => tp().elastic, set: v => this.afterTube({ elastic: v }) });
        this.add(sec.body, { label: 'Shear modulus G', type: 'range', min: 1e3, max: 1e9, log: true, scale: 1e-3, unit: 'kPa', get: () => tp().G, set: v => this.afterTube({ G: v }) });
        this.add(sec.body, { label: 'Gent limit J_m', type: 'range', min: 1, max: 1000, log: true, unit: '', get: () => tp().Jm, set: v => this.afterTube({ Jm: v }) });
        this.add(sec.body, { label: 'Transmural pressure', type: 'range', min: -20e3, max: 100e3, scale: 1e-3, unit: 'kPa', get: () => sim.elastic.pOut, set: v => { sim.elastic.pOut = v; } });
        this.add(sec.body, { label: 'Pulse pressure amplitude', type: 'range', min: 0, max: 50e3, scale: 1e-3, unit: 'kPa', get: () => sim.elastic.pAmp, set: v => { sim.elastic.pAmp = v; } });
        this.add(sec.body, { label: 'Pressure lag', type: 'range', min: 0, max: 0.5, scale: 1e3, unit: 'ms', get: () => sim.elastic.lag, set: v => { sim.elastic.lag = v; } });
        panel.appendChild(sec.root);
      }

      /* fluid & flow */
      {
        const sec = section('Fluid and flow', false);
        const fp = () => sim.flow.params;
        this.add(sec.body, { label: 'Fluid', type: 'select', options: Object.entries(MS.FLUIDS).map(([k, f]) => [k, f.name]), get: () => sim.fluidKey, set: v => { sim.setFluid(v); this.refreshAll(); } });
        this.add(sec.body, { label: 'Density ρ', type: 'range', min: 500, max: 14000, log: true, unit: 'kg/m³', get: () => fp().rho, set: v => sim.flow.setParams({ rho: v }) });
        this.add(sec.body, { label: 'Viscosity μ', type: 'range', min: 1e-4, max: 10, log: true, scale: 1e3, unit: 'mPa·s', get: () => fp().mu, set: v => sim.flow.setParams({ mu: v }) });
        this.add(sec.body, { label: 'Susceptibility χ_f', type: 'number', scale: 1e6, unit: '×10⁻⁶', get: () => fp().chi, set: v => sim.flow.setParams({ chi: v }) });
        this.add(sec.body, { label: 'Conductivity σ_f', type: 'number', unit: 'S/m', get: () => fp().sigma, set: v => sim.flow.setParams({ sigma: v }) });
        this.add(sec.body, { label: 'Temperature', type: 'range', min: 273, max: 330, unit: 'K', get: () => fp().T, set: v => sim.flow.setParams({ T: v }) });
        sec.body.appendChild(el('h4', { text: 'Prescribed flow Q(t) = Q̄·w(t), Womersley profiles' }));
        this.add(sec.body, { label: 'Mean velocity', type: 'range', min: -1, max: 1, scale: 1e3, unit: 'mm/s', step: 'any', get: () => sim.flow.meanVelocity(sim.tube.Rref), set: v => sim.flow.setParams({ Qmean: Math.PI * sim.tube.Rref * sim.tube.Rref * v }) });
        this.add(sec.body, { label: 'Waveform', type: 'select', options: [['steady', 'Steady'], ['sine', 'Sinusoidal'], ['pulse', 'Arterial pulse']], get: () => fp().waveform, set: v => sim.flow.setParams({ waveform: v }) });
        this.add(sec.body, { label: 'Frequency', type: 'range', min: 0.1, max: 20, log: true, unit: 'Hz', get: () => fp().freq, set: v => sim.flow.setParams({ freq: v }) });
        this.add(sec.body, { label: 'Pulsatility β', type: 'range', min: 0, max: 3, unit: '', get: () => fp().beta, set: v => sim.flow.setParams({ beta: v }) });
        panel.appendChild(sec.root);
      }

      /* particles */
      {
        const sec = section('Metallic objects (swarm)', true);
        this.add(sec.body, { label: 'Material', type: 'select', options: Object.entries(MS.MATERIALS).map(([k, m]) => [k, m.name]), get: () => P.materialKey, set: v => { sim.setMaterial(v); this.refreshAll(); } });
        this.add(sec.body, { label: 'Radius', type: 'range', min: 1e-8, max: 3e-3, log: true, scale: 1e6, unit: 'µm', get: () => P.radius, set: v => { P.radius = v; } });
        this.add(sec.body, { label: 'Polydispersity (CV)', type: 'range', min: 0, max: 0.5, unit: '', get: () => P.polydispersity, set: v => { P.polydispersity = v; } });
        this.add(sec.body, { label: 'Density ρ_p', type: 'range', min: 500, max: 22000, log: true, unit: 'kg/m³', get: () => P.material.rho, set: v => { P.material.rho = v; } });
        this.add(sec.body, { label: 'Susceptibility χ_p', type: 'number', unit: '', get: () => P.material.chi, set: v => { P.material.chi = v; } });
        this.add(sec.body, { label: 'Saturation M_s', type: 'number', scale: 1e-3, unit: 'kA/m', get: () => P.material.Ms, set: v => { P.material.Ms = v; } });
        this.add(sec.body, { label: 'Remanence M_r (hard)', type: 'number', scale: 1e-3, unit: 'kA/m', get: () => P.material.Mr, set: v => { P.material.Mr = v; } });
        this.add(sec.body, { label: 'Conductivity σ_p', type: 'number', unit: 'S/m', get: () => P.material.sigma, set: v => { P.material.sigma = v; } });
        this.add(sec.body, { label: 'Magnetization law', type: 'select', options: [['auto', 'From material'], ['linear', 'Linear para/dia'], ['ferro', 'Soft ferro (sat.)'], ['spm', 'Superparamagnetic'], ['hard', 'Hard (permanent)']], get: () => P.magModel, set: v => { P.magModel = v; } });
        this.add(sec.body, { label: 'SPM core diameter', type: 'range', min: 2e-9, max: 50e-9, log: true, scale: 1e9, unit: 'nm', get: () => P.dcore, set: v => { P.dcore = v; } });
        sec.body.appendChild(el('h4', { text: 'Injection' }));
        this.add(sec.body, { label: 'Mode', type: 'select', options: [['continuous', 'Continuous infusion'], ['bolus', 'Bolus at t = 0']], get: () => sim.inj.mode, set: v => { sim.inj.mode = v; app.reset(); } });
        this.add(sec.body, { label: 'Particle count', type: 'range', min: 1, max: 3000, log: true, step: 1, unit: '', get: () => sim.inj.count, set: v => { sim.inj.count = Math.round(v); } });
        this.add(sec.body, { label: 'Infusion rate', type: 'range', min: 1, max: 5000, log: true, unit: '/s', get: () => sim.inj.rate, set: v => { sim.inj.rate = v; } });
        this.add(sec.body, { label: 'Recycle exited (bolus)', type: 'check', get: () => sim.inj.recycle, set: v => { sim.inj.recycle = v; } });
        this.add(sec.body, { label: 'Random seed', type: 'number', step: 1, unit: '', get: () => sim.inj.seed, set: v => { sim.inj.seed = Math.round(v); } });
        sec.body.appendChild(el('h4', { text: 'Physics switches' }));
        const sw = (label, key, title) => this.add(sec.body, { label, type: 'check', title, get: () => P[key], set: v => { P[key] = v; } });
        sw('Dipole–dipole interactions', 'dipole', 'pairwise forces, cut-off 8a');
        sw('Mutual induction', 'mutual', 'neighbour dipole fields enter the magnetization');
        sw('Eddy-current damping', 'eddy', 'C = (2πσa⁵/15)J²');
        sw('AC eddy force (time-averaged)', 'acEddy');
        sw('Brownian motion', 'brownian');
        sw('Gravity & buoyancy', 'gravity');
        this.add(sec.body, { label: 'Gravity direction', type: 'range', min: -180, max: 180, unit: '°', get: () => P.gravAngle * r2d, set: v => { P.gravAngle = v * d2r; } });
        sw('Saffman shear lift', 'saffman');
        sw('Near-wall drag corrections', 'wallDrag', 'Faxén/Brenner + Haberman–Sayre');
        sw('Schiller–Naumann drag', 'nonlinearDrag');
        sw('Added mass & pressure gradient', 'addedMass');
        this.add(sec.body, { label: 'Wall friction μ', type: 'range', min: 0, max: 1.5, unit: '', get: () => P.muF, set: v => { P.muF = v; } });
        this.add(sec.body, { label: 'Rolling coupling α', type: 'range', min: 0, max: 1, unit: '', title: 'wall rolling velocity v = α a Ω for spinning hard particles', get: () => P.rollAlpha, set: v => { P.rollAlpha = v; } });
        this.add(sec.body, { label: 'Dry restitution e', type: 'range', min: 0, max: 1, unit: '', get: () => P.eDryOverride != null ? P.eDryOverride : P.material.eDry, set: v => { P.eDryOverride = v; } });
        this.add(sec.body, { label: 'Contact resolution', type: 'range', min: 0.1, max: 10, log: true, unit: 'a/step', title: 'max approach per sub-step of a pair not yet in contact', get: () => P.contactRes, set: v => { P.contactRes = v; } });
        this.add(sec.body, { label: 'Max time step', type: 'range', min: 1e-6, max: 0.05, log: true, scale: 1e3, unit: 'ms', get: () => sim.dtMaxUser, set: v => { sim.dtMaxUser = v; } });
        this.add(sec.body, { label: 'Max sub-steps / frame', type: 'range', min: 1, max: 400, log: true, step: 1, unit: '', get: () => sim.maxSubsteps, set: v => { sim.maxSubsteps = Math.round(v); } });
        panel.appendChild(sec.root);
      }

      /* display */
      {
        const sec = section('Display', false);
        const o = R.opts;
        const d = (label, key, type, extra) => this.add(sec.body, Object.assign({ label, type, get: () => o[key], set: v => { o[key] = v; R.invalidate(); R.heat.key = ''; } }, extra || {}));
        d('Field map |B|', 'heatmap', 'check');
        d('Map minimum', 'bmin', 'range', { min: 1e-6, max: 1, log: true, scale: 1e3, unit: 'mT' });
        d('Map maximum', 'bmax', 'range', { min: 1e-3, max: 10, log: true, unit: 'T' });
        d('Field lines', 'streamlines', 'check');
        d('Field-line density', 'streamDensity', 'range', { min: 0.3, max: 3, log: true, unit: '' });
        d('Flow profile glyphs', 'flowGlyphs', 'check');
        d('Particle colour', 'colorMode', 'select', { options: [['state', 'State'], ['speed', 'Speed'], ['moment', 'Magnetic moment']] });
        d('Moment arrows', 'showMoments', 'check');
        d('Force arrows', 'showForces', 'check');
        d('Particle size boost', 'particleBoost', 'range', { min: 1, max: 50, log: true, unit: '×' });
        d('Source–source forces', 'showInteractions', 'check');
        sec.body.appendChild(el('div', { class: 'btnrow' }, [el('button', { text: 'Fit view', onclick: () => R.fitToScene() })]));
        panel.appendChild(sec.root);
      }

      /* diagnostics */
      {
        const sec = section('Diagnostics', true);
        this.diagBox = el('div', { class: 'diag' });
        sec.body.appendChild(this.diagBox);
        panel.appendChild(sec.root);
      }
      this.refreshAll();
    }

    /* ------------------------------------------------------------ source cards */
    rebuildSources() {
      const list = this.sourceList; list.innerHTML = '';
      this.sourceRefreshers = [];
      const sim = this.sim, R = this.renderer, app = this.app;
      for (const src of sim.field.sources) {
        const card = el('div', { class: 'srccard' + (src === R.selected ? ' selected' : '') });
        const head = el('div', { class: 'srchead' });
        const en = el('input', { type: 'checkbox', title: 'enabled' }); en.checked = src.enabled; en.addEventListener('change', () => { src.enabled = en.checked; sim.field.touch(); });
        const name = el('input', { type: 'text', class: 'name', value: src.label }); name.addEventListener('change', () => { src.label = name.value; });
        head.append(en, el('span', { class: 'icon', text: S.TYPES[src.type].icon }), name,
          el('button', { class: 'mini', text: 'select', title: 'select on canvas', onclick: () => { R.selected = src; this.rebuildSources(); } }),
          el('button', { class: 'mini', text: 'copy', onclick: () => { const c = S.clone(src); c.x += S.size(src); sim.field.add(c); this.rebuildSources(); } }),
          el('button', { class: 'mini danger', text: '✕', onclick: () => { sim.field.remove(src); if (R.selected === src) R.selected = null; this.rebuildSources(); } }));
        card.appendChild(head);
        const body = el('div', { class: 'srcbody' });
        card.appendChild(body);
        const refs = [];
        const add = (spec) => { spec.after = spec.after || (() => sim.field.touch()); const c = ctl(spec); body.appendChild(c.root); refs.push(c.refresh); };
        add({ label: 'x', type: 'number', scale: 1e3, unit: 'mm', get: () => src.x, set: v => { src.x = v; } });
        add({ label: 'y', type: 'number', scale: 1e3, unit: 'mm', get: () => src.y, set: v => { src.y = v; } });
        if (src.type !== 'linear') add({ label: 'Angle', type: 'range', min: -180, max: 180, unit: '°', get: () => MS.util.wrapAngle(src.angle) * r2d, set: v => { src.angle = v * d2r; } });
        if (src.type === 'cuboid') {
          add({ label: 'Remanence B_r', type: 'range', min: 0.05, max: 1.5, unit: 'T', get: () => src.Br, set: v => { src.Br = v; } });
          add({ label: 'Length along M', type: 'range', min: 1e-4, max: 0.2, log: true, scale: 1e3, unit: 'mm', get: () => src.Lx, set: v => { src.Lx = v; } });
          add({ label: 'Width (in plane)', type: 'range', min: 1e-4, max: 0.2, log: true, scale: 1e3, unit: 'mm', get: () => src.Ly, set: v => { src.Ly = v; } });
          add({ label: 'Depth (out of plane)', type: 'range', min: 1e-4, max: 0.2, log: true, scale: 1e3, unit: 'mm', get: () => src.Lz, set: v => { src.Lz = v; } });
        } else if (src.type === 'cylinder') {
          add({ label: 'Remanence B_r', type: 'range', min: 0.05, max: 1.5, unit: 'T', get: () => src.Br, set: v => { src.Br = v; } });
          add({ label: 'Radius', type: 'range', min: 1e-4, max: 0.1, log: true, scale: 1e3, unit: 'mm', get: () => src.R, set: v => { src.R = v; } });
          add({ label: 'Length (axis)', type: 'range', min: 1e-4, max: 0.2, log: true, scale: 1e3, unit: 'mm', get: () => src.L, set: v => { src.L = v; } });
        } else if (src.type === 'coil') {
          add({ label: 'Radius', type: 'range', min: 1e-3, max: 0.3, log: true, scale: 1e3, unit: 'mm', get: () => src.R, set: v => { src.R = v; } });
          add({ label: 'Length (0 = loop)', type: 'range', min: 0, max: 0.3, scale: 1e3, unit: 'mm', get: () => src.L, set: v => { src.L = v; } });
          add({ label: 'Turns N', type: 'range', min: 1, max: 5000, log: true, step: 1, unit: '', get: () => src.N, set: v => { src.N = Math.round(v); } });
          add({ label: 'Current I', type: 'range', min: -50, max: 50, unit: 'A', get: () => src.I, set: v => { src.I = v; } });
          add({ label: 'Drive', type: 'select', options: [['dc', 'DC'], ['ac', 'AC: I cos(2πft+φ)']], get: () => src.drive.mode, set: v => { src.drive.mode = v; this.rebuildSources(); } });
          if (src.drive.mode === 'ac') {
            add({ label: 'Frequency', type: 'range', min: 0.1, max: 200, log: true, unit: 'Hz', get: () => src.drive.freq, set: v => { src.drive.freq = v; } });
            add({ label: 'Phase φ', type: 'range', min: -180, max: 180, unit: '°', get: () => src.drive.phase * r2d, set: v => { src.drive.phase = v * d2r; } });
          }
        } else if (src.type === 'dipole') {
          add({ label: 'Moment m', type: 'range', min: 1e-6, max: 100, log: true, unit: 'A·m²', get: () => src.m, set: v => { src.m = v; } });
          add({ label: 'Core radius', type: 'range', min: 1e-5, max: 0.05, log: true, scale: 1e3, unit: 'mm', get: () => src.rcore, set: v => { src.rcore = v; } });
        } else if (src.type === 'linear') {
          add({ label: '|B₀|', type: 'range', min: 0, max: 2, scale: 1e3, unit: 'mT', get: () => src.B0, set: v => { src.B0 = v; } });
          add({ label: 'B₀ direction', type: 'range', min: -180, max: 180, unit: '°', get: () => MS.util.wrapAngle(src.angle) * r2d, set: v => { src.angle = v * d2r; } });
          add({ label: 'G_xx', type: 'range', min: -50, max: 50, unit: 'T/m', get: () => src.Gxx, set: v => { src.Gxx = v; } });
          add({ label: 'G_xy', type: 'range', min: -50, max: 50, unit: 'T/m', get: () => src.Gxy, set: v => { src.Gxy = v; } });
          add({ label: 'G_yy', type: 'range', min: -50, max: 50, unit: 'T/m', get: () => src.Gyy, set: v => { src.Gyy = v; } });
        }
        if (src.type === 'cuboid' || src.type === 'cylinder' || src.type === 'dipole') {
          add({ label: 'Spin rate', type: 'range', min: -600, max: 600, unit: 'rpm', title: 'mechanical rotation of the magnet', get: () => src.spin * 60 / (2 * Math.PI), set: v => { src.spin = v * 2 * Math.PI / 60; } });
          add({ label: 'Strength scale', type: 'range', min: -1, max: 1, unit: '×', get: () => src.drive.amp, set: v => { src.drive.amp = v; } });
        }
        add({ label: 'Lock position', type: 'check', get: () => src.locked, set: v => { src.locked = v; } });
        list.appendChild(card);
        this.sourceRefreshers.push(() => refs.forEach(r => r()));
      }
      if (!sim.field.sources.length) list.appendChild(el('p', { class: 'hint', text: 'No sources. Add a magnet or a coil below.' }));
    }
    refreshSourceValues() { if (this.sourceRefreshers) for (const r of this.sourceRefreshers) r(); }

    /* ------------------------------------------------------------ diagnostics */
    updateDiagnostics() {
      const d = this.sim.updateDiagnostics(), sim = this.sim;
      const rows = [
        ['Simulated time', fmt(sim.time, 4) + ' s'],
        ['Speed vs. real time', (sim.timeScale * d.achieved).toPrecision(2) + '× (' + d.substeps + ' sub-steps, dt ' + fmtSI(d.dt, 's') + ')'],
        ['Particles in tube / injected / exited', `${d.N} / ${d.injected} / ${d.exited}`],
        ['Retained at wall', `${d.retained} (${(100 * d.retainedFrac).toFixed(0)} % of present)`],
        ['Capture efficiency', (100 * d.captureEff).toFixed(1) + ' % of resolved'],
        ['Wall contacts / pair contacts', `${d.wallContacts} / ${d.pairContacts}`],
        ['Mean particle speed', fmtSI(d.meanSpeed, 'm/s')],
        ['Max |B| at particles', fmtSI(d.Bmax, 'T')],
        ['Max magnetic force', fmtSI(d.Fmax, 'N')],
        ['F_mag / F_drag (at ū)', fmt(d.magToDrag, 3)],
        ['Tube Reynolds Re', fmt(d.Re, 3)],
        ['Womersley α', fmt(d.alpha, 3)],
        ['Dean number', fmt(d.Dean, 3)],
        ['Hartmann (max B)', fmt(d.Ha, 3) + (d.Ha > 1 ? '  ⚠ MHD not modelled' : '')],
        ['Pulse-wave L·f/c (quasi-static if ≪ 1)', fmt(d.waveLengthRatio, 3) + ' (c = ' + fmtSI(d.pulseWaveSpeed, 'm/s') + ')'],
        ['Max wall stretch λ', fmt(d.lambdaMax, 4)],
        ['Max particle Re_p', fmt(d.Rep, 3)],
        ['Particle response time τ_p', fmtSI(d.tauP, 's')],
        ['Stokes number St = τ_p ū / D', fmt(d.Stokes, 3)],
        ['Péclet number', fmt(d.Pe, 3)],
        ['Mason number (report §11)', fmt(d.Mason, 3)],
        ['Settling velocity', fmtSI(d.settling, 'm/s')],
      ];
      const box = this.diagBox;
      if (!box._built) { box.innerHTML = ''; box._cells = rows.map(r => { const v = el('span', { class: 'val' }); box.append(el('span', { class: 'key', text: r[0] }), v); return v; }); box._built = true; }
      box._cells.forEach((c, i) => { if (c.textContent !== rows[i][1]) c.textContent = rows[i][1]; });
    }

    /* ------------------------------------------------------------ canvas interaction */
    bindCanvas() {
      const c = this.renderer.canvas, R = this.renderer, sim = this.sim, app = this.app;
      let drag = null;
      const pointers = new Map();
      let pinch = null;
      const pos = (e) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
      c.addEventListener('pointerdown', (e) => {
        c.setPointerCapture(e.pointerId);
        const p = pos(e); pointers.set(e.pointerId, p);
        if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), scale: R.view.scale, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }; drag = null; return; }
        if (R.editTube) { const i = R.hitTubePoint(p.x, p.y); if (i >= 0) { drag = { kind: 'tubept', i }; return; } }
        const hit = R.hitSource(p.x, p.y, sim.time);
        if (hit) {
          R.selected = hit.src; this.rebuildSources();
          if (hit.part === 'rotate') drag = { kind: 'rotate', src: hit.src };
          else if (!hit.src.locked) { const w = R.s2w(p.x, p.y); drag = { kind: 'move', src: hit.src, dx: hit.src.x - w.x, dy: hit.src.y - w.y }; }
          else drag = { kind: 'none' };
        } else { drag = { kind: 'pan', x: p.x, y: p.y }; }
      });
      c.addEventListener('pointermove', (e) => {
        const p = pos(e);
        if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
        if (pinch && pointers.size === 2) {
          const [a, b] = [...pointers.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
          R.zoomAt(pinch.cx, pinch.cy, (pinch.scale * d / pinch.d) / R.view.scale); return;
        }
        if (!drag) { this.updateProbe(p); return; }
        if (drag.kind === 'pan') { R.pan(p.x - drag.x, p.y - drag.y); drag.x = p.x; drag.y = p.y; }
        else if (drag.kind === 'move') { const w = R.s2w(p.x, p.y); drag.src.x = w.x + drag.dx; drag.src.y = w.y + drag.dy; sim.field.touch(); this.refreshSourceValues(); }
        else if (drag.kind === 'rotate') { const cs = R.w2s(drag.src.x, drag.src.y); const ang = Math.atan2(-(p.y - cs.y), p.x - cs.x); drag.src.angle = e.shiftKey ? Math.round(ang / (15 * d2r)) * 15 * d2r : ang; if (drag.src.spin) drag.src.angle -= drag.src.spin * sim.time; sim.field.touch(); this.refreshSourceValues(); }
        else if (drag.kind === 'tubept') { const w = R.s2w(p.x, p.y); const pts = sim.tube.params.points.map(q => q.slice()); pts[drag.i] = [w.x, w.y]; this.afterTube({ points: pts }); }
      });
      const end = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; drag = null; };
      c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
      c.addEventListener('pointerleave', () => { R.probe = null; });
      c.addEventListener('wheel', (e) => { e.preventDefault(); const p = pos(e); R.zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
      c.addEventListener('dblclick', (e) => { const p = pos(e); if (R.editTube) { const w = R.s2w(p.x, p.y); const pts = sim.tube.params.points.map(q => q.slice()); pts.splice(pts.length - 1, 0, [w.x, w.y]); this.afterTube({ points: pts }); } });
      window.addEventListener('keydown', (e) => {
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) return;
        if (e.code === 'Space') { e.preventDefault(); app.toggle(); }
        else if (e.key === 'r') app.reset();
        else if (e.key === 'f') R.fitToScene();
        else if (e.key === 'Delete' && R.selected) { sim.field.remove(R.selected); R.selected = null; this.rebuildSources(); }
        else if (e.key === '.') app.stepOnce();
      });
    }
    updateProbe(p) {
      const R = this.renderer, sim = this.sim, w = R.s2w(p.x, p.y);
      const pr = sim.field.probe(w.x, w.y, sim.time);
      // force on a reference particle of the current material/radius
      const P = sim.P, mat = P.material, fl = sim.flow.params, a = P.radius, V = 4 / 3 * Math.PI * a * a * a;
      const H = pr.B / MS.CONST.MU0;
      let M;
      const model = P.magModel === 'auto' ? mat.model : P.magModel;
      const chiEff = 3 * (mat.chi - fl.chi) / (3 + mat.chi + 2 * fl.chi);
      if (model === 'hard') M = mat.Mr; else if (model === 'spm') M = mat.Ms * MS.util.langevin(MS.CONST.MU0 * mat.Ms * Math.PI / 6 * Math.pow(P.dcore, 3) * H / (MS.CONST.KB * fl.T)); else if (model === 'ferro') M = Math.min(chiEff * H, mat.Ms); else M = chiEff * H;
      const mx = pr.B > 0 ? V * M * pr.bx / pr.B : 0, my = pr.B > 0 ? V * M * pr.by / pr.B : 0;
      const F = Math.hypot(pr.jxx * mx + pr.jxy * my, pr.jxy * mx + pr.jyy * my);
      const probe = { x: w.x, y: w.y, bx: pr.bx, by: pr.by, B: pr.B, G: pr.G, F };
      const loc = sim.tube.locate(w.x, w.y, -1, { idx: 0, s: 0, n: 0 });
      if (loc.s >= 0 && loc.s <= sim.tube.L && Math.abs(loc.n) <= sim.tube.R[loc.idx]) { const fo = sim.dyn.fo; sim.flow.axial(loc.n, sim.tube.R[loc.idx], fo); probe.u = fo.u; probe.xi = Math.abs(loc.n) / sim.tube.R[loc.idx]; }
      R.probe = probe;
    }
  }
  MS.Controls = Controls;
})(typeof window !== 'undefined' ? window : globalThis);
