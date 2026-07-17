---
name: moat-track-c
description: "Strategic moat direction decided 2026-07-16 — season archive + wave lineage + genesis ledger (ROADMAP Track C, M1-M4)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 133491bb-5f7d-4e63-8f9a-a0c8c78809cf
---

On 2026-07-16 the user chose the app's moat strategy: make the parser
**compound** via a season archive. Full milestones live in ROADMAP.md
**Track C — Moat (compounding data)**; the plan file from that session was
`if-iam-planning-on-elegant-wadler.md`.

Core decisions (locked with the user):
- Both directions staged: archive foundation → wave-lineage UI → genesis
  truth ledger. Backfill current season only (2026-06-01→now).
- Raw NHC text is ground truth, committed to `archive/{year}/{basin}/`;
  derived JSON regenerated, never hand-edited; app loads it lazily.
- Credibility rule: prefer broken lineage chains over invented links —
  a wrong lineage is that feature's "Tropical Depression Or".

**Why:** the parser is the unique asset; an accumulating archive + lineage
data makes it harder to copy every day it runs.

**How to apply:** when a session proposes Track C work, start at the topmost
unchecked M-item in ROADMAP.md. M1 shipped 2026-07-16 (PR #50): archive-sync/
derive-summary/nhc-text-archive tools + archive.yml cron + 849-product backfill;
Shipped through M3 (2026-07-17): M2 engine + lab (PR #52, symmetric
genesis ambiguity added post-audit in PR #53), M3 trail treatments lab
stage (PR #54) and the in-app history affordance (PR #55) — Derek's
locked pick is HC_TRAIL breadcrumbs/all/linear/w3/dotR4; untagged
disturbances deliberately get no history link (wrong-lineage risk).
Next: M4 (genesis truth ledger — per-invest timeline, chance-trend
sparklines, season calibration table, all over lineage-2026.json).
Before M4: the "offset phrases anchor at the landmark" parser gap in
ROADMAP "Parser gaps" degrades invest positions (EP94's 17° lurch) —
fixing it first improves the ledger's positions AND may restore the
June 21 genesis link legitimately. Delegation pattern proven across
four PRs: main loop designs/verifies, Opus agents build.
See [[ship-cheaply]] for the ship flow.
