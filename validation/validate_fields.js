#!/usr/bin/env node
/* Validation of the magnetic-field library against independent numerical references.
 *   node validation/validate_fields.js
 * Checks:
 *  1. Bulirsch cel vs. direct quadrature of its defining integral.
 *  2. Current loop (cel form) vs. Biot–Savart line quadrature and vs. the classical K/E expression.
 *  3. Ideal solenoid / cylinder magnet (Derby–Olbert) vs. stacked-loop quadrature, on-axis formula, dipole far field.
 *  4. Cuboid magnet vs. magnetic surface-charge quadrature, far-field dipole limit, Gauss/Ampère consistency.
 *  5. Superposition sanity: Helmholtz pair uniformity, Maxwell pair linear gradient.
 */
const { load } = require('./_load');
const MS = load();
const MU0 = MS.CONST.MU0;
const S = MS.sources;
const results = [];
function check(name, err, tol) {
  const ok = err <= tol;
  results.push({ name, err, tol, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(70)} max rel err = ${err.toExponential(2)} (tol ${tol.toExponential(0)})`);
}
const relErr = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);

/* 1 ---------------------------------------------------------------- cel */
{
  const cel = MS.special.cel;
  function celQ(kc, p, c, s) {
    const n = 400000; let sum = 0;
    for (let i = 0; i < n; i++) { const ph = (i + 0.5) / n * Math.PI / 2; const c2 = Math.cos(ph) ** 2, s2 = Math.sin(ph) ** 2; sum += (c * c2 + s * s2) / ((c2 + p * s2) * Math.sqrt(c2 + kc * kc * s2)); }
    return sum * Math.PI / 2 / n;
  }
  let e = 0;
  for (const [kc, p, c, s] of [[0.3, 1, 1, -1], [0.7, 0.25, 1, 0.5], [0.05, 0.04, 1, 0.2], [0.9, 2.5, -1, 1], [0.5, 1, 1, 0.25], [0.999, 0.9, 1, 0.95]]) e = Math.max(e, relErr(cel(kc, p, c, s), celQ(kc, p, c, s)));
  check('cel(kc,p,c,s) vs midpoint quadrature of definition', e, 1e-9);
  const K05 = 1.6857503548125960, E05 = 1.4674622093394272;
  check('K(0.5), E(0.5) vs tabulated', Math.max(relErr(MS.special.ellipK(0.5), K05), relErr(MS.special.ellipE(0.5), E05)), 1e-13);
}

/* 2 ---------------------------------------------------------------- loop */
function biotSavartLoop(a, I, X, Y, nseg) {
  // loop centred at origin, axis = X, lies in the plane X=0 (y,z circle of radius a); field point (X, Y, 0)
  nseg = nseg || 20000;
  let Bx = 0, By = 0, Bz = 0;
  for (let i = 0; i < nseg; i++) {
    const ph = (i + 0.5) / nseg * 2 * Math.PI;
    const py = a * Math.cos(ph), pz = a * Math.sin(ph);
    const dl = 2 * Math.PI * a / nseg;
    // tangent direction (0, -sin, cos)
    const tx = 0, ty = -Math.sin(ph), tz = Math.cos(ph);
    const rx = X - 0, ry = Y - py, rz = 0 - pz;
    const r = Math.sqrt(rx * rx + ry * ry + rz * rz), r3 = r * r * r;
    // dl × r
    Bx += (ty * rz - tz * ry) / r3 * dl;
    By += (tz * rx - tx * rz) / r3 * dl;
    Bz += (tx * ry - ty * rx) / r3 * dl;
  }
  const f = MU0 * I / (4 * Math.PI);
  return { x: Bx * f, y: By * f, z: Bz * f };
}
{
  const a = 0.02, I = 7;
  const out = { x: 0, y: 0 };
  let e = 0, eKE = 0;
  const pts = [[0.005, 0.003], [0.0, 0.01], [0.03, 0.025], [-0.012, 0.0199], [0.001, 0.0201], [0.05, -0.04], [0, 0]];
  for (const [X, Y] of pts) {
    S.loopUnit(X, Y, a, out);
    const bx = out.x * MU0 * I / Math.PI, by = out.y * MU0 * I / Math.PI;
    const ref = biotSavartLoop(a, I, X, Y);
    const scale = Math.hypot(ref.x, ref.y);
    e = Math.max(e, Math.hypot(bx - ref.x, by - ref.y) / scale);
    // classical K/E expression
    const rho = Math.abs(Y), z = X;
    const k2 = 4 * a * rho / ((a + rho) ** 2 + z * z), k = Math.sqrt(k2);
    const K = MS.special.ellipK(k), E = MS.special.ellipE(k);
    const pre = MU0 * I / (2 * Math.PI) / Math.sqrt((a + rho) ** 2 + z * z);
    const Bz = pre * (K + (a * a - rho * rho - z * z) / ((a - rho) ** 2 + z * z) * E);
    const Brho = rho > 1e-12 ? pre * z / rho * (-K + (a * a + rho * rho + z * z) / ((a - rho) ** 2 + z * z) * E) : 0;
    eKE = Math.max(eKE, Math.hypot(bx - Bz, by - (Y >= 0 ? Brho : -Brho)) / scale);
  }
  check('Current loop (cel form) vs Biot–Savart line quadrature', e, 1e-6);
  check('Current loop (cel form) vs classical K/E expression', eKE, 1e-10);
}

/* 3 ---------------------------------------------------------------- solenoid / cylinder */
{
  const a = 0.015, L = 0.04, b = L / 2, nI = 1e5; // turns per metre × current
  const out = { x: 0, y: 0 }, o2 = { x: 0, y: 0 };
  const B0 = MU0 * nI / Math.PI;
  // stacked-loop Gauss–Legendre-free reference: fine midpoint stack of loops (K/E form)
  function stack(X, Y, nl) {
    let bx = 0, by = 0;
    for (let i = 0; i < nl; i++) {
      const zc = -b + (i + 0.5) / nl * L;
      S.loopUnit(X - zc, Y, a, o2);
      const dI = nI * L / nl;
      bx += o2.x * MU0 * dI / Math.PI; by += o2.y * MU0 * dI / Math.PI;
    }
    return { x: bx, y: by };
  }
  let e = 0;
  for (const [X, Y] of [[0, 0.005], [0.01, 0.01], [0.03, 0.02], [0.019, 0.016], [-0.05, 0.03], [0.0, 0.0149], [0.025, 0.0]]) {
    S.solenoidUnit(X, Y, a, b, out);
    const bx = out.x * B0, by = out.y * B0;
    const ref = stack(X, Y, 20000);
    e = Math.max(e, Math.hypot(bx - ref.x, by - ref.y) / Math.hypot(ref.x, ref.y));
  }
  check('Ideal solenoid (Derby–Olbert) vs 20 000 stacked loops', e, 1e-6);
  // on-axis closed form
  let eax = 0;
  for (const z of [0, 0.01, 0.02, 0.03, 0.1]) {
    S.solenoidUnit(z, 0, a, b, out);
    const ref = MU0 * nI / 2 * ((z + b) / Math.sqrt((z + b) ** 2 + a * a) - (z - b) / Math.sqrt((z - b) ** 2 + a * a));
    eax = Math.max(eax, relErr(out.x * B0, ref));
  }
  check('Ideal solenoid on-axis vs elementary formula', eax, 1e-11);
  // far field dipole: μ = nI·L·πa²
  const mu = nI * L * Math.PI * a * a;
  let efar = 0;
  for (const [X, Y] of [[0.5, 0.2], [0.1, 0.6], [-0.4, -0.3]]) {
    S.solenoidUnit(X, Y, a, b, out);
    const r = Math.hypot(X, Y), r5 = r ** 5;
    const Bz = MU0 * mu / (4 * Math.PI) * (2 * X * X - Y * Y) / r5;
    const Br = MU0 * mu / (4 * Math.PI) * 3 * Math.abs(Y) * X / r5;
    efar = Math.max(efar, Math.hypot(out.x * B0 - Bz, out.y * B0 - (Y >= 0 ? Br : -Br)) / Math.hypot(Bz, Br));
  }
  check('Ideal solenoid far field → point dipole (|r| ≈ 15–30 sizes)', efar, 3e-3);
}

/* 4 ---------------------------------------------------------------- cuboid */
function cuboidChargeQuad(X, Y, hx, hy, hz, n) {
  // M = 1 along x; charge ±1 on faces x=±hx; H = (1/4π) Σ σ ∫∫ (r - r')/|r - r'|^3 dS'
  n = n || 400; let Hx = 0, Hy = 0;
  for (let f = -1; f <= 1; f += 2) {
    const xf = f * hx;
    for (let i = 0; i < n; i++) {
      const yp = -hy + (i + 0.5) / n * 2 * hy;
      for (let j = 0; j < n; j++) {
        const zp = -hz + (j + 0.5) / n * 2 * hz;
        const rx = X - xf, ry = Y - yp, rz = -zp;
        const r = Math.sqrt(rx * rx + ry * ry + rz * rz), r3 = r * r * r;
        Hx += f * rx / r3; Hy += f * ry / r3;
      }
    }
  }
  const dS = (2 * hy / n) * (2 * hz / n) / (4 * Math.PI);
  return { x: Hx * dS, y: Hy * dS };
}
{
  const hx = 0.005, hy = 0.007, hz = 0.004;
  const out = { x: 0, y: 0 };
  let e = 0;
  for (const [X, Y] of [[0.012, 0.003], [0.0, 0.015], [0.02, 0.02], [-0.008, 0.001], [0.0051, 0.0], [0.006, 0.0071]]) {
    S.cuboidUnit(X, Y, hx, hy, hz, out);
    const ref = cuboidChargeQuad(X, Y, hx, hy, hz, 600);
    e = Math.max(e, Math.hypot(out.x - ref.x, out.y - ref.y) / Math.hypot(ref.x, ref.y));
  }
  check('Cuboid magnet vs surface-charge quadrature (600² per face)', e, 2e-4);
  // far field dipole
  const V = 8 * hx * hy * hz; let efar = 0;
  for (const [X, Y] of [[0.4, 0.1], [0.05, 0.5], [-0.3, -0.3]]) {
    S.cuboidUnit(X, Y, hx, hy, hz, out);
    const r = Math.hypot(X, Y), r5 = r ** 5;
    const Hx = V / (4 * Math.PI) * (2 * X * X - Y * Y) / r5, Hy = V / (4 * Math.PI) * 3 * X * Y / r5;
    efar = Math.max(efar, Math.hypot(out.x - Hx, out.y - Hy) / Math.hypot(Hx, Hy));
  }
  check('Cuboid far field → point dipole', efar, 3e-3);
  // field just outside pole face: H_n jumps by σ = M; inside H_n ≈ -N M; check B_n continuity
  S.cuboidUnit(hx - 1e-7, 0, hx, hy, hz, out); const bin = out.x;     // includes +M inside
  S.cuboidUnit(hx + 1e-7, 0, hx, hy, hz, out); const bout = out.x;
  check('Cuboid: normal B continuous across pole face', relErr(bin, bout), 1e-4);
  // curl-free & divergence check via finite differences (outside), including Bz-free midplane → ∂xBy = ∂yBx
  {
    const h = 1e-6, X = 0.011, Y = 0.004;
    const o = { x: 0, y: 0 };
    S.cuboidUnit(X + h, Y, hx, hy, hz, o); const bxp = o.x, byp = o.y;
    S.cuboidUnit(X - h, Y, hx, hy, hz, o); const bxm = o.x, bym = o.y;
    S.cuboidUnit(X, Y + h, hx, hy, hz, o); const bxyp = o.x;
    S.cuboidUnit(X, Y - h, hx, hy, hz, o); const bxym = o.x;
    const dByDx = (byp - bym) / (2 * h), dBxDy = (bxyp - bxym) / (2 * h);
    check('Cuboid: ∇×B = 0 in plane (∂xBy = ∂yBx)', Math.abs(dByDx - dBxDy) / Math.abs(dBxDy), 1e-5);
  }
}

/* 5 ---------------------------------------------------------------- superposition sanity */
{
  const R = 0.05, NI = 1000;
  const c1 = S.create('coil', { x: -R / 2, y: 0, R, L: 0, N: 1, I: NI });
  const c2 = S.create('coil', { x: +R / 2, y: 0, R, L: 0, N: 1, I: NI });
  const o = { x: 0, y: 0 };
  const Bc = (8 / (5 * Math.sqrt(5))) * MU0 * NI / R;
  S.evalB(c1, 0, 0, 0, o); S.evalB(c2, 0, 0, 0, o, true);
  check('Helmholtz pair centre field = (4/5)^{3/2} μ0 N I / R', relErr(o.x, Bc), 1e-10);
  S.evalB(c1, 0.1 * R, 0.1 * R, 0, o); S.evalB(c2, 0.1 * R, 0.1 * R, 0, o, true);
  check('Helmholtz pair uniformity at 0.1 R off-centre (< 0.1 % by design)', relErr(o.x, Bc), 1e-3);
  // Maxwell (anti-Helmholtz) pair gradient at centre: G = (48/25) sqrt(3/5) μ0 N I / R²  (coils at ±R/2 with opposite currents)
  c2.I = -NI;
  const h = 1e-5;
  S.evalB(c1, h, 0, 0, o); S.evalB(c2, h, 0, 0, o, true); const bp = o.x;
  S.evalB(c1, -h, 0, 0, o); S.evalB(c2, -h, 0, 0, o, true); const bm = o.x;
  // NB: the uploaded report quotes (48/25)√(3/5); the correct coefficient for d = R is (3/2)(4/5)^{5/2} = 48/(25√5) ≈ 0.8587
  const G = (48 / (25 * Math.sqrt(5))) * MU0 * NI / (R * R);
  check('Anti-Helmholtz (d = R) axial gradient = 48/(25√5) μ0 N I / R²', relErr(Math.abs((bp - bm) / (2 * h)), G), 1e-6);
}

const nfail = results.filter(r => !r.ok).length;
console.log(`\n${results.length - nfail}/${results.length} checks passed`);
module.exports = results;
if (require.main === module) process.exit(nfail ? 1 : 0);
