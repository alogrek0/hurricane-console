/*
 * tools/archive-audit.js — run parser.js over a CURATED corpus of archived NHC
 * products from nhc.noaa.gov (as opposed to tools/parser-audit.js, which sweeps
 * whatever is on the live api.weather.gov feed right now).
 *
 * Usage:  node tools/archive-audit.js                  # audit only (triage)
 *         node tools/archive-audit.js --save-fixtures  # audit + write fixtures/
 *
 * --save-fixtures persists the corpus into the repo: each product's teletype
 * text (LF-normalized) goes to fixtures/<tag>.txt and a pinned snapshot of the
 * current parser output (shape: tools/corpus-summary.js) goes to
 * fixtures/expected.json, which `node test.js` then asserts against offline.
 * This same command IS the snapshot-update workflow after a deliberate parser
 * change: re-run it, review `git diff fixtures/`, commit alongside the change.
 * It refuses to write if ANY product fails its ground-truth expectations below
 * — never pin snapshots the manifest itself says are wrong.
 *
 * Why it exists: the TCM (parseTCM) and SPECIAL-FEATURES cyclone
 * (extractCyclones) paths only get exercised when a storm is active, so a live
 * audit during a quiet spell measures nothing. The manifest below pins real
 * archived advisories chosen to cover the phrasing space: hurricane / TS / TD
 * with a spelled-number name / subtropical / post-tropical / Potential Tropical
 * Cyclone / a SPECIAL advisory, plus TWDATs from active-storm periods with one
 * and two simultaneous cyclones.
 *
 * Dev-only and NETWORK-DEPENDENT on first run; every fetched product is cached
 * under a temp dir (override with AUDIT_OUT) and re-runs are served from cache,
 * so iterating on parser fixes works offline and does not hammer nhc.noaa.gov.
 *
 * The flags are a TRIAGE AID, not a pass/fail gate — regression coverage for
 * anything found here belongs in test.js as a distilled fixture. This is NOT
 * part of `node test.js` (which must stay offline and deterministic).
 *
 * Zero dependencies; never runs in the browser.
 */
'use strict';
const P = require('../parser.js');
const fs = require('fs');
const os = require('os');
const path = require('path');

const OUT = process.env.AUDIT_OUT || path.join(os.tmpdir(), 'hurricane-console-archive-audit');
fs.mkdirSync(OUT, { recursive: true });

const SAVE = process.argv.includes('--save-fixtures');
const FIXDIR = path.join(__dirname, '..', 'fixtures');
const SUM = require('./corpus-summary.js');

const UA = { headers: { 'User-Agent': 'hurricane-console-archive-audit (opt08400@gmail.com)' } };
const BASE = 'https://www.nhc.noaa.gov/archive/';

// --- curated manifest ----------------------------------------------------------
// TCMs live at archive/{year}/al{NN}/al{NN}{YYYY}.fstadv.{NNN}.shtml (raw
// teletype inside a <pre>). Expectations are checked case-insensitively.
const TCMS = [
  { path: '2023/ep18/ep182023.fstadv.009.shtml',
    expect: { classification: 'Tropical Storm', name: 'Otis' },
    covers: 'EP basin advisory (pre-RI Otis) — exercises EP storm-id path' },
  { path: '2024/ep01/ep012024.fstadv.002.shtml',
    expect: { classification: 'Tropical Storm', name: 'Aletta' },
    covers: 'weak EP tropical storm with DISSIPATED forecast tail' },
  { path: '2024/al08/al082024.fstadv.001.shtml',
    expect: { classification: 'Potential Tropical Cyclone', name: 'Eight', postTropTrack: true },
    covers: 'PTC + INLAND/TROPICAL CYCLONE/DISSIPATED forecast-line suffixes' },
  { path: '2023/al05/al052023.fstadv.001.shtml',
    expect: { classification: 'Subtropical Storm', name: 'Don' },
    covers: 'subtropical' },
  { path: '2023/al10/al102023.fstadv.001.shtml',
    expect: { classification: 'Tropical Depression', name: 'Ten' },
    covers: 'TD with spelled-number name (Idalia genesis)' },
  { path: '2023/al13/al132023.fstadv.002.shtml',
    expect: { classification: 'Tropical Storm', name: 'Lee' },
    covers: 'tropical storm' },
  { path: '2023/al13/al132023.fstadv.023.shtml',
    expect: { classification: 'Hurricane', name: 'Lee' },
    covers: 'hurricane; sibling of the inline TCM_FIX in test.js' },
  { path: '2023/al13/al132023.fstadv.044.shtml',
    expect: { classification: 'Post-Tropical Cyclone', name: 'Lee', postTropTrack: true },
    covers: 'post-tropical header (not just a track suffix)' },
  { path: '2024/al14/al142024.fstadv.009.shtml',
    expect: { classification: 'Hurricane', name: 'Milton' },
    covers: 'SPECIAL FORECAST/ADVISORY' },
];

