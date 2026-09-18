# PeakyPicky MW calibrations

Each file here is one column's molecular-weight calibration, loaded by
`../index.html` (and produced/edited by `../calibrate.html`) via
`index.json`. Adding a calibration is a data-only change — no code needed.

**Units.** MW in daltons. All volumes in mL. Every `veMl`/`v0Ml` is measured
**from the injection event**, not from the start of the recording.

## Two model variants

- **`"model": "kav"`** — real, lab-measured. Built from three of your own runs
  on the column (a blue-dextran void run + one or more mixed-standard runs)
  using `calibrate.html`. Fits `log10(MW) = intercept + slope·Kav`, where
  `Kav = (Ve − V0) / (Vt − V0)`. `V0` comes from the void run; `Vt` is read
  fresh from whichever run is currently loaded in the viewer (its own
  `ColumnVolume` metadata), so the estimate stays correct even if a given
  export's exact column volume differs slightly from the one recorded here.
- **`"model": "ve"`** — legacy/digitized. No void volume was measured; the fit
  runs directly against raw elution volume instead of Kav. These four were
  digitized from Cytiva's published chromatogram figures (pixel-position
  analysis against the plotted axis ticks) for the small Increase 3.2/300
  micro-columns, not from real lab runs — treat their MW estimates as rough
  order-of-magnitude, not a certified calibration.

In both cases, **the standards' raw `(mw, veMl)` pairs are the only
authoritative data** — the app always recomputes the least-squares fit itself
at load time (never trusts a precomputed coefficient). Each file's
`fitSummary` block is `informationalOnly: true`, included purely so a PR
reviewer can sanity-check the numbers in the diff; the app ignores it.

## Adding your own column

1. Run three standard chromatography runs on your column: one blue-dextran
   (void volume) run, and one or more mixed-standard runs with proteins of
   known MW (two per run is typical).
2. Open `calibrate.html`, drop the void run, then the standard run(s), review
   the auto-detected peak-to-MW assignments, and download the calibration
   JSON it produces.
3. Save that file into this folder and add an entry to `index.json`.
4. Open a PR per the repo's approval workflow (see the root `README.md`) —
   there's no backend, so this is the only way a new calibration reaches
   everyone else.
