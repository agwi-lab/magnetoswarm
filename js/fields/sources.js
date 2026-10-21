/* MagnetoSwarm — magnetic field sources.
 *
 * All sources are evaluated exactly (no dipole approximation unless the source *is* a dipole)
 * in the simulation plane, which is
 *   - the mid-plane (z = 0) of a cuboid magnet whose magnetization lies in the plane,
 *   - a plane containing the symmetry axis of a cylindrical magnet, solenoid or loop.
 * Local frame: the source sits at the origin with its magnetization / axis along +X.
 * World frame: local frame translated to (x, y) and rotated by `angle` (counter-clockwise).
 * Superposition of several sources is exact in non-magnetic media (tissue, water, polymers).
 *
 * Units: SI everywhere (m, T, A, A/m).
 *
 * References
 *   cuboid  : scalar-potential / magnetic-charge solution (e.g. Engel-Herbert & Hesjedal, JAP 97, 074504 (2005));
 *             H_n = (σ/4π) Σ ±atan(YZ/(XR)) [solid angle], H_t = -(σ/4π) Σ ±ln(Z+R).
 *   cylinder, solenoid, loop : Derby & Olbert, Am. J. Phys. 78, 229 (2010) — closed forms with
 *             Bulirsch's generalized complete elliptic integral C(kc, p, c, s).
 */
