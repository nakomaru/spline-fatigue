// sanity check: reproduce the Python numbers for the user's joint
const P = require("./physics.js");

// the user's actual joint, to compare against Python (cp=14 -> Leff~21.5)
const p = {
  PCD: 56.6667, N: 34, phi: 30, eng_pct: 100 * 12 / 34, // ~35% -> n_c=12 to match prior runs
  d_root: 55.512, sleeve_OD: 90, sleeve_bore: 56.666,
  L: 58, cp: 14, G: 80000,
  sbase_factor: 0.63, hwork_factor: 0.9, hload_factor: 0.55,
  Kt: 3.0, Kf: 2.0, UTS: 2000, surf: 0.75, b: -0.09,
  fret_uni: 0.40, fret_bi: 0.55, mxax_uni: 1.0, mxax_bi: 0.85,
  T: 5000, slip0: 0.6, mu: 0.30,
};

const r = P.computeAll(p);
const R = r.readout;
const f = (x, d = 2) => Number(x).toFixed(d);

console.log("GJ_shaft       =", R.GJs.toExponential(3), "(py 7.458e10)");
console.log("GJ_sleeve      =", R.GJg.toExponential(3), "(py 4.343e11)");
console.log("stiffness ratio=", f(R.stiffRatio, 1), "(py 5.8)");
console.log("beta           =", f(R.beta, 4), "1/mm   1/beta =", f(R.oneOverBeta, 1), "(py 21.7)");
console.log("L_eff          =", f(R.Leff, 2), "mm     (py 21.5)");
console.log("crossover uni  =", f(R.xUni, 1), "mm     (py ~42.6)");
console.log("crossover bi   =", f(R.xBi, 1), "mm     (py ~31.9)");
console.log("gov uni        =", R.govUni);
console.log("gov bi         =", R.govBi);
console.log("tooth cap uni  =", f(R.toothCapUni, 0), "N*m  (py ~ scales w/ Leff)");
console.log("shaft cap uni  =", f(R.shaftCapUni, 0), "N*m  (py 7149)");
console.log("shaft cap bi   =", f(R.shaftCapBi, 0), "N*m  (py 4140)");

// life at L_eff=36 to compare with spline_life.py table
const p36 = Object.assign({}, p);
const g = P.geometry(p36), S = P.strengths(p36);
for (const T of [4000, 5000, 6000]) {
  const ut = P.life(p36, g, S, T, "tooth", "uni", 36);
  const bs = P.life(p36, g, S, T, "shaft", "bi", 36);
  console.log(`L_eff=36 T=${T}: uni-tooth Nf=${ut.toExponential(2)}  bi-shaft Nf=${bs.toExponential(2)}`);
}

// CONSISTENCY: at the endurance-capacity torque, life must be ~1e6 cycles
console.log("\nconsistency (capacity torque should give Nf ~ 1e6):");
for (const [mode, dir] of [["tooth","uni"],["tooth","bi"],["shaft","uni"],["shaft","bi"]]) {
  const Tcap = mode === "tooth" ? P.capTooth(p, g, S, 36, dir) : P.capShaft(p, S, dir);
  const Nf = P.life(p, g, S, Tcap, mode, dir, 36);
  const ok = Nf > 7e5 && Nf < 1.4e6 ? "OK" : "MISMATCH";
  console.log(`  ${mode}/${dir}: Tcap=${Tcap.toFixed(0)} N*m -> Nf=${Nf.toExponential(2)}  [${ok}]`);
}
