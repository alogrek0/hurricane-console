# Hurricane Console

A static, installable web app that fetches the latest NHC **Tropical Weather
Discussion (TWDAT)**, parses the raw teletype text into geospatial features, and
plots them on an Atlantic basin map. No backend, no build step, no API keys.

## What it does

- Pulls the newest TWDAT from `api.weather.gov` (CORS-open, JSON) and parses it
  in the browser.
- Regex pass extracts explicit coordinates: wave axes (`along 46W south of 17N`),
  convection boxes (`from 07N to 11N between 40W and 50W`), trough polylines
  (`from 08N27W to 08N44W to 09N57W`), and point fixes (`near 14N76W`).
- Gazetteer pass resolves prose-only positions (`between Hispaniola and the
  southeastern Bahamas`) — always marked **◇ INFERRED**, never presented as exact.
- Dead-reckons +24h wave positions from stated motion, drawn as an uncertainty
  band between the slow and fast solutions when the text gives a speed range.
- **Paste product** button maps any TWDAT text you paste, including archived
  issuances from the [NHC text archive](https://www.nhc.noaa.gov/text/).
- Plots the official NHC forecast track (TCM advisories) with a cone of
  uncertainty computed from NHC's published seasonal cone radii — labeled as
  computed; the official cone lives at hurricanes.gov.

## Run locally

```bash
python3 -m http.server 8000   # open http://localhost:8000
```

(The service worker needs http(s); `file://` runs the app without offline support.)

## Test

```bash
node test.js
```

## Deploy to GitHub Pages

1. Push these files to the root of `main`.
2. Repo **Settings → Pages → Source: Deploy from a branch**, pick `main` /
   `/ (root)`, save.
3. Live at `https://<user>.github.io/<repo>/` within a minute.

## Status badges

| Badge  | Meaning |
|--------|---------|
| LIVE   | fresh product from api.weather.gov |
| CACHED | network unreachable; showing last stored product |
| SAMPLE | API unavailable and nothing cached; embedded fallback |
| PASTED | you pasted a product manually |

## PWA behavior

- **Shell** (HTML/JS/icons/Leaflet): cache-first, silently revalidated — opens
  instantly, even offline.
- **Data** (`api.weather.gov`): network-first; if the network is down the last
  product is served from cache and the badge flips to **CACHED**.
- iOS install: Share → **Add to Home Screen** (Safari never prompts).
- Versions are CalVer (`YYYY.MM.DD[.N]`) in `version.js` — shown in the app's
  meta corner so you can always tell which build a device is running. Bump it
  when you ship shell changes so clients update (a pre-push git hook guards
  this: `git config core.hooksPath tools/hooks` once per clone).
- When a new version is deployed, running clients show a **"New version
  available — Refresh"** banner instead of silently serving stale files until
  the next visit.

## Honest limitations

- The parser is heuristic. NHC forecasters write for humans; unusual phrasings
  will be missed or misplaced. The confidence flag and source-sentence popups
  exist so errors are visible, not hidden.
- The basemap is fully embedded Natural Earth 1:50m vector data (public domain):
  land, coastlines, country borders, and US state lines — identical online and
  offline, no tile server. Internal borders of other countries are deliberately
  omitted to keep the chart quiet.
- **Not for life-safety decisions.** Official NHC products at hurricanes.gov are
  always authoritative.
