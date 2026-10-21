/* MagnetoSwarm — elastic tube geometry.
 *
 * Centre-line: Catmull–Rom spline through user control points, resampled to N uniformly spaced
 * arc-length stations with tangent t̂, normal n̂ = ẑ×t̂ and curvature κ.
 *
 * Reference inner radius (report §2.1 + stenosis):
 *   R0(s) = [R_in + (R_out−R_in) s/L] · (1 + δ_c sin(2π N_c s/L)) · (1 − σ_st exp(−((s−s_st)/w_st)²))
 *
 * Elastic wall (report §7, reduced to a membrane "tube law", quasi-static, λ_z = 1):
 *   Gent material  W = −(G J_m/2) ln(1 − (I1−3)/J_m)  (J_m → ∞ : neo-Hookean)
 *   with λ = R/R0, h = h0/λ, σ_r ≈ 0 (thin wall) and Laplace's law p = σ_θ h / R:
 *       p(λ) = (G h0 / R0) · (1 − λ⁻⁴) / (1 − (λ² + λ⁻² − 2)/J_m)
 *   Valid for h0/R0 ≲ 0.2 and tube lengths ≪ pulse-wave length (Moens–Korteweg c = sqrt(E h/(2ρR))).
 *   The deformed radius R(s,t) = λ(s,t) R0(s) follows the local transmural pressure p(s,t).
 */
