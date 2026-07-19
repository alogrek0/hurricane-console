/*
 * tools/bdeck-truth.js — b-deck truth validation (Track C M6): read the
 * captured ATCF best-track snapshots (archive/{year}/atcf/, Track C M5) as
 * GROUND TRUTH and cross-check the parser-derived record — lineage chains
 * (build-lineage.js) and genesis-ledger verdicts (build-genesis-ledger.js) —
 * writing archive/derived/bdeck-truth-{year}.json.
 *
 * The honesty rule, extended one more layer: validation FLAGS disagreements,
 * it never retro-fits links or rewrites verdicts. The ledger stays exactly as
 * derived from the prose; this file is an overlay recording what the best
 * tracks say about each claim. A ledger verdict the b-decks cannot speak to
 * (recycled invest tag captured too late, untagged area with no ATCF identity)
 * is agreement "no-data" — un-truthable is not wrong.
 *
 * What the b-decks state EXPLICITLY (no track-overlap inference needed):
 *   - field 28 STORMNAME walks GENESIS### -> INVEST -> ONE -> ARTHUR
 *   - trailing user data carries `genesis-num, NNN` (shared by an invest file
 *     and the cyclone it became) and SPAWNINVEST / TRANSITIONED / DISSIPATED
 *     tags whose values name ATCF ids ("al712026 to al902026") — the
 *     tag -> cyclone handoff written down by the source itself
 * A cyclone file's best track is retroactive (rows reach back through the
 *   invest phase), so early-season storms are truthable even though capture
 *   started 2026-07-18; the standalone files of invests whose tags recycled
 *   before capture are gone forever — those chains stay "no-data".
 *
 * Per tagged ledger record: truth outcome (formed into which b-deck storm /
 * not-formed / open / no-data), agreement (confirms | resolves | refutes |
 * open | no-data), genesis-timing delta (ledger genesisStamp vs the b-deck's
 * first TD-or-stronger DTG), per-sighting position stats vs best-track fixes,
 * and per-statement 48h/7d TRUTH verdicts (window vs first-TD DTG) feeding a
 * truth calibration table. Cyclone chains are matched to b-deck storms by
 * name; two chains mapping to one storm (the lineage name-identity rule
 * splitting TD One from TS Arthur) is flagged informationally — by design,
 * not an error.
 *
 * Deterministic: "now" (btkNow) = the max DTG across all snapshots, never the
 * wall clock; output arrays follow ledger/lineage order; rebuilding over an
 * unchanged archive is byte-identical.
 *
 * Usage:  node tools/bdeck-truth.js     (offline — reads only committed files;
 *         cron runs it after bdeck-sync.js each cycle)
 *
 * Pure logic is exported for test.js; only the CLI body (require.main)
 * touches the filesystem. Zero dependencies; never runs in the browser.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { SEASON } = require('./archive-sync.js');
const BL = require('./build-lineage.js');
const GL = require('./build-genesis-ledger.js');

const ARCHIVE = path.join(__dirname, '..', 'archive');
const OUT = path.join(ARCHIVE, 'derived', 'bdeck-truth-' + SEASON + '.json');

// genesis truth = first best-track row at tropical/subtropical-cyclone status
const CYCLONE_STATUS = { TD: 1, TS: 1, HU: 1, TY: 1, ST: 1, SD: 1, SS: 1 };
const ERA_PAD_H = 48;        // chain-window pad when matching an invest file era
const CYC_TRAIL_H = 240;     // genesis may trail the chain's last sighting this far
const POS_MATCH_H = 6;       // sighting matches the fix within one synoptic step
const POS_OUTLIER_DEG = 5;   // flag a sighting this far off the best track

// --- pure helpers (exported for offline tests) ----------------------------------

// '235N' -> 23.5, '1003W' -> -100.3 (tenths + hemisphere; W/S negative)
function parseTenths(tok) {
  const m = /^(\d+)([NSEW])$/.exec(String(tok || '').trim());
  if (!m) return null;
  const v = parseInt(m[1], 10) / 10;
  return (m[2] === 'S' || m[2] === 'W') ? -v : v;
}

const pad12 = (dtg) => (/^\d{10}$/.test(dtg) ? dtg + '00' : dtg);

// One snapshot's text -> { basin, num, rows, names, genesisNum, refs,
// firstTdDtg, minDtg, maxDtg }. Rows are per-DTG deduped (34/50/64-kt radii
// repeat the fix); short rows (no STORMNAME) and MSLP 0 are tolerated. refs
// collects every ATCF id named by SPAWNINVEST/TRANSITIONED/DISSIPATED tags —
// the explicit handoff evidence.
function parseBdeck(text) {
  const rows = [];
  const seen = {};
  let basin = null, num = null, genesisNum = null, firstTdDtg = null;
  const names = [];
  const refs = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const f = line.split(',').map((s) => s.trim());
    if (f.length < 11 || !/^\d{10}(\d{2})?$/.test(f[2])) continue;
    basin = basin || f[0];
    num = num || f[1];
    const dtg = pad12(f[2]);
    const name = f.length > 27 ? f[27] : '';
    for (let i = 0; i < f.length; i++) {
      if (f[i] === 'genesis-num' && f[i + 1]) genesisNum = f[i + 1];
      if (f[i] === 'SPAWNINVEST' || f[i] === 'TRANSITIONED' || f[i] === 'DISSIPATED') {
        const ids = String(f[i + 1] || '').match(/[a-z]{2}[0-9a-z]{2}\d{4}/gi) || [];
        ids.forEach((id) => { refs[id.toLowerCase()] = true; });
      }
    }
    if (name && name !== 'INVEST' && !/^GENESIS\d+$/.test(name) && names.indexOf(name) < 0) names.push(name);
    if (!firstTdDtg && CYCLONE_STATUS[f[10]]) firstTdDtg = dtg;
    if (seen[dtg]) continue; // later rows at one DTG are extra radii thresholds
    seen[dtg] = true;
    rows.push({ dtg: dtg, lat: parseTenths(f[6]), lon: parseTenths(f[7]),
      vmax: parseInt(f[8], 10) || 0, status: f[10], name: name });
  }
  if (!rows.length) return null;
  return { basin: basin, num: num, rows: rows, names: names, genesisNum: genesisNum,
    refs: Object.keys(refs).sort(), firstTdDtg: firstTdDtg,
    minDtg: rows[0].dtg, maxDtg: rows[rows.length - 1].dtg };
}

// 'bal012026.202606180000.dat' -> { base:'bal012026', id:'al012026', stamp }
function snapshotParts(fname) {
  const m = /^(b(al|ep)(\d{2})(\d{4}))\.(\d{12})\.dat$/.exec(fname);
  if (!m) return null;
  return { base: m[1], id: m[1].slice(1), num: m[3], stamp: m[5] };
}

// Recycled tags leave multiple snapshots per base in distinct DTG eras; growth
// of a live file leaves superseded ones. Keep a snapshot unless a LATER-stamped
// sibling OF THE SAME BASE contains its DTG range (pure growth); disjoint eras
// both survive. Grouping by base is load-bearing: a cyclone's retroactive
// track CONTAINS its invest's era (bep05 spans bep96), and cross-base
// comparison would silently drop the invest's own snapshot.
function liveEras(snaps) {
  const out = [];
  for (const s of snaps) {
    const superseded = snaps.some((t) => t !== s &&
      (t.base || '') === (s.base || '') && t.stamp > s.stamp &&
      t.minDtg <= s.minDtg && t.maxDtg >= s.maxDtg);
    if (!superseded) out.push(s);
  }
  return out;
}

// lineage basin key -> ATCF basin field ('AT' chains live in 'AL' files)
const ATCF_BASIN = { AT: 'AL', EP: 'EP' };

// lineage names carry NHC's basin suffix ("Six-E"); b-deck STORMNAME does not
const normName = (name) => String(name || '').toUpperCase().replace(/-[EC]$/, '');

const flatDeg = (aLat, aLon, bLat, bLon) =>
  Math.sqrt(Math.pow(aLat - bLat, 2) + Math.pow(aLon - bLon, 2));

// does [minDtg, maxDtg] overlap the chain window [first, last] with pads (h)?
function overlapsWindow(minDtg, maxDtg, first, last, padBeforeH, padAfterH) {
  const startsAfterEnd = BL.hoursBetween(GL.stampPlusHours(last, padAfterH), minDtg);
  const endsBeforeStart = BL.hoursBetween(maxDtg, GL.stampPlusHours(first, -padBeforeH));
  if (startsAfterEnd == null || endsBeforeStart == null) return false;
  return startsAfterEnd <= 0 && endsBeforeStart <= 0;
}

// Truth outcome for one tagged ledger record. files = parsed snapshots (with
// .id/.base/.stamp merged in). Explicit evidence only: an invest file sharing
// genesis-num with a cyclone file, or either file's handoff tags naming the
// other's id. No overlap-only inference — that would be the linker's job, and
// the whole point is an INDEPENDENT check.
function investTruth(record, files, btkNow) {
  if (!record.tag) return null;
  const m = /^(AL|EP|CP)(\d{2})$/.exec(record.tag);
  if (!m) return null;
  const investId = m[1].toLowerCase() + m[2] + SEASON;
  const inv = files.find((f) => f.id === investId &&
    overlapsWindow(f.minDtg, f.maxDtg, record.firstStamp, record.lastStamp, ERA_PAD_H, ERA_PAD_H));
  const cyc = files.find((f) => parseInt(f.num, 10) < 90 && f.basin === m[1].slice(0, 2) &&
    overlapsWindow(f.minDtg, f.maxDtg, record.firstStamp, record.lastStamp, ERA_PAD_H, CYC_TRAIL_H) &&
    (f.refs.indexOf(investId) >= 0 ||
     (inv && inv.genesisNum && f.genesisNum === inv.genesisNum) ||
     (inv && inv.refs.indexOf(f.id) >= 0)));
  if (!inv && !cyc) return null;
  let kind;
  if (cyc) kind = cyc.firstTdDtg ? 'formed' : 'no-genesis';
  else if (BL.hoursBetween(inv.maxDtg, btkNow) <= 12) kind = 'open';
  else kind = 'not-formed';
  return {
    kind: kind,
    investBdeck: inv ? inv.base : null,
    cycloneBdeck: cyc ? cyc.base : null,
    cycloneNames: cyc ? cyc.names : [],
    genesisNum: (inv && inv.genesisNum) || (cyc && cyc.genesisNum) || null,
    firstTdDtg: cyc ? cyc.firstTdDtg : null,
  };
}

// ledger outcome kind x truth kind -> agreement. Terminal truth against a
// terminal ledger claim confirms or refutes; against 'unresolved' it RESOLVES
// (the ledger honestly refused to guess — truth answers); 'open' on either
// side defers; absent truth is no-data.
function agreementOf(ledgerKind, truth) {
  if (!truth) return 'no-data';
  const truthFormed = truth.kind === 'formed';
  const truthDead = truth.kind === 'not-formed' || truth.kind === 'no-genesis';
  if (truth.kind === 'open') return ledgerKind === 'formed' ? 'refutes' : 'open';
  if (ledgerKind === 'formed') {
    if (!truthFormed) return 'refutes';
    return 'confirms'; // name checked by the caller, which may downgrade
  }
  if (ledgerKind === 'unresolved-nearby-cyclone') return (truthFormed || truthDead) ? 'resolves' : 'open';
  if (ledgerKind === 'no-cyclone') return truthFormed ? 'refutes' : 'confirms';
  return (truthFormed || truthDead) ? 'resolves' : 'open'; // ledger 'open'
}

// Truth verdict for one chance statement at horizon h: the b-deck's first
// TD-or-stronger DTG against the window. An invest still tracked at btkNow
// with no genesis yet still yields not-formed for windows already closed —
// the best track would show a TD if one had happened.
function statementTruth(stamp, horizonH, truth, btkNow) {
  if (!truth) return null;
  const windowEnd = GL.stampPlusHours(stamp, horizonH);
  if (truth.firstTdDtg && truth.firstTdDtg <= windowEnd) return 'formed';
  if (windowEnd > btkNow) return 'pending';
  return 'not-formed';
}

// per-sighting distance to the nearest-in-time best-track fix (±POS_MATCH_H)
function posStats(sightings, files) {
  const fixes = [];
  files.forEach((f) => { if (f) f.rows.forEach((r) => { if (r.lat != null && r.lon != null) fixes.push(r); }); });
  if (!fixes.length) return null;
  const dists = [];
  for (const s of sightings) {
    if (s.lat == null || s.lon == null) continue;
    let best = null;
    for (const r of fixes) {
      const h = BL.hoursBetween(r.dtg, s.stamp);
      if (h == null || Math.abs(h) > POS_MATCH_H) continue;
      const d = flatDeg(s.lat, s.lon, r.lat, r.lon);
      if (best == null || d < best) best = d;
    }
    if (best != null) dists.push(best);
  }
  if (!dists.length) return null;
  const r1 = (v) => Math.round(v * 10) / 10;
  return { n: dists.length, meanDeg: r1(dists.reduce((a, b) => a + b, 0) / dists.length),
    maxDeg: r1(Math.max.apply(null, dists)) };
}

// null-safe truth calibration cell math (same "0/0 is not 0%" rule as the ledger)
function truthCalibrate(records) {
  const mk = () => ({ low: cell(), medium: cell(), high: cell() });
  function cell() { return { statements: 0, formed: 0, notFormed: 0, pending: 0, observedRate: null }; }
  const cal = { h48: mk(), d7: mk() };
  for (const rec of records) {
    for (const st of rec.statements) {
      tally(cal.h48, st.chance48, st.truth48);
      tally(cal.d7, st.chance7, st.truth7);
    }
  }
  function tally(table, chance, verdict) {
    if (!chance || !verdict || !table[chance.cat]) return;
    const c = table[chance.cat];
    c.statements++;
    if (verdict === 'formed') c.formed++;
    else if (verdict === 'not-formed') c.notFormed++;
    else if (verdict === 'pending') c.pending++;
    const resolved = c.formed + c.notFormed;
    c.observedRate = resolved ? Math.round((c.formed / resolved) * 100) / 100 : null;
  }
  return cal;
}

// the full cross-check: ledger + lineage + parsed snapshot files -> output object
function buildTruth(ledger, lineage, files, btkNow) {
  const flags = [];
  const basins = {};
  for (const basin of ['AT', 'EP']) {
    const invests = [];
    for (const rec of (ledger.basins[basin] || { invests: [] }).invests) {
      const chain = (lineage.basins[basin].invests || []).find((c) => c.id === rec.id);
      const truth = investTruth(rec, files, btkNow);
      let agreement = agreementOf(rec.outcome.kind, truth);
      if (agreement === 'confirms' && rec.outcome.kind === 'formed' && truth &&
          rec.outcome.cycloneName &&
          truth.cycloneNames.indexOf(normName(rec.outcome.cycloneName)) < 0) {
        agreement = 'refutes'; // formed, but into a different storm than truth says
      }
      const stats = truth && chain
        ? posStats(chain.sightings, [files.find((f) => f.base === truth.investBdeck),
                                     files.find((f) => f.base === truth.cycloneBdeck)])
        : null;
      const statements = rec.statements.map((st) => ({
        stamp: st.stamp,
        chance48: st.chance48, chance7: st.chance7,
        verdict48: st.verdict48, verdict7: st.verdict7,
        truth48: statementTruth(st.stamp, GL.H48_H, truth, btkNow),
        truth7: statementTruth(st.stamp, GL.D7_H, truth, btkNow),
      }));
      if (agreement === 'resolves') flags.push({ basin: basin, subject: rec.id, kind: 'truth-resolves-' +
        (rec.outcome.kind === 'unresolved-nearby-cyclone' ? 'unresolved' : 'open'),
        detail: (rec.tag || 'untagged') + ': ledger ' + rec.outcome.kind + ', b-deck says ' + truth.kind +
          (truth.cycloneBdeck ? ' into ' + truth.cycloneBdeck + ' (' + truth.cycloneNames.join('/') + ')' : '') });
      if (agreement === 'refutes') flags.push({ basin: basin, subject: rec.id, kind: 'truth-refutes-' + rec.outcome.kind,
        detail: (rec.tag || 'untagged') + ': ledger ' + rec.outcome.kind +
          (rec.outcome.cycloneName ? ' into ' + rec.outcome.cycloneName : '') +
          ', b-deck says ' + truth.kind +
          (truth.cycloneBdeck ? ' into ' + truth.cycloneBdeck + ' (' + truth.cycloneNames.join('/') + ')' : '') });
      if (stats && stats.maxDeg > POS_OUTLIER_DEG) flags.push({ basin: basin, subject: rec.id,
        kind: 'position-outlier', detail: (rec.tag || 'untagged') + ': max sighting-to-track distance ' +
          stats.maxDeg + ' deg (mean ' + stats.meanDeg + ', n ' + stats.n + ')' });
      invests.push({ id: rec.id, tag: rec.tag,
        ledger: { kind: rec.outcome.kind, cycloneId: rec.outcome.cycloneId || null,
          cycloneName: rec.outcome.cycloneName || null, genesisStamp: rec.outcome.genesisStamp || null },
        truth: truth, agreement: agreement,
        genesisDeltaH: (truth && truth.firstTdDtg && rec.outcome.genesisStamp)
          ? Math.round(BL.hoursBetween(truth.firstTdDtg, rec.outcome.genesisStamp)) : null,
        posStats: stats, statements: statements });
    }
    const cyclones = [];
    const byBdeck = {};
    for (const chain of lineage.basins[basin].cyclones || []) {
      const cyc = files.find((f) => parseInt(f.num, 10) < 90 && f.basin === ATCF_BASIN[basin] &&
        f.names.indexOf(normName(chain.name)) >= 0 &&
        overlapsWindow(f.minDtg, f.maxDtg, chain.sightings[0].stamp,
          chain.sightings[chain.sightings.length - 1].stamp, ERA_PAD_H, ERA_PAD_H));
      const stats = cyc ? posStats(chain.sightings, [cyc]) : null;
      if (cyc) (byBdeck[cyc.base] = byBdeck[cyc.base] || []).push(chain);
      if (stats && stats.maxDeg > POS_OUTLIER_DEG) flags.push({ basin: basin, subject: chain.id,
        kind: 'position-outlier', detail: chain.name + ': max sighting-to-track distance ' +
          stats.maxDeg + ' deg (mean ' + stats.meanDeg + ', n ' + stats.n + ')' });
      cyclones.push({ id: chain.id, name: chain.name, bdeck: cyc ? cyc.base : null, posStats: stats });
    }
    Object.keys(byBdeck).sort().forEach((base) => {
      if (byBdeck[base].length > 1) flags.push({ basin: basin, subject: base, kind: 'same-storm-split',
        detail: byBdeck[base].map((c) => c.name + ' (' + c.id + ')').join(' + ') +
          ' are one best-track storm — the name-identity rule splits reclassifications by design' });
    });
    basins[basin] = { invests: invests, cyclones: cyclones };
  }
  const all = basins.AT.invests.concat(basins.EP.invests);
  const count = (a) => all.filter((r) => r.agreement === a).length;
  return {
    _readme: 'B-deck truth overlay (Track C M6): the parser-derived genesis ledger and ' +
      'lineage chains cross-checked against the captured ATCF best-track snapshots in ' +
      'archive/' + SEASON + '/atcf/. Regenerated by `node tools/bdeck-truth.js` — NEVER hand-edit. ' +
      'The ledger itself is untouched: disagreements are FLAGGED here, never retro-fitted. ' +
      '"no-data" means the b-decks cannot speak to the claim (tag recycled before capture, ' +
      'untagged area) — un-truthable is not wrong.',
    season: SEASON,
    btkNow: btkNow,
    summary: { invests: all.length, confirms: count('confirms'), resolves: count('resolves'),
      refutes: count('refutes'), open: count('open'), noData: count('no-data'), flags: flags.length },
    flags: flags,
    basins: basins,
    truthCalibration: truthCalibrate(all),
  };
}

// --- CLI ------------------------------------------------------------------------

function build() {
  const atcfDir = path.join(ARCHIVE, String(SEASON), 'atcf');
  const ledgerFile = path.join(ARCHIVE, 'derived', 'genesis-' + SEASON + '.json');
  const lineageFile = path.join(ARCHIVE, 'derived', 'lineage-' + SEASON + '.json');
  if (!fs.existsSync(atcfDir) || !fs.existsSync(ledgerFile) || !fs.existsSync(lineageFile)) {
    console.error('bdeck-truth: missing inputs (atcf snapshots + derived ledger/lineage) — nothing written');
    process.exit(1);
  }
  const snaps = [];
  for (const fname of fs.readdirSync(atcfDir).sort()) {
    const parts = snapshotParts(fname);
    if (!parts) continue;
    const parsed = parseBdeck(fs.readFileSync(path.join(atcfDir, fname), 'utf8'));
    if (!parsed) continue;
    snaps.push(Object.assign({ base: parts.base, id: parts.id, stamp: parts.stamp }, parsed));
  }
  const files = liveEras(snaps);
  const btkNow = files.reduce((m, f) => (f.maxDtg > m ? f.maxDtg : m), '');
  const ledger = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
  const lineage = JSON.parse(fs.readFileSync(lineageFile, 'utf8'));
  const out = buildTruth(ledger, lineage, files, btkNow);
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  console.log('wrote', OUT, '—', out.summary.invests, 'invest records:',
    out.summary.confirms, 'confirmed,', out.summary.resolves, 'resolved,',
    out.summary.refutes, 'refuted,', out.summary.open, 'open,', out.summary.noData, 'no-data |',
    out.flags.length, 'flag(s)');
}

module.exports = {
  SEASON, CYCLONE_STATUS, ERA_PAD_H, CYC_TRAIL_H, POS_MATCH_H, POS_OUTLIER_DEG,
  ATCF_BASIN, normName,
  parseTenths, parseBdeck, snapshotParts, liveEras, flatDeg, overlapsWindow,
  investTruth, agreementOf, statementTruth, posStats, truthCalibrate, buildTruth,
};

if (require.main === module) build();
