/* ============================================================================
   Spline torsional-fatigue physics. Pure functions, no DOM.
   Single source of truth for the equations; unit-tested in node (physics.test.js).
   ----------------------------------------------------------------------------
   Units: length mm, force N, stress MPa, torque held in N*mm internally,
          reported in N*m. Angles handled in radians internally.

   The model resolves a set of standard geometry/material COEFFICIENTS from real
   spline specs (each can be overridden manually), then runs the same shear-lag /
   Lewis-bending / Basquin chain as before.  resolve(p) returns every resolved
   value so the UI can show it with its formula.
============================================================================ */
(function (root) {
  "use strict";

  const PI = Math.PI;
  const deg = d => d * PI / 180;
  const inv = a => Math.tan(a) - a;                 // involute function, a in rad
  const tanh = Math.tanh, cosh = Math.cosh, sinh = Math.sinh;
  const log10 = Math.log10;

  function linspace(a, b, n) {
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = a + (b - a) * i / (n - 1);
    return out;
  }

  // Shigley fatigue-strength fraction f (for the Basquin-exponent estimate)
  function fFrac(Sut) {
    if (Sut <= 490) return 0.90;
    if (Sut >= 1400) return 0.77;
    return 0.90 + (0.77 - 0.90) * (Sut - 490) / (1400 - 490);
  }

  // Marin surface factor k_a = a*UTS^b, by finish (Shigley, UTS in MPa)
  const KA = { ground: [1.58, -0.085], machined: [4.51, -0.265],
               hotrolled: [57.7, -0.718], forged: [272.0, -0.995] };

  // ==========================================================================
  // resolve: real specs (+ optional manual overrides) -> all coefficients
  // ==========================================================================
  function resolve(p) {
    const PCD = p.PCD, N = p.N, r = PCD / 2, module = PCD / N, pitch = PI * module;
    const alpha = deg(p.phi);
    const n_c = (p.eng_pct / 100) * N;

    // --- working depth h_work (engaged flank height) ------------------------
    const h_work_auto = module;                          // ISO 4156 nominal: working depth ~ module
    const h_work = p.hwork_mode === "manual" ? p.hwork_manual : h_work_auto;

    // --- tooth root critical-section thickness s_base -----------------------
    // involute chordal thickness at the root-form circle (radius r - h_work)
    const rb = r * Math.cos(alpha);
    let r_root = r - h_work;
    if (r_root < rb * 1.0005) r_root = rb * 1.0005;      // stay above base circle
    const s_pitch = pitch / 2;                           // equal tooth/space at pitch
    const alpha_root = Math.acos(rb / r_root);
    const s_base_auto = 2 * r_root * (s_pitch / (2 * r) + inv(alpha) - inv(alpha_root));
    const s_base = p.sbase_mode === "manual" ? p.sbase_manual : s_base_auto;

    // --- bending moment arm h_load by load position -------------------------
    const add = 0.5 * module;                            // spline addendum ~ 0.5 m
    let D_load;
    if (p.hload_mode === "tip") D_load = PCD + 2 * add;
    else if (p.hload_mode === "hpstc") D_load = PCD + add;
    else D_load = PCD;                                   // pitch-line (default)
    const h_load_auto = D_load / 2 - r_root;
    const h_load = p.hload_mode === "manual" ? p.hload_manual : h_load_auto;

    // --- tooth fillet SCF Kf (Dolan-Broghamer, AGMA 908) --------------------
    // H,L,M linear in pressure angle, anchored to the 20deg/25deg gear values
    const dphi = p.phi - 20;
    const H = 0.34 - 0.0018 * dphi, Lc = 0.316 + 0.0016 * dphi, Mc = 0.408 - 0.0022 * dphi;
    const Kf_auto = Math.max(1, H + Math.pow(s_base / p.r_fillet, Lc) * Math.pow(s_base / h_load, Mc));
    const Kf = p.Kf_mode === "manual" ? p.Kf_manual : Kf_auto;

    // --- shaft root SCF Kt (torsion) ----------------------------------------
    // Neuber elliptical-notch estimate, torsion-reduced; upper bound, prefer FE/chart
    const Kt_auto = 1 + 2 * Math.sqrt(h_work / p.r_fillet) * 0.62;
    const Kt = p.Kt_mode === "auto" ? Kt_auto : p.Kt_manual;

    // --- mesh stiffness cp (N/mm/um) ----------------------------------------
    const qprime = 0.04723 + 0.41342 / N;                // ISO 6336-1, x=0, internal-external
    const cp_iso = 0.8 / qprime;                         // c' = CM/q', CM ~ 0.8
    const cp_eff = p.cp_mode === "iso" ? cp_iso : p.cp_manual;

    // --- torsional stiffnesses ----------------------------------------------
    const G = p.G;
    const Js = PI * Math.pow(p.d_root, 4) / 32;
    const Jg = PI * (Math.pow(p.sleeve_OD, 4) - Math.pow(p.sleeve_bore, 4)) / 32;
    const GJs = G * Js, GJg = G * Jg;

    // --- shear-lag diffusion ------------------------------------------------
    const k_theta = n_c * (cp_eff * 1000) * r * r;       // cp N/mm/um -> N/mm^2 (x1000)
    const beta = Math.sqrt(k_theta * (1 / GJs + 1 / GJg));
    const Leff = tanh(beta * p.L) / beta;

    // --- material strengths --------------------------------------------------
    const [ka_a, ka_b] = KA[p.finish] || KA.machined;
    const ka = ka_a * Math.pow(p.UTS, ka_b);
    const d = p.d_root;
    const kb = d <= 51 ? Math.pow(d / 7.62, -0.107) : 1.51 * Math.pow(d, -0.157);
    const surf_auto = Math.min(1, ka * kb);
    const surf = p.surf_mode === "manual" ? p.surf_manual : surf_auto;

    const sig_e = 0.42 * p.UTS * surf;                   // bending endurance (R=-1)
    const tau_e = 0.29 * p.UTS * surf;                   // torsion endurance (R=-1)
    const tau_u = 0.60 * p.UTS;                          // shear ultimate

    const b_auto = -log10(2 * fFrac(p.UTS)) / 3;         // Basquin slope estimate
    const b = p.b_mode === "manual" ? p.b_manual : b_auto;
    const SIGF_tooth = sig_e / Math.pow(2e6, b);
    const SIGF_shaft = tau_e / Math.pow(2e6, b);

    // --- fretting knockdowns from the Ruiz FFDP ------------------------------
    // peak flank contact pressure (MPa) at the bite edge, and FFDP severity
    const T_Nmm = p.T * 1000;
    const q0 = T_Nmm * beta * cosh(beta * p.L) / sinh(beta * p.L);   // torque/length at x=0
    const press_peak = (q0 / r) / (n_c * Math.cos(alpha) * h_work);  // MPa
    const ffdp = p.mu * press_peak * p.slip0;                        // MPa*um (Ruiz)
    const fret_uni = 1 / (1 + ffdp / p.fret_anchor);                 // one flank reworked
    const fret_bi = 1 / (1 + 0.5 * ffdp / p.fret_anchor);            // damage split over two flanks

    return {
      // geometry
      PCD, N, r, module, pitch, n_c, h_work, s_base, h_load, D_load,
      r_fillet: p.r_fillet, d_root: p.d_root,
      // coefficients
      Kf, Kf_auto, Kt, Kt_auto, cp_eff, cp_iso,
      // stiffness / diffusion
      G, Js, Jg, GJs, GJg, stiffRatio: GJg / GJs, k_theta, beta, oneOverBeta: 1 / beta, Leff,
      // material
      surf, surf_auto, ka, kb, sig_e, tau_e, tau_u, b, b_auto, SIGF_tooth, SIGF_shaft, UTS: p.UTS,
      // fretting / direction
      press_peak, ffdp, fret_uni, fret_bi, mxax_uni: p.mxax_uni, mxax_bi: p.mxax_bi,
    };
  }

  // ---- stress per unit torque (MPa per N*mm) ------------------------------
  function toothStressPerT(R, Leff) {
    return 6 * R.h_load * R.Kf / (R.r * R.n_c * R.s_base * R.s_base * Leff);
  }
  function shaftStressPerT(R) {
    return R.Kt * 16 / (PI * Math.pow(R.d_root, 3));
  }
  const goodmanPeak = (se, su) => 2 / (1 / se + 1 / su);  // R=0 peak allowed

  // ---- endurance-based torque capacity (N*m) ------------------------------
  function capTooth(R, Leff, dir) {
    const fret = dir === "bi" ? R.fret_bi : R.fret_uni;
    const strength = R.sig_e * fret;
    const peak = dir === "bi" ? strength : goodmanPeak(strength, R.UTS);
    return (peak / toothStressPerT(R, Leff)) / 1000;
  }
  function capShaft(R, dir) {
    const mx = dir === "bi" ? R.mxax_bi : R.mxax_uni;
    const strength = R.tau_e * mx;
    const peak = dir === "bi" ? strength : goodmanPeak(strength, R.tau_u);
    return (peak / shaftStressPerT(R)) / 1000;
  }

  // ---- equivalent reversed amplitude & Basquin life -----------------------
  function sarEff(R, T_Nm, mode, dir, Leff) {
    const T = T_Nm * 1000;
    let speak, knock, su;
    if (mode === "tooth") { speak = toothStressPerT(R, Leff) * T; knock = dir === "bi" ? R.fret_bi : R.fret_uni; su = R.UTS; }
    else { speak = shaftStressPerT(R) * T; knock = dir === "bi" ? R.mxax_bi : R.mxax_uni; su = R.tau_u; }
    let sar;
    if (dir === "uni") { const sa = speak / 2, sm = speak / 2; sar = sa / Math.max(1e-6, 1 - sm / su); }
    else sar = speak;
    return sar / knock;
  }
  function life(R, T_Nm, mode, dir, Leff) {
    const sar = sarEff(R, T_Nm, mode, dir, Leff);
    const sigf = mode === "tooth" ? R.SIGF_tooth : R.SIGF_shaft;
    if (sar >= sigf) return 0.5;
    return 0.5 * Math.pow(sar / sigf, 1 / R.b);
  }

  function crossoverLeff(R, dir) {
    const shaft = capShaft(R, dir);
    let prev = null, prevL = null;
    for (let L = 4; L <= 120; L += 0.5) {
      const d = capTooth(R, L, dir) - shaft;
      if (prev !== null && (prev < 0) !== (d < 0)) return prevL + (0 - prev) * (L - prevL) / (d - prev);
      prev = d; prevL = L;
    }
    return null;
  }

  function qOfX(beta, L, x, T_Nmm) { return T_Nmm * beta * cosh(beta * (L - x)) / sinh(beta * L); }
  function LeffOfL(beta, L) { return tanh(beta * L) / beta; }

  // ==========================================================================
  // master compute: everything the UI needs
  // ==========================================================================
  function computeAll(p) {
    const R = resolve(p);
    const T_Nmm = p.T * 1000;

    // 1) load diffusion q(x)
    const xs = linspace(0, p.L, 120);
    const qx = xs.map(x => qOfX(R.beta, p.L, x, T_Nmm) / 1000);   // N*m per mm
    const q_peak = qx[0];

    // 2) L_eff vs engagement length L
    const Lgrid = linspace(4, Math.max(80, p.L * 1.4), 100);
    const LeffVsL = Lgrid.map(L => LeffOfL(R.beta, L));
    const oneOverBetaLine = Lgrid.map(() => R.oneOverBeta);

    // 3) mode competition vs Leff
    const Le = linspace(4, 80, 120);
    const tUni = Le.map(L => capTooth(R, L, "uni"));
    const tBi = Le.map(L => capTooth(R, L, "bi"));
    const sUni = Le.map(() => capShaft(R, "uni"));
    const sBi = Le.map(() => capShaft(R, "bi"));
    const xUni = crossoverLeff(R, "uni");
    const xBi = crossoverLeff(R, "bi");

    // 4) S-N at current Leff
    const Tgrid = linspace(Math.max(200, p.T * 0.25), p.T * 2.2, 120);
    const sn = {
      tUni: Tgrid.map(T => [life(R, T, "tooth", "uni", R.Leff), T]),
      tBi: Tgrid.map(T => [life(R, T, "tooth", "bi", R.Leff), T]),
      sUni: Tgrid.map(T => [life(R, T, "shaft", "uni", R.Leff), T]),
      sBi: Tgrid.map(T => [life(R, T, "shaft", "bi", R.Leff), T]),
    };

    // 5) Goodman diagram
    const toothPeak = toothStressPerT(R, R.Leff) * T_Nmm;
    const shaftPeak = shaftStressPerT(R) * T_Nmm;
    const goodman = {
      toothLine: [[0, R.sig_e], [R.UTS, 0]], shaftLine: [[0, R.tau_e], [R.tau_u, 0]],
      toothUni: [toothPeak / 2, toothPeak / 2], toothBi: [0, toothPeak],
      shaftUni: [shaftPeak / 2, shaftPeak / 2], shaftBi: [0, shaftPeak],
      UTS: R.UTS, tau_u: R.tau_u, sig_e: R.sig_e, tau_e: R.tau_e,
    };

    // 6) stress vs torque
    const stressVsT = {
      tooth: Tgrid.map(T => [T, toothStressPerT(R, R.Leff) * T * 1000]),
      shaft: Tgrid.map(T => [T, shaftStressPerT(R) * T * 1000]),
      sig_e: R.sig_e, tau_e: R.tau_e,
    };

    // 7) fretting FFDP(x)
    const fx = linspace(0, p.L, 120);
    const press = fx.map(x => (qOfX(R.beta, p.L, x, T_Nmm) / R.r) / (R.n_c * Math.cos(deg(p.phi)) * R.h_work));
    const slip = fx.map(x => p.slip0 * (0.15 + 0.85 * x / p.L));
    const sigt = fx.map(x => (qOfX(R.beta, p.L, x, T_Nmm) / R.r) / R.h_work);
    const ffdp = fx.map((x, i) => p.mu * press[i] * slip[i]);
    const fret_site = fx[ffdp.indexOf(Math.max(...ffdp))];

    // 8) sleeve bursting hoop (pressure angle enters via W_r = W_t*tan a)
    const Ri = p.sleeve_bore / 2, Ro = p.sleeve_OD / 2;
    const lame = (Ro * Ro + Ri * Ri) / (Ro * Ro - Ri * Ri);
    const hoopPerT = (Math.tan(deg(p.phi)) / (R.r * PI * R.PCD * R.Leff)) * lame * 1000;
    const bursting = { curve: Tgrid.map(T => [T, hoopPerT * T]), hoopAtT: hoopPerT * p.T, UTS: R.UTS, sig_e: R.sig_e, lame };

    const govUni = capTooth(R, R.Leff, "uni") < capShaft(R, "uni") ? "teeth" : "shaft";
    const govBi = capTooth(R, R.Leff, "bi") < capShaft(R, "bi") ? "teeth" : "shaft";
    const lifeUni = Math.min(life(R, p.T, "tooth", "uni", R.Leff), life(R, p.T, "shaft", "uni", R.Leff));
    const lifeBi = Math.min(life(R, p.T, "tooth", "bi", R.Leff), life(R, p.T, "shaft", "bi", R.Leff));

    return {
      R,
      readout: {
        PCD: R.PCD, module: R.module, n_c: R.n_c, r: R.r,
        h_work: R.h_work, s_base: R.s_base, h_load: R.h_load,
        Kf: R.Kf, Kt: R.Kt, cp_eff: R.cp_eff,
        GJs: R.GJs, GJg: R.GJg, stiffRatio: R.stiffRatio,
        beta: R.beta, oneOverBeta: R.oneOverBeta, Leff: R.Leff, q_peak,
        surf: R.surf, b: R.b, sig_e: R.sig_e, tau_e: R.tau_e, tau_u: R.tau_u,
        ffdp: R.ffdp, press_peak: R.press_peak, fret_uni: R.fret_uni, fret_bi: R.fret_bi,
        xUni, xBi, govUni, govBi, lifeUni, lifeBi,
        toothCapUni: capTooth(R, R.Leff, "uni"), toothCapBi: capTooth(R, R.Leff, "bi"),
        shaftCapUni: capShaft(R, "uni"), shaftCapBi: capShaft(R, "bi"),
        fret_site, hoopAtT: bursting.hoopAtT,
      },
      charts: {
        diffusion: { xs, qx, q_peak, Leff: R.Leff },
        leffVsL: { Lgrid, LeffVsL, oneOverBetaLine, curL: p.L, curLeff: R.Leff },
        modeComp: { Le, tUni, tBi, sUni, sBi, xUni, xBi, curLeff: R.Leff },
        sn, goodman, stressVsT,
        fretting: { fx, press, slip, sigt, ffdp, fret_site },
        bursting,
      },
    };
  }

  const API = { computeAll, resolve, linspace, LeffOfL, qOfX,
                toothStressPerT, shaftStressPerT, capTooth, capShaft, life, sarEff, crossoverLeff };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  root.Physics = API;
})(typeof window !== "undefined" ? window : globalThis);
