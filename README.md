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
- Bump `VERSION` in `sw.js` when you ship shell changes so clients update.

## Honest limitations

- The parser is heuristic. NHC forecasters write for humans; unusual phrasings
  will be missed or misplaced. The confidence flag and source-sentence popups
  exist so errors are visible, not hidden.
- Coastlines are hand-simplified vectors (~0.5°), schematic by design.
- **Not for life-safety decisions.** Official NHC products at hurricanes.gov are
  always authoritative.