// Archived discussions are plain text at archive/text/{TYPE}/{year}/{TYPE}.{YYYYMMDDHHMM}.txt
// (TYPE = TWDAT Atlantic, TWDEP East Pacific). Exact minute stamps are
// unpredictable, so each entry is a timestamp PREFIX resolved against the
// year's directory listing. If a resolved product's SPECIAL FEATURES doesn't
// match the expectation, nudge the prefix by a few hours before suspecting
// the parser — storms come and go between issuances.
const TWDS = [
  { type: 'TWDAT', year: 2023, prefix: '202309151',
    expect: { cyclones: 2, names: ['Lee', 'Margot'] },
    covers: 'two simultaneous cyclones, ALL-CAPS archive text' },
  { type: 'TWDAT', year: 2023, prefix: '202307161',
    expect: { cyclones: 1, names: ['Don'] },
    covers: 'single (subtropical) cyclone' },
  { type: 'TWDAT', year: 2023, prefix: '202308291',
    expect: { cyclones: 2, names: ['Idalia', 'Franklin'] },
    covers: 'two hurricanes, warning-laden prose' },
  { type: 'TWDEP', year: 2023, prefix: '2023102416',
    expect: { cyclones: 1, names: ['Otis'] },
    covers: 'EP: Tropical Storm Otis in SPECIAL FEATURES (pre-RI), Acapulco prose' },
  // wavesMin is 2 of 3 DELIBERATELY: the first wave ("axis north of 85W to
  // inland Central America") states no latitude anywhere — a known phrasing
  // gap, pinned as a wart rather than papered over with an invented extent.
  { type: 'TWDEP', year: 2025, prefix: '2025071809',
    expect: { cyclones: 0, names: [], wavesMin: 2 },
    covers: 'EP: corrected (CCA) product, 2-of-3 waves (no-latitude axis pinned gap), gap winds' },
  { type: 'TWDEP', year: 2024, prefix: '2024031621',
    expect: { cyclones: 0, names: [] },
    covers: 'EP: quiet season, no SPECIAL FEATURES/WAVES sections, pure gap-wind narrative' },
  // The two products that shipped the phantom-cyclone bug: NHC's genesis prose
  // ("a tropical depression OR tropical storm IS expected to form") used to be
  // read as an existing storm named "Or" / "Is". Both must parse to ZERO
  // cyclones while still fixing the analyzed low they describe.
  { type: 'TWDEP', year: 2026, prefix: '2026071416',
    expect: { cyclones: 0, names: [] },
    covers: 'EP: genesis prose "a tropical depression or tropical storm is expected to form" — no phantom cyclone' },
  { type: 'TWDEP', year: 2026, prefix: '2026071403',
    expect: { cyclones: 0, names: [] },
    covers: 'EP: genesis prose "a tropical depression is expected to form" — no phantom cyclone' },
];

// --- fetch + cache ---------------------------------------------------------------
async function fetchCached(url, cacheName) {
  const f = path.join(OUT, cacheName);
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8');
  const res = await fetch(url, UA);
  if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
  const t = await res.text();
  fs.writeFileSync(f, t);
  return t;
}

