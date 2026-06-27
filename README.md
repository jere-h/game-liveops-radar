# Live-ops Deconfliction Radar

A single-page, fully client-side static web app for live-ops / monetization
teams. It **pre-loads an example live-ops calendar** and sweeps it for
collisions: every initiative is plotted as a blip on a radar scope, and a glowing
link between two blips means they enroll the **same players** — the setup that
cannibalizes revenue and contaminates A/B readouts.

Alongside the radar it shows a **pre-computed assessment**: per-collision risks
and opportunities written like a monetization analyst would, plus an overall
read of the slate. The hard numbers (shared players, overlap %, concurrent days,
impact band) are computed live in your browser from the data; only the
qualitative narrative is baked in.

Drop in your own calendar + assignment-log CSVs (under **Use your own data**) and
the radar, metrics, and detail cards recompute on the same path. The threshold
slider re-filters every view live — drag up to keep only the worst offenders,
down to 0% to reveal every weak tie.

There is **no backend, no build step, and no runtime dependencies** — just
vanilla ES modules with a self-contained CSV parser and a dependency-free SVG
radar renderer, so it hosts as pure static files and works offline / behind a
firewall. A pure-function core (parse / validate / compute / filter) is separated
from the DOM UI and exercised by an in-browser test page.

## What's in here

- `index.html` — the app entry point (radar + assessment dashboard).
- `styles.css` — app/dashboard styling.
- `radar.css` — styling for the SVG radar renderer.
- `js/app.js` — DOM/UI wiring; auto-loads the sample and coordinates the views.
- `js/core.js` — pure-function core (parse / validate / compute / filter).
- `js/radar.js` — dependency-free SVG radar-sweep renderer.
- `js/sample-data.js` — bundled sample calendar + assignment CSVs.
- `js/assessment.js` — the baked-in, pre-computed risk/opportunity narrative.
- `tests.html` — in-browser test page exercising the core + integration contract.

## How the radar reads

- **Blip = initiative.** Distance from the centre is its collision risk (the
  worst overlap fraction it participates in); blips at the rim have no collision.
- **Blip size = enrolled population** (distinct players in the assignment log).
- **Link = shared players** between two concurrent initiatives. Colour is the
  impact band (red High ≥50% overlap, amber Medium 20–50%, green Low <20%);
  thicker/brighter links mean a larger shared fraction. Links below the threshold
  are hidden.

## Run it locally

Because the app uses native ES modules, opening `index.html` directly via
`file://` may be blocked by your browser's module/CORS rules. Serve the folder
over HTTP:

```sh
# Python 3
python3 -m http.server 8000
```

Then open <http://localhost:8000/>. To run the in-browser tests, open
<http://localhost:8000/tests.html>.

## Host it on GitHub Pages

All asset paths are relative, so the app is hostable as-is. Push these files to
the repository root, then enable Pages (either **Deploy from a branch → main →
`/ (root)`**, or a GitHub Actions static-deploy workflow). The included
`.nojekyll` file tells Pages to serve every file verbatim (skipping Jekyll), so
assets under `js/` are published unchanged. Visit
`https://<you>.github.io/<repo>/`.

## Known limitations (deliberate MVP scope)

- **Membership-only overlap.** A collision is computed purely from
  `player_id`↔`initiative_id` membership in the assignment log. Segment-predicate
  evaluation and live data connectors are intentionally out of scope.
- **Pre-launch initiatives under-report.** An initiative with no enrollments yet
  (truly pre-launch) shows as a clean blip even if it will later collide.
- **The assessment narrative is pre-written, not a live model call.** It is
  authored for the bundled sample. The numbers shown are always live from your
  data, but the qualitative risk/opportunity prose only applies to the sample;
  load custom data and the panel says so.
- **Uncalibrated bands.** The Low/Medium/High thresholds (20% / 50%) and the
  default sensitivity are starting guesses, deliberately adjustable via the slider.
