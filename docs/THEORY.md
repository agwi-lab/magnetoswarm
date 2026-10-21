# MagnetoSwarm — model, equations and numerical methods

This document records the physics implemented in the simulator, its derivation, the approximations
made relative to the full multiphysics formulation of the report *Comprehensive Mathematical Model:
Metallic Object Dynamics in Magnetically-Actuated Fluid-Filled Elastic Tubes* (hereafter "the report"),
and the validation performed. SI units throughout.

## 0. Reduced-order framing (report §12)

The report formulates five coupled subsystems (quasi-static Maxwell, Navier–Stokes with MHD, rigid-body
dynamics of the objects, hyperelastic wall, interface conditions). A browser simulation cannot solve the
resolved FSI/LBM problem; the simulator therefore implements the report's *reduced-order* route
(§12.1–12.4) consistently and exactly wherever closed forms exist:

* the applied field is prescribed analytically (§12.3) but **not** approximated — exact finite-size
  magnet, solenoid and loop solutions are used;
* fluid flow is the fully developed unsteady solution in a circular tube (Womersley), one-way coupled
  to point particles with finite-size corrections (§12.1, §12.2);
* objects are spheres with 3 translational degrees of freedom in the symmetry plane plus a
  quasi-static spin degree of freedom for hard magnets;
* the wall is a hyperelastic membrane obeying a tube law (§7.2 constitutive models, §2.3 kinematics),
  loaded by the fluid pressure only.

Dimensionless groups of §5.5 / §11.1 are evaluated live so that the user can see when an
approximation leaves its range (Re, α, Dean, Ha, St, Pe, Mason, pulse-wave-length ratio).

## 1. Magnetic field (report §3, §4)

### 1.1 Plane of simulation
The simulation plane contains the magnetization of block magnets (their mid-plane, z = 0) and the
axis of cylindrical magnets, solenoids and loops. By symmetry B_z ≡ 0 in this plane and the in-plane
field is exactly the 3-D field evaluated there. Out-of-plane forces vanish by the same symmetry.

### 1.2 Cuboid magnet
Uniform magnetization M = B_r/μ0 along the local x axis is equivalent to magnetic surface charges
σ = ±M on the faces x = ±L_x/2. Integrating the Coulomb kernel over a rectangular face gives, with
X = x − x_f, Y_i = y − y'_i, Z_j = z − z'_j, R_ij = √(X²+Y_i²+Z_j²), ε_ij = (−1)^{i+j}:

    H_x = (σ/4π) Σ_ij ε_ij atan( Y_i Z_j / (X R_ij) )          (solid-angle term)
    H_y = −(σ/4π) Σ_ij ε_ij ln( Z_j + R_ij )
    H_z = −(σ/4π) Σ_ij ε_ij ln( Y_i + R_ij )   (= 0 on z = 0)

B = μ0(H + M) inside, μ0 H outside (Engel-Herbert & Hesjedal 2005; Camacho & Sosa 2013).
Validated against a 600×600-point quadrature of the charge sheets (1e-5), the far-field dipole and
continuity of B_n across the pole face.

### 1.3 Cylinder magnet, ideal solenoid, loop
Derby & Olbert (Am. J. Phys. 78, 229, 2010) give, for a cylindrical current sheet of radius a and half
length b with B_0 = μ0 n I/π (solenoid) or μ0 M/π (axially magnetized cylinder):

    B_ρ = B_0 [ α₊ C(k₊,1,1,−1) − α₋ C(k₋,1,1,−1) ]
    B_z = B_0 a/(a+ρ) [ β₊ C(k₊,γ²,1,γ) − β₋ C(k₋,γ²,1,γ) ]
    z± = z ± b, α± = a/√(z±²+(ρ+a)²), β± = z±/√(z±²+(ρ+a)²), γ = (a−ρ)/(a+ρ),
    k± = √((z±²+(a−ρ)²)/(z±²+(a+ρ)²))

where C(k_c,p,c,s) = ∫₀^{π/2}(c cos²φ + s sin²φ)/((cos²φ + p sin²φ)√(cos²φ + k_c² sin²φ)) dφ is
Bulirsch's generalized complete elliptic integral, computed by his quadratically convergent
AGM-type algorithm `cel`. The b → 0 limit gives the single loop (their eqs. 11–13). Validated against
direct quadrature of C, Biot–Savart line integration (2e-14), 20 000 stacked loops (3e-8), the
elementary on-axis formula and the dipole far field.

### 1.4 Other sources
Point dipole B = (μ0/4π)[3(m·r̂)r̂ − m]/r³ (regularized inside a core radius); ideal "gradient-coil"
field B = R(B_0 ê_x + G·r_local) with a symmetric in-plane gradient matrix (the third diagonal element,
−G_xx−G_yy, is implied by ∇·B = 0 — report eq. for category D).

