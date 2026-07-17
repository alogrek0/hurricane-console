# Portable Claude Code memory — Hurricane Console

The `*.md` files in this folder are a **committed copy of this project's Claude Code
auto-memory**: durable facts about the user, their workflow preferences, and locked
project decisions. Normally this memory lives *outside* the repo, under the user's
`~/.claude`, so it does **not** travel with `git clone`. It was copied here on
2026-07-17 so it can move between machines with the repo.

## If you are a Claude Code instance on a new machine — install it

Claude Code loads per-project memory from a user-level folder, not from the repo. To
make this memory active, copy these files there:

1. **Find the target folder.** Claude Code stores this project's memory at:
   ```
   ~/.claude/projects/<ENCODED_REPO_PATH>/memory/
   ```
   `<ENCODED_REPO_PATH>` is the repo's **absolute path** with every `:`, `\`, and `/`
   replaced by `-`. Example: `C:\Users\dblitch\projects\hurricane-console`
   → `C--Users-dblitch-projects-hurricane-console`. If unsure, start `claude` in the
   repo once and look for the auto-created folder under `~/.claude/projects/`.
2. **Copy every `*.md` here EXCEPT this `README.md`** into that `memory/` folder.
3. **`MEMORY.md` is the index** loaded into context each session. If the destination
   already has a `MEMORY.md`, **merge** these entries into it — don't blindly overwrite.
4. These are **user/workflow context, not project source** — don't treat them as code.

## Caveats

- The canonical, live memory is the user's `~/.claude`; **this folder is a transport
  copy and can go stale.** Re-copy from the source if in doubt.
- Each memory carries its own `metadata.type` and an age; verify any `file:line` or
  code-behavior claim against the current tree before relying on it.
- This repo deploys to GitHub Pages, so these files are **publicly fetchable**. They
  contain workflow preferences and project notes — no secrets — but keep it that way:
  never copy a memory containing a token, credential, or private detail here.

## Files
- `MEMORY.md` — the index (one line per memory)
- `github-tooling-gaps.md`, `model-tiering-preference.md`,
  `ui-samples-before-implementing.md`, `ship-cheaply.md`, `moat-track-c.md`
  — one fact each (user prefs, workflow feedback, project decisions)
