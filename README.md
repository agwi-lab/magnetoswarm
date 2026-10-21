# MagnetoSwarm — metallic swarms in magnetically actuated, fluid-filled elastic tubes

Interactive, browser-based (no build step, no server) simulation of swarms of metallic objects —
para-, dia-, soft-ferro-, superpara- and hard-magnetic, conducting or not — flowing through a
compliant tube and actuated by **movable, parametrized magnetic field sources** (block and
cylinder permanent magnets, coils/solenoids with DC or AC drive, point dipoles, ideal field +
gradient systems). All sources superpose exactly; every one can be dragged, rotated, spun, pulsed
and edited while the simulation runs.

The implementation follows the reduced-order model of the accompanying report (`docs/THEORY.md`
cites each equation) and is **numerically validated against independent references**
(`validation/`, 28 checks: fields vs. quadrature, Womersley/Poiseuille limits, settling,
magnetophoresis, dipole forces, wet restitution, friction, eddy polarizability).

## Quick start

* Open `index.html` directly, or serve the folder (`python3 -m http.server`) — plain scripts, no modules, no bundler.
* **Run / Pause** (Space), **Step** (`.`), **Reset** (`r`), **Fit** (`f`), speed slider = simulated seconds per real second.
* **Drag** a magnet or coil to move it; drag the **amber handle** to rotate (Shift = 15° steps); edit all parameters in *Field sources*.
* **Pan** by dragging empty space, **zoom** with the wheel / pinch; hover to probe B, |∇|B|| and the force on a reference particle.
* Pick a **Scenario** (11 presets: capture by a block magnet, pulsatile curved artery, Helmholtz chaining, Maxwell gradient, rotating-field micro-rollers, Halbach array, inertial steel beads, aluminium eddy braking, opposing magnets, capillary SPIONs with Brownian motion, stenosed S-bend) or build your own and **Save JSON**.
* The elastic tube can be straight / arc / S-bend / sinuous / free-form (enable *Edit control points*; double-click adds a point).

## Deploy to GitHub Pages (account `agwi-lab`)

```bash
git init && git add -A && git commit -m "MagnetoSwarm v1.0"
git branch -M main
git remote add origin git@github.com:agwi-lab/magnetoswarm.git   # create the (public) repo first
git push -u origin main
```

Then either

1. **Settings → Pages → Build and deployment → Source: "GitHub Actions"** — the included
   workflow `.github/workflows/deploy-pages.yml` runs the validation suites and publishes the site at
   `https://agwi-lab.github.io/magnetoswarm/` on every push to `main`; or
2. **Source: "Deploy from a branch"** → `main` / `(root)` — no workflow needed (`.nojekyll` is included).

Nothing is built; the repository root *is* the site. External resources are limited to Google Fonts and
KaTeX (both from CDNs, both optional: the page works offline with system fonts and raw TeX in the help dialog).

## What is simulated (summary)

| Subsystem | Model | Where |
|---|---|---|
| Field sources | Exact in-plane fields: cuboid magnet (magnetic-charge solution), cylinder magnet / ideal solenoid / loop (Derby–Olbert, Bulirsch `cel`), point dipole, ideal uniform field + symmetric gradient; AC drives with phase (rotating fields), mechanical spin; exact superposition; Jacobian by per-source central differences | `js/fields/` |
| Magnetization | Sphere with demagnetization: `M = min(χ_eff H, M_s)`, `χ_eff = 3(χ_p−χ_f)/(3+χ_p+2χ_f)`; Langevin superparamagnetism; hard magnets with lag angle, step-out and asynchronous spin; explicit mutual induction between neighbours | `js/particles/dynamics.js` |
| Forces | Gradient force `J·m`; dipole–dipole pair forces (cell list, cut-off 8a); gravity/buoyancy; Stokes drag with Schiller–Naumann, Haberman–Sayre confinement and Faxén/Brenner wall anisotropy; added mass + unsteady pressure gradient; Saffman lift; motional eddy-current damping tensor `(2πσa⁵/15)J²`; time-averaged AC eddy force with the exact conducting-sphere polarizability; Brownian displacements | same |
| Contacts | Hard-sphere projection (Heyes–Melrose), wet restitution `e = e_dry·exp(−35/St)`, Coulomb stick–slip at the wall, wall rolling `v = α a Ω` for spinning hard particles | same |
| Integration | Backward Euler for the velocity with the full (anisotropic) drag tensor — exact overdamped limit, stable for inertial beads; adaptive sub-steps (field scale, pair approach, AC and pulse periods); hard-wall constraint is predictive (no penetration) | `js/sim/simulation.js` |
| Flow | Prescribed `Q(t)` (steady, sinusoidal, carotid-like pulse) decomposed into 10 harmonics; exact Womersley profile per harmonic (complex Bessel series), consistent pressure gradient, radial wall-motion velocity | `js/flow/flow.js` |
| Elastic tube | Catmull–Rom centre-line, taper, corrugation, Gaussian stenosis; Gent / neo-Hookean membrane tube law `p(λ)` inverted by Newton at 400 stations from the local transmural pressure (outlet + pulse + viscous/inertial drop) | `js/flow/tube.js` |
| Diagnostics | Re, Womersley α, Dean, Hartmann (warns when MHD would matter), Moens–Korteweg wave-length ratio, max stretch, Re_p, τ_p, Stokes, Péclet, Mason, F_mag/F_drag, settling velocity, capture efficiency, contacts, achieved speed | panel |

