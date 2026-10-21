/* Loads the browser (classic-script) modules into a Node global, in dependency order. */
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const ORDER = [
  'js/core/constants.js', 'js/core/mathutil.js', 'js/fields/elliptic.js', 'js/fields/sources.js',
  'js/fields/field.js', 'js/flow/tube.js', 'js/flow/flow.js', 'js/particles/materials.js',
  'js/particles/swarm.js', 'js/particles/dynamics.js', 'js/sim/presets.js', 'js/sim/simulation.js',
];
exports.ORDER = ORDER;
exports.load = function (upto) {
  const root = path.join(__dirname, '..');
  for (const f of ORDER) {
    const p = path.join(root, f);
    if (!fs.existsSync(p)) { if (upto === undefined) continue; else break; }
    vm.runInThisContext(fs.readFileSync(p, 'utf8'), { filename: f });
    if (upto && f.endsWith(upto)) break;
  }
  return globalThis.MS;
};
