/*
 * tools/build-genesis-ledger.js — genesis truth ledger (Track C M4, data layer).
 * Reads archive/derived/lineage-2026.json (build-lineage.js runs first) and
 * writes archive/derived/genesis-2026.json: per-invest statement verdicts for
 * every stated 48h/7d formation chance, plus the season calibration table.
 *
 * Usage:  node tools/build-genesis-ledger.js   (no args; SEASON is a constant)
 *
 * THE HONESTY RULE, EXTENDED TO OUTCOMES: the lineage layer prefers broken
 * chains over invented links; this layer prefers unscored statements over
 * invented outcomes. Four verdicts per statement (a stated chance at stamp T,
 * per horizon window T+48h / T+7d):
 *
 *   formed      ONLY when this invest chain has a lineage invest-cyclone
 *               genesis link whose atStamp falls inside the window. A link is
 *               the only thing that ever earns "formed".
 *   pending     the window extends past nowStamp (the archive hasn't seen the
 *               future yet). Pending over guessed — always checked before
 *               unresolved so an open window never gets pre-judged.
 *   unresolved  window closed, no link, but an UNATTRIBUTED cyclone chain
 *               (linked to no invest at all) opened inside the window within
 *               NEAR_CYC_DEG of this invest. The lineage layer saw ambiguity
 *               and refused the link; this layer inherits that refusal in both
 *               directions — it will not claim "formed" (no link) and it will
 *               not claim "did not form" (that cyclone might be this invest).
 *               Real forcing case: AL90 ends at 60%/60% with TD One opening
 *               6.6h later at 8.1 deg — beyond the 3-deg link gate, well inside
 *               the shadow. Those statements are unresolved, not lies.
 *   not-formed  window closed, no link, clear air. Note formed-late is
 *               honestly not-formed on the shorter horizon (standard forecast
 *               verification): the linked cyclone is ATTRIBUTED to the invest,
 *               so it never shadows the early windows it fell outside of.
 *
 * NEAR_CYC_DEG (10) is deliberately wider than build-lineage's 3-deg link
 * gate: the link zone is where we claim formed; the shadow zone is where we
 * refuse to claim not-formed. An unmeasurable distance (either side without a
 * mappable position) also shadows — never invent clear air.
 *
 * Records: every invest chain with at least one stated chance, tagged AND
 * untagged (odds attach to areas before tagging; excluding untagged chains
 * would bias calibration upward). Keyed by CHAIN id — tags repeat across
 * broken chains (CP90 has two) and a tag-bridge here would be an invented
 * link by the back door; same-tag chains only cross-reference in
 * siblingChains. Every statement is calibrated (NHC restates odds each
 * issuance; each restatement is a fresh forecast — standard probabilistic
 * verification counts them all).
 *
 * Output is DETERMINISTIC: nowStamp is the max stamp in the lineage file
 * (never wall-clock — a lagging "now" only over-produces pending, never a
 * false verdict), records stay in lineage order, and a rebuild over an
 * unchanged archive is byte-identical. observedRate is null when nothing is
 * resolved — 0/0 is not 0%.
 *
 * The pure pieces (statementVerdict, investOutcome, nearbyCyclones,
 * ledgerRecord, calibrate, buildLedger, the constants) are exported for
 * test.js, which drives them with synthetic lineage-shaped objects. Only the
 * CLI body (require.main) touches the filesystem. Zero dependencies; never
 * runs in the browser.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { stampDate } = require('./nhc-text-archive.js');
const LIN = require('./build-lineage.js');

const SEASON = 2026;
const ARCHIVE = path.join(__dirname, '..', 'archive');

const H48_H = 48;               // the two stated horizons, in hours
const D7_H = 168;
const NEAR_CYC_DEG = 10;        // unresolved shadow radius (see header)
const NEAR_CYC_TAIL_H = 48;     // a cyclone may open this long after the chain's last sighting
const OPEN_CHAIN_H = LIN.MAX_GAP_H; // chain counts as still live within one lineage gap of now

const CATS = ['low', 'medium', 'high'];

// --- small helpers --------------------------------------------------------------

function round3(x) { return Math.round(x * 1000) / 1000; }

function hoursBetween(prevStamp, curStamp) { return LIN.hoursBetween(prevStamp, curStamp); }

// stamp + h hours -> 12-digit UTC stamp, or null if the stamp is unreadable
// (an unmeasurable window is a window we don't score).
function stampPlusHours(stamp, h) {
  const d = stampDate(stamp);
  if (!d) return null;
  const t = new Date(d.getTime() + h * 3600e3);
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  return String(t.getUTCFullYear()) + p2(t.getUTCMonth() + 1) + p2(t.getUTCDate()) +
    p2(t.getUTCHours()) + p2(t.getUTCMinutes());
}

// Max stamp across every sighting and genesis link in every basin — the
// archive's "now". Fixed-width digit strings compare lexicographically.
function maxStamp(lineage) {
  let max = null;
  for (const b of Object.keys(lineage.basins)) {
    const coll = lineage.basins[b];
    for (const fam of ['waves', 'invests', 'cyclones']) {
      for (const chain of coll[fam] || []) {
        for (const s of chain.sightings) if (max == null || s.stamp > max) max = s.stamp;
      }
    }
    for (const g of coll.genesis || []) if (max == null || g.atStamp > max) max = g.atStamp;
  }
  return max;
}

// --- outcome resolution ---------------------------------------------------------

// Unattributed cyclone chains (linked to NO invest) whose first sighting falls
// in [inv first, inv last + NEAR_CYC_TAIL_H] and within NEAR_CYC_DEG of the
// invest's temporally-nearest mappable sighting. An unmeasurable distance
// (invest has no mappable sighting, or the cyclone opens position-less)
// qualifies too — we can never rule out what we cannot measure.
function nearbyCyclones(inv, coll) {
  const attributed = new Set();
  for (const g of coll.genesis || []) {
    if (g.kind === 'invest-cyclone') attributed.add(g.to);
  }
  const firstStamp = inv.sightings[0].stamp;
  const lastStamp = inv.sightings[inv.sightings.length - 1].stamp;
  const tail = stampPlusHours(lastStamp, NEAR_CYC_TAIL_H);
  const mappable = inv.sightings.filter(function (s) { return s.lat != null && s.lon != null; });
  const out = [];
  for (const cyc of coll.cyclones || []) {
    if (attributed.has(cyc.id)) continue;
    const cf = cyc.sightings[0];
    if (cf.stamp < firstStamp || (tail != null && cf.stamp > tail)) continue;
    let dist = null;
    if (cf.lat != null && cf.lon != null && mappable.length) {
      let near = null, nearDt = null;
      for (const s of mappable) {
        const dt = hoursBetween(s.stamp, cf.stamp);
        const adt = dt == null ? Infinity : Math.abs(dt);
        if (nearDt == null || adt < nearDt) { nearDt = adt; near = s; }
      }
      dist = round3(Math.sqrt(Math.pow(cf.lat - near.lat, 2) + Math.pow(cf.lon - near.lon, 2)));
      if (dist > NEAR_CYC_DEG) continue;
    }
    out.push({ cycloneId: cyc.id, name: cyc.name, firstStamp: cf.stamp, dist: dist });
  }
  return out;
}

// Chain-level outcome summary. Precedence: formed (a lineage link exists) >
// open (still live at now) > unresolved-nearby-cyclone > no-cyclone. The
// nearby list is computed for every non-formed chain because per-statement
// verdicts need it regardless of the chain-level kind.
function investOutcome(inv, coll, nowStamp) {
  for (const g of coll.genesis || []) {
    if (g.kind === 'invest-cyclone' && g.from === inv.id) {
      let name = null;
      for (const c of coll.cyclones || []) if (c.id === g.to) name = c.name;
      return { kind: 'formed', cycloneId: g.to, cycloneName: name, genesisStamp: g.atStamp, nearby: [] };
    }
  }
  const nearby = nearbyCyclones(inv, coll);
  const lastStamp = inv.sightings[inv.sightings.length - 1].stamp;
  const sinceLast = hoursBetween(lastStamp, nowStamp);
  let kind;
  if (sinceLast != null && sinceLast <= OPEN_CHAIN_H) kind = 'open';
  else if (nearby.length) kind = 'unresolved-nearby-cyclone';
  else kind = 'no-cyclone';
  return { kind: kind, cycloneId: null, cycloneName: null, genesisStamp: null, nearby: nearby };
}

// --- per-statement verdicts -----------------------------------------------------

// One stated chance at stamp T, judged over T + windowH. Order matters:
// formed > pending > unresolved > not-formed (pending before unresolved so an
// open window with a nearby cyclone stays pending and resolves later).
function statementVerdict(T, windowH, chance, outcome, nowStamp) {
  if (!chance) return null;
  const windowEnd = stampPlusHours(T, windowH);
  if (windowEnd == null) return null;
  if (outcome.kind === 'formed' && outcome.genesisStamp <= windowEnd) return 'formed';
  if (windowEnd > nowStamp) return 'pending';
  for (const n of outcome.nearby) {
    if (n.firstStamp <= windowEnd) return 'unresolved';
  }
  return 'not-formed';
}

// --- ledger records -------------------------------------------------------------

// One invest chain -> one ledger record, or null when no sighting ever stated
// a chance (nothing to verify). Statements are the chance-bearing sightings.
function ledgerRecord(inv, coll, nowStamp) {
  const bearing = inv.sightings.filter(function (s) { return s.chance48 || s.chance7; });
  if (!bearing.length) return null;
  const outcome = investOutcome(inv, coll, nowStamp);
  let waveOrigin = null;
  for (const g of coll.genesis || []) {
    if (g.kind === 'wave-invest' && g.to === inv.id) waveOrigin = { waveId: g.from, atStamp: g.atStamp };
  }
  const siblings = [];
  if (inv.tag) {
    for (const other of coll.invests || []) {
      if (other.id !== inv.id && other.tag === inv.tag) siblings.push(other.id);
    }
  }
  return {
    id: inv.id,
    tag: inv.tag || null,
    firstStamp: inv.sightings[0].stamp,
    lastStamp: inv.sightings[inv.sightings.length - 1].stamp,
    waveOrigin: waveOrigin,
    outcome: outcome,
    siblingChains: siblings,
    statements: bearing.map(function (s) {
      return {
        stamp: s.stamp, file: s.file, tagged: !!s.tagged,
        chance48: s.chance48 || null, chance7: s.chance7 || null,
        verdict48: statementVerdict(s.stamp, H48_H, s.chance48, outcome, nowStamp),
        verdict7: statementVerdict(s.stamp, D7_H, s.chance7, outcome, nowStamp),
      };
    }),
  };
}

// --- calibration ----------------------------------------------------------------

function emptyCell() {
  return { statements: 0, formed: 0, notFormed: 0, unresolved: 0, pending: 0, observedRate: null };
}

function rateOf(cell) {
  const resolved = cell.formed + cell.notFormed;
  return resolved ? round3(cell.formed / resolved) : null;
}

function emptyCalibration() {
  const cal = { h48: {}, d7: {} };
  for (const c of CATS) { cal.h48[c] = emptyCell(); cal.d7[c] = emptyCell(); }
  return cal;
}

// Bucket every statement by the STATED category of that horizon's chance.
// A null verdict (chance-less horizon or unreadable window) never enters.
function calibrate(records) {
  const cal = emptyCalibration();
  function tally(cell, verdict) {
    cell.statements++;
    if (verdict === 'formed') cell.formed++;
    else if (verdict === 'not-formed') cell.notFormed++;
    else if (verdict === 'unresolved') cell.unresolved++;
    else cell.pending++;
  }
  for (const r of records) {
    for (const st of r.statements) {
      if (st.chance48 && st.verdict48 && cal.h48[st.chance48.cat]) tally(cal.h48[st.chance48.cat], st.verdict48);
      if (st.chance7 && st.verdict7 && cal.d7[st.chance7.cat]) tally(cal.d7[st.chance7.cat], st.verdict7);
    }
  }
  for (const h of ['h48', 'd7']) for (const c of CATS) cal[h][c].observedRate = rateOf(cal[h][c]);
  return cal;
}

function sumCalibration(a, b) {
  const out = emptyCalibration();
  for (const h of ['h48', 'd7']) {
    for (const c of CATS) {
      for (const k of ['statements', 'formed', 'notFormed', 'unresolved', 'pending']) {
        out[h][c][k] = a[h][c][k] + b[h][c][k];
      }
      out[h][c].observedRate = rateOf(out[h][c]);
    }
  }
  return out;
}

// --- the ledger -----------------------------------------------------------------

function buildLedger(lineage, opts) {
  const nowStamp = (opts && opts.nowStamp) || maxStamp(lineage);
  const out = {
    _readme: 'Genesis truth ledger (Track C M4): per-invest statement verdicts + season ' +
      'calibration derived from archive/derived/lineage-' + lineage.season + '.json by ' +
      '`node tools/build-genesis-ledger.js` — NEVER hand-edit. Deterministic ("now" is the ' +
      'max archive stamp, never wall-clock). Verdicts: formed REQUIRES a lineage ' +
      'invest-cyclone genesis link; an unattributed cyclone opening nearby makes the window ' +
      'unresolved — this ledger refuses to invent formed AND refuses to invent not-formed; ' +
      'windows past nowStamp are pending, never guessed.',
    season: lineage.season,
    nowStamp: nowStamp,
    basins: {},
    calibrationTotal: null,
  };
  let total = emptyCalibration();
  for (const b of Object.keys(lineage.basins)) {
    const coll = lineage.basins[b];
    const records = (coll.invests || [])
      .map(function (inv) { return ledgerRecord(inv, coll, nowStamp); })
      .filter(Boolean);
    const cal = calibrate(records);
    out.basins[b] = { invests: records, calibration: cal };
    total = sumCalibration(total, cal);
  }
  out.calibrationTotal = total;
  return out;
}

// --- filesystem (CLI only; not exercised by test.js) ----------------------------

function build() {
  const src = path.join(ARCHIVE, 'derived', 'lineage-' + SEASON + '.json');
  if (!fs.existsSync(src)) {
    console.error('missing ' + src + ' — run `node tools/build-lineage.js` first');
    process.exit(1);
  }
  const lineage = JSON.parse(fs.readFileSync(src, 'utf8'));
  const out = buildLedger(lineage);
  for (const b of Object.keys(out.basins)) {
    const recs = out.basins[b].invests;
    let statements = 0, verdicts = { formed: 0, 'not-formed': 0, unresolved: 0, pending: 0 };
    for (const r of recs) {
      for (const st of r.statements) {
        for (const v of [st.verdict48, st.verdict7]) {
          if (v) { statements++; verdicts[v]++; }
        }
      }
    }
    console.log(b + ': ' + recs.length + ' invest record(s), ' + statements + ' scored statement-horizons (' +
      verdicts.formed + ' formed, ' + verdicts['not-formed'] + ' not-formed, ' +
      verdicts.unresolved + ' unresolved, ' + verdicts.pending + ' pending)');
  }
  const file = path.join(ARCHIVE, 'derived', 'genesis-' + SEASON + '.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
  console.log('wrote genesis-' + SEASON + '.json (now=' + out.nowStamp + ')');
}

module.exports = {
  SEASON,
  H48_H, D7_H, NEAR_CYC_DEG, NEAR_CYC_TAIL_H, OPEN_CHAIN_H,
  stampPlusHours, maxStamp,
  nearbyCyclones, investOutcome, statementVerdict,
  ledgerRecord, calibrate, sumCalibration, buildLedger,
};

if (require.main === module) build();
