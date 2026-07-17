---
name: ui-samples-before-implementing
description: "For UI/visual features, show a live sample menu/demo and wait for the user's pick BEFORE integrating into the app"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 39776e25-b074-480e-930e-596d9dc121cc
---

When a task changes how the app looks or feels (new labels, hover treatments, highlights, styling), the user wants to see and try 2–3 concrete visual samples first — a live demo/lab page with a treatment menu — and explicitly pick one before any shipped file is touched.

**Why:** They said so directly ("I want to see UI sample menu demo before we implement") and reinforced it at plan approval. The repo codifies the same value in `tools/highlight-lab.html` ("how a selection *looks* is judged by looking, not by shipping a release per constant").

**How to apply:** Structure UI plans in two phases with a hard gate: Phase 1 builds only dev-only demo assets (e.g., a `tools/*-lab.html` page loading the real map/data) plus screenshots and a local URL; then STOP for the pick. Phase 2 integrates the chosen treatment into shipped files (with version bump etc.).
