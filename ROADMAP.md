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
- [x] **Reclaim the home-indicator sliver** (2026-07-18, user request) — the
  toolbar fully padded past the safe-area inset, leaving ~34pt visually dead.
  The readout's last line is non-interactive and hugs the screen edges while
  the indicator pill is centered — the sides of that band are clear. Toolbar
  padding-bottom is now `max(.5rem, env(safe-area-inset-bottom) - 12px)`:
  ~19pt reclaimed for the map on notched iPhones, 12px reserved so the corner
  curve never clips a descender, zero-inset devices unchanged. A fuller
  edge-to-edge pass (map bleeding under a translucent blurred toolbar) is a
  candidate Track A item — needs a treatment lab if pursued.
- [x] **Dead page-background band under the toolbar in the installed PWA**
  (2026-07-18, phone screenshots) — `height:100%` sizes against iOS's LAYOUT
  viewport, which runs shorter than the real screen in standalone mode. Fixed:
  `#app` uses `height:100dvh` (dynamic viewport; `%` kept as fallback). The
  page never scrolls, so dvh can't cause reflow jumps. Confirmed on-device.
- [x] **Issuance readout: redundant + wrapping** (2026-07-18, review) — three
  cleanups: (1) the `local` clause now renders only when it actually converts
  (for a viewer in the product's own timezone, "200 PM EDT · local 2:00 PM
  EDT" was the same instant twice in two formats); (2) the "not from today"
  date check compares the VIEWER's calendar day, not UTC — the UTC day flips
  at 0000Z (8 PM EDT), stamping every evening product with a spurious date;
  (3) "ahead of clock" → "early" (same skew signal, never wraps mid-phrase).
- [x] **TWO popup text ended mid-sentence with "…"** (2026-07-18, phone
  report) — the 600-char CONTEXT_MAX cap cut AL91's entry exactly at the
  impact sentence + recon-flight line. A TWO entry is the complete,
  self-contained paragraph NHC wrote about that system, so the disturbance
  extractor now passes it uncapped (popups scroll since .3); TWD features
  keep the cap (long paragraphs shared across many features).
- [x] **Formation-chance star lines read as run-on paragraph text**
  (2026-07-18, phone report) — the raw product writes them as separate "*"
  bullets; chunk-flattening ran them into the prose. renderTWO now splits
  them back onto their own lines in a `.pop-chances` block under a dashed
  separator — verbatim NHC words, NHC's own layout restored.
- [x] **Opening focus framed an invest the map wasn't showing** (2026-07-18,
  user recommendation) — with a quiet TWD and an active invest, the launch
  peek zoomed to the invest's spot while still displaying the TWD: a framed
  patch of empty sea. Now the LAUNCH peek also switches the product — it
  adopts the TWO it already fetched (zero extra network, real badge/cache
  handling via the shared adoptTWO tail) so the framed invest is on screen,
  with the segmented control lighting TWO. App-open only, by explicit
  decision: launch is context-free, but a basin flip mid-session re-runs the
  peek frame-only — it must never override a manual product choice. The
  cyclone path is unchanged (an active TWD cyclone wins and stays TWD).
- [x] **Tall invest popup clipped at the frame top on mobile; swipes panned the
  map instead of scrolling it** (2026-07-18, reported from the phone on AL91) —
  two stacked causes. (1) A popup anchored high in the basin opens upward past
  the map frame, and autopan can't rescue it: `maxBoundsViscosity: 1.0` pins
  the chart-fit view with zero pan slack, so the popup top (title included)
  clipped off-screen — latent for any long-text invest, guaranteed once the M4
  genesis charts landed. Fixed: `fitPopupInView` slides a clipped popup down
  over its anchor via margin-bottom (Leaflet anchors popups by their BOTTOM
  edge — margin-top is a no-op), settling over three idempotent passes because
  the charts arrive async and autopan animates. (2) Leaflet's container
  declares `touch-action:none`, which on iOS also kills native scrolling of
  the popup's overflow box — swipes "locked" and fell through to the map.
  Fixed: `touch-action:pan-y` on the popup content (`pan-x pan-y` on the
  sparkline strip); Leaflet already stops those touches from starting a drag.
  Follow-up same day: the slid-down popup landed UNDER the zoom control and
  scrubber (both stack above the popup pane) — while any popup is open the
  body carries `hc-popup-open` and those two overlays fade out
  (pointer-events off), returning on close. Map-nav isn't needed mid-read.
  Second follow-up (user request): the graticule lat/lon labels yield the
  same way — they also stack above the popup pane and read as clutter over
  popup text.
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

- [x] **TWO invest tag lost when a "Regardless of..." paragraph precedes the
  star lines** (2026-07-16, found by the M1 backfill; fixed 2026-07-17) — in
  `archive/2026/AT/TWOAT.202606160502.txt` / `...161142.txt` the chunk holding
  the `* Formation chance` lines starts with a "Regardless of tropical cyclone
  formation..." paragraph, so parseTWO's prev-chunk prepend (keyed on the chunk
  *starting* with `*`) never fired and the `Northwestern Gulf of America (AL90):`
  title — tag and location — was lost. *Fixed: the star chunk inherits the
  previous chunk when it has no first-line colon of its own AND the previous
  chunk starts with a clean title line (the `[^:.]` title class keeps the
  "For the North Atlantic..." header and old-format untitled prose from being
  inherited). Verified over all 381 archived TWOs: exactly the 5 gap products
  changed, all 92 raw invest tags now parse. First TWO fixtures added
  (2 gap + 2 controls); derived JSON regenerated — AL90's genesis chain is
  tag-chainable for M2.*
