/* MagnetoSwarm — particle storage (structure of typed arrays, swap-remove compaction). */
(function (global) {
  'use strict';
  const MS = global.MS = global.MS || {};

  const F64 = ['x', 'y', 'vx', 'vy', 'a', 'mx', 'my', 'thB', 'thM', 'omega', 'tStuck', 'fx', 'fy',
    'ux', 'uy', 'dudn', 'dudt', 'nn', 'ss', 'RR', 'Rdot', 'bx', 'by', 'jxx', 'jxy', 'jyy', 'hx', 'hy',
    'gam0', 'slip', 'tAge', 'born'];
  const I32 = ['station', 'cell'];
  const I8 = ['st', 'stick', 'contact', 'hasPrev'];

  class Swarm {
    constructor(capacity) {
      this.cap = capacity || 1024;
      this.n = 0;
      this._alloc(this.cap);
      this.injected = 0; this.exited = 0;
    }
    _alloc(cap) {
      for (const k of F64) this[k] = new Float64Array(cap);
      for (const k of I32) this[k] = new Int32Array(cap);
      for (const k of I8) this[k] = new Int8Array(cap);
    }
    _grow() {
      const old = {};
      for (const k of [...F64, ...I32, ...I8]) old[k] = this[k];
      this.cap *= 2;
      this._alloc(this.cap);
      for (const k of [...F64, ...I32, ...I8]) this[k].set(old[k]);
    }
    add(x, y, a, t) {
      if (this.n >= this.cap) this._grow();
      const i = this.n++;
      this.x[i] = x; this.y[i] = y; this.vx[i] = 0; this.vy[i] = 0; this.a[i] = a;
      this.mx[i] = 0; this.my[i] = 0; this.thB[i] = 0; this.thM[i] = 0; this.omega[i] = 0; this.tStuck[i] = 0;
      this.station[i] = -1; this.cell[i] = -1; this.st[i] = 0; this.stick[i] = 0; this.contact[i] = 0; this.hasPrev[i] = 0;
      this.slip[i] = 0; this.tAge[i] = 0; this.born[i] = t || 0; this.gam0[i] = 0;
      this.injected++;
      return i;
    }
    remove(i) {
      const j = --this.n;
      if (i !== j) {
        for (const k of F64) this[k][i] = this[k][j];
        for (const k of I32) this[k][i] = this[k][j];
        for (const k of I8) this[k][i] = this[k][j];
      }
    }
    clear() { this.n = 0; this.injected = 0; this.exited = 0; }
  }
  MS.Swarm = Swarm;
})(typeof window !== 'undefined' ? window : globalThis);
