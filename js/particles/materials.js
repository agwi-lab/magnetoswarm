/* MagnetoSwarm — material library (report §6.3, §10).
 *
 * Object materials:  rho [kg/m³], chi (volume susceptibility, SI), Ms (saturation magnetization A/m),
 *                    Mr (remanent magnetization A/m, hard magnets), sigma (electrical conductivity S/m),
 *                    model: 'linear' (para/dia), 'ferro' (soft, linear→saturation with sphere demagnetization),
 *                           'spm' (superparamagnetic, Langevin), 'hard' (permanent moment, lag-angle alignment),
 *                    eDry: dry coefficient of restitution.
 * Susceptibilities of weakly magnetic metals from CRC / periodictable.com; soft-ferromagnet initial
 * susceptibilities are large enough that the sphere response is demagnetization-limited (χ_eff → 3).
 */
(function (global) {
  'use strict';
  const MS = global.MS = global.MS || {};
  const MU0 = MS.CONST.MU0;

  MS.MATERIALS = {
    magnetite:  { name: 'Magnetite Fe₃O₄ microparticle', rho: 5170, chi: 5.0,   Ms: 4.8e5, Mr: 0, sigma: 2.5e4,  model: 'ferro', eDry: 0.6 },
    spion:      { name: 'SPION cluster (superparamagnetic)', rho: 4000, chi: 1.0, Ms: 3.5e5, Mr: 0, sigma: 1e3, model: 'spm', eDry: 0.5, dcore: 12e-9 },
    polymag:    { name: 'Magnetic polymer microsphere', rho: 1500, chi: 1.0,   Ms: 2.0e4, Mr: 0, sigma: 0,      model: 'ferro', eDry: 0.7 },
    iron:       { name: 'Carbonyl iron (soft Fe)',      rho: 7870, chi: 1000,  Ms: 1.71e6, Mr: 0, sigma: 1.0e7, model: 'ferro', eDry: 0.85 },
    nickel:     { name: 'Nickel',                        rho: 8900, chi: 100,   Ms: 4.9e5, Mr: 0, sigma: 1.43e7, model: 'ferro', eDry: 0.85 },
    steel430:   { name: 'Ferritic stainless steel (430)', rho: 7700, chi: 500,  Ms: 1.2e6, Mr: 0, sigma: 1.67e6, model: 'ferro', eDry: 0.9 },
    ndfeb:      { name: 'NdFeB (hard magnet, N52)',      rho: 7500, chi: 0.05,  Ms: 1.18e6, Mr: 1.43 / MU0, sigma: 6.25e5, model: 'hard', eDry: 0.8 },
    aluminium:  { name: 'Aluminium (paramagnetic conductor)', rho: 2700, chi: 2.11e-5, Ms: 0, Mr: 0, sigma: 3.5e7, model: 'linear', eDry: 0.85 },
    copper:     { name: 'Copper (diamagnetic conductor)', rho: 8960, chi: -9.63e-6, Ms: 0, Mr: 0, sigma: 5.96e7, model: 'linear', eDry: 0.85 },
    titanium:   { name: 'Titanium (paramagnetic)',       rho: 4500, chi: 1.81e-4, Ms: 0, Mr: 0, sigma: 2.38e6, model: 'linear', eDry: 0.85 },
    platinum:   { name: 'Platinum (paramagnetic)',       rho: 21450, chi: 2.57e-4, Ms: 0, Mr: 0, sigma: 9.43e6, model: 'linear', eDry: 0.85 },
    bismuth:    { name: 'Bismuth (strongly diamagnetic)', rho: 9780, chi: -1.66e-4, Ms: 0, Mr: 0, sigma: 8.7e5, model: 'linear', eDry: 0.7 },
  };

  MS.FLUIDS = {
    water:      { name: 'Water (20 °C)',                rho: 998,  mu: 1.002e-3, chi: -9.0e-6, sigma: 5.5e-6, T: 293.15 },
    saline:     { name: 'Saline 0.9 % NaCl',            rho: 1005, mu: 0.95e-3,  chi: -9.0e-6, sigma: 1.5,    T: 293.15 },
    blood:      { name: 'Blood (whole, 37 °C, Newtonian approx.)', rho: 1060, mu: 3.5e-3, chi: -8.9e-6, sigma: 0.7, T: 310.15 },
    glycerol40: { name: '40 % glycerol–water',          rho: 1100, mu: 3.5e-3,   chi: -8.0e-6, sigma: 1e-4,   T: 293.15 },
    glycerol85: { name: '85 % glycerol–water',          rho: 1220, mu: 0.11,     chi: -7.0e-6, sigma: 1e-5,   T: 293.15 },
    glycerol:   { name: 'Glycerol (100 %)',             rho: 1260, mu: 1.41,     chi: -6.7e-6, sigma: 1e-5,   T: 293.15 },
    silicone:   { name: 'Silicone oil 100 cSt',         rho: 960,  mu: 0.096,    chi: -8.0e-6, sigma: 1e-12,  T: 293.15 },
    mercury:    { name: 'Mercury (MHD not modelled!)',  rho: 13534, mu: 1.53e-3, chi: -2.8e-5, sigma: 1.02e6, T: 293.15 },
  };

  MS.TUBE_MATERIALS = {
    silicone: { name: 'Silicone rubber', G: 3.0e5, Jm: 30 },
    latex:    { name: 'Latex', G: 2.5e5, Jm: 60 },
    natural:  { name: 'Natural rubber', G: 5.0e5, Jm: 50 },
    pu:       { name: 'PU elastomer', G: 2.0e6, Jm: 30 },
    artery:   { name: 'Artery (phenomenological)', G: 1.5e5, Jm: 2.5 },
    rigid:    { name: 'Rigid (glass / PMMA)', G: 1e9, Jm: 1e9 },
  };
})(typeof window !== 'undefined' ? window : globalThis);
