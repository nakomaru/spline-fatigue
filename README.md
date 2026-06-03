# spline-fatigue

Interactive explorer for involute-spline torsional fatigue: where an axle-shaft /
side-gear joint fails (teeth shearing tangentially vs. the shaft cracking
radially inward), and how unidirectional (R=0) and bidirectional (R=-1) loading
differ.

Live: https://nakomaru.github.io/spline-fatigue/

## What it shows

Drag any slider and every chart and number recomputes live:

- **Load diffusion** along the engagement, from shear-lag (`q(x) = T&beta;cosh(&beta;(L-x))/sinh(&beta;L)`)
- **Effective length** `L_eff = tanh(&beta;L)/&beta;` vs. physical engagement length
- **Failure-mode competition**: tooth-bending capacity vs. shaft-torsion capacity vs. `L_eff`
- **Predicted life (S-N)** per mode and direction, from a Basquin fit
- **Goodman** mean-stress diagram explaining why bidirectional is worse
- **Stress vs. torque** per mode against the endurance limits
- **Fretting initiation site** (a Ruiz-type FFDP along the flank)
- **Sleeve bursting** vs. torque, where the pressure angle enters via `W_r = W_t&middot;tan&alpha;`

## Files

- `index.html` — the app (UI, bilingual EN/JA, localStorage persistence)
- `physics.js` — the equations, the single source of truth, runnable in node
- `plot.js` — dependency-free canvas plotter
- `physics.test.js` — node sanity checks (`node physics.test.js`)

No build step and no dependencies; open `index.html` or serve the directory.
