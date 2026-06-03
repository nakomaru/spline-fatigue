/* ============================================================================
   Spline torsional-fatigue physics. Pure functions, no DOM.
   Every equation here is the same one used in the Python scripts; this file is
   the single source of truth and is unit-tested in node (see physics.test.js).
   ----------------------------------------------------------------------------
   Units: length mm, force N, stress MPa, torque held in N*mm internally,
          reported in N*m. Angles handled in radians internally.
============================================================================ */
(function (root) {
  "use strict";

  const PI = Math.PI;
  const deg = d => d * PI / 180;
  const tanh = Math.tanh, cosh = Math.cosh, sinh = Math.sinh;

  // ---- small helpers -------------------------------------------------------
  function linspace(a, b, n) {
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = a + (b - a) * i / (n - 1);
    return out;
  }
  function logspace(a, b, n) { // 10^a .. 10^b
    return linspace(a, b, n).map(e => Math.pow(10, e));
  }

  // ---- derived geometry ----------------------------------------------------
  function geometry(p) {
    const PCD = p.PCD;                           // fixed by the joint envelope
    const module = PCD / p.N;                    // m derived from PCD and tooth count
    const r = PCD / 2;
    const pitch = PI * module;                   // circular pitch at PCD
    const s_base = p.sbase_factor * pitch;       // tooth base thickness
    const h_work = p.hwork_factor * module;      // radial working/contact height
    const h_load = p.hload_factor * h_work;      // bending lever arm above root
    const n_c = (p.eng_pct / 100) * p.N;         // engaged teeth = engagement% x N
    const G = p.G;
    const Js = PI * Math.pow(p.d_root, 4) / 32;          // solid shaft
    const Jg = PI * (Math.pow(p.sleeve_OD, 4) - Math.pow(p.sleeve_bore, 4)) / 32;
    const GJs = G * Js, GJg = G * Jg;
    return { PCD, module, r, pitch, s_base, h_work, h_load, n_c, Js, Jg, GJs, GJg };
  }

  // ---- shear-lag load diffusion -------------------------------------------
  // beta^2 = k_theta * (1/GJs + 1/GJg) ;  k_theta = n_c * cp * r^2
  // cp given in N/mm/um  ->  N/mm^2 by x1000
  function shearLag(p, g) {
    const k_theta = g.n_c * (p.cp * 1000) * g.r * g.r;       // N
    const beta = Math.sqrt(k_theta * (1 / g.GJs + 1 / g.GJg)); // 1/mm
    const Leff = tanh(beta * p.L) / beta;
    return { k_theta, beta, oneOverBeta: 1 / beta, Leff };
  }
  // torque transferred per unit length at axial x (peak at x=0, the bite edge)
  function qOfX(beta, L, x, T_Nmm) {
    return T_Nmm * beta * cosh(beta * (L - x)) / sinh(beta * L);
  }
  function LeffOfL(beta, L) { return tanh(beta * L) / beta; }

  // ---- stress per unit torque (MPa per N*mm) ------------------------------
  // tooth root-fillet bending: q_peak = T/Leff ; sigma = 6 q_peak h_load Kf /(r n_c s_base^2)
  function toothStressPerT(p, g, Leff) {
    return 6 * g.h_load * p.Kf / (g.r * g.n_c * g.s_base * g.s_base * Leff);
  }
  // shaft root torsion principal: tau = Kt * 16 T /(pi d^3)
  function shaftStressPerT(p) {
    return p.Kt * 16 / (PI * Math.pow(p.d_root, 3));
  }

  // ---- material strengths --------------------------------------------------
  function strengths(p) {
    const sig_e = 0.42 * p.UTS * p.surf;   // bending endurance (R=-1), surface
    const tau_e = 0.29 * p.UTS * p.surf;   // torsion endurance (R=-1), surface
    const tau_u = 0.60 * p.UTS;            // shear ultimate
    const SIGF_tooth = sig_e / Math.pow(2e6, p.b);  // Basquin coef per mode
    const SIGF_shaft = tau_e / Math.pow(2e6, p.b);
    return { sig_e, tau_e, tau_u, SIGF_tooth, SIGF_shaft };
  }

  function goodmanPeak(se, su) { return 2 / (1 / se + 1 / su); } // R=0 peak allowed

  // ---- endurance-based torque capacity (N*m) ------------------------------
  function capTooth(p, g, S, Leff, dir) {
    const fret = dir === "bi" ? p.fret_bi : p.fret_uni;
    const strength = S.sig_e * fret;
    const peak = dir === "bi" ? strength : goodmanPeak(strength, p.UTS);
    return (peak / toothStressPerT(p, g, Leff)) / 1000;
  }
  function capShaft(p, S, dir) {
    const mx = dir === "bi" ? p.mxax_bi : p.mxax_uni;
    const strength = S.tau_e * mx;
    const peak = dir === "bi" ? strength : goodmanPeak(strength, S.tau_u);
    return (peak / shaftStressPerT(p)) / 1000;
  }

  // ---- equivalent reversed amplitude & Basquin life -----------------------
  function sarEff(p, g, S, T_Nm, mode, dir, Leff) {
    const T = T_Nm * 1000;
    let speak, knock, su;
    if (mode === "tooth") { speak = toothStressPerT(p, g, Leff) * T; knock = dir === "bi" ? p.fret_bi : p.fret_uni; su = p.UTS; }
    else { speak = shaftStressPerT(p) * T; knock = dir === "bi" ? p.mxax_bi : p.mxax_uni; su = S.tau_u; }
    let sar;
    // mean-stress correction uses the mode's ultimate (UTS for bending, shear-ultimate
    // for torsion) so life and capacity (capShaft/capTooth) stay consistent.
    if (dir === "uni") { const sa = speak / 2, sm = speak / 2; sar = sa / Math.max(1e-6, 1 - sm / su); }
    else sar = speak;
    return sar / knock;
  }
  function life(p, g, S, T_Nm, mode, dir, Leff) {
    const sar = sarEff(p, g, S, T_Nm, mode, dir, Leff);
    const sigf = mode === "tooth" ? S.SIGF_tooth : S.SIGF_shaft;
    if (sar >= sigf) return 0.5;
    return 0.5 * Math.pow(sar / sigf, 1 / p.b);
  }

  // ---- crossover effective length (tooth cap == shaft cap) ----------------
  function crossoverLeff(p, g, S, dir) {
    const shaft = capShaft(p, S, dir);
    let prev = null, prevL = null;
    for (let L = 4; L <= 120; L += 0.5) {
      const d = capTooth(p, g, S, L, dir) - shaft;
      if (prev !== null && (prev < 0) !== (d < 0)) {
        // linear interp
        return prevL + (0 - prev) * (L - prevL) / (d - prev);
      }
      prev = d; prevL = L;
    }
    return null;
  }

  // ============================================================================
  // master compute: everything the UI needs
  // ============================================================================
  function computeAll(p) {
    const g = geometry(p);
    const sl = shearLag(p, g);
    const S = strengths(p);
    const T_Nmm = p.T * 1000;

    // 1) load diffusion q(x)
    const xs = linspace(0, p.L, 120);
    const qx = xs.map(x => qOfX(sl.beta, p.L, x, T_Nmm) / 1000); // N*m per mm
    const q_peak = qx[0];

    // 2) L_eff vs engagement length L
    const Lgrid = linspace(4, Math.max(80, p.L * 1.4), 100);
    const LeffVsL = Lgrid.map(L => LeffOfL(sl.beta, L));
    const oneOverBetaLine = Lgrid.map(() => sl.oneOverBeta);

    // 3) mode competition vs Leff
    const Le = linspace(4, 80, 120);
    const tUni = Le.map(L => capTooth(p, g, S, L, "uni"));
    const tBi = Le.map(L => capTooth(p, g, S, L, "bi"));
    const sUni = Le.map(() => capShaft(p, S, "uni"));
    const sBi = Le.map(() => capShaft(p, S, "bi"));
    const xUni = crossoverLeff(p, g, S, "uni");
    const xBi = crossoverLeff(p, g, S, "bi");

    // 4) S-N at current Leff
    const Tgrid = linspace(Math.max(200, p.T * 0.25), p.T * 2.2, 120);
    const sn = {
      tUni: Tgrid.map(T => [life(p, g, S, T, "tooth", "uni", sl.Leff), T]),
      tBi: Tgrid.map(T => [life(p, g, S, T, "tooth", "bi", sl.Leff), T]),
      sUni: Tgrid.map(T => [life(p, g, S, T, "shaft", "uni", sl.Leff), T]),
      sBi: Tgrid.map(T => [life(p, g, S, T, "shaft", "bi", sl.Leff), T]),
    };

    // 5) Goodman diagram: strength lines + current load points
    const toothPeak = toothStressPerT(p, g, sl.Leff) * T_Nmm;
    const shaftPeak = shaftStressPerT(p) * T_Nmm;
    const goodman = {
      toothLine: [[0, S.sig_e], [p.UTS, 0]],
      shaftLine: [[0, S.tau_e], [S.tau_u, 0]],
      // load points (mean, amplitude)
      toothUni: [toothPeak / 2, toothPeak / 2],
      toothBi: [0, toothPeak],
      shaftUni: [shaftPeak / 2, shaftPeak / 2],
      shaftBi: [0, shaftPeak],
      UTS: p.UTS, tau_u: S.tau_u, sig_e: S.sig_e, tau_e: S.tau_e,
    };

    // 6) stress vs torque (linear) for each mode, with strength bands
    const stressVsT = {
      tooth: Tgrid.map(T => [T, toothStressPerT(p, g, sl.Leff) * T * 1000]),
      shaft: Tgrid.map(T => [T, shaftStressPerT(p) * T * 1000]),
      sig_e: S.sig_e, tau_e: S.tau_e,
    };

    // 7) fretting FFDP(x) (illustrative shapes from the diffusion + windup slip)
    const fx = linspace(0, p.L, 120);
    const press = fx.map(x => (qOfX(sl.beta, p.L, x, T_Nmm) / g.r) / Math.cos(deg(p.phi)) / (g.n_c * g.h_work));
    const slip = fx.map(x => p.slip0 * (0.15 + 0.85 * x / p.L));
    const sigt = fx.map(x => (qOfX(sl.beta, p.L, x, T_Nmm) / g.r) / g.h_work);
    const ffdp = fx.map((x, i) => sigt[i] * p.mu * press[i] * slip[i]);
    const fret_site = fx[ffdp.indexOf(Math.max(...ffdp))];

    // 8) sleeve bursting hoop stress (WHERE PRESSURE ANGLE MATTERS)
    // radial tooth load W_r = W_t*tan(phi) acts as internal pressure on the rim;
    // Lame hoop at the bore.  Thin rim or high pressure angle -> high hoop.
    const Ri = p.sleeve_bore / 2, Ro = p.sleeve_OD / 2;
    const lame = (Ro * Ro + Ri * Ri) / (Ro * Ro - Ri * Ri);
    const hoopPerT = (Math.tan(deg(p.phi)) / (g.r * PI * g.PCD * sl.Leff)) * lame * 1000; // MPa per N*m
    const bursting = {
      curve: Tgrid.map(T => [T, hoopPerT * T]),
      hoopAtT: hoopPerT * p.T,
      UTS: p.UTS, sig_e: S.sig_e, lame,
    };

    // governing mode at current Leff & torque
    // language-neutral codes; UI localizes them
    const govUni = capTooth(p, g, S, sl.Leff, "uni") < capShaft(p, S, "uni") ? "teeth" : "shaft";
    const govBi = capTooth(p, g, S, sl.Leff, "bi") < capShaft(p, S, "bi") ? "teeth" : "shaft";
    const lifeUni = Math.min(life(p, g, S, p.T, "tooth", "uni", sl.Leff), life(p, g, S, p.T, "shaft", "uni", sl.Leff));
    const lifeBi = Math.min(life(p, g, S, p.T, "tooth", "bi", sl.Leff), life(p, g, S, p.T, "shaft", "bi", sl.Leff));

    return {
      g, sl, S,
      readout: {
        PCD: g.PCD, module: g.module, n_c: g.n_c, r: g.r, GJs: g.GJs, GJg: g.GJg, stiffRatio: g.GJg / g.GJs,
        beta: sl.beta, oneOverBeta: sl.oneOverBeta, Leff: sl.Leff, q_peak,
        xUni, xBi, govUni, govBi, lifeUni, lifeBi,
        toothCapUni: capTooth(p, g, S, sl.Leff, "uni"), toothCapBi: capTooth(p, g, S, sl.Leff, "bi"),
        shaftCapUni: capShaft(p, S, "uni"), shaftCapBi: capShaft(p, S, "bi"),
        fret_site, hoopAtT: bursting.hoopAtT, sig_e: S.sig_e,
      },
      charts: {
        diffusion: { xs, qx, q_peak, Leff: sl.Leff },
        leffVsL: { Lgrid, LeffVsL, oneOverBetaLine, curL: p.L, curLeff: sl.Leff },
        modeComp: { Le, tUni, tBi, sUni, sBi, xUni, xBi, curLeff: sl.Leff },
        sn,
        goodman,
        stressVsT,
        fretting: { fx, press, slip, sigt, ffdp, fret_site },
        bursting,
      },
    };
  }

  const API = { computeAll, geometry, shearLag, strengths, linspace, logspace,
                LeffOfL, qOfX, capTooth, capShaft, life, crossoverLeff };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  root.Physics = API;
})(typeof window !== "undefined" ? window : globalThis);
