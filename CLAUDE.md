# Hurricane Console — project guide for Claude Code

A static, installable PWA that fetches the latest NHC **Tropical Weather
Discussion** (TWDAT / TWDEP), parses the raw teletype text into geospatial
features, and plots them on an **Atlantic or East Pacific** basin map. A basin
switcher in the header subtitle toggles the frame + data source (persisted in
`hc-basin`, default Atlantic). **No backend, no build step, no API keys.**
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
node test.js      # parser smoke test + archive-corpus snapshots, exits non-zero on failure
```

Keep `node test.js` green. The parser is the component that has to earn its keep,
so any parser change gets a matching assertion in `test.js`. CI (GitHub Actions)
runs the same command on every push to `main` and every PR.

The suite includes **snapshot checks against `fixtures/`** — real archived NHC
products with pinned parser output (`fixtures/expected.json`). A failing snapshot
means parser behavior changed on real-world text. If the change is deliberate:
run `node tools/archive-audit.js --save-fixtures` (network, dev-only; refuses to
write if any product fails its ground-truth expectations), review
`git diff fixtures/`, and commit the regenerated snapshots alongside the parser
change. Never hand-edit `expected.json`. Snapshots pin *current* behavior, warts
included — e.g. known phrasing gaps stay pinned until the parser is fixed, at
which point regeneration records the improvement.

## Architecture

Everything is client side. Files:

| file             | role |
|------------------|------|
| `index.html`     | app shell, styles, script order |
| `app.js`         | fetch → parse → render on Leaflet; per-basin frame/graticule/masks (`BASINS` config, `switchBasin`); badge + paste/refresh/history-scrubber + basin-switcher UI |
| `parser.js`      | TWDAT/TWDEP text-to-geo engine (per-basin) — runs in browser AND node |
| `basemap.js`     | embedded Natural Earth 50m basemap: land, coast, country borders, US-only state lines — GENERATED, do not hand-edit (regenerate: `node tools/build-basemap.js`) |
| `countries.js`   | invisible per-country hover hit-polygons (named, simplified) for the desktop country-name tooltip — GENERATED alongside basemap.js, do not hand-edit; loaded lazily by app.js on hover-capable pointers only (phones never fetch it) |
| `tools/build-basemap.js` | dev-only generator: downloads/clips NE 50m → basemap.js + countries.js |
| `tools/make-icons.html` | dev-only icon generator: canvas-draws the header glyph at every icon size (any/maskable/apple + favicon.svg is hand-authored from the same art) — regeneration procedure in the file header |
| `tools/highlight-lab.html` | dev-only selection-highlight lab: real feature shapes + a menu of treatments and live dials; prints the exact app.js/index.html constants. Reachable on a phone (Pages serves the repo root) — how a selection *looks* is judged by looking, not by shipping a release per constant |
| `tools/hover-lab.html` | dev-only country-hover lab: real Leaflet + basemap.js + countries.js (live hit-testing is the thing under judgment — mask suppression, features-win-hover, border alignment), treatment menu + dials, prints the exact constants |
| `sample.js`      | embedded SAMPLE-state fallbacks: Atlantic TWDAT/TWOAT/TCM (Jul 7 2026 + Lee) and East Pacific TWDEP/TWOEP (recent-real captures; no EP TCM sample) |
| `phonetics.js`   | NHC pronunciation-guide respellings for the 2026-2031 name rotations, basin-keyed `{ AT, EP }` like `GAZ` — display data only (app.js popup titles); identity entries (`lee: 'lee'`) kept in data, suppressed at render; annual retired-name updates land here |
| `tools/phonetics-lab.html` | dev-only phonetic-typography lab: real popup chrome + the six title cases that matter (cone's ◇ INFERRED ordering, wind-field middot collision, identity suppression), treatments + dials, prints the exact index.html/app.js constants |
| `version.js`     | app version, single source (CalVer) — shared by page, SW, and tests |
| `sw.js`          | service worker: cache-first shell, network-first data |
| `tools/hooks/`   | committed git hooks; pre-push delegates to the shared version guard; enable once per clone: `git config core.hooksPath tools/hooks` |
| `tools/check-version-guard.sh` | the version-bump check itself (`BASE HEAD` args) — single source, called by the pre-push hook AND CI |
| `tools/corpus-summary.js` | snapshot shape for the archive corpus — shared by test.js (checker) and archive-audit.js (writer) |
| `tools/archive-audit.js` | dev-only, network: audits parser vs curated archived NHC products; `--save-fixtures` regenerates `fixtures/` |
| `tools/nhc-text-archive.js` | shared nhc.noaa.gov archive-access helpers (BASE, UA, `listingNames`, `stampOf`/`stampDate`) — required by archive-audit.js AND archive-sync.js so the crawl identity + listing parse can't drift |
| `tools/archive-sync.js` | dev-only, network: season backfill + cron sync (`--since`/`--derive`); fetches TWDAT/TWOAT/TWDEP/TWOEP → `archive/{year}/{basin}/` (idempotent, skip-and-log), re-derives `archive/derived/`; pure helpers unit-tested offline |
| `tools/derive-summary.js` | derived-record shape (Track C) — shared writer (archive-sync `--derive`) / checker (test.js); TWD cyclones + wave axes, counts for convection/troughs; TWO invests/positions/chances; `issuedISO` via parseIssued |
| `tools/build-lineage.js` | season lineage engine (Track C M2): composes diff.js pairing across the archive into wave/invest/cyclone chains + conservative genesis links → `archive/derived/lineage-2026.json`; gates (18h gap, 2° east-drift, second-tag refusal, one-genesis-link-per-source symmetry) all err toward breaking — broken chains beat invented links; pure logic exported, unit-tested offline; cron re-runs it each sync |
| `tools/lineage-lab.html` | dev-only chain-inspection lab ("dispatcher's wall map"): Leaflet + basemap.js over the real lineage JSON (amber SAMPLE badge on fallback), basin/kind/confidence filters, season-replay scrubber, per-sighting popups; proximity/inferred joins dashed, ○/× chain endpoints so breaks read honestly; M3 layers trail treatments on it |
| `archive/` | committed season archive: raw NHC text (ground truth, LF-pinned) under `{year}/{AT,EP}/` + re-derivable `derived/{year}-{basin}.json` (regenerated by `--derive`, never hand-edit) |
| `.github/workflows/archive.yml` | 6-hourly cron: `archive-sync.js --derive`, commit new `archive/` to main as github-actions[bot] only if changed (no version bump — archive/ isn't a shell path); GITHUB_TOKEN pushes don't re-trigger workflows |
| `fixtures/`      | committed archive corpus: 21 real NHC products across both basins (TCM/TWD/TWO; LF-pinned via `.gitattributes`) + pinned snapshots in `expected.json` — regenerate only via `--save-fixtures`, never hand-edit |
| `.github/workflows/ci.yml` | CI: `node test.js` on push-to-main + PRs; version guard on PRs |
| `.github/workflows/alerts.yml` | invest alerts (Atlantic + East Pacific): cron (two offset twice-hourly schedules — GitHub cron is best-effort) polls the TWOAT and TWOEP, diffs vs per-basin cached state, pushes to ntfy.sh (`NTFY_TOPIC` repo secret; unset = dry-run). Central Pacific out of scope |
| `tools/alert-invests.js` | the alerter: fetch/diff/push; api.weather.gov primary, falls back to the tgftp.nws.noaa.gov text mirror when the newest visible product is stale (>7 h — the list API can lag an issuance by an hour+); pure logic (stateFromTWO/diffAlerts/formatAlert/isStale/tgftpProduct) unit-tested offline in test.js |
| `manifest.json`  | PWA manifest |
| `ROADMAP.md`     | session agenda (features + App Store tracks, friction log, maintenance calendar) — the weekly check-in routine reads it; topmost unchecked item is the default proposal |
| `test.js`        | node parser test harness (includes the corpus snapshot checks) |

### The parser (three passes, in `parser.js`)
Per-basin: Atlantic AND East Pacific. `detectBasin` reads the product header
(`TWDEP`/`TWOEP`/`AXPZ20`/`ABPZ20` or the "for the eastern ... Pacific" area
line) — never the body, where "eastern Pacific" appears in Atlantic departure
prose; `opts.basin` overrides. The basin selects the gazetteer (`GAZ.AT` /
`GAZ.EP` — self-contained tables; EP has NO Hawaii entry by design, Central
Pacific systems stay honestly unmapped), the left-basin rule (in a TWDEP,
"moved into the eastern Pacific" is an ARRIVAL — the asymmetry is load-bearing
and tested), and the climo guards (EP adds Tehuantepec/Papagayo gap-wind
vocabulary). `CONE_RADII_NM` is keyed `AL`/`EP`/`CP` (CP aliases EP — NHC
publishes one combined column) under a single `CONE_SEASON`. Coordinate
extraction is basin-blind.
1. **Regex** — explicit coordinates: wave axes (`along 46W south of 17N`),
   convection boxes (`from 07N to 11N between 40W and 50W`), trough polylines
   (`from 08N27W to 08N44W to 09N57W`), point fixes (`near 14N76W`). Confidence high.
2. **Gazetteer** — prose-only positions (`between Hispaniola and the southeastern
   Bahamas`). **Always** returned with `inferred:true` and rendered dashed with a
   `◇ INFERRED` tag. A gazetteer guess must never masquerade as a fix. Heavily
   guarded against noise: no dot for future positions ("will reach the Lesser
   Antilles"), climatological features (Colombian low, Atlantic ridge),
   cross-references / model fields, features departed for the Pacific, or
   re-mentions of a wave/trough the product already positions with coordinates
   (definite article or within 2° of the same-kind parsed geometry).
3. **Dead-reckoning** — projects +24h wave positions from stated motion. A speed
   range (`15 to 20 kt`) yields an **uncertainty band** between the slow and fast
   solutions, not a single point.

**Troughs are three features, not one.** `troughKind` tags each polyline `itcz` /
`monsoon` / `trough` from the sentence that positions it ("Segments of the ITCZ
are from 07.5N90W to…", "The monsoon trough extends from…") — read, never
guessed; nearest cue *before* the coordinates wins, so a sentence naming both
still tags each segment right. Sentence bounds key on `'. '` (period + SPACE),
never a bare `.`, because the coordinates carry decimal points (`07.5N90W`) and
splitting on those severs the cue from its segments. The app colour-codes the
three (ITCZ cyan / monsoon green / trough slate-teal) — a **house convention, not
NHC's**: their chart labels the first two in text and dashes the third, so the
popup always names the feature. `fixtures/expected.json` pins the per-kind counts.

**A cyclone must be real.** NHC routinely discusses storms that do not exist yet
("a tropical depression **or** tropical storm **is expected to form** later
today"). The classification match will happily swallow the next word as the
storm's name — this shipped a fabricated *"Tropical Depression Or"* plotted at a
nearby low's coordinates. `extractCyclones` now requires: the following token is
not genesis/function vocabulary (`NOT_A_NAME`; ALL-CAPS archives have no case
signal, so this is the backstop there), the token is capitalized in mixed-case
text, and the classification is not preceded by an indefinite article ("a
tropical depression" is generic; NHC never writes "a Tropical Storm Otis"). The
scan walks past a genesis mention to a real storm in the same paragraph. A
cyclone-less SPECIAL FEATURES still emits a **fix** at any stated center, so the
analyzed low survives the phantom's removal. A named storm that does not exist is
the worst lie this map can tell — fixtures `TWDEP.2026071416*`/`TWDEP.2026071403*`
pin the exact prose that broke it.
4. **TCM pass** — `parseTCM` reads the official forecast/advisory (track points,
   intensity, current-position 34/50/64-kt quadrant wind radii); `coneFromTrack`
   computes the cone from NHC's published seasonal radii (update `CONE_RADII_NM`
   each season from nhc.noaa.gov/aboutcone.shtml — a test alarms every January).
   The cone is always labeled as computed — never presented as the official cone.
   `windFieldFromTCM` turns the radii into nested quadrant-stepped rings —
   deliberately NOT smoothed (interpolating between quadrants would invent
   data), and labeled as official advisory data since, unlike the cone, they are.

`dehyphenate()` rejoins teletype line-wraps (`upper-\nlevel` → `upper-level`) so
keyword matches survive — this was a real bug; keep the hyphen.

### Data + caching
- `api.weather.gov` sends `Access-Control-Allow-Origin: *`, so the browser fetches
  products directly — no proxy. Product types are the 3-letter AWIPS categories
  (`TWD`, `TWO`, `TCM`), which mix basins/offices: the app scans the newest few
  (12 for TWD/TWO, since the list interleaves basins) and selects by the active
  basin's AWIPS id in the text (`TWDAT`/`TWOAT` for Atlantic, `TWDEP`/`TWOEP` for
  East Pacific) or storm ID prefix (`AL…` Atlantic; `EP…`/`CP…` East Pacific).
- `sw.js` is network-first for `api.weather.gov` and stamps cache-served responses
  with `X-From-Cache: 1` so the badge reads **CACHED** honestly.
- Versioning is CalVer (`YYYY.MM.DD`, `.N` suffix for same-day re-deploys), single
  source in `version.js` — the page shows it in the meta corner, the SW derives its
  **shell** cache name from it (the data cache is deliberately version-independent —
  `data-v1`, FIFO-trimmed to ~200 entries — so cached NOAA products survive
  updates), and tests check the format. Bump it whenever any shell file
  ships. The check lives in `tools/check-version-guard.sh` (the watched-file list
  is defined ONLY there) and runs twice: the committed pre-push hook
  (`tools/hooks/pre-push`, enable with `git config core.hooksPath tools/hooks`)
  and the CI workflow on PRs. Changes to `test.js`, `fixtures/`, `tools/`, docs,
  or `.github/` do **not** need a bump — only the shell files do.

### The badge is a contract
The header badge must always reflect the true data source: **LIVE / CACHED /
SAMPLE / PASTED / ERROR / HISTORY**. Never show LIVE for stale or sample data.
**HISTORY** means the viewer deliberately stepped to a past issuance with the
map's history scrubber — a chosen view of the archive, never a euphemism for
CACHED (which stays reserved for involuntarily stale data); stepping forward to
the newest issuance restores the real source badge (LIVE or CACHED). Honesty
about provenance is the whole point — inferred features are visually distinct
for the same reason. **LOADING** is the one transient exception — shown
(pulsing) only while a fetch is in flight, before the source is known; it
asserts no provenance and must resolve to one of the six real states. Never
claim a source optimistically before the fetch resolves.

## Conventions
- Plain ES5-ish browser JS, no framework, no bundler. Keep it dependency-free
  except Leaflet from the CDN (already in the SHELL cache list).
- **Map z-order is declarative, via Leaflet panes** — `hc-mask` (402) <
  `hc-areas` (410) < `hc-lines` (420) < `hc-points` (430). Never rely on layer
  add order: Leaflet stacks paths as they are added, and the TCM overlay
  arrives asynchronously, so add-order stacking silently buried the troughs
  under the convection boxes (and let the boxes steal their taps). Every new
  layer picks a pane. **A thin line must win a tap over the area fill it
  crosses.** The selected feature (popup open) carries `.hc-sel` — identity
  color kept, stroke thickened, white halo — so it's never ambiguous which
  shape was hit.
- Coordinates are `{lat, lon}` with **west and south negative** throughout.
- **Basemap is all-vector and embedded**: Natural Earth 50m land/coast/borders in
  `basemap.js` render identically online and offline — no tile server, no
  attribution requirements, no network dependency. Border policy is deliberate:
  country borders everywhere, admin-1 state lines only for the USA (filtered at
  generation time by `ADM0_A3`). This also keeps the basemap portable to a future
  non-Mercator display CRS (see docs/PROJECTION_DECISION.md), which raster tiles
  would not survive.

## ECC toolkit (session plugin, not a repo dependency)
The ECC plugin is installed user-level in Claude Code and supplies extra
commands/agents in this project — useful ones here: `/ecc:code-review`
(diff review), the `ecc:security-reviewer` agent, `/ecc:harness-audit`.
Nothing from ECC is installed into this repo, deliberately: the repo stays
dependency-free, and the project's own skills (`audit`, `ship`, `verify`)
remain the canonical workflows. Don't copy ECC files into `.claude/`.

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
- ~~Push alerts via GitHub Actions cron + ntfy.sh~~ DONE (`alerts.yml` +
  `tools/alert-invests.js`): new invest / new outlook area / 7-day chance
  crossing 40%/60%. The app itself is still fully static — the alerter is a
  repo sidecar that never runs in the browser.
- ~~East Pacific support~~ DONE (fully): PR1 made the parser per-basin (EP
  gazetteer, cone radii, invest tags); PR2 added the EP map frame (5S–35N /
  145W–70W) and a header-subtitle basin switcher (persisted `hc-basin`, default
  Atlantic), with letterbox masks over the widened union basemap and embedded
  TWDEP/TWOEP samples. Central Pacific (east of 140W) is honestly unmapped. The
  invest alerter now covers **both basins** (TWOAT + TWOEP, per-basin state);
  Central Pacific (CP9x) is out of scope — no headline invest alert.
