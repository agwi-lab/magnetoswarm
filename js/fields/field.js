/* MagnetoSwarm — FieldModel: the total applied field of all sources.
 *
 *  B(x,t) = Σ_s B_s(x,t)      (exact superposition — linear magnetostatics in non-magnetic media)
 *
 * Besides B we need the in-plane Jacobian J_ij = ∂B_i/∂x_j (symmetric outside the sources because
 * ∇×B = 0, and B_z ≡ 0 on the symmetry plane). It is obtained per source by 4-point central differences
 * with a step h = 1e-4 × (source size); truncation error O(h²) ≈ 1e-8 relative, well below any physical
 * uncertainty, while remaining exact for every source geometry without per-type derivative algebra.
 *
 * For AC-driven coils the complex field amplitude (phasor) B̂(x) = Σ_c Î_c b_c(x) is accumulated per
 * frequency; it is used for the time-averaged eddy-current force on conducting particles.
 */
(function (global) {
  'use strict';
  const MS = global.MS = global.MS || {};
  const S = MS.sources;

  const tmp = { x: 0, y: 0 };

  /* factor-override variant of S.evalB (shares the transform code) */
  S.evalBf = function (src, x, y, t, factor, out, add) {
    if (!add) { out.x = 0; out.y = 0; }
    if (!src.enabled || factor === 0) return out;
    const ang = S.angleAt(src, t);
    const c = Math.cos(ang), s = Math.sin(ang);
    const dx = x - src.x, dy = y - src.y;
    const X = c * dx + s * dy, Y = -s * dx + c * dy;
    const scale = factor * S.nominal(src);
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
    out.x += c * bx - s * by;
    out.y += s * bx + c * by;
    return out;
  };

  class FieldModel {
    constructor() {
      this.sources = [];
      this.version = 0;          // bumped whenever geometry/strength changes (renderer cache key)
      this._o = { x: 0, y: 0 };
      this._p = { x: 0, y: 0 };
      this._q = { x: 0, y: 0 };
      this._r = { x: 0, y: 0 };
    }
    add(src) { this.sources.push(src); this.touch(); return src; }
    remove(src) { const i = this.sources.indexOf(src); if (i >= 0) this.sources.splice(i, 1); this.touch(); }
    clear() { this.sources.length = 0; this.touch(); }
    touch() { this.version++; }
    get(id) { return this.sources.find(s => s.id === id); }

    /* true if any enabled source changes in time (AC drive or spinning magnet) */
    isTimeVarying() {
      for (const s of this.sources) if (s.enabled && ((s.drive && s.drive.mode === 'ac') || s.spin)) return true;
      return false;
    }
    /* distinct AC frequencies (Hz) among enabled sources */
    acFrequencies() {
      const f = [];
      for (const s of this.sources) if (s.enabled && s.drive && s.drive.mode === 'ac' && s.drive.freq > 0) {
        if (!f.some(v => Math.abs(v - s.drive.freq) < 1e-9 * Math.max(1, v))) f.push(s.drive.freq);
      }
      return f;
    }

    /* B at (x,y,t) → out.x, out.y (tesla) */
    evalB(x, y, t, out) {
      out.x = 0; out.y = 0;
      const o = this._o;
      for (const s of this.sources) {
        if (!s.enabled) continue;
        S.evalB(s, x, y, t, o, false);
        out.x += o.x; out.y += o.y;
      }
      return out;
    }

    /* B and symmetric Jacobian at (x,y,t).
     * out: {bx, by, jxx, jxy, jyy}
     * ac (optional): phasor accumulator {n, freq[], bxr[], bxi[], byr[], byi[], jxxr[], jxxi[], jxyr[], jxyi[], jyyr[], jyyi[]} */
    evalBJ(x, y, t, out, ac) {
      let bx = 0, by = 0, jxx = 0, jxy = 0, jyy = 0;
      const o = this._o, p = this._p, q = this._q, r = this._r;
      if (ac) ac.n = 0;
      for (const s of this.sources) {
        if (!s.enabled) continue;
        const f = S.driveFactor(s, t);
        const h = 1e-4 * S.size(s);
        const isAC = ac && s.drive && s.drive.mode === 'ac' && s.drive.freq > 0;
        // unit (factor = 1) evaluations, then scale: instantaneous by f, phasor by amp·e^{iφ}
        S.evalBf(s, x + h, y, t, 1, o, false);
        S.evalBf(s, x - h, y, t, 1, p, false);
        S.evalBf(s, x, y + h, t, 1, q, false);
        S.evalBf(s, x, y - h, t, 1, r, false);
        const ubx = 0.25 * (o.x + p.x + q.x + r.x), uby = 0.25 * (o.y + p.y + q.y + r.y);
        const ujxx = (o.x - p.x) / (2 * h);
        const ujyx = (o.y - p.y) / (2 * h);          // ∂By/∂x
        const ujxy = (q.x - r.x) / (2 * h);          // ∂Bx/∂y  (= ∂By/∂x analytically)
        const ujyy = (q.y - r.y) / (2 * h);
        const usym = 0.5 * (ujyx + ujxy);
        if (f !== 0) {
          bx += f * ubx; by += f * uby; jxx += f * ujxx; jxy += f * usym; jyy += f * ujyy;
        }
        if (isAC) {
          let k = -1;
          for (let i = 0; i < ac.n; i++) if (Math.abs(ac.freq[i] - s.drive.freq) < 1e-9 * Math.max(1, ac.freq[i])) { k = i; break; }
          if (k < 0 && ac.n < ac.freq.length) { k = ac.n++; ac.freq[k] = s.drive.freq; ac.bxr[k] = ac.bxi[k] = ac.byr[k] = ac.byi[k] = 0; ac.jxxr[k] = ac.jxxi[k] = ac.jxyr[k] = ac.jxyi[k] = ac.jyyr[k] = ac.jyyi[k] = 0; }
          if (k >= 0) {
            const ar = s.drive.amp * Math.cos(s.drive.phase), ai = s.drive.amp * Math.sin(s.drive.phase);
            ac.bxr[k] += ar * ubx; ac.bxi[k] += ai * ubx; ac.byr[k] += ar * uby; ac.byi[k] += ai * uby;
            ac.jxxr[k] += ar * ujxx; ac.jxxi[k] += ai * ujxx; ac.jxyr[k] += ar * usym; ac.jxyi[k] += ai * usym; ac.jyyr[k] += ar * ujyy; ac.jyyi[k] += ai * ujyy;
          }
        }
      }
      out.bx = bx; out.by = by; out.jxx = jxx; out.jxy = jxy; out.jyy = jyy;
      return out;
    }

    static makeACAccumulator(nmax) {
      nmax = nmax || 4;
      const mk = () => new Float64Array(nmax);
      return { n: 0, freq: mk(), bxr: mk(), bxi: mk(), byr: mk(), byi: mk(), jxxr: mk(), jxxi: mk(), jxyr: mk(), jxyi: mk(), jyyr: mk(), jyyi: mk() };
    }

    /* |B| and ∇|B| at a point (for probes) */
    probe(x, y, t) {
      const o = { bx: 0, by: 0, jxx: 0, jxy: 0, jyy: 0 };
      this.evalBJ(x, y, t, o);
      const B = Math.hypot(o.bx, o.by);
      const gx = B > 0 ? (o.jxx * o.bx + o.jxy * o.by) / B : 0;
      const gy = B > 0 ? (o.jxy * o.bx + o.jyy * o.by) / B : 0;
      return { bx: o.bx, by: o.by, B, gx, gy, G: Math.hypot(gx, gy), jxx: o.jxx, jxy: o.jxy, jyy: o.jyy };
    }

    /* Force and torque on each source due to all other sources (equivalent-dipole estimate at the
     * source centre — leading order; exact for well separated sources). Returns [{src, fx, fy, tz, B}]. */
    interactions(t) {
      const res = [];
      const o = { bx: 0, by: 0, jxx: 0, jxy: 0, jyy: 0 };
      for (const s of this.sources) {
        if (!s.enabled || s.type === 'linear') continue;
        const m = S.momentOf(s, t);
        const ang = S.angleAt(s, t);
        const mx = m * Math.cos(ang), my = m * Math.sin(ang);
        let bx = 0, by = 0, jxx = 0, jxy = 0, jyy = 0;
        for (const u of this.sources) {
          if (u === s || !u.enabled) continue;
          const f = S.driveFactor(u, t); if (f === 0) continue;
          const h = 1e-4 * S.size(u);
          const a = this._o, b = this._p, c = this._q, d = this._r;
          S.evalBf(u, s.x + h, s.y, t, f, a, false); S.evalBf(u, s.x - h, s.y, t, f, b, false);
          S.evalBf(u, s.x, s.y + h, t, f, c, false); S.evalBf(u, s.x, s.y - h, t, f, d, false);
          bx += 0.25 * (a.x + b.x + c.x + d.x); by += 0.25 * (a.y + b.y + c.y + d.y);
          jxx += (a.x - b.x) / (2 * h); jyy += (c.y - d.y) / (2 * h); jxy += 0.5 * ((a.y - b.y) + (c.x - d.x)) / (2 * h);
        }
        res.push({ src: s, fx: jxx * mx + jxy * my, fy: jxy * mx + jyy * my, tz: mx * by - my * bx, B: Math.hypot(bx, by), m });
      }
      return res;
    }

    /* Field magnitude/components sampled on a grid covering [x0,x1]×[y0,y1] (nx×ny) at time t.
     * Fills Float32Arrays bx, by (row-major, y increasing with row index). */
    sampleGrid(x0, y0, x1, y1, nx, ny, t, bxArr, byArr) {
      const o = this._o;
      const dx = (x1 - x0) / (nx - 1), dy = (y1 - y0) / (ny - 1);
      let k = 0;
      for (let j = 0; j < ny; j++) {
        const y = y0 + j * dy;
        for (let i = 0; i < nx; i++, k++) {
          const x = x0 + i * dx;
          let sx = 0, sy = 0;
          for (const s of this.sources) {
            if (!s.enabled) continue;
            S.evalB(s, x, y, t, o, false);
            sx += o.x; sy += o.y;
          }
          bxArr[k] = sx; byArr[k] = sy;
        }
      }
    }

    serialize() { return this.sources.map(S.serialize); }
    load(list) { this.sources = list.map(S.deserialize); this.touch(); }
  }

  MS.FieldModel = FieldModel;
})(typeof window !== 'undefined' ? window : globalThis);
