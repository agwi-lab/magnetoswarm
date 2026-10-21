/* MagnetoSwarm — special functions
 *  - cel(kc,p,c,s): Bulirsch's generalized complete elliptic integral
 *      C(kc,p,c,s) = ∫_0^{π/2} (c cos²φ + s sin²φ) / ((cos²φ + p sin²φ) sqrt(cos²φ + kc² sin²φ)) dφ
 *    (Bulirsch 1969; algorithm as reproduced in Derby & Olbert, Am. J. Phys. 78, 229 (2010) and
 *     Numerical Recipes 1st ed.). K(k)=C(kc,1,1,1), E(k)=C(kc,1,1,kc²), kc = sqrt(1-k²).
 *  - complex Bessel J0, J1 by power series (Womersley profiles).
 */
(function (global) {
  'use strict';
  const MS = global.MS = global.MS || {};
  const SF = MS.special = {};
  const PIO2 = Math.PI / 2;

  SF.cel = function (kc, p, c, s) {
    if (kc === 0) kc = 1e-300;
    const CA = 1e-13;
    let qc = Math.abs(kc), a = c, b = s, e = qc, em = 1.0, f, g, q;
    if (p > 0) {
      p = Math.sqrt(p);
      b /= p;
    } else {
      f = qc * qc; q = 1 - f; g = 1 - p; f -= p; q *= (b - a * p);
      p = Math.sqrt(f / g); a = (a - b) / g; b = -q / (g * g * p) + a * p;
    }
    for (let it = 0; it < 60; it++) {
      f = a; a += b / p; g = e / p; b += f * g; b += b; p += g; g = em; em += qc;
      if (Math.abs(g - qc) <= g * CA) break;
      qc = Math.sqrt(e); qc += qc; e = qc * em;
    }
    return PIO2 * (b + a * em) / (em * (em + p));
  };

  /* Complete elliptic integrals of the 1st and 2nd kind as functions of modulus k */
  SF.ellipK = function (k) { const kc = Math.sqrt(Math.max(1e-300, 1 - k * k)); return SF.cel(kc, 1, 1, 1); };
  SF.ellipE = function (k) { const kc2 = Math.max(0, 1 - k * k); return SF.cel(Math.sqrt(kc2), 1, 1, kc2); };

  /* Complex Bessel functions of the first kind (orders 0 and 1), power series.
   * Accurate for |z| up to ~30 in double precision (we cap Womersley numbers at 25). */
  SF.besselJ0J1c = function (zr, zi, out) {
    const hr = zr / 2, hi = zi / 2;
    const wr = -(hr * hr - hi * hi), wi = -(2 * hr * hi);   // w = -(z/2)^2
    let tr = 1, ti = 0, s0r = 1, s0i = 0;                  // J0 terms: w^k/(k!)^2
    let ur = 1, ui = 0, s1r = 1, s1i = 0;                  // J1 terms (x z/2): w^k/(k!(k+1)!)
    const absz = Math.sqrt(zr * zr + zi * zi);
    for (let k = 1; k < 200; k++) {
      let nr = tr * wr - ti * wi, ni = tr * wi + ti * wr;
      tr = nr / (k * k); ti = ni / (k * k);
      s0r += tr; s0i += ti;
      nr = ur * wr - ui * wi; ni = ur * wi + ui * wr;
      ur = nr / (k * (k + 1)); ui = ni / (k * (k + 1));
      s1r += ur; s1i += ui;
      if (k > absz && Math.abs(tr) + Math.abs(ti) + Math.abs(ur) + Math.abs(ui) < 1e-17 * (Math.abs(s0r) + Math.abs(s0i) + Math.abs(s1r) + Math.abs(s1i) + 1e-300)) break;
    }
    out.j0r = s0r; out.j0i = s0i;
    out.j1r = hr * s1r - hi * s1i; out.j1i = hr * s1i + hi * s1r;
    return out;
  };
})(typeof window !== 'undefined' ? window : globalThis);