### 1.5 Superposition and time dependence
B(x,t) = Σ_s f_s(t) B̂_s(x; pose_s(t)), f = amp (DC) or amp·cos(2πft+φ) (AC), pose including a
mechanical spin ω_spin. Superposition is exact in non-magnetic media; NdFeB magnetization is treated as
rigid (coercivity ≫ applied fields). Two coil pairs with phases 0 and π/2 produce a rotating field.

### 1.6 Jacobian
J_ij = ∂B_i/∂x_j is symmetric outside the sources (∇×B = 0). It is evaluated per source by 4-point
central differences with step h = 10⁻⁴·(source size); truncation error O(h²) ≈ 1e-8 relative, round-off
negligible in double precision. The same evaluations provide B (average of the four points, O(h²)).

### 1.7 Source–source interaction
Each magnet/coil is also a dipole of moment m_s (M V or N I π R²) in the field of the others:
F = ∇(m·B), τ_z = m × B evaluated at its centre (leading order). This is displayed as a mounting-load
indicator; it does not alter the fields (rigid mounts assumed).

## 2. Magnetization of the objects (report §6.3)

Local field at a particle: H_loc = B/μ0 + Σ_j (1/4π)[3(m_j·r̂)r̂ − m_j]/r³ (neighbours within 8a,
previous-step moments — explicit mutual induction, one fixed-point iteration per step).

* **Linear para-/diamagnetic and soft ferromagnetic spheres.** The exact response of a sphere of
  susceptibility χ_p in a medium χ_f to a uniform field is m = 3V(χ_p−χ_f)/(3+χ_p+2χ_f) H, i.e.
  demagnetization-limited (χ_eff → 3 for χ_p ≫ 1). Saturation: |M| ≤ M_s. This reproduces the
  magnetic-drug-targeting model of Furlani & Ng (2006). Negative Δχ (diamagnetic objects, or weakly
  paramagnetic objects in paramagnetic fluids) gives repulsion from field maxima, as in MagLev.
* **Superparamagnetic clusters.** M = M_s L(ξ), ξ = μ0 M_s V_core H/(k_B T), V_core from the core
  diameter (default 12 nm).
* **Hard magnets.** |M| = M_r. In a field rotating at ω_f the quasi-static torque balance
  M_r V B sin φ = 8π μ a³ Ω gives the lag angle φ = asin(ω_f/ω_so), ω_so = M_r V B/(8πμa³); above
  step-out the time-averaged spin is Ω = ω_f − √(ω_f² − ω_so²) (Helgesen et al. 1990; used in the
  micro-robotics literature). The alignment time 8πμa³/(M_r V B) is ≪ 1 ms for all presets, so a
  quasi-static orientation is exact for practical purposes.

## 3. Equation of motion (report §6.1, §5.4, §6.4)

    m_eff dv/dt = −Γ_d (v − u) − C v + J m + Σ_j F_dd,ij + (ρ_p − ρ_f) V g
                  + (3/2) ρ_f V Du/Dt + F_L + F_ac + F_contact

* **m_eff = ρ_p V + ½ ρ_f V** (added mass); the fluid-acceleration force (pressure gradient + added
  mass of the fluid part) is (3/2)ρ_f V Du/Dt with Du/Dt ≈ ∂u/∂t from the harmonic decomposition.
* **Drag** Γ_d = 6πμa K(a/R)(1 + 0.15 Re_p^0.687)[f∥ t̂t̂ + f⊥ n̂n̂]: Stokes drag, Schiller–Naumann
  (Re_p < 1000), Haberman–Sayre centre-line confinement K(λ) (λ = a/R ≤ 0.9), Faxén parallel and
  Brenner/Lorentz perpendicular near-wall factors (clamped at gap 0.05a). The tensor is anisotropic
  near the wall, which the implicit solve handles exactly.
* **Eddy-current damping.** A conducting sphere moving through a static non-uniform field sees
  dB/dt = (v·∇)B in its frame; the induced quasi-static moment is m = −(2πσa⁵/15) dB/dt (valid for
  a ≪ skin depth), and the force on it is F = (m·∇)B = −C v with C_ik = (2πσa⁵/15) Σ_j ∂_iB_j ∂_kB_j =
  (2πσa⁵/15)(J²)_ik, a positive semi-definite damping tensor. This is the rigorous low-Rm version of the
  report's eddy term (whose uniform-field form has zero mean force).
