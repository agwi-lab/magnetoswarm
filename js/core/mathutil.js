/* MagnetoSwarm — small numeric helpers */
(function (global) {
  'use strict';
  const MS = global.MS = global.MS || {};
  const U = MS.util = {};

  U.clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.hypot2 = (x, y) => Math.sqrt(x * x + y * y);
  U.wrapAngle = (a) => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };

  /* Deterministic PRNG (mulberry32) + Gaussian (Box–Muller) */
  U.makeRNG = function (seed) {
    let s = (seed >>> 0) || 0x9e3779b9;
    let spare = null;
    const rng = function () {
      s += 0x6D2B79F5;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    rng.gauss = function () {
      if (spare !== null) { const g = spare; spare = null; return g; }
      let u, v, r;
      do { u = 2 * rng() - 1; v = 2 * rng() - 1; r = u * u + v * v; } while (r >= 1 || r === 0);
      const f = Math.sqrt(-2 * Math.log(r) / r);
      spare = v * f;
      return u * f;
    };
    rng.seed = function (x) { s = (x >>> 0) || 0x9e3779b9; spare = null; };
    return rng;
  };

  /* Langevin function with series for small argument */
  U.langevin = function (x) {
    const ax = Math.abs(x);
    if (ax < 1e-3) return x / 3 - x * x * x / 45;
    if (ax > 40) return x > 0 ? 1 - 1 / x : -1 - 1 / x;
    return 1 / Math.tanh(x) - 1 / x;
  };

  /* Format a number with SI prefix */
  U.fmtSI = function (v, unit, digits) {
    if (!isFinite(v)) return '—';
    if (v === 0) return '0 ' + (unit || '');
    const pre = [['T', 1e12], ['G', 1e9], ['M', 1e6], ['k', 1e3], ['', 1], ['m', 1e-3], ['µ', 1e-6], ['n', 1e-9], ['p', 1e-12], ['f', 1e-15]];
    const av = Math.abs(v);
    for (const [p, f] of pre) {
      if (av >= f * 0.9999) return (v / f).toPrecision(digits || 3).replace(/\.?0+$/, '') + ' ' + p + (unit || '');
    }
    return v.toExponential(2) + ' ' + (unit || '');
  };
  U.fmt = function (v, digits) {
    if (!isFinite(v)) return '—';
    const av = Math.abs(v);
    if (av !== 0 && (av < 1e-3 || av >= 1e5)) return v.toExponential(digits || 2);
    return Number(v.toPrecision(digits || 3)).toString();
  };
})(typeof window !== 'undefined' ? window : globalThis);
