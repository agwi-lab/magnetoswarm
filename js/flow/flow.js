/* MagnetoSwarm — pulsatile tube flow (Womersley solution, report §5.3).
 *
 * The volumetric flow rate is prescribed: Q(t) = Q_mean · w(t),  w(t) = Re Σ_n c_n e^{i n ω t}.
 * For every harmonic the exact fully developed solution of the unsteady Stokes equations in a
 * circular tube is used (Womersley 1955), normalised so that its cross-sectional average is 1:
 *
 *   Φ_n(ξ) = [1 − J0(Λ_n ξ)/J0(Λ_n)] / [1 − 2 J1(Λ_n)/(Λ_n J0(Λ_n))],   Λ_n = i^{3/2} α_n,  α_n = R sqrt(nω/ν)
 *   Φ_0(ξ) = 2 (1 − ξ²)                                                   (Poiseuille)
 *
 *   u(ξ, t) = Q_mean/(π R²) · Re Σ_n c_n Φ_n(ξ) e^{i n ω t},     ξ = r/R
 *
 * The axial pressure gradient consistent with each harmonic is
 *   ∂p/∂s|_n = − i n ω ρ Q̂_n / (π R² D_n),  D_n = 1 − 2J1(Λ)/(ΛJ0(Λ)),   and  −8 μ Q_0/(π R⁴) for n = 0.
 *
 * Approximations: profile shapes use α at the reference radius (quasi-fully-developed flow in
 * slowly varying / gently curved tubes); the local mean velocity uses the local deformed radius.
 * Fluids are Newtonian and non-conducting (Hartmann number Ha ≪ 1 — reported as a diagnostic).
 */