* **AC eddy force.** For harmonic fields, the exact polarizability of a conducting sphere
  (Landau & Lifshitz §59) χ(ω) = −(3/2)[1 − 3/x² + 3 cot x/x], x = (1+i)a/δ, δ = √(2/(μ0σω)), gives
  the time-averaged force ⟨F_i⟩ = (V/2μ0) Re[χ Σ_j B̂_j (∂_i B̂_j)*] with B̂ the complex field amplitude
  accumulated per frequency. Low-frequency limit χ ≈ i μ0σωa²/10 − (μ0σωa²)²/105 (repulsive
  real part), skin-effect limit χ → −3/2 (both verified numerically).
* **Dipole–dipole** F_ij = (3μ0/4πr⁴)[(m_i·r̂)m_j + (m_j·r̂)m_i + (m_i·m_j − 5(m_i·r̂)(m_j·r̂))r̂],
  cut-off 8a (force ratio 2e-4), cell-list neighbour search.
* **Saffman lift** F_L = 6.46 μ a² sgn(γ̇) √(|γ̇|/ν)(u_t − v_t) n̂ (Saffman 1965; valid for small shear
  Reynolds number — optional).
* **Brownian motion**: displacements √(2D dt)ξ with D = k_B T/γ (isotropic; relevant below ~1 µm).

### 3.1 Contacts and wall
Following the report's recommendation to calibrate DEM contact parameters, but noting that explicit
Hertz–Mindlin springs with realistic stiffness would need sub-microsecond steps (and are meaningless for
overdamped micro-particles), contacts are treated as **hard-sphere constraints**:

* non-penetration by position projection (Heyes & Melrose 1993), mobility-weighted between particles;
* normal collisions with the wet coefficient of restitution e = e_dry exp(−35/St),
  St = (ρ_p + ½ρ_f) d |v_n|/(9μ) (Legendre, Zenit & Magnaudet 2006; Joseph et al. 2001): no rebound
  for St ≲ 10, dry value for St ≳ 500;
