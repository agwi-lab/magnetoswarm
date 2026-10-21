#!/usr/bin/env node
/* Validation of the particle dynamics against analytic limits.
 *   node validation/validate_dynamics.js
 */
const { load } = require('./_load');
const MS = load();
const MU0 = MS.CONST.MU0, G = MS.CONST.G;
const results = [];
function check(name, err, tol) { const ok = err <= tol; results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(74)} err = ${err.toExponential(2)} (tol ${tol.toExponential(0)})`); }
const relErr = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);

function makeSim(opts) {
  const sim = new MS.Simulation();
  sim.load({
    sources: opts.sources || [],
    tube: Object.assign({ points: [[-0.05, 0], [0.05, 0]], Rin: 0.005, Rout: 0.005, h0: 0.001, elastic: false }, opts.tube || {}),
    fluidKey: 'water', flow: Object.assign({ Qmean: 0, waveform: 'steady' }, opts.flow || {}),
    P: Object.assign({ materialKey: 'iron', radius: 5e-6, polydispersity: 0, dipole: false, mutual: false, brownian: false, gravity: false, eddy: false, wallDrag: false, nonlinearDrag: false, addedMass: false }, opts.P || {}),
    inj: { mode: 'bolus', count: 0 }, elastic: { pOut: 0, pAmp: 0, lag: 0 },
  });
  return sim;
}
function place(sim, x, y, a) { const i = sim.swarm.add(x, y, a, 0); sim.swarm.station[i] = sim.tube.stationOf(x + 0.05); return i; }

/* 1. Stokes settling, overdamped (5 µm iron, water) */
{
  const sim = makeSim({ P: { gravity: true, gravAngle: -Math.PI / 2 } });
  const a = 5e-6; place(sim, 0, 0.002, a);
  for (let k = 0; k < 200; k++) sim.substep(1e-4);
  const sw = sim.swarm, fl = sim.flow.params, mat = sim.P.material;
  const vs = 2 * (mat.rho - fl.rho) * G * a * a / (9 * fl.mu);
  check('Stokes settling velocity (overdamped, 5 µm Fe in water)', relErr(-sw.vy[0], vs), 1e-9);
}
/* 2. Settling with inertia: relaxation v(t) = v_s (1 − e^{−t/τ}); backward Euler → first order, test at coarse dt */
{
  const sim = makeSim({ P: { materialKey: 'steel430', radius: 0.5e-3, gravity: true, gravAngle: -Math.PI / 2 } });
  sim.tube.setParams({ Rin: 0.3, Rout: 0.3 });
  const a = 0.5e-3; place(sim, 0, 0.0, a);
  const fl = sim.flow.params, mat = sim.P.material;
  const V = 4 / 3 * Math.PI * a ** 3, m = mat.rho * V, gam = 6 * Math.PI * fl.mu * a * MS.Dynamics.haberman(a / 0.3), tau = m / gam;
  const vs = (mat.rho - fl.rho) * V * G / gam;
  const dt = tau / 400; let t = 0;
  for (let k = 0; k < 200; k++) { sim.substep(dt); t += dt; }
  const vexp = vs * (1 - Math.exp(-t / tau));
  check('Inertial relaxation towards terminal velocity (τ = 0.43 s, dt = τ/400, implicit Euler)', relErr(-sim.swarm.vy[0], vexp), 5e-3);
}
/* 3. Magnetophoresis in an ideal gradient: v = (J·m)/γ with m = V min(3H, Ms) */
{
  const B0 = 0.2, Gxx = 10;   // T, T/m along x
  const sim = makeSim({ sources: [{ type: 'linear', x: 0, y: 0, angle: 0, B0, Gxx, Gxy: 0, Gyy: -5 }] });
  const a = 5e-6; place(sim, 0.01, 0.001, a);
  for (let k = 0; k < 300; k++) sim.substep(1e-4);      // 30 ms ≫ τ_p = 44 µs
  const sw = sim.swarm, fl = sim.flow.params, mat = sim.P.material;
  const V = 4 / 3 * Math.PI * a ** 3, gam = sw.gam0[0];
  const Bx = sw.bx[0], By = sw.by[0];
  const H = Math.hypot(Bx, By) / MU0;
  const chiEff = 3 * (mat.chi - fl.chi) / (3 + mat.chi + 2 * fl.chi);
  const M = Math.min(chiEff * H, mat.Ms);
  const mx = V * M * Bx / (MU0 * H), my = V * M * By / (MU0 * H);
  check('Induced moment m = V min(χ_eff H, M_s) Ĥ, χ_eff = 3Δχ/(3+χ_p+2χ_f)', Math.hypot(sw.mx[0] - mx, sw.my[0] - my) / Math.hypot(mx, my), 1e-9);
  const Fx = Gxx * mx + 0 * my, Fy = 0 * mx - 5 * my;
  check('Magnetophoretic velocity = (J·m)/γ (overdamped steady state; force lags one step)', Math.hypot(sw.vx[0] - Fx / gam, sw.vy[0] - Fy / gam) / Math.hypot(Fx / gam, Fy / gam), 2e-4);
}
/* 4. Eddy polarizability: low-frequency expansion and perfect-conductor limit */
{
  const o = {};
  const a = 1e-3, sigma = 3.5e7;
  MS.Dynamics.chiEddy(a, sigma, 2 * Math.PI * 2, o);         // q = a/δ ≈ 0.05
  const y = MU0 * sigma * 2 * Math.PI * 2 * a * a;
  check('χ(ω) low-frequency: Im = μ0σωa²/10, Re = −(μ0σωa²)²/105', Math.max(relErr(o.im, y / 10), relErr(o.re, -(y * y) / 105)), 2e-2);
  MS.Dynamics.chiEddy(a, sigma, 2 * Math.PI * 1e9, o);
  check('χ(ω) skin-effect limit → −3/2 (perfect diamagnet, a/δ ≈ 370)', relErr(o.re, -1.5), 1e-2);
  // continuity between branches
  const q1 = {}, q2 = {}; MS.Dynamics.chiEddy(a, sigma, 2 * Math.PI * 1.95, q1); MS.Dynamics.chiEddy(a, sigma, 2 * Math.PI * 2.05, q2);
  check('χ(ω) continuity across the expansion switch', Math.abs(q1.im - q2.im) / q2.im, 0.06);
}
/* 5. Dipole pair: head-to-tail attraction in a uniform field, F = 6 μ0 m²/(4π r⁴) */
{
  const B0 = 0.01;
  const sim = makeSim({ sources: [{ type: 'linear', x: 0, y: 0, angle: 0, B0, Gxx: 0, Gxy: 0, Gyy: 0 }], P: { dipole: true, mutual: false } });
  const a = 5e-6, r = 4 * a;
  place(sim, -r / 2, 0, a); place(sim, r / 2, 0, a);
  const dt = 1e-7; sim.substep(dt);
  const fl = sim.flow.params, mat = sim.P.material;
  const V = 4 / 3 * Math.PI * a ** 3, mp = mat.rho * V, gam = sim.swarm.gam0[0];
  const H = B0 / MU0, chiEff = 3 * (mat.chi - fl.chi) / (3 + mat.chi + 2 * fl.chi), m = V * Math.min(chiEff * H, mat.Ms);
  const F = 6 * MU0 * m * m / (4 * Math.PI * r ** 4);
  // implicit Euler from rest: v = F / (m_p/dt + γ)
  check('Dipole–dipole head-to-tail attraction 6μ0m²/(4πr⁴)', relErr(sim.swarm.vx[1] * (mp / dt + gam), -F), 1e-4);
  const sim2 = makeSim({ sources: [{ type: 'linear', x: 0, y: 0, angle: 0, B0, Gxx: 0, Gxy: 0, Gyy: 0 }], P: { dipole: true, mutual: false } });
  place(sim2, 0, -r / 2, a); place(sim2, 0, r / 2, a);
  sim2.substep(dt);
  const F2 = 3 * MU0 * m * m / (4 * Math.PI * r ** 4);
  check('Dipole–dipole side-by-side repulsion 3μ0m²/(4πr⁴)', relErr(sim2.swarm.vy[1] * (mp / dt + sim2.swarm.gam0[1]), F2), 1e-4);
  // mutual induction: field of j at i adds (1/4π)(2m/r³) head-to-tail
  const sim3 = makeSim({ sources: [{ type: 'linear', x: 0, y: 0, angle: 0, B0, Gxx: 0, Gxy: 0, Gyy: 0 }], P: { dipole: true, mutual: true } });
  place(sim3, -r / 2, 0, a); place(sim3, r / 2, 0, a);
  sim3.substep(dt); sim3.substep(dt);   // second step uses the moments of the first
  const Hexp = H + m / (4 * Math.PI * r ** 3) * 2;
  check('Mutual induction: H_loc = H + 2m/(4πr³) for a head-to-tail pair', relErr(sim3.swarm.hx[0], Hexp), 1e-6);
}
/* 6. Haberman–Sayre factor */
check('Haberman–Sayre K(0.1) = 0.7916 (wall factor 1.263)', relErr(MS.Dynamics.haberman(0.1), 0.79162), 2e-4);
/* 7. Wall friction: stick below μF_N, slide above (overdamped) */
{
  const mu = 0.3;
  // particle pressed to the lower wall by gravity, tangential force from a linear gradient on a saturated particle
  const mk = (Gxx) => {
    const sim = makeSim({ sources: [{ type: 'linear', x: 0, y: 0, angle: 0, B0: 1.0, Gxx, Gxy: 0, Gyy: 0 }], P: { gravity: true, gravAngle: -Math.PI / 2, muF: mu } });
    const a = 5e-6; place(sim, 0, -0.005 + a, a);
    for (let k = 0; k < 200; k++) sim.substep(1e-4);
    return sim;
  };
  const a = 5e-6, V = 4 / 3 * Math.PI * a ** 3;
  const s1 = mk(1e-3); const fl = s1.flow.params, mat = s1.P.material;
  const FN = (mat.rho - fl.rho) * V * G, m = V * mat.Ms;
  const Ft = 1e-3 * m;        // tangential force (saturated, field along x → F_x = Gxx m)
  check('Wall Coulomb friction: stick when F_t < μ F_N', Math.abs(s1.swarm.vx[0]) > 0 ? 1 : 0, 0.5);
  const Gslide = 3 * mu * FN / m;
  const s2 = mk(Gslide);
  const gam = s2.swarm.gam0[0];
  check('Wall Coulomb friction: slide velocity (F_t − μF_N)/γ when F_t > μF_N', relErr(s2.swarm.vx[0], (Gslide * m - mu * FN) / gam), 1e-5);
  void Ft;
}
/* 8. Wet restitution at the wall: steel ball falling in water, e = e_dry exp(−35/St) */
{
  const sim = makeSim({ P: { materialKey: 'steel430', radius: 2e-3, gravity: true, gravAngle: -Math.PI / 2, eDryOverride: 0.9 } });
  sim.tube.setParams({ Rin: 0.01, Rout: 0.01 });
  sim.P.radius = 2e-3;
  const a = 2e-3; place(sim, 0, 0, a);
  sim.swarm.vy[0] = -1.0;   // 1 m/s impact
  let vIn = 0, vOut = 0, bounced = false;
  for (let k = 0; k < 400; k++) {
    const vb = sim.swarm.vy[0];
    sim.substep(2e-5);
    if (!bounced && sim.swarm.contact[0]) { vIn = vb; bounced = true; vOut = sim.swarm.vy[0]; break; }
  }
  const fl = sim.flow.params, mat = sim.P.material;
  const St = (mat.rho + 0.5 * fl.rho) * 2 * a * Math.abs(vIn) / (9 * fl.mu);
  const e = 0.9 * Math.exp(-35 / St);
  check(`Wet restitution at wall: e = 0.9 exp(−35/St), St = ${St.toExponential(2)}`, relErr(vOut / (-vIn), e), 5e-3);
}

const nfail = results.filter(r => !r).length;
console.log(`\n${results.length - nfail}/${results.length} checks passed`);
if (require.main === module) process.exit(nfail ? 1 : 0);