(function (global) {
  'use strict';
  const MS = global.MS = global.MS || {};
  const bessel = MS.special.besselJ0J1c;

  const NXI = 65;

  class FlowModel {
    constructor(params) {
      this.params = Object.assign({
        rho: 998, mu: 1.0e-3, chi: -9.0e-6, sigma: 5.5e-6, T: 293.15,
        Qmean: 1e-7,            // [m³/s]
        waveform: 'steady',     // 'steady' | 'sine' | 'pulse'
        freq: 1.2,              // [Hz]
        beta: 0.8,              // pulsatility amplitude (peak-to-mean − 1)
        nHarm: 10,
      }, params || {});
      this.Rref = 0.002;
      this.t = 0;
      this.build(this.Rref);
    }

    setParams(patch) { Object.assign(this.params, patch); this.build(this.Rref); }
    get nu() { return this.params.mu / this.params.rho; }

    /* waveform w(φ), φ ∈ [0,1) */
    waveformValue(phi) {
      const p = this.params;
      phi -= Math.floor(phi);
      if (p.waveform === 'sine') return 1 + p.beta * Math.sin(2 * Math.PI * phi);
      if (p.waveform === 'pulse') {
        const S = this._pulseShape(phi);
        return 1 + p.beta * (S - this._Smean) / (this._Smax - this._Smean);
      }
      return 1;
    }
    _pulseShape(phi) {
      // carotid-like double hump, made periodic by summing neighbours
      let S = 0;
      for (let k = -1; k <= 1; k++) {
        const f = phi + k;
        const d1 = (f - 0.17) / 0.08, d2 = (f - 0.42) / 0.09;
        S += Math.exp(-d1 * d1) + 0.35 * Math.exp(-d2 * d2);
      }
      return S;
    }

    build(Rref) {
      this.Rref = Rref || this.Rref;
      const p = this.params;
      const NH = (p.waveform === 'steady') ? 0 : p.nHarm;
      this.NH = NH;
      // pulse-shape normalisation
      if (p.waveform === 'pulse') {
        let sum = 0, mx = -Infinity; const n = 1024;
        for (let k = 0; k < n; k++) { const v = this._pulseShape(k / n); sum += v; mx = Math.max(mx, v); }
        this._Smean = sum / n; this._Smax = mx;
      }
      // Fourier coefficients c_n (complex): w(φ) = Re Σ c_n e^{i2πnφ}
      const n = 1024;
      this.cr = new Float64Array(NH + 1); this.ci = new Float64Array(NH + 1);
      const w = new Float64Array(n);
      for (let k = 0; k < n; k++) w[k] = this.waveformValue(k / n);
      for (let m = 0; m <= NH; m++) {
        let sr = 0, si = 0;
        for (let k = 0; k < n; k++) { const th = -2 * Math.PI * m * k / n; sr += w[k] * Math.cos(th); si += w[k] * Math.sin(th); }
        const f = (m === 0 ? 1 : 2) / n;
        this.cr[m] = sr * f; this.ci[m] = m === 0 ? 0 : si * f;
      }
      // Womersley profiles
      const omega = 2 * Math.PI * p.freq;
      const nu = this.nu;
      this.alpha = this.Rref * Math.sqrt(omega / nu);           // α for the fundamental
      this.phiR = new Float64Array((NH + 1) * NXI); this.phiI = new Float64Array((NH + 1) * NXI);
      this.dphiR = new Float64Array((NH + 1) * NXI); this.dphiI = new Float64Array((NH + 1) * NXI);
      this.Fr = new Float64Array(NH + 1); this.Fi = new Float64Array(NH + 1);   // pressure factors i n ω ρ / D_n
      const o = {};
      for (let m = 0; m <= NH; m++) {
        if (m === 0) {
          for (let k = 0; k < NXI; k++) { const xi = k / (NXI - 1); this.phiR[k] = 2 * (1 - xi * xi); this.dphiR[k] = -4 * xi; }
          continue;
        }
        let a = Math.min(25, this.Rref * Math.sqrt(m * omega / nu));   // cap for series accuracy
        // Λ = α e^{i 3π/4}
        const Lr = a * Math.cos(3 * Math.PI / 4), Li = a * Math.sin(3 * Math.PI / 4);
        bessel(Lr, Li, o);
        const J0r = o.j0r, J0i = o.j0i, J1r = o.j1r, J1i = o.j1i;
        // D = 1 − 2 J1/(Λ J0)
        const LJ0r = Lr * J0r - Li * J0i, LJ0i = Lr * J0i + Li * J0r;
        const den = LJ0r * LJ0r + LJ0i * LJ0i;
        const qr = (J1r * LJ0r + J1i * LJ0i) / den, qi = (J1i * LJ0r - J1r * LJ0i) / den;   // J1/(ΛJ0)
        const Dr = 1 - 2 * qr, Di = -2 * qi;
        const Dd = Dr * Dr + Di * Di;
        const inv0 = J0r * J0r + J0i * J0i;
        for (let k = 0; k < NXI; k++) {
          const xi = k / (NXI - 1);
          bessel(Lr * xi, Li * xi, o);
          // g = 1 − J0(Λξ)/J0(Λ)
          const rr = (o.j0r * J0r + o.j0i * J0i) / inv0, ri = (o.j0i * J0r - o.j0r * J0i) / inv0;
          const gr = 1 - rr, gi = -ri;
          // Φ = g / D
          this.phiR[m * NXI + k] = (gr * Dr + gi * Di) / Dd;
          this.phiI[m * NXI + k] = (gi * Dr - gr * Di) / Dd;
          // dΦ/dξ = Λ J1(Λξ)/J0(Λ) / D
          const hr = (o.j1r * J0r + o.j1i * J0i) / inv0, hi = (o.j1i * J0r - o.j1r * J0i) / inv0;   // J1(Λξ)/J0(Λ)
          const LHr = Lr * hr - Li * hi, LHi = Lr * hi + Li * hr;
          this.dphiR[m * NXI + k] = (LHr * Dr + LHi * Di) / Dd;
          this.dphiI[m * NXI + k] = (LHi * Dr - LHr * Di) / Dd;
        }
        // F_n = i n ω ρ / D
        const wr = 0, wi = m * omega * p.rho;
        this.Fr[m] = (wr * Dr + wi * Di) / Dd; this.Fi[m] = (wi * Dr - wr * Di) / Dd;
      }
      this.er = new Float64Array(NH + 1); this.ei = new Float64Array(NH + 1);
      this.setTime(this.t);
      this.version = (this.version || 0) + 1;
    }

    /* precompute phasors e^{i n ω t} and the instantaneous flow rate */
    setTime(t) {
      this.t = t;
      const om = 2 * Math.PI * this.params.freq;
      let q = 0, dq = 0;
      for (let m = 0; m <= this.NH; m++) {
        const th = m * om * t; const c = Math.cos(th), s = Math.sin(th);
        this.er[m] = c; this.ei[m] = s;
        q += this.cr[m] * c - this.ci[m] * s;
        dq += -(this.cr[m] * s + this.ci[m] * c) * m * om;
      }
      this.wNow = q; this.dwNow = dq;
      this.Q = this.params.Qmean * q;
      this.dQdt = this.params.Qmean * dq;
    }

    /* Profile sums at ξ ∈ [0,1]: W (velocity shape), W_ξ, W_t (time derivative / Q_mean normalisation) */
    profile(xi, out) {
      xi = Math.abs(xi); if (xi > 1) xi = 1;
      const f = xi * (NXI - 1); let k = Math.floor(f); if (k >= NXI - 1) k = NXI - 2; const a = f - k;
      let W = 0, Wx = 0, Wt = 0;
      const om = 2 * Math.PI * this.params.freq;
      for (let m = 0; m <= this.NH; m++) {
        const i0 = m * NXI + k;
        const pr = this.phiR[i0] + a * (this.phiR[i0 + 1] - this.phiR[i0]);
        const pi = this.phiI[i0] + a * (this.phiI[i0 + 1] - this.phiI[i0]);
        const dr = this.dphiR[i0] + a * (this.dphiR[i0 + 1] - this.dphiR[i0]);
        const di = this.dphiI[i0] + a * (this.dphiI[i0 + 1] - this.dphiI[i0]);
        // z = c_n e_n
        const zr = this.cr[m] * this.er[m] - this.ci[m] * this.ei[m];
        const zi = this.cr[m] * this.ei[m] + this.ci[m] * this.er[m];
        W += zr * pr - zi * pi;
        Wx += zr * dr - zi * di;
        // d/dt (z Φ) = i m ω z Φ → Re = −m ω Im(zΦ)
        Wt += -m * om * (zr * pi + zi * pr);
      }
      out.W = W; out.Wx = Wx; out.Wt = Wt;
      return out;
    }

    /* Axial velocity (m/s), its normal derivative and local fluid acceleration at normal offset n in a
     * tube of local radius R. Writes {u, dudn, dudt}. */
    axial(n, R, out) {
      const xi = Math.abs(n) / R;
      if (xi >= 1) { out.u = 0; out.dudn = 0; out.dudt = 0; return out; }
      this.profile(xi, out);
      const q = this.params.Qmean / (Math.PI * R * R);
      out.u = q * out.W;
      out.dudn = q * out.Wx / R * (n >= 0 ? 1 : -1);
      out.dudt = q * out.Wt;
      return out;
    }

    /* axial pressure gradient dp/ds (Pa/m) in a tube of local radius R */
    dpds(R) {
      const p = this.params;
      let g = -8 * p.mu * p.Qmean * this.cr[0] / (Math.PI * R * R * R * R);
      const A = Math.PI * R * R;
      for (let m = 1; m <= this.NH; m++) {
        const zr = this.cr[m] * this.er[m] - this.ci[m] * this.ei[m];
        const zi = this.cr[m] * this.ei[m] + this.ci[m] * this.er[m];
        g -= (this.Fr[m] * zr - this.Fi[m] * zi) * p.Qmean / A;
      }
      return g;
    }

    meanVelocity(R) { return this.params.Qmean / (Math.PI * R * R); }
    reynolds(R) { return this.params.rho * Math.abs(this.meanVelocity(R)) * 2 * R / this.params.mu; }
    womersley(R) { return R * Math.sqrt(2 * Math.PI * this.params.freq / this.nu); }
  }

  MS.FlowModel = FlowModel;
})(typeof window !== 'undefined' ? window : globalThis);