// Archived .shtml pages wrap the raw teletype in <pre>...</pre>; take the first
// one and undo the handful of entities the archive uses.
function stripPre(html) {
  const m = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
  if (!m) throw new Error('no <pre> block found — bad URL or page layout changed');
  return m[1]
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

// Resolve a discussion timestamp prefix to the first matching filename in the
// year's directory listing (listing itself is cached too).
async function resolveTWD(type, year, prefix) {
  const listing = await fetchCached(BASE + 'text/' + type + '/' + year + '/', type + '-listing-' + year + '.html');
  const names = [...new Set((listing.match(new RegExp(type + '\\.\\d{12}\\.txt', 'g')) || []))].sort();
  return names.find((n) => n.startsWith(type + '.' + prefix)) || null;
}

// --- audits ----------------------------------------------------------------------
// Per-basin sanity boxes. Atlantic matches tools/parser-audit.js; the EP
// discussion declares coverage 03.4S-30N out to 140W (features can reference
// the Caribbean side of a cross-basin wave, hence east to -70).
const SANE = (p) => p.lat >= -8 && p.lat <= 45 && p.lon >= -105 && p.lon <= 5;
const SANE_EP = (p) => p.lat >= -5 && p.lat <= 35 && p.lon >= -145 && p.lon <= -70;
// TCM forecast tracks legitimately run well beyond the discussion frames —
// post-tropical Lee (2023) reached 52.3N; EP recurvers cross 140W — so tracks
// get taller/wider boxes.
const SANE_TCM = (p) => p.lat >= -8 && p.lat <= 65 && p.lon >= -105 && p.lon <= 10;
const SANE_TCM_EP = (p) => p.lat >= 0 && p.lat <= 50 && p.lon >= -180 && p.lon <= -80;
const same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

function auditTCM(txt, expect, sane) {
  const saneTcm = sane || SANE_TCM;
  const r = P.parseTCM(txt);
  const flags = [];
  if (!r) return { flags: ['parse-null'], stats: {} };
  if (!same(r.classification, expect.classification))
    flags.push('expected-classification:' + expect.classification + '/got:' + r.classification);
  if (!same(r.name, expect.name)) flags.push('expected-name:' + expect.name + '/got:' + r.name);
  if (!r.track.length) flags.push('no-track-points');
  if (r.track.some((p) => !isFinite(p.lat) || !isFinite(p.lon) || !saneTcm(p)))
    flags.push('track-point-out-of-basin');
  if (r.center && !saneTcm(r.center)) flags.push('center-out-of-basin(' + r.center.lat + ',' + r.center.lon + ')');
  if (r.windKt == null) flags.push('no-wind');
  if (expect.postTropTrack && !r.track.some((p) => p.state === 'post-tropical'))
    flags.push('no-post-trop-tag');
  return { flags, stats: { adv: r.advisory, cls: r.classification, name: r.name, track: r.track.length, wind: r.windKt, press: r.pressureMb, motion: !!r.motion } };
}

function auditTWD(txt, expect, sane) {
  const r = P.parse(txt);
  const flags = [];
  const cyc = r.cyclones || [];
  if (cyc.length !== expect.cyclones) flags.push('cyclone-count:' + expect.cyclones + '/got:' + cyc.length);
  expect.names.forEach((n) => {
    if (!cyc.some((c) => same(c.name, n))) flags.push('missing-cyclone:' + n);
  });
  cyc.forEach((c) => {
    if (!isFinite(c.lat) || !isFinite(c.lon) || !sane(c)) flags.push('cyclone-out-of-basin:' + c.name);
    if (c.windKt == null) flags.push('cyclone-no-wind:' + c.name);
  });
  if (expect.wavesMin != null && r.waves.length < expect.wavesMin)
    flags.push('waves-min:' + expect.wavesMin + '/got:' + r.waves.length);
  if (r.sections.length <= 1) flags.push('sections-not-split');
  return { flags, stats: { basin: r.basin, sec: r.sections.length, cyc: cyc.length, waves: r.waves.length, names: cyc.map((c) => c.classification + ' ' + c.name).join('; ') } };
}

// --- runner ----------------------------------------------------------------------
(async () => {
  const report = { TCM: [], TWDAT: [], TWDEP: [] };
  // --save-fixtures accumulator; `_txt` holds the LF-normalized fixture body
  // and is stripped before expected.json is written.
  const fixtures = { tcm: {}, twdat: {}, twdep: {} };

  for (const item of TCMS) {
    const tag = item.path.split('/').pop().replace(/\.shtml$/, '');
    // EP advisories (archive/{year}/ep{NN}/...) get the EP track box
    const sane = /\/ep\d/.test(item.path) ? SANE_TCM_EP : SANE_TCM;
    let row;
    try {
      const raw = stripPre(await fetchCached(BASE + item.path, tag + '.html'));
      fs.writeFileSync(path.join(OUT, tag + '.txt'), raw);
      row = { id: tag, covers: item.covers, ...auditTCM(raw, item.expect, sane) };
      if (SAVE) {
        const txt = raw.replace(/\r\n?/g, '\n');
        fixtures.tcm[tag + '.txt'] = { source: BASE + item.path, covers: item.covers, snap: SUM.summarizeTCM(P.parseTCM(txt)), _txt: txt };
      }
    } catch (e) {
      row = { id: tag, covers: item.covers, flags: ['fetch-error:' + e.message], stats: {} };
    }
    report.TCM.push(row);
  }

  for (const item of TWDS) {
    const sane = item.type === 'TWDEP' ? SANE_EP : SANE;
    let row;
    try {
      const fname = await resolveTWD(item.type, item.year, item.prefix);
      if (!fname) throw new Error('no ' + item.type + ' matching prefix ' + item.prefix + ' in ' + item.year);
      const raw = await fetchCached(BASE + 'text/' + item.type + '/' + item.year + '/' + fname, fname);
      row = { id: fname, covers: item.covers, ...auditTWD(raw, item.expect, sane) };
      if (SAVE) {
        const txt = raw.replace(/\r\n?/g, '\n');
        fixtures[item.type.toLowerCase()][fname] = { source: BASE + 'text/' + item.type + '/' + item.year + '/' + fname, covers: item.covers, snap: SUM.summarizeTWDAT(P.parse(txt)), _txt: txt };
      }
    } catch (e) {
      row = { id: item.type + '.' + item.prefix + '*', covers: item.covers, flags: ['fetch-error:' + e.message], stats: {} };
    }
    report[item.type].push(row);
  }

  for (const type of ['TCM', 'TWDAT', 'TWDEP']) {
    const rows = report[type];
    const flagged = rows.filter((r) => r.flags.length);
    console.log(`\n===== ${type}: ${rows.length} products, ${flagged.length} flagged =====`);
    rows.forEach((r) => {
      const mark = r.flags.length ? '!!' : 'ok';
      console.log(`  [${mark}] ${r.id}  (${r.covers})`);
      if (r.flags.length) console.log('       ' + r.flags.join(' | '));
      else console.log('       ' + JSON.stringify(r.stats));
    });
  }
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  console.log('\nFlags are a triage aid, not a pass/fail gate.');
  console.log('corpus + report saved to', OUT);

  if (SAVE) {
    const flagged = [...report.TCM, ...report.TWDAT, ...report.TWDEP].filter((r) => r.flags.length);
    if (flagged.length) {
      console.error('\n--save-fixtures: REFUSING to write fixtures — ' + flagged.length +
        ' product(s) failed the manifest expectations above. Fix the parser (or the manifest) first.');
      process.exit(1);
    }
    fs.mkdirSync(FIXDIR, { recursive: true });
    const expected = {
      _readme: 'Pinned parser snapshots for the committed archive corpus (checked by node test.js). ' +
        'Regenerate deliberately with: node tools/archive-audit.js --save-fixtures (network, dev-only), ' +
        'then review the git diff — a changed snap is a parser behavior change. Never hand-edit.',
      tcm: {}, twdat: {}, twdep: {},
    };
    let n = 0;
    for (const type of ['tcm', 'twdat', 'twdep']) {
      for (const name of Object.keys(fixtures[type]).sort()) {
        const e = fixtures[type][name];
        fs.writeFileSync(path.join(FIXDIR, name), e._txt);
        expected[type][name] = { source: e.source, covers: e.covers, snap: e.snap };
        n++;
      }
    }
    fs.writeFileSync(path.join(FIXDIR, 'expected.json'), JSON.stringify(expected, null, 2) + '\n');
    console.log('\n--save-fixtures: wrote ' + n + ' fixtures + expected.json to ' + FIXDIR);
    console.log('Review `git diff fixtures/` before committing.');
  }
})();