* at the wall the unilateral constraint v_n ≤ Ṙ (the wall's own radial velocity) is imposed predictively
  (no penetration within a step); the implied normal reaction λ_N = A_nn(v_n^free − Ṙ) feeds Coulomb
  friction: stick if |A_tt v_t^free| ≤ μ_f λ_N, otherwise slide with the friction force μ_f λ_N. In the
  overdamped limit this is exactly "stick iff |F_t + γu_t| ≤ μ_f F_N";
* spinning hard particles in wall contact translate with v = α a Ω (α < 1 accounts for lubrication
  slip; Goldman, Cox & Brenner 1967; rolling micro-robot experiments).

### 3.2 Time integration
Velocity: backward Euler, ((m_eff/dt) I + Γ_d + C) v_new = (m_eff/dt) v_old + Γ_d u + F — a 2×2
solve per particle. For m_eff/dt → 0 it is the exact overdamped (Maxey–Riley quasi-steady, report
§12.4) solution; for inertial beads it is first-order accurate and unconditionally stable. Positions:
explicit with v_new, then constraints. Sub-step size: min of the user maximum, 2 % of the tube radius
per step at the fastest particle, the pair-approach criterion (contactRes·a_min / max relative
velocity of pairs not yet in contact, bounded to ≤ 50× slowdown), 0.1/ω for AC drives and spinning
magnets, 1 % of the pulse period, 0.2/Ω for spinning particles.

## 4. Flow (report §5.3)

Prescribed flow rate Q(t) = Q_mean w(t), w = Re Σ_n c_n e^{inωt} (10 harmonics of a steady, sinusoidal
or carotid-like waveform). For each harmonic the exact Womersley solution of the unsteady Stokes
equations in a rigid circular tube is used, normalised to unit cross-sectional mean:

    Φ_n(ξ) = [1 − J0(Λ_n ξ)/J0(Λ_n)] / [1 − 2J1(Λ_n)/(Λ_n J0(Λ_n))],  Λ_n = i^{3/2} α_n, α_n = R√(nω/ν)
    u(ξ,t) = Q_mean/(πR²) Re Σ_n c_n Φ_n(ξ) e^{inωt},  Φ_0 = 2(1−ξ²)

with the consistent pressure gradient ∂p/∂s|_n = −inωρ Q̂_n/(πR² D_n), D_n = 1 − 2J1/(ΛJ0), reducing
to −8μQ/(πR⁴) for n = 0. Complex Bessel functions are summed as power series (α capped at 25). The
profile shape uses α at the reference radius; the local mean velocity uses the local deformed radius
(quasi-fully-developed flow in slowly varying, gently curved tubes — Dean number displayed). The
radial velocity u_r = (r/R)Ṙ of a dilating cross-section is added so that the no-slip wall condition
u = ẇ_wall of §5.3 holds.

## 5. Elastic wall (report §7, §2.3)

For an incompressible isotropic hyperelastic membrane with circumferential stretch λ = R/R0, axial
stretch 1 and negligible radial stress, Laplace's law p = σ_θ h/R with h = h0/λ gives the tube law

    p(λ) = (G h0/R0) (1 − λ⁻⁴) / (1 − (λ² + λ⁻² − 2)/J_m)

for the Gent model (J_m → ∞: neo-Hookean; Mooney–Rivlin with λ_z = 1 is identical with G → 2(C10+C01)).
The pressure saturates at G h0/R0 for neo-Hookean walls (limit-point instability), while the Gent
limit J_m provides strain stiffening (arteries: J_m ≈ 2.5). λ(s,t) is obtained by safeguarded Newton
iteration at 400 stations from the local transmural pressure p(s,t) = p_out + p_pulse(t) +
∫_s^L(−∂p/∂s) ds'. Validity: h0/R0 ≲ 0.2, quasi-static inflation, tube length ≪ Moens–Korteweg
wavelength c/f with c = √(E h/(2ρR)) (ratio shown). Particle-induced wall indentation is negligible
(Hertz estimate: nanometres for micro-particles).

## 6. Validation summary

`validation/validate_fields.js` (14 checks) and `validation/validate_dynamics.js` (14 checks) are
dependency-free Node scripts; `smoke_sim.js` runs every preset headlessly; `smoke_ui.js` boots the full
page in jsdom + node-canvas. See `validation/RESULTS.md`.

## 7. Errata / remarks on the report

* Anti-Helmholtz (Maxwell) gradient for coil spacing d = R: G = (3/2)(4/5)^{5/2} μ0NI/R² =
  48/(25√5) μ0NI/R² ≈ 0.859 μ0NI/R², not (48/25)√(3/5) ≈ 1.49.
* The eddy-current drag formula quoted for a sphere in a *uniform* field (∝ (v×B)×B) has zero
  steady force in the quasi-static limit (charges redistribute electrostatically); the braking force
  arises from field *gradients* and is the tensor C above.
* 304 stainless steel is austenitic and essentially non-ferromagnetic; the ferritic grade 430 is used
  for the "steel" material.

## References

* Derby N., Olbert S., *Cylindrical magnets and ideal solenoids*, Am. J. Phys. 78, 229 (2010).
* Bulirsch R., *Numerical calculation of elliptic integrals and elliptic functions*, Numer. Math. 7, 78 (1965).
* Engel-Herbert R., Hesjedal T., *Calculation of the magnetic stray field of a uniaxial magnetic domain*, J. Appl. Phys. 97, 074504 (2005).
* Furlani E. P., Ng K. C., *Analytical model of magnetic nanoparticle transport and capture in the microvasculature*, Phys. Rev. E 73, 061919 (2006).
* Womersley J. R., *Method for the calculation of velocity, rate of flow and viscous drag in arteries when the pressure gradient is known*, J. Physiol. 127, 553 (1955).
* Landau L. D., Lifshitz E. M., *Electrodynamics of Continuous Media*, §59 (conducting sphere in an AC field).
* Schiller L., Naumann A., Z. Ver. Dtsch. Ing. 77, 318 (1933). Haberman W. L., Sayre R. M., DTMB Report 1143 (1958). Happel J., Brenner H., *Low Reynolds Number Hydrodynamics* (Faxén, Brenner wall factors).
* Saffman P. G., *The lift on a small sphere in a slow shear flow*, J. Fluid Mech. 22, 385 (1965).
* Joseph G. G., Zenit R., Hunt M. L., Rosenwinkel A. M., *Particle–wall collisions in a viscous fluid*, J. Fluid Mech. 433, 329 (2001). Legendre D., Zenit R., Daniel C., Guiraud P., *A note on the modelling of the bouncing of spherical drops or solid spheres on a wall in viscous fluid*, Chem. Eng. Sci. 61, 3543 (2006).
* Heyes D. M., Melrose J. R., *Brownian dynamics simulations of model hard-sphere suspensions*, J. Non-Newtonian Fluid Mech. 46, 1 (1993).
* Goldman A. J., Cox R. G., Brenner H., *Slow viscous motion of a sphere parallel to a plane wall*, Chem. Eng. Sci. 22, 637 (1967).
* Helgesen G., Pieranski P., Skjeltorp A. T., *Nonlinear phenomena in systems of magnetic holes*, Phys. Rev. Lett. 64, 1425 (1990) (step-out / asynchronous rotation).
* Gent A. N., *A new constitutive relation for rubber*, Rubber Chem. Technol. 69, 59 (1996); Anand V., *A catalog of pressure drop, deformation profile and tube laws for slender hyperelastic tubes*, arXiv:2209.05335 (2022).
* Recent swarm / micro-roller context: Propulsion mechanisms in magnetic microrobotics — from single microrobots to swarms (2025 review); microrobot vascular path planning with wall-coupled rolling v = α·2πfR (arXiv:2509.05500, 2025).
