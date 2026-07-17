---
name: ship-cheaply
description: "Token-cheap shipping for hurricane-console — one-call tools/ship.ps1, harness facts (Bash-only allow rules, GateGuard cost), PS 5.1 exit-code trap"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 8581015c-d524-4774-a397-41af09f386b5
---

The user has twice flagged (2026-07-16) that shipping to Pages burns too many tokens.

**Why:** every extra tool round-trip re-reads the whole session context; hook denials double file writes; verbose outputs (full test dumps, echoed Playwright scripts) compound it.

**How to apply:**
- Ship via ONE call: `tools/ship.ps1` (see the ship skill — write msg/body scratchpad files, run the script). Auto-merge-on-green is the user's explicitly confirmed standing default, recorded in SKILL.md; `-Hold` for the active-storm rule.
- Project allow rules are `Bash(...)` only — the PowerShell tool doesn't match them; prefer the script (or Bash tool) for gh/git ship commands so pre-approved rules apply as intended.
- ECC GateGuard demands facts before the first Write/Edit per file (14 denials on 2026-07-16). Only the user can change hook config; they have the `"env": {"ECC_GATEGUARD": "off"}` snippet for `~/.claude/settings.json` — check whether it's active before expecting denials.
- PS 5.1: `$LASTEXITCODE` goes stale when `& cmd` fails at the PowerShell level — verify outcomes (URL regex, `git merge-base --is-ancestor` against fetched origin/main), never exit codes alone. ship.ps1's HONESTY RULE header documents this; keep it ASCII-only.
- Keep outputs terse: summary lines, not full dumps; suggest fresh sessions for mechanical follow-ups to long work sessions.

Related: [[ship-flow-token-costs]] (parent-scope memory with fuller history).
