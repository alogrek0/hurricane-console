---
name: model-tiering-preference
description: Derek wants cost-conscious model tiering — delegate to cheaper models where the work shape allows
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 640d178a-1fa9-4ffe-95a3-ef18bb125201
---

Derek explicitly opted into multi-model subagent delegation (2026-07-14, EP basin work): Sonnet for research fan-out (archive sweeps, coordinate curation with sources), Haiku for cheap read-only scans, and Opus for large well-specified implementation ("Use Opus for this" on PR2 execution).

**Why:** Cost consciousness on a hobby project; the main loop's value is design precision and verification, not typing volume.

**How to apply:** For big features, plan in the main loop with enough file/line detail that an Opus subagent can execute verbatim; main loop then reviews the diff, runs the verification checklist itself, and ships. Keep the most delicate work (parser.js regex/ordering contracts) in the main loop. Verify every externally-sourced number a research agent returns before it enters the code.
