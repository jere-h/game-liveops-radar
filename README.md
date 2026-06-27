# Live-ops Deconfliction Checker

A single-page, fully client-side static web app for live-ops PMs. Upload a
calendar CSV and an assignment-log CSV (or click **Load sample data**), and the
app parses them entirely in your browser, computes every date-overlapping
initiative pair, counts shared enrolled players, derives overlap fraction /
window days / impact band, and renders threshold-filtered flag cards ranked by
severity. Includes a live-adjustable threshold slider, an empty state, and
readable validation errors.

There is **no backend, no build step, and no runtime dependencies** — just
vanilla ES modules with a self-contained CSV parser, so it hosts as pure static
files and works offline / behind a firewall. A pure-function core (parse /
validate / compute / filter) is separated from the DOM UI so it can be exercised
by an in-browser test page.

## What's in here

- `index.html` — the app entry point.
- `styles.css` — styling.
- `js/app.js` — DOM/UI wiring.
- `js/core.js` — pure-function core (parse / validate / compute / filter).
- `js/sample-data.js` — bundled sample CSVs for **Load sample data**.
- `tests.html` — in-browser test page exercising the core.

## Run it locally

Because the app uses native ES modules, opening `index.html` directly via the
`file://` protocol may be blocked by your browser's module/CORS rules. The most
reliable way is to serve the folder over HTTP:

sh
# Python 3
python3 -m http.server 8000


Then open <http://localhost:8000/> in your browser. (Many setups also work by
simply double-clicking `index.html`, but the local server avoids module-loading
surprises.)

To run the in-browser tests, open <http://localhost:8000/tests.html>.

## Host it on GitHub Pages

All asset paths are relative, so the app is hostable as-is.

1. Create a GitHub repository and push these files to it:
   sh
   git init
   git add .
   git commit -m "Live-ops Deconfliction Checker"
   git branch -M main
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   
2. In the repository, go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
4. Choose the default branch (`main`) and the `/ (root)` folder, then **Save**.
5. Wait a moment for the build, then visit
   `https://<you>.github.io/<repo>/`.

The included `.nojekyll` file tells GitHub Pages to serve all files verbatim
(skipping Jekyll processing), so assets in folders are published unchanged.
