---
name: ship
description: Ship the working tree — commit, push, open a PR, wait for CI, merge, sync main. The repo's merge-when-green flow (see ROADMAP.md) in one command. Pass "hold" to stop after the PR goes green without merging (active-storm rule).
---

# /ship — commit → push → PR → CI → merge

Runs the full merge-when-green flow for whatever is in the working tree.
Merging to `main` IS the deploy (GitHub Pages serves `main`), so a completed
/ship ends with the change live within a minute. Auto-merge on green CI is the
repo owner's standing, explicitly-confirmed default (2026-07-16) — invoking
/ship without "hold" IS the consent to merge and deploy; do not re-ask per PR.

## Primary path: ONE script call (token-cheap)

The whole flow lives in `tools/ship.ps1`. Do exactly three things:

1. **Preflight the version bump** (the only judgment call): if any shell file
   changed (authoritative list in `tools/check-version-guard.sh`), `version.js`
   must be bumped in this change set (CalVer `YYYY.MM.DD`, `.N` suffix for
   same-day). Bump it if the work didn't already.
2. **Write two scratchpad files** (one batched Write call): the commit message
   (short imperative summary line like the existing history, body, ending with
   the Co-Authored-By line the harness requires) and the PR body (`## Summary`,
   `## Verification`, ending with the "Generated with Claude Code" line).
3. **Run the script** (single call; ~1–2 min, mostly CI wait):

   ```
   powershell -NoProfile -File tools/ship.ps1 -Branch <short-name> -Title "<PR title>" `
     -MessageFile <scratchpad>\msg.txt -BodyFile <scratchpad>\body.md [-Hold]
   ```

The script runs the tests (never ships red; prints only the summary line),
deletes `.playwright-mcp/` and stray untracked root `.png`s, branches off a
fresh `main` (or stays on the current feature branch), commits everything as
one commit, pushes (the pre-push hook enforces the version guard), creates or
reuses the PR, watches CI with the "no checks reported" retry, merges when
green, and syncs + prunes branches. Output is terse; failures print the
relevant detail, leave the PR open, and exit non-zero — report them and STOP.

`-Hold` (active-storm rule, see ROADMAP.md): stops after the PR is green;
merge later when asked.

## Fallback: manual steps

Use only when the script's one-commit shape doesn't fit (multiple commits per
concern in one PR) or for conflict recovery.

1. **Preflight**: `node test.js` green; version bump per the guard; no
   `.playwright-mcp/` or stray root `.png`s.
2. **Branch**: from a pulled `main`, or stay on the feature branch.
3. **Commit**: one commit per concern, message via `git commit -F <file>`,
   Co-Authored-By line at the end.
4. **Push**: `git push -u origin <branch>`.
5. **PR**: `gh pr create --body-file <file>`.
6. **CI**: `gh pr checks --watch --fail-fast`; "no checks reported" right
   after creation means wait ~15s and retry. Red = report, leave open, STOP.
7. **Merge**: `gh pr merge --merge`, sync main, delete branches.
8. **Report**: PR link, merge commit, Pages redeploy reminder.

## Notes

- `gh` may need its full path in shells opened before it was installed:
  `"/c/Program Files/GitHub CLI/gh.exe"` (bash) /
  `& "C:\Program Files\GitHub CLI\gh.exe"` (PowerShell). The script resolves
  this itself.
- If CI is green but the merge is blocked (conflict with a just-merged PR),
  rebase on `origin/main`, resolve — `version.js` conflicts resolve to the
  highest CalVer — force-push the feature branch, and re-watch CI.