Everything is SI internally; the panel shows mm, µm, mT, kPa, mPa·s.

### Interaction between several sources

The field of every source is linear in its own strength, so the total field is the exact vector sum (no
mutual perturbation for air-core coils and rigid NdFeB magnets, whose coercivity ≫ the fields of the
other sources). What *does* change nonlinearly is the particle response: saturated particles feel
`F ∝ ∇|B|`, unsaturated ones `F ∝ ∇|B|²`, so two magnets do not simply "add their pull". Null planes
between opposing magnets expel soft particles; a Maxwell pair gives a uniform force; AC pairs in
quadrature give rotating fields. The force and torque that the other sources exert on each magnet are
displayed (equivalent-dipole estimate; conservative near contact) so you can judge mounting loads.

## Validation

```bash
npm run validate          # fields + dynamics + headless run of every preset (no dependencies)
npm i && npm run validate:ui   # optional: boots the full UI in jsdom + node-canvas, exercises 140+ controls
```

Results of the last run are in `validation/RESULTS.md`. Notable: cuboid field agrees with 600²-point
surface-charge quadrature to 1e-5; loop field with Biot–Savart to 2e-14; solenoid with 20 000 stacked
loops to 3e-8; Womersley profiles reproduce Poiseuille (α→0) and the prescribed flow rate to 2e-4;
settling, magnetophoretic and dipole–dipole velocities match closed forms to ≤1e-9.

**Erratum found in the source report:** the anti-Helmholtz (Maxwell, d = R) gradient coefficient is
`48/(25√5) ≈ 0.859` (= (3/2)(4/5)^{5/2}), not `(48/25)√(3/5) ≈ 1.49`; see `validation/validate_fields.js`.

## Limitations (deliberate)

* One-way coupling: particles do not disturb the flow (dilute suspensions); no hydrodynamic particle–particle interactions; no Basset history force.
* Non-conducting fluids: the Hartmann number is reported and flagged, MHD body forces are not solved.
* Plane of symmetry: 2D axial-plane kinematics; particle crowding in the third dimension is not represented.
* Air-core coils; permanent magnets with rigid magnetization; spheres only (no shape-anisotropy torques, no hysteresis).
* The tube law is a thin membrane (h₀/R₀ ≲ 0.2) under quasi-static, spatially uniform pulsation (L ≪ pulse wavelength — checked in the diagnostics); particle loads do not deform the wall.
* Strongly magnetic millimetre particles aggregate with forces far above drag; such clusters are physically correct but numerically stiff — reduce *Contact resolution* or disable dipole interactions for speed.

## Repository layout

```
index.html  css/style.css            page and styles
js/core      constants, numeric helpers, PRNG
js/fields    special functions (cel, complex Bessel), sources, FieldModel
js/flow      TubeGeometry (elastic tube), FlowModel (Womersley)
js/particles materials, Swarm storage, Dynamics
js/sim       presets, Simulation orchestrator
js/ui        Renderer (canvas), Controls (panel + interaction)
js/main.js   application bootstrap
docs/THEORY.md   equations, derivations, references, mapping to the report
validation/      independent numerical checks and headless smoke tests
```

License: MIT.
