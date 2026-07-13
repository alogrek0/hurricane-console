---
name: ship
description: Ship the working tree — commit, push, open a PR, wait for CI, merge, sync main. The repo's merge-when-green flow (see ROADMAP.md) in one command. Pass "hold" to stop after the PR goes green without merging (active-storm rule).
---

# /ship — commit → push → PR → CI → merge

Runs the full merge-when-green flow for whatever is in the working tree.
Merging to `main` IS the deploy (GitHub Pages serves `main`), so a completed
/ship ends with the change live within a minute.

`gh` may need its full path in shells opened before it was installed:
`"/c/Program Files/GitHub CLI/gh.exe"` (bash) / `& "C:\Program Files\GitHub CLI\gh.exe"` (PowerShell).

## Steps

1. **Preflight**
   - `node test.js` must pass — never ship red.
   - If any shell file changed (the authoritative list is in
     `tools/check-version-guard.sh`), `version.js` must be bumped in this
     change set (CalVer `YYYY.MM.DD`, `.N` suffix for same-day). Bump it if
     the work didn't already.
   - Never commit `.playwright-mcp/` or stray screenshot `.png`s at the repo
     root — delete them first.
2. **Branch**: if on `main`, `git fetch origin && git pull`, then create a
   short descriptive branch. If already on a feature branch, stay on it.
3. **Commit**: one commit per concern (a feature and an unrelated doc tweak
   can be separate commits in the same PR). Message style: short imperative
   summary line like the existing history. End the body with the
   Co-Authored-By line the harness requires.
4. **Push**: `git push -u origin <branch>`.
5. **PR**: `gh pr create` with a `## Summary` and `## Verification` body,
   ending with the "Generated with Claude Code" line.
6. **Wait for CI**: `gh pr checks <n> --watch --fail-fast` (the suite takes
   ~1 min). Right after PR creation it can error with "no checks reported" —
   the job hasn't registered yet; wait ~15s and retry. If a check fails:
   report the failure output, leave the PR open, and STOP — do not merge.
7. **Merge** (skip when the user said "hold"): `gh pr merge <n> --merge`
   (merge commit, matching the repo's history), then
   `git checkout main && git pull`, and delete the local + remote branch.
8. **Report**: PR link, merge commit, and a reminder that Pages redeploys
   and live clients get the update banner on their next reload.

## Notes

- "hold" (active-storm rule, see ROADMAP.md): do steps 1–6 only; say the PR
  is green and waiting, and merge later when asked.
- If CI is green but the merge is blocked (conflict with a just-merged PR),
  rebase on `origin/main`, resolve — `version.js` conflicts resolve to the
  highest CalVer — force-push the feature branch, and re-watch CI.
