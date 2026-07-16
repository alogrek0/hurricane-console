# Roadmap

The session agenda for steady work toward an eventual App Store release.

**How this file is used:** one session ≈ one green PR, merged as soon as CI
passes (merge-when-green — deploys are cheap, rollback is a revert, and
clients pick up updates on the next reload). Queued/stacked PRs are avoided:
every shell PR bumps the same `version.js` line, so parallel PRs always
conflict. The one reason to hold a merge is an **active storm** — don't ship
mid-event while the map is in anger-use; say "hold" and the PR waits green.
`/ship` runs the whole commit → push → PR → CI → merge flow. The weekly
Sunday check-in routine reads this file top-down and proposes the **topmost
unchecked item**; entries in the friction log jump the queue. Check items off
(`[x]`) in the same PR that completes them.

## Friction log

Real-usage annoyances from actual storm-watching. Anything here outranks the
planned tracks — lived friction beats speculation.

- [x] **Update banner lags deploys by up to 10 min** (2026-07-13) — after
  merging the graticule-label fix, a plain reload didn't surface the new
  version; a shift-refresh was needed. Cause: `register('sw.js')` defaults to
  `updateViaCache:'imports'`, so update checks refetched `sw.js` (unchanged)
  but took `version.js` — the actual update signal — from the HTTP cache
  (GitHub Pages `max-age=600`). Fixed same day: register with
  `updateViaCache:'none'`.
- [x] **The app was always one launch behind** (2026-07-14) — reported three
  times in a day as "I don't see <the thing you just shipped>". Each time the
  deploy was fine and the SW had already downloaded the new shell; the running
  page just kept serving the old one, because the shell is cache-first and a
  booted page doesn't re-read it. The update banner was the only escape, and
  it's easy to miss. Fixed: a `controllerchange` listener reloads once when a
  new worker takes over **right after launch** (the update check on load). Not
  mid-session — auto-reloading someone watching a storm is worse than being a
  version behind; that stays the banner's job.

## Parser gaps (found in real products, awaiting their own PR)

- [ ] **TWO invest tag lost when a "Regardless of..." paragraph precedes the
  star lines** (2026-07-16, found by the M1 backfill) — in
  `archive/2026/AT/TWOAT.202606160502.txt` / `...161142.txt` the chunk holding
  the `* Formation chance` lines starts with a "Regardless of tropical cyclone
  formation..." paragraph, so parseTWO's prev-chunk prepend (keyed on the chunk
  *starting* with `*`) never fires and the `Northwestern Gulf of America (AL90):`
  title — tag and location — is lost (chances still parse; derived record is
  honestly null-tagged). Fix in parser.js (walk back to a titled chunk), add
  these products as the first TWOAT fixtures, regenerate snapshots, version
  bump. Matters for M2/M4: AL90's sightings can't chain by tag until fixed.

## Track A — Features

- [x] **Product-history scrubber** — fetch the last ~8 TWDAT/TWO issuances and
  step through time; watch waves march and formation odds evolve. Pairs
  naturally with an invest alert ("what changed since yesterday?").
