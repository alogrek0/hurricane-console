---
name: audit
description: Whole-codebase review — fan out read-only auditors across the app's subsystems, adversarially verify each finding, and return one ranked report (correctness, tidiness, test coverage, security). Report only; makes no edits. Use when there is no diff to review (the built-in /code-review and /simplify work on a diff/PR; this reviews the source as it stands).
---

# /audit — whole-codebase review, report only

The built-in `/code-review`, `/simplify`, and `/security-review` all need a diff
or PR. When `main` is clean there is nothing for them to chew on. `/audit`
reviews the source **as it stands**: it fans out read-only auditors over the
app's subsystems, makes each candidate finding survive a skeptic pass, and
returns a single ranked report across four dimensions — **correctness bugs,
tidiness/simplification, test coverage, security**.

**This skill never edits, commits, or applies a fix.** It produces a report and
stops. Fixing is a separate, deliberate step (`/code-review`, `/simplify`, or by
hand). A false-positive "bug" is worse than a missed nit here — this is the repo
of "a cyclone must be real" and "the badge is a contract" — so the verify pass
defaults to rejecting anything speculative.

## Steps

1. **Preflight**
   - Run `node test.js` — it must be green. Audit against a known-good baseline;
     if the suite is already red, report that first and stop (fix the baseline,
     don't audit on top of it).
   - Note the working-tree state (`git status`). A clean tree is the normal
     case; if there are uncommitted changes, say so — the report covers what's
     on disk, not a diff.
2. **Fan out** — dispatch the auditors below **in a single message** so they run
   in parallel (`Agent`, `subagent_type: general-purpose` — they must read whole
   files, not just excerpts). Give **every** auditor: the four dimensions, the
   fixed finding shape (step 4), and the **Intentional — do not flag** list
   (`## Notes`). One auditor per subsystem:
   - `parser.js` — the load-bearing three-pass engine + `parseTCM`. Per-basin
     logic, `troughKind` tagging, the `extractCyclones` phantom-name guards,
     gazetteer `inferred` gating, cone/wind-field math. Correctness-heavy.
   - `app.js` — fetch → parse → render on Leaflet, per-basin frame/mask setup
     (`BASINS`, `switchBasin`), pane z-order, the badge state machine, history
     scrubber, paste/refresh UI.
   - `sw.js` + caching — cache-first shell / network-first data, the
     version-derived shell cache name, the version-independent FIFO data cache,
     `X-From-Cache` stamping.
   - `index.html` + the DOM render path — the injection surface: parsed teletype
     text reaching the DOM (popups, readout, badge). Security lens especially.
   - `test.js` + `fixtures/` — coverage gaps vs actual parser behaviour: parser
     branches with no assertion, invariants asserted in prose (CLAUDE.md) but not
     in a test, fixture kinds not exercised.
   - `tools/` — `alert-invests.js` (its pure `stateFromTWO`/`diffAlerts`/
     `formatAlert` logic), `archive-audit.js`, `check-version-guard.sh`, the
     generators. Correctness + tidiness.
3. **Verify** — pool the candidates and run a skeptic pass. For each finding:
   *"Try to refute this. Is it actually reachable/true given the whole file and
   the repo invariants? Default to rejecting if speculative."* Drop anything that
   doesn't survive. For a heavier sweep, the `Workflow` tool can pipeline
   audit → verify, but the parallel-`Agent` path above is the default and stays
   dependency-free like `/ship` and `/verify`.
4. **Report** — one document, findings grouped by the four dimensions,
   most-severe first, deduped across subsystems. Each finding:
   `file:line` · dimension · severity · **why it's real** (the concrete failure
   or cost) · **suggested fix** (described, never applied). End with a one-line
   pointer that fixing is the next, separate step. Emit nothing else — no edits,
   no commits, no auto-applied tidy.

## Notes

- **Intentional — do NOT flag as bugs** (load-bearing design; see `CLAUDE.md`).
  An auditor that raises these is producing noise:
  - **Provenance honesty** — the badge states (LIVE / CACHED / SAMPLE / PASTED /
    ERROR / HISTORY / LOADING) and their distinctions are a contract; `inferred:
    true` features render dashed on purpose; the cone is labelled *computed*, the
    wind field *official* — deliberate.
  - The EP gazetteer has **no Hawaii** entry by design; Central Pacific
    (east of 140W) stays honestly unmapped.
  - The TWDEP **left-basin asymmetry** ("moved into the eastern Pacific" is an
    ARRIVAL in an EP product) is load-bearing and tested — not a copy-paste slip.
  - `fixtures/expected.json` pins **current** behaviour, warts included; it is
    never hand-edited (regen only via `tools/archive-audit.js --save-fixtures`).
    A pinned wart is a pin, not a bug in the fixture.
  - `basemap.js` is **generated** — don't flag its style/verbosity. Trough
    colour-coding (ITCZ cyan / monsoon green / trough slate-teal) is a **house
    convention**, not NHC's — intentional.
  - Pane z-order (`hc-mask` 402 < `hc-areas` 410 < `hc-lines` 420 < `hc-points`
    430) is declarative on purpose — don't propose add-order stacking.
  - CalVer / version-guard rules: only shell files trigger a bump; `test.js`,
    `fixtures/`, `tools/`, `.github/`, docs, and `.claude/` do not.
- Real ES5-ish, dependency-free (Leaflet from CDN) is the house style — don't
  recommend a framework, bundler, or npm dependency as a "fix".
- Coordinates are `{lat, lon}`, west/south negative, throughout — a sign that
  looks wrong is usually this convention.
- Scope the fan-out to what the user asks. Default is all four dimensions across
  every subsystem; if they name one dimension or one file (e.g. "just the
  parser"), audit only that and say so in the report.
