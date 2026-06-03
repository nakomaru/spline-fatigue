// sanity check: reproduce the Python numbers and exercise the resolved coefficients
const P = require("./physics.js");

// the user's actual joint (manual coefficients pinned to the prior validated run)
const p = {
  PCD: 56.6667, N: 34, phi: 30, eng_pct: 100 * 12 / 34,
  L: 58, r_fillet: 0.45, d_root: 55.512, sleeve_OD: 90, sleeve_bore: 56.666, G: 80000,
  hwork_mode: "manual", hwork_manual: 0.9 * (56.6667 / 34),
  sbase_mode: "manual", sbase_manual: 0.63 * Math.PI * (56.6667 / 34),
  hload_mode: "manual", hload_manual: 0.55 * 0.9 * (56.6667 / 34),
  Kf_mode: "manual", Kf_manual: 2.0,
  Kt_mode: "manual", Kt_manual: 3.0,
  cp_mode: "manual", cp_manual: 14,
  finish: "machined", surf_mode: "manual", surf_manual: 0.75,
  b_mode: "manual", b_manual: -0.09,
  UTS: 2000, mxax_uni: 1.0, mxax_bi: 0.85,
  fret_anchor: 60, T: 5000, slip0: 0.6, mu: 0.30,
};

const R = P.resolve(p);
const f = (x, d = 2) => Number(x).toFixed(d);

console.log("== reproduce prior validated run (manual coefficients) ==");
console.log("GJ_shaft       =", R.GJs.toExponential(3), "(py 7.458e10)");
console.log("GJ_sleeve      =", R.GJg.toExponential(3), "(py 4.343e11)");
console.log("beta           =", f(R.beta, 4), "1/mm   1/beta =", f(R.oneOverBeta, 1), "(py 21.7)");
console.log("L_eff          =", f(R.Leff, 2), "mm     (py 21.5)");
console.log("crossover uni  =", f(P.crossoverLeff(R, "uni"), 1), "mm     (py ~42.6)");
console.log("crossover bi   =", f(P.crossoverLeff(R, "bi"), 1), "mm     (py ~31.9)");
console.log("shaft cap uni  =", f(P.capShaft(R, "uni"), 0), "N*m  (py 7149)");
console.log("shaft cap bi   =", f(P.capShaft(R, "bi"), 0), "N*m  (py 4140)");

console.log("\n== consistency (capacity torque should give Nf ~ 1e6) ==");
for (const [mode, dir] of [["tooth", "uni"], ["tooth", "bi"], ["shaft", "uni"], ["shaft", "bi"]]) {
  const Tcap = mode === "tooth" ? P.capTooth(R, 36, dir) : P.capShaft(R, dir);
  const Nf = P.life(R, Tcap, mode, dir, 36);
  const ok = Nf > 7e5 && Nf < 1.4e6 ? "OK" : "MISMATCH";
  console.log(`  ${mode}/${dir}: Tcap=${Tcap.toFixed(0)} N*m -> Nf=${Nf.toExponential(2)}  [${ok}]`);
}

// now the AUTO coefficients, for picking generic defaults
const auto = {
  PCD: 60, N: 24, phi: 30, eng_pct: 100, L: 40, r_fillet: 0.45,
  d_root: 57, sleeve_OD: 95, sleeve_bore: 58, G: 80000,
  hwork_mode: "auto", sbase_mode: "auto", hload_mode: "pitch",
  Kf_mode: "auto", Kt_mode: "manual", Kt_manual: 3.0, cp_mode: "iso",
  finish: "machined", surf_mode: "auto", b_mode: "auto",
  UTS: 1500, mxax_uni: 1.0, mxax_bi: 0.85, fret_anchor: 60,
  T: 2500, slip0: 0.6, mu: 0.30,
};
const A = P.resolve(auto);
console.log("\n== auto-computed coefficients at generic defaults ==");
console.log("module      =", f(A.module, 3), "mm");
console.log("h_work auto =", f(A.h_work, 3), "mm  (= module)");
console.log("s_base auto =", f(A.s_base, 3), "mm  (involute @ root)");
console.log("h_load auto =", f(A.h_load, 3), "mm  (pitch-line)");
console.log("Kf auto     =", f(A.Kf, 3), " (Dolan-Broghamer)");
console.log("Kt auto est =", f(A.Kt_auto, 3), " (Neuber, upper bound)");
console.log("cp iso      =", f(A.cp_iso, 2), "N/mm/um (ISO 6336)");
console.log("surf auto   =", f(A.surf, 3), " (machined, d=57)  ka=", f(A.ka, 3), "kb=", f(A.kb, 3));
console.log("b auto      =", f(A.b, 4));
console.log("FFDP        =", f(A.ffdp, 2), "MPa*um  press_peak=", f(A.press_peak, 1), "MPa");
console.log("fret_uni    =", f(A.fret_uni, 3), " fret_bi =", f(A.fret_bi, 3), " (anchor=", auto.fret_anchor, ")");
