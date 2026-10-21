#!/usr/bin/env node
/* Runs every preset headlessly for a short simulated time and reports timing / sanity statistics. */
const { load } = require('./_load');
const MS = load();
const only = process.argv[2];
let fail = 0;
for (const pr of MS.PRESETS) {
  if (only && pr.key !== only) continue;
  const sim = new MS.Simulation();
  sim.load(JSON.parse(JSON.stringify(pr.cfg)));
  const T = Number(process.argv[3] || 0.3);
  const t0 = Date.now();
  let steps = 0;
  while (T - sim.time > 1e-9) { sim.advance(Math.min(0.02, T - sim.time)); steps += sim.lastSubsteps; if (Date.now() - t0 > 60000) break; }
  const d = sim.updateDiagnostics();
  const sw = sim.swarm;
  let nan = 0, maxv = 0, outside = 0;
  for (let i = 0; i < sw.n; i++) {
    if (!isFinite(sw.x[i]) || !isFinite(sw.vx[i])) nan++;
    maxv = Math.max(maxv, Math.hypot(sw.vx[i], sw.vy[i]));
    if (Math.abs(sw.nn[i]) > sw.RR[i] + 1e-9) outside++;
  }
  const ms = Date.now() - t0;
  const ok = nan === 0 && outside === 0;
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${pr.key.padEnd(20)} t=${sim.time.toFixed(3)}s steps=${steps} ${ms}ms (${(ms / Math.max(steps, 1)).toFixed(2)} ms/step) N=${sw.n} retained=${d.retained} exited=${d.exited} maxv=${maxv.toExponential(2)} Bmax=${d.Bmax.toExponential(2)} Fmax=${d.Fmax.toExponential(2)} Re_p=${d.Rep.toExponential(1)} dt=${d.dt.toExponential(1)} nan=${nan} outside=${outside}`);
}
process.exit(fail ? 1 : 0);
