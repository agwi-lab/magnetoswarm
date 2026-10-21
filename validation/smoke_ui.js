#!/usr/bin/env node
/* Headless UI smoke test with jsdom + node-canvas: loads index.html, boots the app, runs frames,
 * loads every preset, exercises interactions and the control panel. Requires `npm i jsdom canvas` (dev only). */
const path = require('path');
const fs = require('fs');
let JSDOM; try { ({ JSDOM } = require('jsdom')); } catch (e) { console.error('This test needs the dev dependencies: npm install (jsdom + canvas)'); process.exit(2); }
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/<script defer src="https:[^"]+"><\/script>/g, '').replace(/<link rel="stylesheet" href="https:[^"]+">/g, '');
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
window.devicePixelRatio = 1;
window.HTMLCanvasElement.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, width: 1000, height: 600, right: 1000, bottom: 600 }; };
window.PointerEvent = window.MouseEvent;
window.HTMLElement.prototype.setPointerCapture = function () {};
window.performance = window.performance || { now: () => Date.now() };
let rafQueue = [];
window.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length; };
window.URL.createObjectURL = () => 'blob:x'; window.URL.revokeObjectURL = () => {};
const order = ['js/core/constants.js', 'js/core/mathutil.js', 'js/fields/elliptic.js', 'js/fields/sources.js', 'js/fields/field.js', 'js/flow/tube.js', 'js/flow/flow.js', 'js/particles/materials.js', 'js/particles/swarm.js', 'js/particles/dynamics.js', 'js/sim/presets.js', 'js/sim/simulation.js', 'js/ui/render.js', 'js/ui/controls.js', 'js/main.js'];
for (const f of order) window.eval(fs.readFileSync(path.join(root, f), 'utf8') + `\n//# sourceURL=${f}`);
window.dispatchEvent(new window.Event('DOMContentLoaded'));
const app = window.app;
if (!app) throw new Error('app not created');
function frames(n) { for (let k = 0; k < n; k++) { const q = rafQueue; rafQueue = []; for (const cb of q) cb(performance.now() + k * 16); } }
let errors = 0;
function tryit(name, fn) { try { fn(); console.log('OK   ' + name); } catch (e) { errors++; console.log('FAIL ' + name + ': ' + (e.stack || e)); } }
tryit('boot + 5 frames', () => { frames(5); });
tryit('run 30 frames', () => { app.toggle(); frames(30); app.toggle(); if (!(app.sim.time > 0)) throw new Error('time did not advance'); });
for (const p of window.MS.PRESETS) tryit('preset ' + p.key, () => { app.loadPreset(p.key); app.toggle(); frames(12); app.toggle(); app.controls.updateDiagnostics(); });
tryit('controls: change every range/select/check once', () => {
  const panel = window.document.getElementById('panel');
  const inputs = panel.querySelectorAll('input, select');
  let n = 0;
  for (const inp of inputs) {
    if (inp.type === 'range') { inp.value = Math.round(Number(inp.value) * 0.9); inp.dispatchEvent(new window.Event('input', { bubbles: true })); }
    else if (inp.type === 'number') { inp.value = String(Number(inp.value) || 1); inp.dispatchEvent(new window.Event('change', { bubbles: true })); }
    else if (inp.type === 'checkbox') { inp.checked = !inp.checked; inp.dispatchEvent(new window.Event('change', { bubbles: true })); inp.checked = !inp.checked; inp.dispatchEvent(new window.Event('change', { bubbles: true })); }
    else if (inp.tagName === 'SELECT' && !inp.classList.contains('preset')) { const opts = [...inp.options]; if (opts.length > 1) { inp.value = opts[(opts.findIndex(o => o.selected) + 1) % opts.length].value; inp.dispatchEvent(new window.Event('change', { bubbles: true })); } }
    n++;
  }
  frames(3);
  console.log('     exercised ' + n + ' inputs');
});
tryit('add sources + pairs', () => { app.loadPreset('capture-block'); app.addSource('coil'); app.addSource('dipole'); app.addSource('linear'); app.addSource('cylinder'); app.addPair('rotating'); app.addPair('maxwell'); frames(4); app.toggle(); frames(5); app.toggle(); });
tryit('canvas drag/rotate/pan/zoom/probe', () => {
  app.loadPreset('capture-block'); frames(2);
  const c = window.document.getElementById('view'); const R = app.renderer; const src = app.sim.field.sources[0];
  const s = R.w2s(src.x, src.y);
  const ev = (type, x, y, extra) => c.dispatchEvent(new window.MouseEvent(type, Object.assign({ clientX: x, clientY: y, bubbles: true, pointerId: 1 }, extra || {})));
  ev('pointerdown', s.x, s.y); ev('pointermove', s.x + 30, s.y + 10); ev('pointerup', s.x + 30, s.y + 10);
  if (R.selected !== src) throw new Error('source not selected');
  const s2 = R.w2s(src.x, src.y); const d = R.handleDist(src); const hx = s2.x + d * Math.cos(src.angle), hy = s2.y - d * Math.sin(src.angle);
  ev('pointerdown', hx, hy); ev('pointermove', hx + 20, hy + 20); ev('pointerup', hx + 20, hy + 20);
  ev('pointerdown', 5, 5); ev('pointermove', 25, 15); ev('pointerup', 25, 15);
  c.dispatchEvent(new window.WheelEvent('wheel', { deltaY: -100, clientX: 400, clientY: 300 }));
  ev('pointermove', 500, 300);
  frames(3);
  if (!R.probe) throw new Error('probe missing');
});
tryit('tube editing + shapes', () => { app.setTubeShape('arc'); app.setTubeShape('sbend'); app.setTubeShape('sinuous'); app.setTubeShape('custom'); app.setTubeLength(0.05); frames(3); app.toggle(); frames(5); app.toggle(); });
tryit('serialize/load round trip', () => { const cfg = JSON.parse(JSON.stringify(app.sim.serialize())); app.sim.load(cfg); frames(2); });
tryit('theory modal', () => { app.showTheory(true); app.showTheory(false); });
console.log(errors ? `\n${errors} UI smoke failures` : '\nUI smoke test passed');
process.exit(errors ? 1 : 0);
