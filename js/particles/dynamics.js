/* MagnetoSwarm — swarm dynamics (report §6, §12 reduced-order model, one-way fluid coupling).
 *
 * Per particle i (sphere, radius a, volume V):
 *   m_eff dv/dt = −Γ_d (v − u) − C v + F_mag + F_dd + F_g + F_fa + F_L + F_ac + F_contact
 *
 *   Γ_d  = 6π μ a K(a/R) (1 + 0.15 Re_p^0.687) [f∥ t̂t̂ + f⊥ n̂n̂]   Stokes drag with Schiller–Naumann, tube
 *          confinement (Haberman–Sayre) and near-wall Faxén/Brenner anisotropy
 *   C    = (2π σ a⁵/15) J²        eddy-current (motional) damping tensor, J_ij = ∂B_i/∂x_j  (a ≪ skin depth)
 *   F_mag= J·m                   gradient force on the (induced or permanent) moment m
 *   F_dd = Σ_j dipole–dipole force (cut-off 8 a)
 *   F_g  = (ρ_p − ρ_f) V g      gravity + buoyancy (in-plane component)
 *   F_fa = (3/2) ρ_f V Du/Dt    pressure-gradient + added-mass force of the unsteady flow (m_eff includes ½ρ_f V)
 *   F_L  = 6.46 μ a² sgn(γ̇) sqrt(|γ̇|/ν) (u_t − v_t) n̂    Saffman shear lift (optional)
 *   F_ac = (V/2μ0) Re[χ(ω) Σ_j B̂_j ∂_i B̂_j*]   time-averaged eddy force in AC fields, χ(ω) from the exact
 *          conducting-sphere polarizability (Landau & Lifshitz §59)
 *
 * Magnetization m = V M(H_loc), H_loc = B/μ0 + Σ_j H_dip,j (mutual induction, explicit):
 *   linear / soft ferro : M = min(χ_eff H, M_s) Ĥ,   χ_eff = 3(χ_p − χ_f)/(3 + χ_p + 2χ_f)   (sphere demagnetization)
 *   superparamagnetic   : M = M_s L(μ0 M_s V_core H / k_B T)
 *   hard                : |M| = M_r, direction lags the field by the quasi-static angle φ = asin(ω_f/ω_so);
 *                         ω_so = M_r V B /(8π μ a³) (step-out), asynchronous rotation Ω = ω_f − sqrt(ω_f² − ω_so²)
 *
 * Time integration: backward Euler for the velocity with the full drag tensor (exact overdamped limit
 * v = (Γ_d + C)⁻¹(Γ_d u + F) when m_eff/dt → 0), explicit positions, hard-sphere constraints by projection
 * (Heyes–Melrose), collisions with wet restitution e = e_dry exp(−35/St) (Legendre et al. 2006; Joseph et al. 2001),
 * Coulomb stick–slip friction at the wall, optional wall rolling v = α a Ω for spinning hard particles.
 */
