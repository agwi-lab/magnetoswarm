# Validation results

Generated 2026-10-21 03:49 UTC with Node v22.22.2 by `npm run validate` (+ `npm run validate:ui`).

## Field library (`validation/validate_fields.js`)

```
PASS  cel(kc,p,c,s) vs midpoint quadrature of definition                     max rel err = 4.31e-14 (tol 1e-9)
PASS  K(0.5), E(0.5) vs tabulated                                            max rel err = 0.00e+0 (tol 1e-13)
PASS  Current loop (cel form) vs Biot–Savart line quadrature                 max rel err = 2.45e-14 (tol 1e-6)
PASS  Current loop (cel form) vs classical K/E expression                    max rel err = 4.68e-15 (tol 1e-10)
PASS  Ideal solenoid (Derby–Olbert) vs 20 000 stacked loops                  max rel err = 3.15e-8 (tol 1e-6)
PASS  Ideal solenoid on-axis vs elementary formula                           max rel err = 3.67e-15 (tol 1e-11)
PASS  Ideal solenoid far field → point dipole (|r| ≈ 15–30 sizes)            max rel err = 1.29e-3 (tol 3e-3)
PASS  Cuboid magnet vs surface-charge quadrature (600² per face)             max rel err = 1.15e-5 (tol 2e-4)
PASS  Cuboid far field → point dipole                                        max rel err = 2.42e-4 (tol 3e-3)
PASS  Cuboid: normal B continuous across pole face                           max rel err = 3.75e-5 (tol 1e-4)
PASS  Cuboid: ∇×B = 0 in plane (∂xBy = ∂yBx)                                 max rel err = 1.22e-8 (tol 1e-5)
PASS  Helmholtz pair centre field = (4/5)^{3/2} μ0 N I / R                   max rel err = 1.93e-16 (tol 1e-10)
PASS  Helmholtz pair uniformity at 0.1 R off-centre (< 0.1 % by design)      max rel err = 1.86e-4 (tol 1e-3)
PASS  Anti-Helmholtz (d = R) axial gradient = 48/(25√5) μ0 N I / R²          max rel err = 4.27e-8 (tol 1e-6)

14/14 checks passed
```

## Particle dynamics (`validation/validate_dynamics.js`)

```
PASS  Stokes settling velocity (overdamped, 5 µm Fe in water)                    err = 1.45e-16 (tol 1e-9)
PASS  Inertial relaxation towards terminal velocity (τ = 0.43 s, dt = τ/400, implicit Euler) err = 9.62e-4 (tol 5e-3)
PASS  Induced moment m = V min(χ_eff H, M_s) Ĥ, χ_eff = 3Δχ/(3+χ_p+2χ_f)         err = 4.15e-18 (tol 1e-9)
PASS  Magnetophoretic velocity = (J·m)/γ (overdamped steady state; force lags one step) err = 5.78e-5 (tol 2e-4)
PASS  χ(ω) low-frequency: Im = μ0σωa²/10, Re = −(μ0σωa²)²/105                    err = 0.00e+0 (tol 2e-2)
PASS  χ(ω) skin-effect limit → −3/2 (perfect diamagnet, a/δ ≈ 370)               err = 4.04e-3 (tol 1e-2)
PASS  χ(ω) continuity across the expansion switch                                err = 4.88e-2 (tol 6e-2)
PASS  Dipole–dipole head-to-tail attraction 6μ0m²/(4πr⁴)                         err = 3.55e-16 (tol 1e-4)
PASS  Dipole–dipole side-by-side repulsion 3μ0m²/(4πr⁴)                          err = 3.55e-16 (tol 1e-4)
PASS  Mutual induction: H_loc = H + 2m/(4πr³) for a head-to-tail pair            err = 1.28e-8 (tol 1e-6)
PASS  Haberman–Sayre K(0.1) = 0.7916 (wall factor 1.263)                         err = 5.54e-5 (tol 2e-4)
PASS  Wall Coulomb friction: stick when F_t < μ F_N                              err = 0.00e+0 (tol 5e-1)
PASS  Wall Coulomb friction: slide velocity (F_t − μF_N)/γ when F_t > μF_N       err = 6.18e-10 (tol 1e-5)
PASS  Wet restitution at wall: e = 0.9 exp(−35/St), St = 3.88e+3                 err = 1.60e-4 (tol 5e-3)

14/14 checks passed
```

