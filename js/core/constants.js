/* MagnetoSwarm — physical constants (SI) */
(function (global) {
  'use strict';
  const MS = global.MS = global.MS || {};
  MS.CONST = Object.freeze({
    MU0: 4e-7 * Math.PI,        // vacuum permeability [H/m]
    KB: 1.380649e-23,           // Boltzmann constant [J/K]
    G: 9.80665,                 // standard gravity [m/s^2]
    PI: Math.PI,
    TWO_PI: 2 * Math.PI,
  });
})(typeof window !== 'undefined' ? window : globalThis);
