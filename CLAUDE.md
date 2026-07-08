# Hurricane Console — project guide for Claude Code

A static, installable PWA that fetches the latest NHC **Tropical Weather
Discussion (TWDAT)**, parses the raw teletype text into geospatial features, and
plots them on an Atlantic basin map. **No backend, no build step, no API keys.**
It deploys to GitHub Pages by pushing to `main`.

## How to run

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

The service worker requires http(s); opening `index.html` via `file://` runs the
app but without offline support. In the sandboxed artifact preview the NOAA fetch
is blocked, so it shows SAMPLE mode — the live path activates on a real origin.

## How to test

```bash
node test.js      # parser smoke test, exits non-zero on failure
```

Keep `node test.js` green. The parser is the component that has to earn its keep,
so any parser change gets a matching assertion in `test.js`.

## Architecture

Everything is client side. Files:

| file             | role |
|------------------|------|
| `index.html`     | app shell, styles, script order |
| `app.js`         | fetch → parse → render on Leaflet; badge + paste/refresh UI |
| `parser.js`      | TWDAT text-to-geo engine — runs in browser AND node |
| `coastlines.js`  | embedded simplified vector coastlines (no tile server) |
| `sample.js`      | embedded Jul 7 2026 TWDAT/TWOAT fallback (SAMPLE state) |
| `sw.js`          | service worker: cache-first shell, network-first data |
| `manifest.json`  | PWA manifest |
| `test.js`        | node parser test harness |

### The parser (three passes, in `parser.js`)
1. **Regex** — explicit coordinates: wave axes (`along 46W south of 17N`),
   convection boxes (`from 07N to 11N between 40W and 50W`), trough polylines
   (`from 08N27W to 08N44W to 09N57W`), point fixes (`near 14N76W`). Confidence high.
2. **Gazetteer** — prose-only positions (`between Hispaniola and the southeastern
   Bahamas`). **Always** returned with `inferred:true` and rendered dashed with a
   `◇ INFERRED` tag. A gazetteer guess must never masquerade as a fix.
3. **Dead-reckoning** — projects +24h wave positions from stated motion. A speed
   range (`15 to 20 kt`) yields an **uncertainty band** between the slow and fast
   solutions, not a single point.

`dehyphenate()` rejoins teletype line-wraps (`upper-\nlevel` → `upper-level`) so
keyword matches survive — this was a real bug; keep the hyphen.

### Data + caching
- `api.weather.gov` sends `Access-Control-Allow-Origin: *`, so the browser fetches
  TWDAT/TWOAT directly — no proxy.
- `sw.js` is network-first for `api.weather.gov` and stamps cache-served responses
  with `X-From-Cache: 1` so the badge reads **CACHED** honestly.
- Bump `VERSION` in `sw.js` whenever shell files change so clients update.

### The badge is a contract
The header badge must always reflect the true data source: **LIVE / CACHED /
SAMPLE / PASTED / ERROR**. Never show LIVE for stale or sample data. Honesty about
provenance is the whole point — inferred features are visually distinct for the
same reason.

## Conventions
- Plain ES5-ish browser JS, no framework, no bundler. Keep it dependency-free
  except Leaflet from the CDN (already in the SHELL cache list).
- Coordinates are `{lat, lon}` with **west and south negative** throughout.
- Coastlines are schematic (~0.5°) by design — matching the product's resolution.

## Deploy (GitHub Pages)
Push to `main`, then repo **Settings → Pages → Deploy from a branch → `main` /
`/ (root)`**. Live at `https://<user>.github.io/<repo>/` within a minute. Any push
to `main` redeploys.

## Not for life-safety decisions
This is a visualization aid built on a heuristic parser. Official NHC products at
hurricanes.gov are always authoritative. Surface that framing; don't imply
precision the parser doesn't have.

## Roadmap parked from prior sessions
- Charleston / Lowcountry angle: overlay NOAA tide-gauge data
  (`tidesandcurrents.noaa.gov`, also CORS-open) for local surge/flood context.
- Optional push alerts via a GitHub Actions cron + ntfy.sh (would add the only
  non-static piece). Not started; keep v1 static.
- East Pacific support: paste a TWDEP to see how the parser handles another basin.