- [ ] **TWO title containing periods defeats the title regex** (2026-07-17,
  pinned as a wart in fixture `TWOAT.202606271144.txt`) — "Off of the
  southeastern coast of the U. S.:" never matches the `[^:.]{1,80}:` title
  pattern, so the tag-from-title path would lose an invest tag if such a title
  ever carried one (none has this season; position falls back to sentence
  scanning and is honestly null). Low urgency; revisit if a real product ever
  pairs a period-bearing title with an invest tag.
- [ ] **Directional-offset phrases anchor at the landmark** (2026-07-17, found
  by the automated chain audit) — "several hundred miles south-southwest of
  the southern tip of the Baja California peninsula" resolves to the Baja
  anchor itself (29N 114W, mid-peninsula) instead of a point offset south of
  it; evidence `TWOEP.202606230501.txt` → `...231147.txt`, where EP94's
  position lurches 17° in 6 h while its tag (correctly) holds the chain
  together. Same coarseness stacks distinct same-product areas on one anchor
  (the June 21 collision that motivated the genesis-symmetry rule). Fix is
  delicate gazetteer/offset work — its own fixtured PR; positions and
  lineage both improve when it lands.

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
- [x] **M2 — Lineage engine**: `tools/build-lineage.js` — compose diff.js
  pairing across the season into entity chains (waves by axis progression,
  invests by tag, cyclones by name) + genesis links (wave→invest→cyclone),
  per-sighting confidence; `lineage-2026.json`; synthetic-sequence unit tests
  + pinned corpus snapshot; negative tests for every join rule.
  *Done 2026-07-17: engine + gates (18h gap, 2° east-drift, second-tag
  refusal), conservative genesis linker (ambiguity = no link), cron rebuilds
  lineage each sync. Every join rule has a negative test. DEVIATION: the
  "pinned corpus snapshot" became growth-proof invariants + an immutable AL90
  pin — exact counts would break CI on every 6-hourly archive commit. Bonus:
  `tools/lineage-lab.html`, a chain-inspection wall map (basin/kind/confidence
  filters, season replay scrubber, REAL/SAMPLE badge) for vetting joins by
  eye; it becomes M3's treatment lab. Season-to-date: AL90 chains June 13→16
  across its designation (12 sightings), EP91 walks 20→80% into the season's
  first EP depression, CP90's two honestly-broken unmapped chains. Post-ship
  automated chain audit (49 flags, all adjudicated innocent — mostly NHC
  re-analysis jitter, one NHC-stated wave merge) hardened the linker: genesis
  ambiguity is now symmetric (one wave claims at most one invest, one invest
  at most one cyclone; comparable candidates → no link), killing the June 21
  double-link to a same-anchor forecast area.*
- [x] **M3 — Lineage UI**: "history" affordance on cyclone/wave/invest popups
  → lazy-fetch (countries.js pattern) → time-faded trail + genesis segments;
  trail treatment judged in a lab first; broken chains render as separate
  segments, never silently bridged.
  *Done 2026-07-17: stage A picked the treatment in `tools/lineage-lab.html`
  (three treatments — comet / breadcrumbs / ghost — over real chains; locked
  `HC_TRAIL = { mode:'breadcrumbs', n:'all', fade:'linear', w:3, dotR:4 }`).
  Stage B shipped the app affordance: a subtle "history" link on cyclone, wave,
  and TAGGED-disturbance popups (untagged disturbances get NO link — an untagged
  area has no invest id to match, so offering it would risk a wrong lineage);
  first click lazy-fetches `archive/derived/lineage-2026.json` (session-cached,
  no SW entry) and draws ONE chain's breadcrumb trail in a dedicated `hc-trail`
  pane (415, under the live lines/points, non-interactive). Matching is
  conservative (name / exact tag / wave within 6° mean-lon + 30h, best-two-within-
  2° = ambiguous = "no tracked lineage"); honesty invariants hold — null-position
  sightings skipped without bridging, proximity/inferred dashed, genesis
  dotted-gold, stacked anchors collapse to a point, a fetch miss reads "season
  archive unavailable" and draws nothing. Trail clears on hide / basin switch /
  refresh / paste / scrubber step (one hook in clearCats). Provenance caption
  "N archived sightings · computed lineage — breaks are honest".*
- [x] **M4 — Genesis truth ledger**: per-invest genesis timeline, TWO
  chance-trend sparklines (absorbs the Track A sparkline item), season
  calibration table (stated 48h/7d odds vs outcomes) — all over
  `lineage-2026.json`.
  *Stage A shipped 2026-07-18: `tools/build-genesis-ledger.js` derives
  `archive/derived/genesis-2026.json` (rebuilt by the 6-hourly cron) — four
  per-statement verdicts extending the honesty rule to outcomes: `formed`
  requires a lineage genesis link; an unattributed cyclone nearby makes the
  window `unresolved` (AL90's 60/60 vs unlinked One/Arthur — refuses to invent
  formed OR not-formed); open windows `pending`. Calibration lives in
  `tools/genesis-lab.html` (dev-side while the season's sample is small),
  which also holds 3 timeline + 3 sparkline candidate treatments.
  Stage B shipped same day: tagged-invest TWO popups render the record at the
  lab-locked pick — step-dual chance sparkline (time-true spacing, null = gap)
  over the ruler timeline (chance-colored ticks, hatched pending window, gold
  cross-hatched unresolved span naming nearby cyclones, ★ only on a formed
  link) — verdicts read from `genesis-2026.json`, never recomputed in the
  browser. Untagged areas get nothing (no tag, no match — the M3 rule).*

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