(function (global) {
  'use strict';
  const MS = global.MS = global.MS || {};
  const MU0 = MS.CONST.MU0;
  const cel = MS.special.cel;
  const S = MS.sources = {};

  let nextId = 1;

  S.TYPES = {
    cuboid:   { label: 'Block magnet (cuboid)',       icon: '▭' },
    cylinder: { label: 'Cylinder magnet',             icon: '⬭' },
    coil:     { label: 'Coil / solenoid',             icon: '◎' },
    dipole:   { label: 'Point dipole',                icon: '→' },
    linear:   { label: 'Ideal field + gradient',      icon: '∇' },
  };

  /* ------------------------------------------------------------------ creation */
  S.create = function (type, opts) {
    const src = {
      id: nextId++,
      type,
      label: '',
      x: 0, y: 0,            // centre [m]
      angle: 0,              // orientation of magnetization / axis [rad]
      enabled: true,
      locked: false,
      drive: { mode: 'dc', amp: 1, freq: 2, phase: 0 },  // amp multiplies nominal strength; ac: amp·cos(2πft+phase)
      spin: 0,               // mechanical rotation rate [rad/s] (magnets); angle(t) = angle + spin·t
    };
    switch (type) {
      case 'cuboid':   Object.assign(src, { Lx: 0.010, Ly: 0.010, Lz: 0.010, Br: 1.30 }); break;
      case 'cylinder': Object.assign(src, { R: 0.005, L: 0.010, Br: 1.30 }); break;
      case 'coil':     Object.assign(src, { R: 0.020, L: 0.010, N: 200, I: 5 }); break;
      case 'dipole':   Object.assign(src, { m: 1.0, rcore: 0.002 }); break;
      case 'linear':   Object.assign(src, { B0: 0.05, Gxx: 0, Gxy: 0, Gyy: 0 }); break;
      default: throw new Error('unknown source type ' + type);
    }
    if (opts) {
      if (opts.drive) { Object.assign(src.drive, opts.drive); delete opts.drive; }
      Object.assign(src, opts);
    }
    if (!src.label) src.label = S.TYPES[type].label;
    return src;
  };

  S.clone = function (src) {
    const c = JSON.parse(JSON.stringify(src));
    c.id = nextId++;
    return c;
  };

  /* characteristic size, used for finite-difference steps and rendering */
  S.size = function (src) {
    switch (src.type) {
      case 'cuboid': return Math.max(src.Lx, src.Ly, src.Lz);
      case 'cylinder': return Math.max(2 * src.R, src.L);
      case 'coil': return Math.max(2 * src.R, src.L);
      case 'dipole': return Math.max(src.rcore, 1e-3);
      case 'linear': return 0.01;
    }
    return 0.01;
  };

  /* nominal field scale (T) multiplying the dimensionless unit field */
  S.nominal = function (src) {
    switch (src.type) {
      case 'cuboid': return src.Br;                       // B = Br · Ĥ(shape)
      case 'cylinder': return src.Br / Math.PI;           // B0 = μ0 M / π, M = Br/μ0
      case 'coil': {
        if (src.L > 1e-3 * src.R) return MU0 * (src.N / src.L) * src.I / Math.PI;   // B0 = μ0 n I / π
        return MU0 * src.N * src.I / Math.PI;                                       // loop: (μ0/π) I_total
      }
      case 'dipole': return MU0 * src.m / (4 * Math.PI);
      case 'linear': return 1;
    }
    return 0;
  };

  /* time factor of the drive */
  S.driveFactor = function (src, t) {
    const d = src.drive;
    if (!d || d.mode === 'dc') return d ? d.amp : 1;
    return d.amp * Math.cos(2 * Math.PI * d.freq * t + d.phase);
  };
  S.angleAt = function (src, t) { return src.spin ? src.angle + src.spin * t : src.angle; };

  /* equivalent dipole moment (A m²) — only used for the source–source interaction readout */
  S.momentOf = function (src, t) {
    const f = S.driveFactor(src, t);
    switch (src.type) {
      case 'cuboid': return f * (src.Br / MU0) * src.Lx * src.Ly * src.Lz;
      case 'cylinder': return f * (src.Br / MU0) * Math.PI * src.R * src.R * src.L;
      case 'coil': return f * src.N * src.I * Math.PI * src.R * src.R;
      case 'dipole': return f * src.m;
      default: return 0;
    }
  };

  /* ------------------------------------------------------------ unit fields (local frame) */

  /* Uniformly magnetized cuboid, M = 1 A/m along +X, half sizes hx,hy,hz, evaluated at (X, Y, 0).
   * Returns H (A/m) for M = 1, i.e. the dimensionless shape field; B = μ0 (H + M·inside). */
  S.cuboidUnit = function (X, Y, hx, hy, hz, out) {
    let Hx = 0, Hy = 0;
    const Y1 = Y + hy, Y2 = Y - hy;      // Y_i = y - y'_i with y'_1=-hy, y'_2=+hy
    const Z1 = hz, Z2 = -hz;             // Z_j = 0 - z'_j
    for (let f = -1; f <= 1; f += 2) {
      let Xf = X - f * hx;
      if (Math.abs(Xf) < 1e-15) Xf = 1e-15;
      // corners (i,j): eps = (+,-,-,+)
      const R11 = Math.sqrt(Xf * Xf + Y1 * Y1 + Z1 * Z1);
      const R12 = Math.sqrt(Xf * Xf + Y1 * Y1 + Z2 * Z2);
      const R21 = Math.sqrt(Xf * Xf + Y2 * Y2 + Z1 * Z1);
      const R22 = Math.sqrt(Xf * Xf + Y2 * Y2 + Z2 * Z2);
      const ax = Math.atan(Y1 * Z1 / (Xf * R11)) - Math.atan(Y1 * Z2 / (Xf * R12))
               - Math.atan(Y2 * Z1 / (Xf * R21)) + Math.atan(Y2 * Z2 / (Xf * R22));
      const ly = Math.log(Math.max(Z1 + R11, 1e-300)) - Math.log(Math.max(Z2 + R12, 1e-300))
               - Math.log(Math.max(Z1 + R21, 1e-300)) + Math.log(Math.max(Z2 + R22, 1e-300));
      Hx += f * ax;
      Hy -= f * ly;
    }
    const inv4pi = 1 / (4 * Math.PI);
    out.x = Hx * inv4pi;
    out.y = Hy * inv4pi;
    if (Math.abs(X) < hx && Math.abs(Y) < hy) out.x += 1;   // B = μ0 (H + M) inside the magnet
    return out;
  };

  /* Ideal solenoid / axially magnetized cylinder (Derby & Olbert eqs. 3–10), axis along X.
   * a = radius, b = half length. Returns B/B0 with B0 = μ0 n I/π (or μ0 M/π). */
  S.solenoidUnit = function (X, Y, a, b, out) {
    let rho = Math.abs(Y);
    const z = X;
    if (Math.abs(rho - a) < 1e-9 * a) rho = a * (rho < a ? 1 - 1e-9 : 1 + 1e-9);   // avoid the sheet edge singularity
    const zp = z + b, zm = z - b;
    const rp = Math.sqrt(zp * zp + (rho + a) * (rho + a));
    const rm = Math.sqrt(zm * zm + (rho + a) * (rho + a));
    const ap = a / rp, am = a / rm, bp = zp / rp, bm = zm / rm;
    const gamma = (a - rho) / (a + rho);
    const kp = Math.sqrt((zp * zp + (a - rho) * (a - rho)) / (zp * zp + (a + rho) * (a + rho)));
    const km = Math.sqrt((zm * zm + (a - rho) * (a - rho)) / (zm * zm + (a + rho) * (a + rho)));
    const Brho = ap * cel(kp, 1, 1, -1) - am * cel(km, 1, 1, -1);
    const g2 = gamma * gamma;
    const Bz = (a / (a + rho)) * (bp * cel(kp, g2, 1, gamma) - bm * cel(km, g2, 1, gamma));
    out.x = Bz;
    out.y = (Y >= 0 ? Brho : -Brho);
    return out;
  };

  /* Single circular loop of radius a (Derby & Olbert eqs. 11–13), axis along X.
   * Returns B·π/(μ0 I) (i.e. unit field for (μ0/π) I_total = 1). */
  S.loopUnit = function (X, Y, a, out) {
    let rho = Math.abs(Y);
    const z = X;
    if (Math.abs(rho - a) < 1e-9 * a && Math.abs(z) < 1e-9 * a) rho = a * (1 + 1e-9);
    const d2 = z * z + (rho + a) * (rho + a);
    const d32 = d2 * Math.sqrt(d2);
    const k12 = (z * z + (a - rho) * (a - rho)) / d2;
    const k1 = Math.sqrt(k12);
    const gamma = (a - rho) / (a + rho);
    const Brho = a * z / d32 * cel(k1, k12, -1, 1);
    const Bz = a * (rho + a) / d32 * cel(k1, k12, 1, gamma);
    out.x = Bz;
    out.y = (Y >= 0 ? Brho : -Brho);
    return out;
  };

  /* Point dipole along +X, unit field = [3(m̂·r̂)r̂ − m̂]/r³ (multiply by μ0 m/4π). */
  S.dipoleUnit = function (X, Y, rcore, out) {
    let r2 = X * X + Y * Y;
    if (r2 < rcore * rcore) { // regularize inside the core radius (uniform interior field of a sphere)
      const rc3 = rcore * rcore * rcore;
      out.x = 2 / rc3; out.y = 0; return out;
    }
    const r = Math.sqrt(r2), r3 = r2 * r;
    const ux = X / r, uy = Y / r;
    out.x = (3 * ux * ux - 1) / r3;
    out.y = (3 * ux * uy) / r3;
    return out;
  };

  /* ----------------------------------------------------------------- evaluation */
  const tmp = { x: 0, y: 0 };

  /* B (tesla) of one source at world point (x,y), time t. Adds into out.x/out.y if `add` is true. */
  S.evalB = function (src, x, y, t, out, add) {
    if (!add) { out.x = 0; out.y = 0; }
    if (!src.enabled) return out;
    const f = S.driveFactor(src, t);
    if (f === 0) return out;
    const ang = S.angleAt(src, t);
    const c = Math.cos(ang), s = Math.sin(ang);
    const dx = x - src.x, dy = y - src.y;
    const X = c * dx + s * dy, Y = -s * dx + c * dy;   // into local frame
    let scale = f * S.nominal(src);
    switch (src.type) {
      case 'cuboid': S.cuboidUnit(X, Y, src.Lx / 2, src.Ly / 2, src.Lz / 2, tmp); break;
      case 'cylinder': S.solenoidUnit(X, Y, src.R, src.L / 2, tmp); break;
      case 'coil':
        if (src.L > 1e-3 * src.R) S.solenoidUnit(X, Y, src.R, src.L / 2, tmp);
        else S.loopUnit(X, Y, src.R, tmp);
        break;
      case 'dipole': S.dipoleUnit(X, Y, src.rcore, tmp); break;
      case 'linear':
        tmp.x = src.B0 + src.Gxx * X + src.Gxy * Y;
        tmp.y = src.Gxy * X + src.Gyy * Y;
        break;
    }
    const bx = tmp.x * scale, by = tmp.y * scale;
    out.x += c * bx - s * by;      // back to world frame
    out.y += s * bx + c * by;
    return out;
  };

  /* Point-in-source test (for rendering and to keep particles out of the sources) */
  S.contains = function (src, x, y, t) {
    const ang = S.angleAt(src, t);
    const c = Math.cos(ang), s = Math.sin(ang);
    const dx = x - src.x, dy = y - src.y;
    const X = c * dx + s * dy, Y = -s * dx + c * dy;
    switch (src.type) {
      case 'cuboid': return Math.abs(X) <= src.Lx / 2 && Math.abs(Y) <= src.Ly / 2;
      case 'cylinder': return Math.abs(X) <= src.L / 2 && Math.abs(Y) <= src.R;
      case 'coil': return Math.abs(X) <= Math.max(src.L, 0.1 * src.R) / 2 && Math.abs(Math.abs(Y) - src.R) <= 0.08 * src.R;
      case 'dipole': return dx * dx + dy * dy <= src.rcore * src.rcore;
      default: return false;
    }
  };

  S.serialize = function (src) { const o = JSON.parse(JSON.stringify(src)); delete o.id; return o; };
  S.deserialize = function (o) { const s = S.create(o.type, JSON.parse(JSON.stringify(o))); return s; };
})(typeof window !== 'undefined' ? window : globalThis);
