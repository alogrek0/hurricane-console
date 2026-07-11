---
name: verify
description: How to run and drive Hurricane Console to verify a change end-to-end
---

# Verifying Hurricane Console changes

## Launch

`python3`/`python` may not exist on this Windows box (MS Store alias). Use:

```bash
npx -y http-server -p 8000 -s     # run in background, serve repo root
```

Then drive `http://localhost:8000` with the Playwright MCP tools. The service
worker needs http(s); `file://` runs without offline support.

## Driving the paste path (exercises the parser end-to-end)

The paste dialog is the fastest way to feed the parser arbitrary real product
text and see it render:

1. Click `#paste` (opens `#pasteDlg`).
2. Set `#pasteText` value via `browser_evaluate` (typing multi-KB teletype text
   is too slow). To paste a file, temporarily `cp` it into the repo root and
   `fetch()` it in the evaluate callback — delete the copy afterwards.
3. Click `#pasteMap`. Routing: text matching `/FORECAST\/ADVISORY/` in the
   first 400 chars → `parseTCM` + `renderTCM`; otherwise TWDAT/TWO parse.
4. Check the badge (top right): must read PASTED on success, ERROR on
   unparseable input — never LIVE for pasted data (badge contract, CLAUDE.md).
5. Check the readout (bottom-right meta): storm name · advisory / feature
   counts · issuance.

Real archived product text lives in the archive-audit cache
(`%TEMP%\hurricane-console-archive-audit\*.txt` after `node tools/archive-audit.js`).

## Gotchas

- favicon.ico 404 in the console is pre-existing noise; so is the
  apple-mobile-web-app-capable deprecation warning.
- Playwright screenshots land in `.playwright-mcp/` inside the repo — delete
  the directory before committing.
- On localhost the live api.weather.gov fetch works (CORS is open), so the
  badge starts LIVE/CACHED, not SAMPLE.
