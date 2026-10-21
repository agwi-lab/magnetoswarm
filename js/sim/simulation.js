/* MagnetoSwarm — simulation orchestrator. */
(function (global) {
  'use strict';
  const MS = global.MS = global.MS || {};
  const MU0 = MS.CONST.MU0;

  class Simulation {
    constructor() {
      this.field = new MS.FieldModel();
      this.tube = new MS.TubeGeometry();
      this.flow = new MS.FlowModel();
      this.swarm = new MS.Swarm(2048);
      this.P = {
        material: Object.assign({}, MS.MATERIALS.magnetite), materialKey: 'magnetite',
        radius: 1e-6, polydispersity: 0.15, magModel: 'auto', dcore: 12e-9,
        dipole: true, mutual: true, eddy: true, acEddy: true, brownian: false, gravity: true, gravAngle: -Math.PI / 2,
        saffman: false, wallDrag: true, nonlinearDrag: true, addedMass: true,
        muF: 0.3, eDryOverride: null, rollAlpha: 0.5, cutoffFactor: 8, stickTime: 0.15, contactRes: 1.0,
      };
      this.inj = { mode: 'continuous', count: 300, rate: 150, recycle: false, seed: 7, inletFraction: 0.12 };
      this.elastic = { pOut: 10e3, pAmp: 2e3, lag: 0.05 };
      this.time = 0; this.running = false; this.timeScale = 1; this.dtMaxUser = 2e-3; this.maxSubsteps = 60;
      this.achieved = 1;   // achieved / requested time ratio of the last frame
      this.stepCount = 0; this.lastSubsteps = 0; this.lastDt = 0;
      this.rng = MS.util.makeRNG(this.inj.seed);
      this.dyn = new MS.Dynamics(this);
      this.pArr = new Float64Array(this.tube.N);
      this._injAcc = 0;
      this.diag = {};
      this.onReset = null;
    }

    /* ----------------------------------------------------------- setup */
    setMaterial(key) { this.P.materialKey = key; this.P.material = Object.assign({}, MS.MATERIALS[key]); }
    setFluid(key) { const f = MS.FLUIDS[key]; this.flow.setParams({ rho: f.rho, mu: f.mu, chi: f.chi, sigma: f.sigma, T: f.T }); this.fluidKey = key; }
    rebuildFlow() { this.flow.build(this.tube.Rref); }

    sampleRadius() {
      const cv = this.P.polydispersity;
      if (cv <= 0) return this.P.radius;
      const s = Math.sqrt(Math.log(1 + cv * cv));
      return this.P.radius * Math.exp(s * this.rng.gauss() - 0.5 * s * s);
    }
    /* place a particle at arc length s, random normal offset */
    spawnAt(s, t) {
      const tube = this.tube, a = this.sampleRadius();
      const idx = tube.stationOf(s);
      const R = tube.R[idx];
      const lim = Math.max(0, R - a * 1.05);
      const n = (2 * this.rng() - 1) * lim;
      const x = tube.sx[idx] + tube.tx[idx] * (s - tube.s[idx]) + tube.nx[idx] * n;
      const y = tube.sy[idx] + tube.ty[idx] * (s - tube.s[idx]) + tube.ny[idx] * n;
      const i = this.swarm.add(x, y, a, t);
      this.swarm.station[i] = idx;
      // start with the local fluid velocity
      const fo = this.dyn.fo; this.flow.axial(n, R, fo);
      this.swarm.vx[i] = fo.u * tube.tx[idx]; this.swarm.vy[i] = fo.u * tube.ty[idx];
      return i;
    }
    spawnBolus(count) {
      const L = this.tube.L;
      for (let k = 0; k < count; k++) this.spawnAt(L * (0.02 + this.inj.inletFraction * this.rng()), this.time);
    }

    reset() {
      this.time = 0; this._injAcc = 0; this.stepCount = 0;
      this.rng.seed(this.inj.seed);
      this.swarm.clear();
      this.tube.resetElastic();
      this.flow.build(this.tube.Rref);
      this.flow.setTime(0);
      this.computePressure();
      this.tube.updateElastic(this.pArr, 0);
      if (this.inj.mode === 'bolus') this.spawnBolus(this.inj.count);
      this.updateDiagnostics();
      if (this.onReset) this.onReset();
    }

    /* ----------------------------------------------------------- pressure & wall */
    computePressure() {
      const tube = this.tube, flow = this.flow, N = tube.N, p = this.pArr;
      const E = this.elastic;
      let ptm = E.pOut;
      if (flow.params.waveform !== 'steady' && flow.params.beta > 0) {
        const w = flow.waveformValue((this.time - E.lag) * flow.params.freq);
        ptm += E.pAmp * (w - 1) / flow.params.beta;
      }
      p[N - 1] = ptm;
      const ds = tube.ds;
      for (let j = N - 2; j >= 0; j--) {
        const Rm = 0.5 * (tube.R[j] + tube.R[j + 1]);
        p[j] = p[j + 1] - flow.dpds(Rm) * ds;     // dp/ds < 0 → pressure rises upstream
      }
    }

    /* ----------------------------------------------------------- time stepping */
    dtMax() {
      const st = this.dyn.stats, P = this.P, flow = this.flow, tube = this.tube;
      let dt = this.dtMaxUser;
      const vmax = Math.max(st.vmax || 0, Math.abs(flow.meanVelocity(tube.Rmin)) * 2);
      dt = Math.min(dt, 0.02 * tube.Rref / Math.max(vmax, 1e-12));                // resolve tube/field scale
      const amin = st.amin || P.radius;
      if (P.dipole || P.mutual) dt = Math.min(dt, Math.max(this.dtMaxUser / 50, P.contactRes * amin / Math.max(st.vrelmax || 0, 1e-12)));   // pair-contact resolution (≤ 50× slowdown)
      // angular frequencies: AC drives, spinning magnets, particle spin
      let om = 0;
      for (const s of this.field.sources) if (s.enabled) { if (s.drive && s.drive.mode === 'ac') om = Math.max(om, 2 * Math.PI * s.drive.freq); if (s.spin) om = Math.max(om, Math.abs(s.spin)); }
      if (om > 0) dt = Math.min(dt, 0.1 / om);
      if (flow.params.waveform !== 'steady') dt = Math.min(dt, 0.01 / flow.params.freq);
      if (st.omegaMax > 0) dt = Math.min(dt, 0.2 / st.omegaMax);
      return Math.max(dt, 1e-8);
    }

    /* advance by `simDt` seconds of simulated time (as far as the sub-step budget allows) */
    advance(simDt) {
      let remaining = simDt, n = 0;
      const t0 = this.time;
      const eps = 1e-6 * simDt;
      while (remaining > eps && n < this.maxSubsteps) {
        const dt = Math.min(remaining, this.dtMax());
        this.substep(dt);
        remaining -= dt; n++;
      }
      this.lastSubsteps = n;
      this.achieved = (this.time - t0) / simDt;
    }

    substep(dt) {
      const t = this.time;
      this.flow.setTime(t);
      this.computePressure();
      this.tube.updateElastic(this.pArr, dt);
      // continuous injection
      if (this.inj.mode === 'continuous') {
        this._injAcc += this.inj.rate * dt;
        while (this._injAcc >= 1 && this.swarm.n < this.inj.count) { this.spawnAt(this.tube.L * 0.01 + 2.2 * this.P.radius, t); this._injAcc -= 1; }
        if (this.swarm.n >= this.inj.count) this._injAcc = 0;
      }
      this.dyn.step(dt, t);
      // exits
      const sw = this.swarm, L = this.tube.L;
      for (let i = sw.n - 1; i >= 0; i--) {
        if (sw.ss[i] > L || sw.ss[i] < 0) {
          sw.exited++;
          if (this.inj.mode === 'bolus' && this.inj.recycle) {
            // re-inject at the inlet, keep radius
            const a = sw.a[i]; sw.remove(i); const j = this.spawnAt(this.tube.L * 0.02, t); sw.a[j] = a; sw.injected--; sw.exited--;
          } else sw.remove(i);
        }
      }
      this.time += dt; this.stepCount++; this.lastDt = dt;
    }

    /* ----------------------------------------------------------- diagnostics */
    updateDiagnostics() {
      const sw = this.swarm, N = sw.n, flow = this.flow, tube = this.tube, P = this.P, mat = P.material, fl = flow.params;
      const d = this.diag;
      const R = tube.Rref;
      const ub = Math.abs(flow.meanVelocity(R));
      d.Re = flow.reynolds(R);
      d.alpha = flow.womersley(R);
      let kmax = 0; for (let j = 0; j < tube.N; j++) kmax = Math.max(kmax, Math.abs(tube.kappa[j]));
      d.Dean = kmax > 0 ? d.Re * Math.sqrt(R * kmax) : 0;
      d.Ha = Math.sqrt(fl.sigma / fl.mu) * 2 * R;           // × B → computed with max B below
      d.pulseWaveSpeed = tube.pulseWaveSpeed(fl.rho);
      d.waveLengthRatio = fl.waveform !== 'steady' ? tube.L * fl.freq / d.pulseWaveSpeed : 0;
      d.N = N; d.injected = sw.injected; d.exited = sw.exited;
      let stuck = 0, vsum = 0, Bmax = 0, Fmax = 0, msum = 0;
      for (let i = 0; i < N; i++) {
        if (sw.st[i]) stuck++;
        vsum += Math.hypot(sw.vx[i], sw.vy[i]);
        const B = Math.hypot(sw.bx[i], sw.by[i]); if (B > Bmax) Bmax = B;
        const F = Math.hypot(sw.jxx[i] * sw.mx[i] + sw.jxy[i] * sw.my[i], sw.jxy[i] * sw.mx[i] + sw.jyy[i] * sw.my[i]); if (F > Fmax) Fmax = F;
        msum += Math.hypot(sw.mx[i], sw.my[i]);
      }
      d.retained = stuck; d.retainedFrac = N ? stuck / N : 0;
      d.captureEff = (stuck + sw.exited) ? stuck / (stuck + sw.exited) : 0;
      d.meanSpeed = N ? vsum / N : 0;
      d.Bmax = Bmax; d.Fmax = Fmax; d.meanMoment = N ? msum / N : 0;
      d.Ha *= Bmax;
      d.Rep = this.dyn.stats.repmax || 0;
      d.pairContacts = this.dyn.stats.nPairContact || 0; d.wallContacts = this.dyn.stats.nContact || 0;
      const a = P.radius, V = 4 / 3 * Math.PI * a * a * a;
      d.tauP = (mat.rho + 0.5 * fl.rho) * V / (6 * Math.PI * fl.mu * a);
      d.Stokes = d.tauP * ub / (2 * R);
      d.Pe = ub * 2 * a / (MS.CONST.KB * fl.T / (6 * Math.PI * fl.mu * a));
      const Msat = mat.model === 'hard' ? mat.Mr : (mat.Ms || Math.abs(mat.chi) * Bmax / MU0);
      d.Mason = (MU0 * Msat * Msat * 4 * a * a) / (fl.mu * Math.max(ub, 1e-12));   // report §11.1 definition
      d.magToDrag = Fmax / (6 * Math.PI * fl.mu * a * Math.max(ub, 1e-12));
      d.settling = 2 * (mat.rho - fl.rho) * MS.CONST.G * a * a / (9 * fl.mu);
      d.dt = this.lastDt; d.substeps = this.lastSubsteps; d.achieved = this.achieved;
      d.lambdaMax = Math.max.apply(null, Array.from(this.tube.lambda));
      return d;
    }

    /* ----------------------------------------------------------- state */
    serialize() {
      return {
        version: 1,
        sources: this.field.serialize(),
        tube: JSON.parse(JSON.stringify(this.tube.params)),
        flow: JSON.parse(JSON.stringify(this.flow.params)), fluidKey: this.fluidKey,
        P: Object.assign({}, this.P), inj: Object.assign({}, this.inj), elastic: Object.assign({}, this.elastic),
        timeScale: this.timeScale, dtMaxUser: this.dtMaxUser,
      };
    }
    load(cfg) {
      this.field.load(cfg.sources || []);
      this.tube.setParams(cfg.tube || {});
      if (cfg.fluidKey && MS.FLUIDS[cfg.fluidKey]) this.fluidKey = cfg.fluidKey;
      this.flow.setParams(cfg.flow || {});
      Object.assign(this.P, cfg.P || {});
      if (cfg.P && cfg.P.materialKey) this.setMaterial(cfg.P.materialKey);
      if (cfg.P && cfg.P.material) this.P.material = Object.assign({}, this.P.material, cfg.P.material);
      Object.assign(this.inj, cfg.inj || {});
      Object.assign(this.elastic, cfg.elastic || {});
      if (cfg.timeScale) this.timeScale = cfg.timeScale;
      if (cfg.dtMaxUser) this.dtMaxUser = cfg.dtMaxUser;
      this.pArr = new Float64Array(this.tube.N);
      this.reset();
    }
  }
  MS.Simulation = Simulation;
})(typeof window !== 'undefined' ? window : globalThis);
