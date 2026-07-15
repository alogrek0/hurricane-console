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

## Track A — Features

- [x] **Product-history scrubber** — fetch the last ~8 TWDAT/TWO issuances and
  step through time; watch waves march and formation odds evolve. Pairs
  naturally with an invest alert ("what changed since yesterday?").
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
