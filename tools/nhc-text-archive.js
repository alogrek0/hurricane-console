/*
 * tools/nhc-text-archive.js — shared access helpers for the nhc.noaa.gov text
 * archive (https://www.nhc.noaa.gov/archive/text/{TYPE}/{year}/).
 *
 * Required by tools/archive-audit.js (curated-corpus auditor) AND
 * tools/archive-sync.js (season backfill + 6-hourly cron), so the two agree on
 * the base URL, the polite User-Agent, and the directory-listing parse instead
 * of duplicating the regex. Pure string/Date helpers here — no fs, no network.
 *
 * Zero dependencies; never runs in the browser.
 */
'use strict';

const BASE = 'https://www.nhc.noaa.gov/archive/';
// Same polite identity archive-audit.js has always sent — a real contact so
// nhc.noaa.gov can reach a human if the crawl ever misbehaves.
const UA = { headers: { 'User-Agent': 'hurricane-console-archive-audit (opt08400@gmail.com)' } };

// Directory-listing HTML -> sorted, de-duplicated list of `TYPE.YYYYMMDDHHMM.txt`
// filenames. The listing repeats each name (link text + href) and carries
// unrelated hrefs; the type-anchored 12-digit pattern is the only shape we keep.
function listingNames(html, type) {
  const re = new RegExp(type + '\\.\\d{12}\\.txt', 'g');
  return [...new Set(String(html || '').match(re) || [])].sort();
}

// Filename -> its 12-digit stamp string (`TWDAT.202607141800.txt` -> `202607141800`),
// or null when there is no stamp (so callers can skip non-product files honestly).
function stampOf(fname) {
  const m = /(\d{12})/.exec(String(fname || ''));
  return m ? m[1] : null;
}

// 12-digit YYYYMMDDHHMM stamp -> UTC Date, or null on malformed input or an
// impossible date (the round-trip check rejects e.g. a day-32 stamp).
function stampDate(stamp) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(String(stamp || ''));
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3], hh = +m[4], mi = +m[5];
  const dt = new Date(Date.UTC(y, mo - 1, d, hh, mi));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d ||
    dt.getUTCHours() !== hh || dt.getUTCMinutes() !== mi) return null;
  return dt;
}

module.exports = { BASE, UA, listingNames, stampOf, stampDate };