## Headless run of every preset, 0.3 s simulated (`validation/smoke_sim.js`)

```
OK   capture-block        t=0.300s steps=150 66ms (0.44 ms/step) N=59 retained=0 exited=0 maxv=1.89e-2 Bmax=1.25e-3 Fmax=1.19e-15 Re_p=6.2e-5 dt=2.0e-3 nan=0 outside=0
OK   artery-pulsatile     t=0.300s steps=1489 470ms (0.32 ms/step) N=90 retained=0 exited=0 maxv=2.29e-1 Bmax=5.17e-1 Fmax=4.17e-10 Re_p=4.4e-2 dt=7.4e-5 nan=0 outside=0
OK   helmholtz-chains     t=0.300s steps=300 228ms (0.76 ms/step) N=250 retained=0 exited=0 maxv=6.02e-4 Bmax=1.98e-2 Fmax=5.95e-14 Re_p=6.3e-6 dt=1.0e-3 nan=0 outside=0
OK   maxwell-gradient     t=0.300s steps=300 131ms (0.44 ms/step) N=250 retained=0 exited=0 maxv=4.02e-4 Bmax=8.74e-3 Fmax=6.49e-14 Re_p=6.9e-6 dt=1.0e-3 nan=0 outside=0
OK   rotating-rollers     t=0.300s steps=300 223ms (0.74 ms/step) N=60 retained=0 exited=0 maxv=8.64e-3 Bmax=7.87e-3 Fmax=2.08e-9 Re_p=4.6e-1 dt=1.0e-3 nan=0 outside=0
OK   halbach              t=0.300s steps=150 60ms (0.40 ms/step) N=59 retained=0 exited=0 maxv=1.51e-2 Bmax=1.36e-2 Fmax=2.19e-13 Re_p=5.2e-5 dt=2.0e-3 nan=0 outside=0
OK   steel-beads          t=0.300s steps=364 15ms (0.04 ms/step) N=4 retained=0 exited=0 maxv=5.43e-2 Bmax=5.19e-3 Fmax=1.61e-6 Re_p=6.8e+1 dt=1.0e-3 nan=0 outside=0
OK   aluminium-eddy       t=0.300s steps=326 17ms (0.05 ms/step) N=4 retained=0 exited=0 maxv=2.24e-2 Bmax=8.26e-3 Fmax=3.85e-11 Re_p=1.6e+1 dt=1.0e-3 nan=0 outside=0
OK   opposing-magnets     t=0.300s steps=150 81ms (0.54 ms/step) N=59 retained=0 exited=0 maxv=7.56e-3 Bmax=1.03e-2 Fmax=3.01e-13 Re_p=2.1e-4 dt=2.0e-3 nan=0 outside=0
OK   capillary-spion      t=0.300s steps=3001 750ms (0.25 ms/step) N=180 retained=0 exited=0 maxv=1.00e-3 Bmax=2.14e-1 Fmax=2.53e-14 Re_p=2.5e-6 dt=9.4e-6 nan=0 outside=0
OK   stenosis-sbend       t=0.300s steps=375 85ms (0.23 ms/step) N=59 retained=0 exited=0 maxv=1.63e-2 Bmax=2.03e-2 Fmax=2.71e-12 Re_p=8.8e-4 dt=2.4e-4 nan=0 outside=0
```

## Full UI in jsdom + node-canvas (`validation/smoke_ui.js`)

```
OK   boot + 5 frames
OK   run 30 frames
OK   preset capture-block
OK   preset artery-pulsatile
OK   preset helmholtz-chains
OK   preset maxwell-gradient
OK   preset rotating-rollers
OK   preset halbach
OK   preset steel-beads
OK   preset aluminium-eddy
OK   preset opposing-magnets
OK   preset capillary-spion
OK   preset stenosis-sbend
     exercised 142 inputs
OK   controls: change every range/select/check once
OK   add sources + pairs
OK   canvas drag/rotate/pan/zoom/probe
OK   tube editing + shapes
OK   serialize/load round trip
OK   theory modal

UI smoke test passed
```