(function (global) {
  'use strict';
  const MS = global.MS = global.MS || {};
  const MU0 = MS.CONST.MU0, KB = MS.CONST.KB, G0 = MS.CONST.G;
  const langevin = MS.util.langevin;

  /* Haberman–Sayre centreline wall factor for a sphere in a cylindrical tube */
  function haberman(l) {
    if (l < 0.01) return 1;
    if (l > 0.9) l = 0.9;
    const l3 = l * l * l, l5 = l3 * l * l;
    return (1 - 2.105 * l + 2.0865 * l3 - 1.7068 * l5 + 0.72603 * l5 * l) / (1 - 0.75857 * l5);
  }

  /* complex magnetic polarizability χ(ω) of a conducting sphere (Landau–Lifshitz §59), m = (V χ/μ0) B̂ */
  function chiEddy(a, sigma, omega, out) {
    const delta = Math.sqrt(2 / (MU0 * sigma * omega));
    const q = a / delta;                       // x = (1+i) q
    if (q < 0.02) {                            // low-frequency expansion
      const y = MU0 * sigma * omega * a * a;
      out.re = -(y * y) / 105; out.im = y / 10; return out;
    }
    if (q > 20) { out.re = -1.5 * (1 - 1.5 / q); out.im = 1.5 * 1.5 / q; return out; }  // skin-effect limit cot x → −i
    // cot x with x = q + i q
    const sr = Math.sin(q) * Math.cosh(q), si = Math.cos(q) * Math.sinh(q);
    const cr = Math.cos(q) * Math.cosh(q), ci = -Math.sin(q) * Math.sinh(q);
    const d = sr * sr + si * si;
    const cotr = (cr * sr + ci * si) / d, coti = (ci * sr - cr * si) / d;
    // 1/x = (1 − i)/(2q) ; 1/x² = −i/(2q²)
    const ixr = 1 / (2 * q), ixi = -1 / (2 * q);
    const ix2r = 0, ix2i = -1 / (2 * q * q);
    // f = 1 − 3/x² + 3 cot(x)/x
    const cxr = cotr * ixr - coti * ixi, cxi = cotr * ixi + coti * ixr;
    const fr = 1 - 3 * ix2r + 3 * cxr, fi = -3 * ix2i + 3 * cxi;
    out.re = -1.5 * fr; out.im = -1.5 * fi;
    return out;
  }

  class Dynamics {
    constructor(sim) {
      this.sim = sim;
      this.loc = { idx: 0, s: 0, n: 0 };
      this.fo = { u: 0, dudn: 0, dudt: 0, W: 0, Wx: 0, Wt: 0 };
      this.bj = { bx: 0, by: 0, jxx: 0, jxy: 0, jyy: 0 };
      this.ac = MS.FieldModel.makeACAccumulator(4);
      this.chi = { re: 0, im: 0 };
      this.pairs = new Int32Array(8192); this.npairs = 0;
      this.cellHead = new Int32Array(1); this.cellNext = new Int32Array(1);
      this.stats = { vmax: 0, slipmax: 0, repmax: 0, omegaMax: 0, nContact: 0, nStuck: 0 };
    }

    /* ---------------------------------------------------------------- neighbour list */
    buildPairs(rcut) {
      const sw = this.sim.swarm, N = sw.n;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < N; i++) { const x = sw.x[i], y = sw.y[i]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      const h = rcut;
      const nx = Math.min(96, Math.max(1, Math.ceil((x1 - x0) / h) + 1));
      const ny = Math.min(96, Math.max(1, Math.ceil((y1 - y0) / h) + 1));
      const hx = Math.max(h, (x1 - x0) / nx + 1e-12), hy = Math.max(h, (y1 - y0) / ny + 1e-12);
      const ncell = nx * ny;
      if (this.cellHead.length < ncell) this.cellHead = new Int32Array(ncell);
      if (this.cellNext.length < N) this.cellNext = new Int32Array(Math.max(N, sw.cap));
      this.cellHead.fill(-1, 0, ncell);
      for (let i = 0; i < N; i++) {
        const cx = Math.min(nx - 1, Math.floor((sw.x[i] - x0) / hx)), cy = Math.min(ny - 1, Math.floor((sw.y[i] - y0) / hy));
        const c = cy * nx + cx;
        sw.cell[i] = c; this.cellNext[i] = this.cellHead[c]; this.cellHead[c] = i;
      }
      let np = 0, vrel2max = 0; const r2 = rcut * rcut;
      for (let i = 0; i < N; i++) {
        const c = sw.cell[i], cx = c % nx, cy = (c - cx) / nx;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = cy + dy; if (yy < 0 || yy >= ny) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = cx + dx; if (xx < 0 || xx >= nx) continue;
            let j = this.cellHead[yy * nx + xx];
            while (j >= 0) {
              if (j > i) {
                const ddx = sw.x[i] - sw.x[j], ddy = sw.y[i] - sw.y[j];
                if (ddx * ddx + ddy * ddy < r2) {
                  if (np + 2 > this.pairs.length) { const t = new Int32Array(this.pairs.length * 2); t.set(this.pairs); this.pairs = t; }
                  this.pairs[np++] = i; this.pairs[np++] = j;
                  const sa = 1.05 * (sw.a[i] + sw.a[j]);
                  if (ddx * ddx + ddy * ddy > sa * sa) {   // approach of pairs not yet in contact
                    const dvx = sw.vx[i] - sw.vx[j], dvy = sw.vy[i] - sw.vy[j];
                    const dv2 = dvx * dvx + dvy * dvy; if (dv2 > vrel2max) vrel2max = dv2;
                  }
                }
              }
              j = this.cellNext[j];
            }
          }
        }
      }
      this.npairs = np / 2;
      this.stats.vrelmax = Math.sqrt(vrel2max);
    }

    /* ---------------------------------------------------------------- one sub-step */
    step(dt, t) {
      const sim = this.sim, sw = sim.swarm, N = sw.n;
      if (!N) return;
      const P = sim.P, mat = P.material, fl = sim.flow.params, tube = sim.tube, field = sim.field, flow = sim.flow;
      const rho_f = fl.rho, mu = fl.mu, nu = mu / rho_f, chi_f = fl.chi, T = fl.T;
      const rho_p = mat.rho, sigma = P.eddy ? mat.sigma : 0;
      const model = P.magModel === 'auto' ? mat.model : P.magModel;
      const chiEff = 3 * (mat.chi - chi_f) / (3 + mat.chi + 2 * chi_f);
      const Ms = mat.Ms > 0 ? mat.Ms : Infinity;
      const Vcore = Math.PI / 6 * Math.pow(P.dcore || 12e-9, 3);
      const eDry = P.eDryOverride != null ? P.eDryOverride : mat.eDry;
      const muF = P.muF, loc = this.loc, fo = this.fo, bj = this.bj, ac = this.ac;
      const useAC = P.acEddy && sigma > 0 && field.acFrequencies().length > 0;
      const gx = P.gravity ? G0 * Math.cos(P.gravAngle) : 0, gy = P.gravity ? G0 * Math.sin(P.gravAngle) : 0;
      const stats = this.stats;
      let amax = 0, amin = Infinity;
      for (let i = 0; i < N; i++) { if (sw.a[i] > amax) amax = sw.a[i]; if (sw.a[i] < amin) amin = sw.a[i]; }
      const rcut = (P.dipole || P.mutual) ? P.cutoffFactor * amax : 2.1 * amax;

      /* ---- A: geometry & fluid at particle */
      for (let i = 0; i < N; i++) {
        tube.locate(sw.x[i], sw.y[i], sw.station[i], loc);
        const idx = loc.idx; sw.station[i] = idx; sw.ss[i] = loc.s; sw.nn[i] = loc.n;
        const R = tube.R[idx]; sw.RR[i] = R; sw.Rdot[i] = tube.Rdot[idx];
        flow.axial(loc.n, R, fo);
        const un = (loc.n / R) * tube.Rdot[idx];
        sw.ux[i] = fo.u * tube.tx[idx] + un * tube.nx[idx];
        sw.uy[i] = fo.u * tube.ty[idx] + un * tube.ny[idx];
        sw.dudn[i] = fo.dudn; sw.dudt[i] = fo.dudt;
      }

      /* ---- B: applied field, Jacobian, AC phasor force */
      for (let i = 0; i < N; i++) {
        field.evalBJ(sw.x[i], sw.y[i], t, bj, useAC ? ac : null);
        sw.bx[i] = bj.bx; sw.by[i] = bj.by; sw.jxx[i] = bj.jxx; sw.jxy[i] = bj.jxy; sw.jyy[i] = bj.jyy;
        sw.hx[i] = bj.bx / MU0; sw.hy[i] = bj.by / MU0;
        let fx = 0, fy = 0;
        if (useAC) {
          const a = sw.a[i], V = 4 / 3 * Math.PI * a * a * a;
          for (let k = 0; k < ac.n; k++) {
            const om = 2 * Math.PI * ac.freq[k];
            chiEddy(a, sigma, om, this.chi);
            // S_i = Σ_j B̂_j conj(∂_i B̂_j)
            const bxr = ac.bxr[k], bxi = ac.bxi[k], byr = ac.byr[k], byi = ac.byi[k];
            const Sxr = bxr * ac.jxxr[k] + bxi * ac.jxxi[k] + byr * ac.jxyr[k] + byi * ac.jxyi[k];
            const Sxi = bxi * ac.jxxr[k] - bxr * ac.jxxi[k] + byi * ac.jxyr[k] - byr * ac.jxyi[k];
            const Syr = bxr * ac.jxyr[k] + bxi * ac.jxyi[k] + byr * ac.jyyr[k] + byi * ac.jyyi[k];
            const Syi = bxi * ac.jxyr[k] - bxr * ac.jxyi[k] + byi * ac.jyyr[k] - byr * ac.jyyi[k];
            const pre = V / (2 * MU0);
            fx += pre * (this.chi.re * Sxr - this.chi.im * Sxi);
            fy += pre * (this.chi.re * Syr - this.chi.im * Syi);
          }
        }
        sw.fx[i] = fx; sw.fy[i] = fy;
      }

      /* ---- C: neighbours */
      this.buildPairs(rcut);
      const pairs = this.pairs, np = this.npairs;

      /* ---- D: mutual induction (explicit, previous moments) */
      if (P.mutual && np) {
        const k4 = 1 / (4 * Math.PI);
        for (let p = 0; p < np; p++) {
          const i = pairs[2 * p], j = pairs[2 * p + 1];
          const dx = sw.x[i] - sw.x[j], dy = sw.y[i] - sw.y[j];
          const r2 = dx * dx + dy * dy, r = Math.sqrt(r2), r3 = r2 * r;
          const ux = dx / r, uy = dy / r;
          // field at i from j
          let md = sw.mx[j] * ux + sw.my[j] * uy;
          sw.hx[i] += k4 * (3 * md * ux - sw.mx[j]) / r3; sw.hy[i] += k4 * (3 * md * uy - sw.my[j]) / r3;
          md = sw.mx[i] * ux + sw.my[i] * uy;
          sw.hx[j] += k4 * (3 * md * ux - sw.mx[i]) / r3; sw.hy[j] += k4 * (3 * md * uy - sw.my[i]) / r3;
        }
      }

      /* ---- E: moments */
      stats.omegaMax = 0;
      for (let i = 0; i < N; i++) {
        const a = sw.a[i], V = 4 / 3 * Math.PI * a * a * a;
        const Hx = sw.hx[i], Hy = sw.hy[i], H = Math.hypot(Hx, Hy);
        let Mmag = 0, dirx = 0, diry = 0;
        if (model === 'hard') {
          const B = MU0 * H;
          const thB = Math.atan2(Hy, Hx);
          let omegaF = 0;
          if (sw.hasPrev[i] && B > 1e-9) omegaF = MS.util.wrapAngle(thB - sw.thB[i]) / dt;
          sw.thB[i] = thB; sw.hasPrev[i] = 1;
          if (B > 1e-9) {
            const omegaSO = mat.Mr * V * B / (8 * Math.PI * mu * a * a * a);
            const aw = Math.abs(omegaF);
            let phi, Om;
            if (aw <= omegaSO) { phi = Math.asin(aw / omegaSO); Om = omegaF; }
            else { phi = Math.PI / 2; Om = Math.sign(omegaF) * (aw - Math.sqrt(aw * aw - omegaSO * omegaSO)); }
            sw.thM[i] = thB - Math.sign(omegaF) * phi;
            sw.omega[i] = Om;
          } else sw.omega[i] = 0;
          Mmag = mat.Mr; dirx = Math.cos(sw.thM[i]); diry = Math.sin(sw.thM[i]);
        } else if (H > 0) {
          dirx = Hx / H; diry = Hy / H;
          if (model === 'spm') Mmag = mat.Ms * langevin(MU0 * mat.Ms * Vcore * H / (KB * T));
          else if (model === 'ferro') Mmag = Math.min(chiEff * H, Ms);
          else Mmag = chiEff * H;   // linear para/dia (may be negative)
        }
        sw.mx[i] = V * Mmag * dirx; sw.my[i] = V * Mmag * diry;
        if (Math.abs(sw.omega[i]) > stats.omegaMax) stats.omegaMax = Math.abs(sw.omega[i]);
      }

      /* ---- F1: dipole–dipole forces */
      if (P.dipole && np) {
        const k = 3 * MU0 / (4 * Math.PI);
        for (let p = 0; p < np; p++) {
          const i = pairs[2 * p], j = pairs[2 * p + 1];
          const dx = sw.x[i] - sw.x[j], dy = sw.y[i] - sw.y[j];
          const r2 = dx * dx + dy * dy, r = Math.sqrt(r2);
          const ux = dx / r, uy = dy / r;
          const mix = sw.mx[i], miy = sw.my[i], mjx = sw.mx[j], mjy = sw.my[j];
          const mir = mix * ux + miy * uy, mjr = mjx * ux + mjy * uy, mm = mix * mjx + miy * mjy;
          const c = k / (r2 * r2);
          const fx = c * (mir * mjx + mjr * mix + (mm - 5 * mir * mjr) * ux);
          const fy = c * (mir * mjy + mjr * miy + (mm - 5 * mir * mjr) * uy);
          sw.fx[i] += fx; sw.fy[i] += fy; sw.fx[j] -= fx; sw.fy[j] -= fy;
        }
      }

      /* ---- F2/G/H: remaining forces, drag tensor, implicit velocity update, wall contact */
      let vmax = 0, slipmax = 0, repmax = 0, nContact = 0, nStuck = 0;
      const uRef = Math.abs(flow.meanVelocity(tube.Rref)) + 1e-9;
      const rng = sim.rng;
      for (let i = 0; i < N; i++) {
        const a = sw.a[i], V = 4 / 3 * Math.PI * a * a * a;
        const mp = rho_p * V, meff = mp + (P.addedMass ? 0.5 * rho_f * V : 0);
        const idx = sw.station[i];
        const tx = tube.tx[idx], ty = tube.ty[idx], nx = tube.nx[idx], ny = tube.ny[idx];
        const R = sw.RR[i], n = sw.nn[i];
        const ux = sw.ux[i], uy = sw.uy[i];
        let vx = sw.vx[i], vy = sw.vy[i];
        let fx = sw.fx[i] + sw.jxx[i] * sw.mx[i] + sw.jxy[i] * sw.my[i];
        let fy = sw.fy[i] + sw.jxy[i] * sw.mx[i] + sw.jyy[i] * sw.my[i];
        // gravity & buoyancy
        fx += (rho_p - rho_f) * V * gx; fy += (rho_p - rho_f) * V * gy;
        // unsteady-flow pressure-gradient + added-mass force
        const ffa = (P.addedMass ? 1.5 : 1.0) * rho_f * V * sw.dudt[i];
        fx += ffa * tx; fy += ffa * ty;
        // Saffman lift
        if (P.saffman) {
          const g = sw.dudn[i];
          if (g !== 0) {
            const ut = ux * tx + uy * ty, vt = vx * tx + vy * ty;
            const FL = 6.46 * mu * a * a * Math.sign(g) * Math.sqrt(Math.abs(g) / nu) * (ut - vt);
            fx += FL * nx; fy += FL * ny;
          }
        }
        // drag tensor
        const relx = vx - ux, rely = vy - uy, rel = Math.hypot(relx, rely);
        let g0 = 6 * Math.PI * mu * a * haberman(a / R);
        const Re = rho_f * rel * 2 * a / mu;
        if (P.nonlinearDrag && Re > 1e-3) g0 *= 1 + 0.15 * Math.pow(Math.min(Re, 1000), 0.687);
        sw.gam0[i] = g0;
        let fpar = 1, fperp = 1;
        const h = R - Math.abs(n);                  // centre distance from the nearest wall
        if (P.wallDrag) {
          const q = Math.min(a / Math.max(h, 1.05 * a), 1 / 1.05);
          const q3 = q * q * q;
          fpar = 1 / (1 - 9 / 16 * q + q3 / 8 - 45 / 256 * q3 * q - q3 * q * q / 16);
          fperp = 1 / (1 - 9 / 8 * q + q3 / 2);
        }
        // Γ_d = g0 (fpar t t^T + fperp n n^T)
        let Axx = g0 * (fpar * tx * tx + fperp * nx * nx), Axy = g0 * (fpar * tx * ty + fperp * nx * ny), Ayy = g0 * (fpar * ty * ty + fperp * ny * ny);
        const Gxx = Axx, Gxy = Axy, Gyy = Ayy;
        // eddy damping C = (2πσa^5/15) J²
        if (sigma > 0) {
          const c = 2 * Math.PI * sigma * Math.pow(a, 5) / 15;
          const jxx = sw.jxx[i], jxy = sw.jxy[i], jyy = sw.jyy[i];
          Axx += c * (jxx * jxx + jxy * jxy); Axy += c * (jxx * jxy + jxy * jyy); Ayy += c * (jxy * jxy + jyy * jyy);
        }
        const mi = meff / dt;
        Axx += mi; Ayy += mi;
        const rx = mi * vx + Gxx * ux + Gxy * uy + fx;
        const ry = mi * vy + Gxy * ux + Gyy * uy + fy;
        const det = Axx * Ayy - Axy * Axy;
        vx = (Ayy * rx - Axy * ry) / det; vy = (Axx * ry - Axy * rx) / det;

        // ---- wall contact
        let contact = 0, stick = 0;
        const gap = h - a;
        const sgn = n >= 0 ? 1 : -1;
        const nox = sgn * nx, noy = sgn * ny;          // outward normal towards the nearest wall
        const wn = sw.Rdot[i];                          // wall normal velocity (outward)
        const vn = vx * nox + vy * noy;
        if (gap - (vn - wn) * dt <= 0) {
          contact = 1;
          const vrel = vn - wn;
          let vnNew = vn;
          const St = (rho_p + 0.5 * rho_f) * 2 * a * Math.abs(vrel) / (9 * mu);
          const e = St > 1 ? eDry * Math.exp(-35 / St) : 0;
          if (vrel > 0) vnNew = (e > 0.02 && gap > -0.05 * a) ? wn - e * vrel : wn;
          const Ann = Axx * nox * nox + 2 * Axy * nox * noy + Ayy * noy * noy;
          const lamN = Math.max(0, Ann * (vn - vnNew));          // normal reaction force
          let vt = vx * tx + vy * ty;
          if (!(e > 0.02 && vrel > 0)) {                            // sustained (inelastic) contact: Coulomb friction
            const Att = Axx * tx * tx + 2 * Axy * tx * ty + Ayy * ty * ty;
            const fric = muF * lamN;
            if (Math.abs(vt) * Att <= fric) { vt = 0; stick = 1; }
            else vt -= Math.sign(vt) * fric / Att;
            // rolling of a spinning (hard) particle on the wall
            if (sw.omega[i] !== 0 && P.rollAlpha > 0) {
              // rolling direction = ẑ × n̂_in = −ẑ × n̂_out → (noy, −nox); v_c = −a Ω (ẑ × n̂_out)
              vt += P.rollAlpha * a * sw.omega[i] * (tx * noy - ty * nox);
            }
          }
          vx = vt * tx + vnNew * nox; vy = vt * ty + vnNew * noy;
          nContact++;
        }
        sw.contact[i] = contact; sw.stick[i] = stick;
        // Brownian displacement
        let bxd = 0, byd = 0;
        if (P.brownian) {
          const D = KB * T / g0;
          const sdev = Math.sqrt(2 * D * dt);
          bxd = sdev * rng.gauss(); byd = sdev * rng.gauss();
        }
        sw.vx[i] = vx; sw.vy[i] = vy;
        sw.x[i] += vx * dt + bxd; sw.y[i] += vy * dt + byd;
        // keep out of the wall (projection in the local frame)
        if (contact) {
          const dxp = sw.x[i] - tube.sx[idx], dyp = sw.y[i] - tube.sy[idx];
          const nn2 = dxp * nx + dyp * ny;
          const lim = Math.max(R - a, 0);
          if (Math.abs(nn2) > lim) { const corr = (Math.abs(nn2) - lim) * (nn2 >= 0 ? -1 : 1); sw.x[i] += corr * nx; sw.y[i] += corr * ny; }
        }
        if (Re > repmax) repmax = Re;
        sw.tAge[i] += dt;
      }

      /* ---- I: particle–particle contacts (hard spheres, wet restitution, mobility-weighted) */
      let nPairContact = 0;
      if (np) {
        for (let pass = 0; pass < 2; pass++) {
          for (let p = 0; p < np; p++) {
            const i = pairs[2 * p], j = pairs[2 * p + 1];
            const dx = sw.x[i] - sw.x[j], dy = sw.y[i] - sw.y[j];
            const d2 = dx * dx + dy * dy, ai = sw.a[i], aj = sw.a[j], sumA = ai + aj;
            if (d2 >= sumA * sumA || d2 === 0) continue;
            if (pass === 0) nPairContact++;
            const d = Math.sqrt(d2), ux = dx / d, uy = dy / d, ov = sumA - d;
            const mi = rho_p * 4 / 3 * Math.PI * ai * ai * ai + (P.addedMass ? 0.5 * rho_f * 4 / 3 * Math.PI * ai * ai * ai : 0);
            const mj = rho_p * 4 / 3 * Math.PI * aj * aj * aj + (P.addedMass ? 0.5 * rho_f * 4 / 3 * Math.PI * aj * aj * aj : 0);
            const wi = 1 / (mi / dt + sw.gam0[i]), wj = 1 / (mj / dt + sw.gam0[j]), ws = wi + wj;
            sw.x[i] += ux * ov * wi / ws; sw.y[i] += uy * ov * wi / ws;
            sw.x[j] -= ux * ov * wj / ws; sw.y[j] -= uy * ov * wj / ws;
            const vrn = (sw.vx[i] - sw.vx[j]) * ux + (sw.vy[i] - sw.vy[j]) * uy;
            if (vrn < 0) {
              const deff = 2 * ai * aj / sumA;
              const St = (rho_p + 0.5 * rho_f) * deff * Math.abs(vrn) / (9 * mu);
              const e = St > 1 ? eDry * Math.exp(-35 / St) : 0;
              const dv = -(1 + e) * vrn;
              sw.vx[i] += ux * dv * wi / ws; sw.vy[i] += uy * dv * wi / ws;
              sw.vx[j] -= ux * dv * wj / ws; sw.vy[j] -= uy * dv * wj / ws;
            }
          }
        }
      }
      /* ---- J: speed statistics and retention bookkeeping (after constraints) */
      for (let i = 0; i < N; i++) {
        const vx = sw.vx[i], vy = sw.vy[i];
        const sp = Math.hypot(vx, vy); if (sp > vmax) vmax = sp;
        const slip = Math.hypot(vx - sw.ux[i], vy - sw.uy[i]); sw.slip[i] = slip; if (slip > slipmax) slipmax = slip;
        if (sw.contact[i] && sp < 0.05 * uRef) sw.tStuck[i] += dt; else sw.tStuck[i] = 0;
        sw.st[i] = sw.tStuck[i] > P.stickTime ? 1 : 0;
        if (sw.st[i]) nStuck++;
      }
      stats.vmax = vmax; stats.slipmax = slipmax; stats.repmax = repmax; stats.nContact = nContact; stats.nStuck = nStuck;
      stats.nPairContact = nPairContact;
      stats.amin = amin; stats.amax = amax;
    }
  }

  Dynamics.haberman = haberman;
  Dynamics.chiEddy = chiEddy;
  MS.Dynamics = Dynamics;
})(typeof window !== 'undefined' ? window : globalThis);
