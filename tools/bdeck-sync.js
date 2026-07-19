/*
 * tools/bdeck-sync.js — 6-hourly capture of NHC's ATCF working best-track
 * ("b-deck") files into archive/{year}/atcf/ (Track C M5, data-capture slice).
 *
 * Why capture at all: the btk/ files MUTATE — each 6h synoptic time appends
 * rows AND past rows get revised in place. Invest files (tags 90-99) are worse:
 * the tag numbers recycle within a season and the file resets to the new
 * system, so an invest's in-season evolution is not archived anywhere public.
 * Every cron cycle not captured is ground truth gone forever. A future Track C
 * milestone reads these as truth for the genesis ledger / lineage validation;
 * this slice is ARCHIVING ONLY — no derive, no app involvement.
 *
 * Usage:  node tools/bdeck-sync.js      (no flags — the listing only carries
 *         current-season files and the snapshot rule below handles re-runs)
 *
 * Layout: archive/{year}/atcf/bal912026.202607180000.dat — the source filename
 * with a content-derived stamp inserted: the max DTG (ATCF field 3, YYYYMMDDHH,
 * minute-bearing 12-digit rows tolerated) padded to the repo's 12-digit stamp
 * convention. No wall clock, so a re-fetch with no new data is a zero diff.
 * Per fetched file:  snapshot absent -> WRITE;  present and byte-identical ->
 * SKIP;  present with different bytes (in-place revision at the same synoptic
 * time) -> OVERWRITE, git history keeping each prior cron-run state. The tree
 * is append-only per synoptic time; a recycled invest tag starts a new DTG era
 * and the old invest's snapshots persist.
 *
 * Only bal / bep files are fetched — Central Pacific (bcp) is out of scope,
 * matching the app and the invest alerter.
 *
 * Dev-only and NETWORK-DEPENDENT (Node 18+ global fetch, zero deps). Polite:
 * one listing request, ~150 ms between file fetches, sequential, same UA
 * identity as the text-archive crawl. A per-file fetch error or an unstampable
 * file (no parseable DTG) is logged and skipped — never a partial or
 * fabricated snapshot; an unreachable listing sets a non-zero exit so the
 * cron run shows red.
 *
 * Cron: .github/workflows/archive.yml runs this every 6 hours after the text
 * sync; its commit step already stages all of archive/. The pure helpers
 * (btkListingNames/maxDtg/snapshotName/writeAction) are exported for test.js,
 * which stays offline; only sync() touches the network. Never runs in the
 * browser (ftp.nhc.noaa.gov sends no CORS headers anyway).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { UA } = require('./nhc-text-archive.js');
const { SEASON } = require('./archive-sync.js');

// b-decks live on a different host than the text archive — BASE in
// nhc-text-archive.js is www.nhc.noaa.gov/archive/ and does not apply here.
const BTK_BASE = 'https://ftp.nhc.noaa.gov/atcf/btk/';
const ARCHIVE = path.join(__dirname, '..', 'archive');
const FETCH_DELAY_MS = 150;

// --- pure helpers (exported for offline tests) ----------------------------------

// Directory-listing HTML -> sorted, de-duplicated current-season b-deck names
// (`bal912026.dat`). Anchored to bal/bep + SEASON, so a-decks, bcp* (Central
// Pacific, out of scope) and stray other-year files never match.
function btkListingNames(html) {
  const re = new RegExp('b(?:al|ep)\\d{2}' + SEASON + '\\.dat', 'g');
  return [...new Set(String(html || '').match(re) || [])].sort();
}

// B-deck text -> the max DTG as a 12-digit stamp, or null when no row parses
// (an unstampable file is never written). ATCF rows are comma-separated with
// space padding; field 3 is the DTG — YYYYMMDDHH, with minute-bearing 12-digit
// values on special rows (landfall / peak intensity). 10-digit DTGs pad to the
// repo's 12-digit stamp convention; fixed width makes lexical max = latest.
function maxDtg(text) {
  let max = null;
  for (const line of String(text || '').split('\n')) {
    const parts = line.split(',');
    if (parts.length < 3) continue;
    const dtg = parts[2].trim();
    if (!/^\d{10}(\d{2})?$/.test(dtg)) continue;
    const stamp = dtg.length === 10 ? dtg + '00' : dtg;
    if (max === null || stamp > max) max = stamp;
  }
  return max;
}

// Source filename + content stamp -> snapshot filename
// (`bal912026.dat`, `202607180000` -> `bal912026.202607180000.dat`).
function snapshotName(fname, stamp) {
  return String(fname).replace(/\.dat$/, '.' + stamp + '.dat');
}

// Existing snapshot content (null when absent) + freshly fetched content ->
// 'write' | 'skip' | 'overwrite'. Overwrite is the in-place-revision case:
// same max DTG, different bytes — git history keeps the prior state.
function writeAction(existingContent, newContent) {
  if (existingContent === null) return 'write';
  if (existingContent === newContent) return 'skip';
  return 'overwrite';
}

// --- network sync (not exercised by test.js) ------------------------------------

const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

async function fetchText(url) {
  const res = await fetch(url, UA);
  if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
  return res.text();
}

async function sync() {
  let listing;
  try {
    listing = await fetchText(BTK_BASE);
  } catch (e) {
    console.error('btk: listing fetch failed — ' + (e.message || e));
    process.exitCode = 1; // an unreachable listing shows the run red
    return;
  }
  const names = btkListingNames(listing);
  const dir = path.join(ARCHIVE, String(SEASON), 'atcf');
  fs.mkdirSync(dir, { recursive: true });
  let wrote = 0, revised = 0, identical = 0, failed = 0;
  for (const name of names) {
    try {
      const raw = await fetchText(BTK_BASE + name);
      const text = raw.replace(/\r\n?/g, '\n'); // LF, matching .gitattributes
      const stamp = maxDtg(text);
      if (stamp === null) {
        // skip-and-log: an unstampable file never becomes an invented snapshot
        console.error('  ' + name + ': no parseable DTG — skipped');
        failed++;
      } else {
        const dest = path.join(dir, snapshotName(name, stamp));
        const existing = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : null;
        const action = writeAction(existing, text);
        if (action === 'skip') identical++;
        else {
          fs.writeFileSync(dest, text);
          if (action === 'write') wrote++; else revised++;
        }
      }
    } catch (e) {
      // skip-and-log: a failed fetch never becomes a partial snapshot
      console.error('  ' + name + ': fetch failed — ' + (e.message || e));
      failed++;
    }
    await sleep(FETCH_DELAY_MS);
  }
  console.log('btk: ' + names.length + ' listed — ' + wrote + ' new, ' +
    revised + ' revised, ' + identical + ' identical, ' + failed + ' failed');
}

module.exports = {
  SEASON, BTK_BASE,
  btkListingNames, maxDtg, snapshotName, writeAction,
};

if (require.main === module) {
  sync().catch(function (e) { console.error(e.message || e); process.exit(1); });
}