- [ ] **Better Lesser Antilles detail** — the islands are used as location
  references when a storm passes through that area, but the embedded Natural
  Earth **50m** basemap under-resolves the small Antilles (many read as dots or
  vanish). Add higher-resolution coastline for that region — NE **10m** clipped
  to roughly 10–19N / 65–59W — via `tools/build-basemap.js` (basemap is
  generated + embedded; don't hand-edit `basemap.js`). Keep the border policy
  (country borders; US-only admin-1) and label the key islands enough to name a
  passing storm's position.
- [ ] **Tide-gauge overlay (Charleston/Lowcountry)** — NOAA CO-OPS
  (`tidesandcurrents.noaa.gov`, CORS-open) water levels for local surge
  context. Build it *before* something aims at the SE coast.
- [ ] **Forecast-point wind fields + 12-ft seas ring** — the TCM already
  carries per-point radii out to ~72h and a seas line; tap a track dot to see
  that hour's wind field. Rounds out the active-storm view.
- [x] **East Pacific (TWDEP) basin support** — basin abstraction (product id →
  map extent + gazetteer set). *PR1: per-basin parser (EP gazetteer, cone radii,
  invest tags, left-basin asymmetry). PR2: EP map frame (5S–35N / 145W–70W),
  header-subtitle basin switcher (persisted `hc-basin`), letterbox masks over the
  widened union basemap, embedded TWDEP/TWOEP samples, per-basin AWIPS/TCM
  wiring. CP east of 140W is honestly unmapped; alerter covers AT + EP (CP out of scope).*
- [x] **Issuance diff (Δ)** — scrubber-row toggle ghosts the previous issuance's
  high-signal features under the current ones (cyclones by name, waves by axis
  longitude, TWO areas by invest tag then proximity) — dashed + faded + stamped
  with the old issuance time, connectors on moved pairs, chance deltas in TWO
  popups, "moved · new · gone" meta note. Pure pairing logic in `diff.js`
  (node-tested); ITCZ/monsoon/convection deliberately excluded as noise.
- [ ] **My-spot impact view** — a localStorage pin (never leaves the device):
  distance to each feature, computed-cone cover, earliest plausible TS-wind
  arrival from the parsed TCM track + radii — labeled with honest uncertainty.
- [ ] **Formation-chance trend sparklines** — per-invest 48h/7d chance history
  across the last ~8 TWO issuances; reuses fetchHistory + parseTWO. *Absorbed
  into Track C M4 — build it there over the season archive instead.*
- [ ] **Recon overlay** — parse and plot Hurricane Hunter HDOB/vortex text
  products (api.weather.gov AWIPS types) near active storms; new mini-parser.

## Track B — App Store readiness

A bare PWA can't be submitted; the path is a Capacitor (WKWebView) shell
around the exact same files. Ordered milestones:

- [x] **PWA polish** — full icon set regenerated from one canvas source
  (`tools/make-icons.html`: any 192/512 + dedicated maskable 512 + apple-touch
  180 + hand-authored favicon.svg), accessibility pass (keyboard/ARIA legend
  toggles, live-region badge/toast/scrubber, dialog labels, contrast fixes to
  4.5:1+), offline audit fix (data cache now version-independent `data-v1`,
  FIFO-trimmed, so cached products survive updates). Launch-screen images
  deliberately SKIPPED (permanent): manifest `background_color` provides the
  launch backdrop; static iOS startup images become a Capacitor-shell concern
  if that ever happens.
- [ ] **Apple Developer account + build machine** — $99/yr; needs Xcode on a
  Mac (owned, borrowed, or a CI Mac runner). Decision, not code.
- [ ] **Capacitor shell spike** — wrap the app unchanged, run it in the iOS
  simulator. Decide then: wrapper lives in a subfolder or a sibling repo.
- [ ] **Native push migration** — inside the wrapped app, invest alerts move
  from ntfy to APNs (the GitHub Actions alerter gains an APNs sender; ntfy
  stays for the PWA). This is the feature that makes the store version *more*
  than the website — Apple's review looks for exactly that.
- [ ] **Home-screen widget** (optional but strong for review) — current
  outlook: basin status + highest 7-day formation chance.
- [ ] **TestFlight beta** — self + a couple of weather-nerd friends.
- [ ] **App Store review prep** — screenshots, privacy labels (no data
  collected — easy), and the existing "not for life-safety decisions" framing
  as the required weather-app disclaimer.

## Track C — Moat (compounding data)

The strategic bet (decided 2026-07-16, plan in `.claude/plans/`): the app's
unique asset is the TWD/TWO prose-to-geography parser — no other app or site
renders the forecasters' written reasoning as interactive geography. The moat
move is to make it **compound**: archive every issuance, chain features across
issuances (diff.js pairing composed season-long), and render any storm's full
pre-genesis life — "tap Hurricane X, rewind to the unnamed wave that left
Africa 12 days earlier." Raw text is ground truth (committed, re-derivable as
the parser improves); derived JSON is regenerated, never hand-edited; the app
loads it lazily. A wrong lineage is this feature's "Tropical Depression Or":
prefer broken chains over invented links.

- [x] **M1 — Archive foundation**: `tools/archive-sync.js` (reuse
  archive-audit.js URL/UA/entity helpers; idempotent; `--derive` builds
  `archive/derived/*.json`), backfill 2026-06-01→now (TWDAT/TWDEP/TWOAT/TWOEP
  into `archive/{year}/{basin}/`), 6-hourly `archive.yml` cron committing to
  main (no version bump — archive/ isn't a shell path), derived-shape tests.
  *Shipped: `tools/nhc-text-archive.js` (BASE/UA/`listingNames`/stamp helpers,
  extracted from archive-audit.js — not duplicated), `tools/archive-sync.js`
  (`--since`/`--derive`, idempotent skip-existing, skip-and-log per product,
  red on an unreachable listing, deterministic derive), `tools/derive-summary.js`
  (shared writer/checker shape: TWD keeps cyclones + wave axes, counts for
  convection/troughs; TWO keeps invests/positions/chances; `issuedISO` via
  parseIssued, null when unparseable), `archive.yml` (cron `23 1,7,13,19`,
  commit-only-if-changed, one rebase retry), `.gitattributes` LF pins, and
  offline derived-shape tests guarded on `archive/` existing.*
- [ ] **M2 — Lineage engine**: `tools/build-lineage.js` — compose diff.js
  pairing across the season into entity chains (waves by axis progression,
  invests by tag, cyclones by name) + genesis links (wave→invest→cyclone),
  per-sighting confidence; `lineage-2026.json`; synthetic-sequence unit tests
  + pinned corpus snapshot; negative tests for every join rule.
- [ ] **M3 — Lineage UI**: "history" affordance on cyclone/wave/invest popups
  → lazy-fetch (countries.js pattern) → time-faded trail + genesis segments;
  trail treatment judged in a lab first; broken chains render as separate
  segments, never silently bridged.
- [ ] **M4 — Genesis truth ledger**: per-invest genesis timeline, TWO
  chance-trend sparklines (absorbs the Track A sparkline item), season
  calibration table (stated 48h/7d odds vs outcomes) — all over
  `lineage-2026.json`.

## Maintenance calendar

- **Early January** — the `CONE_SEASON` test starts failing on purpose until
  the new season's cone radii are entered (`CONE_RADII_NM` in parser.js, from
  nhc.noaa.gov/aboutcone.shtml).
- **~Sep 10 (season peak)** — glance at the Actions tab: GitHub pauses cron
  schedules after ~60 days without repo activity; the invest alerter must be
  running when it matters most.
- **Jun 1 / Nov 30** — season open/close: sanity-check the alerter fired
  during the season and won't spam over winter (off-season TWOs are rare but
  exist; the diff logic handles them).
