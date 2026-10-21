/* MagnetoSwarm — scenario presets. Lengths in metres, SI throughout. */
(function (global) {
  'use strict';
  const MS = global.MS = global.MS || {};
  const d2r = Math.PI / 180;

  const straight = (L) => [[-L / 2, 0], [L / 2, 0]];
  const arc = (L, sag) => [[-L / 2, 0], [-L / 4, sag * 0.75], [0, sag], [L / 4, sag * 0.75], [L / 2, 0]];
  const sBend = (L, amp) => [[-L / 2, 0], [-L / 4, amp], [0, 0], [L / 4, -amp], [L / 2, 0]];

  const Q = (R, u) => Math.PI * R * R * u;

  MS.PRESETS = [
    {
      key: 'capture-block', name: 'Block magnet capturing magnetite microparticles (phantom)',
      description: 'A 10 mm NdFeB cube 4 mm below a silicone tube (R = 2 mm) pulls 2 µm magnetite particles out of a 10 mm/s water stream. Drag the magnet, rotate it, or add a second one.',
      cfg: {
        sources: [{ type: 'cuboid', x: 0, y: -0.0105, angle: 90 * d2r, Lx: 0.010, Ly: 0.010, Lz: 0.010, Br: 1.30, label: 'NdFeB N42 cube' }],
        tube: { points: straight(0.10), Rin: 0.002, Rout: 0.002, h0: 0.0005, G: 3e5, Jm: 30, elastic: true },
        fluidKey: 'water', flow: { Qmean: Q(0.002, 0.010), waveform: 'steady', freq: 1.2, beta: 0.8 },
        P: { materialKey: 'magnetite', radius: 1.0e-6, polydispersity: 0.15, dipole: true, mutual: true, brownian: false, gravity: true, muF: 0.3 },
        inj: { mode: 'continuous', count: 400, rate: 200, seed: 7 }, elastic: { pOut: 8e3, pAmp: 0, lag: 0 }, timeScale: 1, dtMaxUser: 2e-3,
      },
    },
    {
      key: 'artery-pulsatile', name: 'Curved artery, pulsatile flow, elastic wall',
      description: 'Carotid-like pulsatile flow (α ≈ 4) in a compliant curved vessel (R = 3 mm). A large N52 block tries to retain 2 µm magnetite particles near the wall. Watch the wall pulsate and the Womersley profile flatten.',
      cfg: {
        sources: [{ type: 'cuboid', x: 0, y: -0.021, angle: 90 * d2r, Lx: 0.040, Ly: 0.040, Lz: 0.020, Br: 1.43, label: 'NdFeB N52 block' }],
        tube: { points: arc(0.09, 0.006), Rin: 0.003, Rout: 0.0028, h0: 0.0006, G: 1.5e5, Jm: 2.5, elastic: true },
        fluidKey: 'blood', flow: { Qmean: Q(0.003, 0.12), waveform: 'pulse', freq: 1.2, beta: 1.2 },
        P: { materialKey: 'magnetite', radius: 1.0e-6, polydispersity: 0.15, dipole: true, mutual: true, brownian: false, gravity: false, muF: 0.3 },
        inj: { mode: 'continuous', count: 400, rate: 300, seed: 11 }, elastic: { pOut: 10e3, pAmp: 5.3e3, lag: 0.08 }, timeScale: 0.5, dtMaxUser: 2e-3,
      },
    },
    {
      key: 'helmholtz-chains', name: 'Helmholtz pair: chaining in a uniform field',
      description: 'Two coils in Helmholtz geometry give a uniform 20 mT field with no gradient force. Soft iron 2 µm spheres magnetize, attract head-to-tail and form chains along the field (dipole–dipole + mutual induction).',
      cfg: {
        view: 'tube',
        sources: [
          { type: 'coil', x: -0.015, y: 0, angle: 0, R: 0.030, L: 0, N: 200, I: 3.3, label: 'Helmholtz coil A' },
          { type: 'coil', x: 0.015, y: 0, angle: 0, R: 0.030, L: 0, N: 200, I: 3.3, label: 'Helmholtz coil B' },
        ],
        tube: { points: straight(0.03), Rin: 0.0005, Rout: 0.0005, h0: 0.0002, G: 3e5, Jm: 30, elastic: false },
        fluidKey: 'water', flow: { Qmean: Q(0.0005, 0.0003), waveform: 'steady', freq: 1, beta: 0 },
        P: { materialKey: 'iron', radius: 1.0e-6, polydispersity: 0.1, dipole: true, mutual: true, brownian: true, gravity: false, muF: 0.2, contactRes: 2 },
        inj: { mode: 'bolus', count: 250, recycle: true, seed: 3, inletFraction: 0.9 }, elastic: { pOut: 2e3, pAmp: 0, lag: 0 }, timeScale: 0.2, dtMaxUser: 1e-3,
      },
    },
    {
      key: 'maxwell-gradient', name: 'Maxwell (anti-Helmholtz) pair: uniform gradient force',
      description: 'Opposite currents produce a field null at the centre and a linear gradient. Iron spheres are pushed towards the coils (away from the null) — force ∝ ∇|B|².',
      cfg: {
        view: 'tube',
        sources: [
          { type: 'coil', x: -0.015, y: 0, angle: 0, R: 0.030, L: 0, N: 200, I: 3.3, label: 'Maxwell coil A' },
          { type: 'coil', x: 0.015, y: 0, angle: 0, R: 0.030, L: 0, N: 200, I: -3.3, label: 'Maxwell coil B' },
        ],
        tube: { points: straight(0.03), Rin: 0.0005, Rout: 0.0005, h0: 0.0002, G: 3e5, Jm: 30, elastic: false },
        fluidKey: 'water', flow: { Qmean: Q(0.0005, 0.0002), waveform: 'steady', freq: 1, beta: 0 },
        P: { materialKey: 'iron', radius: 1.0e-6, polydispersity: 0.1, dipole: true, mutual: true, brownian: false, gravity: false, muF: 0.2, contactRes: 2 },
        inj: { mode: 'bolus', count: 250, recycle: true, seed: 5, inletFraction: 0.9 }, elastic: { pOut: 2e3, pAmp: 0, lag: 0 }, timeScale: 0.3, dtMaxUser: 1e-3,
      },
    },
    {
      key: 'rotating-rollers', name: 'Rotating field: hard-magnetic microrollers move upstream',
      description: 'Two Helmholtz pairs driven 90° out of phase (10 Hz) create a rotating 5 mT field. NdFeB 50 µm microrobots sediment, spin synchronously (far below step-out) and roll along the wall against a slow flow (v = α a Ω, α = 0.5). Dipole interactions are off: NdFeB particles of this size aggregate into rigid clusters within milliseconds if enabled.',
      cfg: {
        view: 'tube',
        sources: [
          { type: 'coil', x: -0.02, y: 0, angle: 0, R: 0.04, L: 0, N: 100, I: 3.5, drive: { mode: 'ac', amp: 1, freq: 10, phase: 0 }, label: 'X coil A' },
          { type: 'coil', x: 0.02, y: 0, angle: 0, R: 0.04, L: 0, N: 100, I: 3.5, drive: { mode: 'ac', amp: 1, freq: 10, phase: 0 }, label: 'X coil B' },
          { type: 'coil', x: 0, y: -0.02, angle: 90 * d2r, R: 0.04, L: 0, N: 100, I: 3.5, drive: { mode: 'ac', amp: 1, freq: 10, phase: Math.PI / 2 }, label: 'Y coil A' },
          { type: 'coil', x: 0, y: 0.02, angle: 90 * d2r, R: 0.04, L: 0, N: 100, I: 3.5, drive: { mode: 'ac', amp: 1, freq: 10, phase: Math.PI / 2 }, label: 'Y coil B' },
        ],
        tube: { points: straight(0.03), Rin: 0.0015, Rout: 0.0015, h0: 0.0003, G: 3e5, Jm: 30, elastic: false },
        fluidKey: 'glycerol40', flow: { Qmean: Q(0.0015, 0.0004), waveform: 'steady', freq: 1, beta: 0 },
        P: { materialKey: 'ndfeb', radius: 25e-6, polydispersity: 0.05, dipole: false, mutual: false, brownian: false, gravity: true, gravAngle: -Math.PI / 2, muF: 0.3, rollAlpha: 0.5 },
        inj: { mode: 'bolus', count: 60, recycle: true, seed: 2, inletFraction: 0.8 }, elastic: { pOut: 2e3, pAmp: 0, lag: 0 }, timeScale: 0.5, dtMaxUser: 1e-3,
      },
    },
    {
      key: 'halbach', name: 'Halbach array: one-sided field',
      description: 'Five 10 mm blocks with magnetization rotating by 90° from block to block. The field is concentrated on one side and nearly cancelled on the other — flip the array (rotate every block by 180°) to see the difference.',
      cfg: {
        sources: [0, 1, 2, 3, 4].map(k => ({ type: 'cuboid', x: (k - 2) * 0.010, y: -0.012, angle: (90 * k + 90) * d2r, Lx: 0.010, Ly: 0.010, Lz: 0.020, Br: 1.30, label: 'Block ' + (k + 1) })),
        tube: { points: straight(0.10), Rin: 0.002, Rout: 0.002, h0: 0.0005, G: 3e5, Jm: 30, elastic: true },
        fluidKey: 'water', flow: { Qmean: Q(0.002, 0.008), waveform: 'steady', freq: 1, beta: 0 },
        P: { materialKey: 'magnetite', radius: 1.0e-6, polydispersity: 0.15, dipole: true, mutual: true, brownian: false, gravity: true, muF: 0.3 },
        inj: { mode: 'continuous', count: 400, rate: 200, seed: 9 }, elastic: { pOut: 8e3, pAmp: 0, lag: 0 }, timeScale: 1, dtMaxUser: 2e-3,
      },
    },
    {
      key: 'steel-beads', name: 'Steel beads (1 mm) in glycerol–water: inertia, eddy braking, bouncing',
      description: 'Ferritic steel spheres (Re_p ≈ 10, St ≈ 10) are swept past a 30 mm block. Nonlinear drag, added mass, Stokes-number-dependent restitution and the eddy-current damping tensor are all active.',
      cfg: {
        sources: [{ type: 'cuboid', x: 0.01, y: -0.025, angle: 90 * d2r, Lx: 0.030, Ly: 0.030, Lz: 0.020, Br: 1.30, label: 'NdFeB block' }],
        tube: { points: straight(0.15), Rin: 0.006, Rout: 0.006, h0: 0.001, G: 5e5, Jm: 50, elastic: true },
        fluidKey: 'glycerol40', flow: { Qmean: Q(0.006, 0.05), waveform: 'steady', freq: 1, beta: 0 },
        P: { materialKey: 'steel430', radius: 0.5e-3, polydispersity: 0.0, dipole: true, mutual: true, brownian: false, gravity: true, gravAngle: -Math.PI / 2, muF: 0.25 },
        inj: { mode: 'continuous', count: 60, rate: 15, seed: 4 }, elastic: { pOut: 5e3, pAmp: 0, lag: 0 }, timeScale: 1, dtMaxUser: 1e-3,
      },
    },
    {
      key: 'aluminium-eddy', name: 'Aluminium beads: eddy-current braking in a steep gradient',
      description: 'Non-magnetic but highly conductive 1 mm aluminium spheres feel almost no gradient force (χ = 2·10⁻⁵) yet are braked by the motional eddy-current damping tensor C = (2πσa⁵/15) J² near the magnet.',
      cfg: {
        sources: [{ type: 'cylinder', x: 0.0, y: -0.021, angle: 90 * d2r, R: 0.015, L: 0.030, Br: 1.40, label: 'NdFeB cylinder' }],
        tube: { points: straight(0.15), Rin: 0.006, Rout: 0.006, h0: 0.001, G: 5e5, Jm: 50, elastic: false },
        fluidKey: 'water', flow: { Qmean: Q(0.006, 0.05), waveform: 'steady', freq: 1, beta: 0 },
        P: { materialKey: 'aluminium', radius: 0.5e-3, polydispersity: 0.0, dipole: false, mutual: false, brownian: false, gravity: true, gravAngle: -Math.PI / 2, muF: 0.2, eddy: true },
        inj: { mode: 'continuous', count: 60, rate: 15, seed: 4 }, elastic: { pOut: 5e3, pAmp: 0, lag: 0 }, timeScale: 1, dtMaxUser: 1e-3,
      },
    },
    {
      key: 'opposing-magnets', name: 'Opposing magnets: field null and swarm splitting',
      description: 'Two blocks with like poles facing create a null plane between them. Soft particles are expelled from the null towards both walls; the superposed field is exact — move one magnet to break the symmetry.',
      cfg: {
        sources: [
          { type: 'cuboid', x: 0, y: -0.012, angle: 90 * d2r, Lx: 0.015, Ly: 0.015, Lz: 0.015, Br: 1.30, label: 'Lower block (N up)' },
          { type: 'cuboid', x: 0, y: 0.012, angle: -90 * d2r, Lx: 0.015, Ly: 0.015, Lz: 0.015, Br: 1.30, label: 'Upper block (N down)' },
        ],
        tube: { points: straight(0.08), Rin: 0.002, Rout: 0.002, h0: 0.0005, G: 3e5, Jm: 30, elastic: true },
        fluidKey: 'water', flow: { Qmean: Q(0.002, 0.004), waveform: 'steady', freq: 1, beta: 0 },
        P: { materialKey: 'magnetite', radius: 1.5e-6, polydispersity: 0.15, dipole: true, mutual: true, brownian: false, gravity: false, muF: 0.3 },
        inj: { mode: 'continuous', count: 400, rate: 200, seed: 13 }, elastic: { pOut: 8e3, pAmp: 0, lag: 0 }, timeScale: 1, dtMaxUser: 2e-3,
      },
    },
    {
      key: 'capillary-spion', name: 'Capillary (R = 5 µm): SPIONs with Brownian motion',
      description: 'Superparamagnetic 60 nm clusters in plasma-like flow (0.5 mm/s) diffuse (Pe ≈ 1) while a 5 mm magnet 2 mm away applies a ~0.3 T, 100 T/m field. Langevin magnetization, Brownian kicks √(2D dt).',
      cfg: {
        view: 'tube',
        sources: [{ type: 'cuboid', x: 0, y: -0.0046, angle: 90 * d2r, Lx: 0.005, Ly: 0.005, Lz: 0.005, Br: 1.30, label: 'NdFeB 5 mm cube' }],
        tube: { points: straight(0.0003), Rin: 5e-6, Rout: 5e-6, h0: 1e-6, G: 1e5, Jm: 10, elastic: false },
        fluidKey: 'saline', flow: { Qmean: Q(5e-6, 0.0005), waveform: 'steady', freq: 1, beta: 0 },
        P: { materialKey: 'spion', radius: 30e-9, polydispersity: 0.2, dipole: false, mutual: false, brownian: true, gravity: false, muF: 0.3, dcore: 12e-9 },
        inj: { mode: 'continuous', count: 300, rate: 600, seed: 21 }, elastic: { pOut: 2e3, pAmp: 0, lag: 0 }, timeScale: 1, dtMaxUser: 1e-4,
      },
    },
    {
      key: 'stenosis-sbend', name: 'S-bend with stenosis, steerable coil + magnet',
      description: 'A corrugated S-shaped tube with a 50 % stenosis. A DC solenoid and a cylinder magnet can be moved to steer 3 µm nickel particles into the narrowing; the coil current can be set negative to repel.',
      cfg: {
        sources: [
          { type: 'coil', x: -0.02, y: 0.025, angle: -90 * d2r, R: 0.012, L: 0.02, N: 500, I: 15, label: 'DC solenoid' },
          { type: 'cylinder', x: 0.02, y: -0.02, angle: 90 * d2r, R: 0.008, L: 0.015, Br: 1.3, label: 'Cylinder magnet' },
        ],
        tube: { points: sBend(0.09, 0.008), Rin: 0.002, Rout: 0.002, h0: 0.0005, G: 3e5, Jm: 30, elastic: true, stenosisSeverity: 0.5, stenosisPos: 0.5, stenosisWidth: 0.004, corrugAmp: 0.05, corrugPeriods: 12 },
        fluidKey: 'glycerol40', flow: { Qmean: Q(0.002, 0.006), waveform: 'sine', freq: 1, beta: 0.5 },
        P: { materialKey: 'nickel', radius: 1.5e-6, polydispersity: 0.15, dipole: true, mutual: true, brownian: false, gravity: true, muF: 0.3 },
        inj: { mode: 'continuous', count: 400, rate: 200, seed: 17 }, elastic: { pOut: 8e3, pAmp: 3e3, lag: 0.1 }, timeScale: 1, dtMaxUser: 2e-3,
      },
    },
  ];

  MS.presetByKey = (k) => MS.PRESETS.find(p => p.key === k);
})(typeof window !== 'undefined' ? window : globalThis);
