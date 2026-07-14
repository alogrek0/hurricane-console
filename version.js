/*
 * version.js — Hurricane Console app version. Single source of truth.
 * CalVer: YYYY.MM.DD, with a .N suffix for same-day re-deploys
 * (e.g. 2026.07.10 then 2026.07.10.2). Loaded by the page (script tag),
 * the service worker (importScripts — cache names derive from it, and
 * browsers byte-check imported scripts, so bumping this alone triggers
 * the client update flow), and node (test harness).
 *
 * Bump this whenever any shell file ships; the pre-push hook in
 * tools/hooks enforces it.
 */
(function (root) {
  'use strict';
  root.APP_VERSION = '2026.07.14.15';
  if (typeof module !== 'undefined' && module.exports) module.exports = root.APP_VERSION;
})(typeof self !== 'undefined' ? self : globalThis);