(function (global) {
  'use strict';
  const MS = global.MS = global.MS || {};

  const NSTATIONS = 400;

  class TubeGeometry {
    constructor(params) {
      this.params = Object.assign({
        points: [[-0.04, 0], [0.04, 0]],   // control points [m]
        Rin: 0.002, Rout: 0.002,          // inner reference radii [m]
        h0: 0.0005,                       // wall thickness [m]
        stenosisSeverity: 0, stenosisPos: 0.5, stenosisWidth: 0.004,
        corrugAmp: 0, corrugPeriods: 8,
        elastic: true, G: 3.0e5, Jm: 30,  // shear modulus [Pa], Gent limit
      }, params || {});
      this.N = NSTATIONS;
      const N = this.N;
      this.sx = new Float64Array(N); this.sy = new Float64Array(N);
      this.tx = new Float64Array(N); this.ty = new Float64Array(N);
      this.nx = new Float64Array(N); this.ny = new Float64Array(N);
      this.kappa = new Float64Array(N);
      this.s = new Float64Array(N);
      this.R0 = new Float64Array(N);
      this.lambda = new Float64Array(N).fill(1);
      this.R = new Float64Array(N);
      this.Rdot = new Float64Array(N);
      this.p = new Float64Array(N);
      this.version = 0;
      this.build();
    }

    /* ---------------------------------------------------------- centre-line */
    static catmullRom(P, i, u) {
      const n = P.length;
      const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[Math.min(n - 1, i + 1)], p3 = P[Math.min(n - 1, i + 2)];
      const u2 = u * u, u3 = u2 * u;
      const f = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3);
      return [f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])];
    }

    build() {
      const P = this.params.points;
      const nseg = P.length - 1;
      const M = 4000;
      const xs = new Float64Array(M + 1), ys = new Float64Array(M + 1), cum = new Float64Array(M + 1);
      for (let k = 0; k <= M; k++) {
        const u = k / M * nseg;
        let i = Math.min(nseg - 1, Math.floor(u));
        const q = TubeGeometry.catmullRom(P, i, u - i);
        xs[k] = q[0]; ys[k] = q[1];
        cum[k] = k === 0 ? 0 : cum[k - 1] + Math.hypot(xs[k] - xs[k - 1], ys[k] - ys[k - 1]);
      }
      const L = cum[M];
      this.L = L;
      const N = this.N;
      let k = 0;
      for (let j = 0; j < N; j++) {
        const target = L * j / (N - 1);
        while (k < M - 1 && cum[k + 1] < target) k++;
        const f = cum[k + 1] > cum[k] ? (target - cum[k]) / (cum[k + 1] - cum[k]) : 0;
        this.sx[j] = xs[k] + f * (xs[k + 1] - xs[k]);
        this.sy[j] = ys[k] + f * (ys[k + 1] - ys[k]);
        this.s[j] = target;
      }
      // tangents (central differences), normals, curvature
      for (let j = 0; j < N; j++) {
        const a = Math.max(0, j - 1), b = Math.min(N - 1, j + 1);
        let tx = this.sx[b] - this.sx[a], ty = this.sy[b] - this.sy[a];
        const n = Math.hypot(tx, ty) || 1; tx /= n; ty /= n;
        this.tx[j] = tx; this.ty[j] = ty; this.nx[j] = -ty; this.ny[j] = tx;
      }
      for (let j = 0; j < N; j++) {
        const a = Math.max(0, j - 1), b = Math.min(N - 1, j + 1);
        const dth = Math.atan2(this.tx[a] * this.ty[b] - this.ty[a] * this.tx[b], this.tx[a] * this.tx[b] + this.ty[a] * this.ty[b]);
        this.kappa[j] = dth / (this.s[b] - this.s[a] || 1);
      }
      this.ds = L / (N - 1);
      this.buildRadius();
      this.version++;
    }

    buildRadius() {
      const p = this.params, N = this.N, L = this.L;
      for (let j = 0; j < N; j++) {
        const s = this.s[j];
        let R = p.Rin + (p.Rout - p.Rin) * s / L;
        if (p.corrugAmp) R *= 1 + p.corrugAmp * Math.sin(2 * Math.PI * p.corrugPeriods * s / L);
        if (p.stenosisSeverity) {
          const d = (s - p.stenosisPos * L) / p.stenosisWidth;
          R *= 1 - p.stenosisSeverity * Math.exp(-d * d);
        }
        this.R0[j] = Math.max(R, 1e-6);
        this.R[j] = this.R0[j] * this.lambda[j];
      }
      this.Rref = 0.5 * (p.Rin + p.Rout);
      this.Rmin = Math.min.apply(null, Array.from(this.R0));
      this.lambdaMax = this.computeLambdaMax();
    }

    computeLambdaMax() {
      const Jm = this.params.Jm;
      if (!isFinite(Jm) || Jm <= 0) return 4;
      const a = Jm + 2;
      return Math.sqrt(0.5 * (a + Math.sqrt(a * a - 4)));
    }

    setParams(patch) { Object.assign(this.params, patch); this.build(); }

    /* ---------------------------------------------------------- tube law */
    /* transmural pressure [Pa] for circumferential stretch λ at reference radius R0 */
    pressureOfStretch(lam, R0) {
      const K = this.params.G * this.params.h0 / R0;
      const Jm = this.params.Jm;
      const l2 = lam * lam, li2 = 1 / l2;
      const A = 1 - li2 * li2;
      const Bq = isFinite(Jm) && Jm > 0 ? 1 - (l2 + li2 - 2) / Jm : 1;
      return K * A / Bq;
    }
    dPressureDStretch(lam, R0) {
      const K = this.params.G * this.params.h0 / R0;
      const Jm = this.params.Jm;
      const l2 = lam * lam, li2 = 1 / l2;
      const A = 1 - li2 * li2, dA = 4 / (l2 * l2 * lam);
      let Bq = 1, dB = 0;
      if (isFinite(Jm) && Jm > 0) { Bq = 1 - (l2 + li2 - 2) / Jm; dB = -(2 * lam - 2 / (l2 * lam)) / Jm; }
      return K * (dA * Bq - A * dB) / (Bq * Bq);
    }
    /* invert the tube law: λ such that p(λ) = p (safeguarded Newton) */
    stretchOfPressure(p, R0, lam0) {
      const lo = 0.6, hi = 0.995 * this.lambdaMax;
      let lam = Math.min(hi, Math.max(lo, lam0 || 1));
      for (let it = 0; it < 12; it++) {
        const f = this.pressureOfStretch(lam, R0) - p;
        if (Math.abs(f) < 1e-9 * (Math.abs(p) + 1)) break;
        const df = this.dPressureDStretch(lam, R0);
        let step = f / df;
        if (!isFinite(step)) break;
        if (Math.abs(step) > 0.2) step = 0.2 * Math.sign(step);
        lam -= step;
        if (lam < lo) lam = lo; if (lam > hi) lam = hi;
      }
      return lam;
    }

    /* Update deformed radius from a pressure array p(s) [Pa]; dt for the wall velocity */
    updateElastic(pArr, dt) {
      const N = this.N;
      const inv = dt > 0 ? 1 / dt : 0;
      for (let j = 0; j < N; j++) {
        this.p[j] = pArr[j];
        const lam = this.params.elastic ? this.stretchOfPressure(pArr[j], this.R0[j], this.lambda[j]) : 1;
        this.lambda[j] = lam;
        const Rn = lam * this.R0[j];
        this.Rdot[j] = (Rn - this.R[j]) * inv;
        this.R[j] = Rn;
      }
    }
    resetElastic() { this.lambda.fill(1); this.Rdot.fill(0); for (let j = 0; j < this.N; j++) this.R[j] = this.R0[j]; }

    /* Moens–Korteweg pulse-wave speed with E = 3G (incompressible) at the reference radius */
    pulseWaveSpeed(rho) { return Math.sqrt(3 * this.params.G * this.params.h0 / (2 * rho * this.Rref)); }

    /* ---------------------------------------------------------- lookup */
    /* Locate point: returns station index, arc length s, signed normal offset n (writes into out) */
    locate(x, y, hint, out) {
      const N = this.N;
      let best = -1, bd = Infinity;
      if (hint >= 0 && hint < N) {
        const lo = Math.max(0, hint - 6), hi = Math.min(N - 1, hint + 6);
        for (let j = lo; j <= hi; j++) { const dx = x - this.sx[j], dy = y - this.sy[j]; const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = j; } }
        if (best === lo || best === hi) best = -1;   // hit window edge → do a global search
      }
      if (best < 0) {
        bd = Infinity;
        for (let j = 0; j < N; j += 4) { const dx = x - this.sx[j], dy = y - this.sy[j]; const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = j; } }
        const lo = Math.max(0, best - 4), hi = Math.min(N - 1, best + 4);
        for (let j = lo; j <= hi; j++) { const dx = x - this.sx[j], dy = y - this.sy[j]; const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = j; } }
      }
      const dx = x - this.sx[best], dy = y - this.sy[best];
      out.idx = best;
      out.s = this.s[best] + dx * this.tx[best] + dy * this.ty[best];
      out.n = dx * this.nx[best] + dy * this.ny[best];
      return out;
    }

    radiusAt(idx) { return this.R[idx]; }
    /* interpolated quantities at arc length s */
    stationOf(s) { return Math.min(this.N - 1, Math.max(0, Math.round(s / this.ds))); }

    bounds(margin) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const h = this.params.h0;
      for (let j = 0; j < this.N; j++) {
        const r = this.R[j] + h;
        x0 = Math.min(x0, this.sx[j] - r); x1 = Math.max(x1, this.sx[j] + r);
        y0 = Math.min(y0, this.sy[j] - r); y1 = Math.max(y1, this.sy[j] + r);
      }
      margin = margin || 0;
      return { x0: x0 - margin, y0: y0 - margin, x1: x1 + margin, y1: y1 + margin };
    }

    /* outline polygon of inner wall (both sides) for rendering, as arrays of [x,y] */
    wallPolylines(offset) {
      const a = [], b = [];
      for (let j = 0; j < this.N; j++) {
        const r = this.R[j] + (offset || 0);
        a.push([this.sx[j] + this.nx[j] * r, this.sy[j] + this.ny[j] * r]);
        b.push([this.sx[j] - this.nx[j] * r, this.sy[j] - this.ny[j] * r]);
      }
      return [a, b];
    }
  }

  MS.TubeGeometry = TubeGeometry;
})(typeof window !== 'undefined' ? window : globalThis);
