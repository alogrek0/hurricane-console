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
- [ ] **East Pacific (TWDEP) basin support** — basin abstraction (product id →
  map extent + gazetteer set). Biggest lift; opens CP later.

## Track B — App Store readiness

A bare PWA can't be submitted; the path is a Capacitor (WKWebView) shell
around the exact same files. Ordered milestones:

- [ ] **PWA polish** — full icon set (maskable sizes), launch screen,
  accessibility pass (VoiceOver labels on controls, contrast check), offline
  behavior audit. All of this improves the PWA today and is required later.
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
