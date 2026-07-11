/*
 * test.js — parser smoke test. Run: node test.js
 * No framework; exits non-zero if any assertion fails so it works in CI.
 */
const fs = require('fs');
const P = require('./parser.js');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name); }
}

const twd = fs.readFileSync(__dirname + '/sample.txt', 'utf8');
const r = P.parse(twd);

ok('4 sections detected', r.sections.length === 4);
ok('3 tropical waves', r.waves.length === 3);
ok('waves carry motion vectors', r.waves.every(w => w.motion));
ok('3 convection boxes', r.convection.length === 3);
ok('one convection box flagged strong', r.convection.filter(c => c.strong).length === 1);
ok('trough is a 3-point polyline', r.troughs.length === 1 && r.troughs[0].line.length === 3);
ok('3 explicit fixes', r.fixes.length === 3);
ok('inferred position tagged, not a fix', r.inferred.length === 1 && r.inferred[0].inferred === true);
ok('+24h projections for every wave', r.projections.length === 3);
ok('speed-range wave yields an uncertainty band', r.projections.some(p => p.band));

// teletype line-wrap rejoin keeps hyphenated compounds intact
ok('hyphen rejoin preserves "upper-level"',
  /upper-level low/.test(P.dehyphenate('A weak upper-\nlevel low')));

// coordinate parsing: W and S are negative
const pr = P.pairsIn('08N27W to 09S57E');
ok('W longitude parsed negative', pr[0].lon === -27);
ok('S latitude parsed negative', pr[1].lat === -9);
ok('E longitude parsed positive', pr[1].lon === 57);

// --- parseMotion variants ----------------------------------------------------

let m = P.parseMotion('moving west-northwest at 12 kt');
ok('compound direction resolves whole (silent-270 regression)',
  m && m.bearing === 292.5 && m.slowKt === 12);

m = P.parseMotion('moving west-northwestward at 10 to 15 mph');
ok('mph converted to kt', m && m.bearing === 292.5 && m.slowKt === 9 && m.fastKt === 13 && m.unit === 'mph');

m = P.parseMotion('movement toward the north at 5 kt');
ok('"movement toward" phrasing', m && m.bearing === 0 && m.slowKt === 5);

m = P.parseMotion('The cyclone is nearly stationary.');
ok('stationary flagged, zero speed', m && m.stationary === true && m.slowKt === 0);

m = P.parseMotion('moving northwestward, or 320 degrees, at 9 kt');
ok('explicit degrees win over words', m && m.bearing === 320 && m.slowKt === 9);

m = P.parseMotion('moving west at 10 to 15 kt');
ok('plain form regression', m && m.bearing === 270 && m.slowKt === 10 && m.fastKt === 15);

// axis-order fix: projection origin is always the northern end of the axis
ok('wave projection starts at north end (17N)', r.projections[0].from.lat === 17);

// --- real-archive wave phrasings (parser-audit regressions) ------------------
// The synthetic sample used only "axis along 22W from 05N to 17N". Real TWDATs
// vary widely and the original extractor dropped whole waves. Each line below is
// a phrasing pulled from live NHC products (Jul 2026 audit); all must parse.
const TWD_WAVEV = `TWDAT
Tropical Weather Discussion
NWS National Hurricane Center Miami FL
0015 UTC Sun Jul 5 2026

...TROPICAL WAVES...

An Atlantic tropical wave is near 39W, south of 17N, moving W at 15 kt.
Scattered moderate convection is seen from 05.5N to 11.5N between 33W and 39W.

A Caribbean tropical wave is near 72W, south of 20N, moving W at 15 to 20 kt.

An eastern Atlantic tropical wave is along 33W S of 17N, moving W at 10 kt.

A central Atlantic tropical wave is along 61W-62W, south of 18N, moving W at 10 kt.

A far eastern Atlantic tropical wave has its axis along 22W from 12-19N, moving W at 15 kt.

$$`;
const wv = P.parse(TWD_WAVEV).waves;
ok('real phrasings: all five waves parsed', wv.length === 5);
ok('"near 39W" anchors the axis (not just "along")', wv[0] && wv[0].axis[0].lon === -39);
ok('convection "from A to B between C and D" not mistaken for the axis',
  wv[0] && wv[0].axis[0].lat === 17 && wv[0].axis[1].lat === 5); // "south of 17N", not 11.5N
ok('"S of" abbreviation resolves the southern extent',
  wv[2] && wv[2].axis[0].lon === -33 && wv[2].axis[0].lat === 17);
ok('longitude span "61W-62W" averages to the axis meridian',
  wv[3] && wv[3].axis[0].lon === -61.5 && wv[3].axis[0].lat === 18);
ok('hyphenated latitude range "from 12-19N" spans the axis',
  wv[4] && wv[4].axis[0].lat === 19 && wv[4].axis[1].lat === 12 && wv[4].axis[0].lon === -22);
ok('all recovered wave axes carry westward motion', wv.every(w => w.motion && w.motion.bearing === 270));

// --- SPECIAL FEATURES cyclones -----------------------------------------------

const TWD_SF = `TWDAT
Tropical Weather Discussion
NWS National Hurricane Center Miami FL
805 AM EDT Tue Jul 8 2026

Tropical Weather Discussion for the Atlantic Ocean.

...SPECIAL FEATURES...

Hurricane Erin is centered near 25.5N 74.2W at 08/0900 UTC or about
60 nm east of the central Bahamas moving west-northwest at 12 kt.
Estimated minimum central pressure is 968 mb. Maximum sustained winds
are 90 kt with gusts to 110 kt.

Tropical Storm Fernand is centered near 12.0N 40.5W. The cyclone is
nearly stationary. Estimated minimum central pressure is 1002 mb.
Maximum sustained winds are 45 kt.

...TROPICAL WAVES...

A tropical wave has its axis along 22W from 05N to 17N, moving
west at 10 to 15 kt.

$$`;

const sf = P.parse(TWD_SF);
ok('two cyclones extracted', sf.cyclones.length === 2);
const erin = sf.cyclones[0], fernand = sf.cyclones[1];
ok('Erin classified as Hurricane', erin && erin.classification === 'Hurricane' && erin.name === 'Erin');
ok('Erin decimal center parsed', erin && erin.lat === 25.5 && erin.lon === -74.2);
ok('Erin intensity captured', erin && erin.windKt === 90 && erin.pressureMb === 968);
ok('Erin motion wnw not w', erin && erin.motion && erin.motion.bearing === 292.5);
const eproj = sf.projections.find(p => p.id === 'Erin');
// 292.5 deg at 12 kt over 24 h = 288 nm
ok('Erin +24h projection lands where expected',
  eproj && Math.abs(eproj.slow.lat - 27.34) < 0.05 && Math.abs(eproj.slow.lon - -79.11) < 0.05);
ok('stationary Fernand gets no projection',
  fernand && fernand.motion.stationary === true && !sf.projections.some(p => p.id === 'Fernand'));
ok('cyclone center not double-counted as fix',
  !sf.fixes.some(f => f.lat === 25.5 && f.lon === -74.2));
ok('quiet TWDAT has zero cyclones', r.cyclones.length === 0);

// --- TWO (Tropical Weather Outlook) --------------------------------------------

const TWO_FIX = `Tropical Weather Outlook
NWS National Hurricane Center Miami FL
800 AM EDT Tue Jul 8 2026

For the North Atlantic...Caribbean Sea and the Gulf of America:

A tropical wave near the Lesser Antilles is producing disorganized
showers. Environmental conditions could support slow development
later this week while it moves west-northwest at 10 to 15 mph.
* Formation chance through 48 hours...low...20 percent.
* Formation chance through 7 days...medium...40 percent.

An area of low pressure located between the Windward Islands and the
central Caribbean is becoming better organized.
* Formation chance through 48 hours...high...70 percent.
* Formation chance through 7 days...high...80 percent.

Tropical cyclone formation is not expected during the next 48 hours
elsewhere across the basin.

$$`;

const two = P.parseTWO(TWO_FIX);
ok('two disturbances, boilerplate ignored', two.disturbances.length === 2);
const d1 = two.disturbances[0], d2 = two.disturbances[1];
ok('D1 dual chances parsed',
  d1 && d1.chance48 && d1.chance48.pct === 20 && d1.chance48.cat === 'low' &&
  d1.chance7 && d1.chance7.pct === 40 && d1.chance7.cat === 'medium');
ok('D1 always inferred', d1 && d1.inferred === true);
ok('D1 resolves to Lesser Antilles anchor', d1 && d1.lat === 15.5 && d1.lon === -61.3);
ok('D2 "between A and B" midpoint resolves',
  d2 && d2.lat === (13.0 + 15.0) / 2 && d2.lon === (-61.2 + -75.0) / 2);

// --- gazetteer over-firing guards (extractInferred hardening) ------------------
// extractInferred used to fire on ANY place mention, producing two failure modes:
// TYPE 1 — a sentence with singleton coords ("along 61W-62W, south of 18N")
// slipped the pair-guard and got force-fit to a coarse centroid; TYPE 2 — pure
// narrative naming a region got a spurious dot. Two new guards fix both while
// keeping the canonical prose-only case working.

// TYPE 1: singleton coords in a non-WAVE section must yield NO inferred dot.
const TWD_T1 = `TWDAT
Tropical Weather Discussion
NWS National Hurricane Center Miami FL
0015 UTC Sun Jul 5 2026

...DISCUSSION...

A tropical wave has entered the Caribbean, along 61W-62W, south of 18N, moving westward.

$$`;
const t1 = P.parse(TWD_T1);
ok('TYPE 1: singleton-coord sentence produces no inferred dot', t1.inferred.length === 0);

// TYPE 2: pure narrative naming a region must yield NO inferred dot.
const TWD_T2 = `TWDAT
Tropical Weather Discussion
NWS National Hurricane Center Miami FL
0015 UTC Sun Jul 5 2026

...DISCUSSION...

Trades over the Gulf of Honduras will pulse to strong each evening.

$$`;
const t2 = P.parse(TWD_T2);
ok('TYPE 2: pure-narrative region mention produces no inferred dot', t2.inferred.length === 0);

// Canonical prose-only feature: still exactly one inferred dot at the midpoint
// of the two "between A and B" anchors (Hispaniola 19.0,-71.0 & SE Bahamas 22.0,-73.5).
const TWD_CANON = `TWDAT
Tropical Weather Discussion
NWS National Hurricane Center Miami FL
0015 UTC Sun Jul 5 2026

...DISCUSSION...

A disturbed area between Hispaniola and the southeastern Bahamas bears watching over the next several days.

$$`;
const tc = P.parse(TWD_CANON);
ok('canonical prose-only feature still infers exactly one dot', tc.inferred.length === 1);
ok('canonical inferred dot lands at the between-anchor midpoint',
  tc.inferred[0] && tc.inferred[0].lat === (19.0 + 22.0) / 2 && tc.inferred[0].lon === (-71.0 + -73.5) / 2);

// --- basemap.js integrity (generated file; guards a bad regeneration) ---------

const BM = require('./basemap.js');
const layers = {};
(BM.features || []).forEach(f => { layers[f.properties.layer] = f.geometry; });
ok('basemap: FeatureCollection with 4 layer features',
  BM.type === 'FeatureCollection' && BM.features.length === 4 &&
  layers.land && layers.usStates && layers.countries && layers.coast);
ok('basemap: geometry types per layer',
  layers.land.type === 'MultiPolygon' && layers.coast.type === 'MultiLineString' &&
  layers.countries.type === 'MultiLineString' && layers.usStates.type === 'MultiLineString');
ok('basemap: layer volumes sane', layers.land.coordinates.length >= 120 &&
  layers.coast.coordinates.length >= 150 && layers.countries.coordinates.length >= 50 &&
  layers.usStates.coordinates.length >= 80);
// clip keeps one continuity vertex past each frame edge, so allow 1 deg margin
const inClip = ([x, y]) => x >= -111 && x <= 6 && y >= -11 && y <= 46;
ok('basemap: all line coords inside clip box (+1 deg margin)',
  ['coast', 'countries', 'usStates'].every(k =>
    layers[k].coordinates.every(line => line.every(inClip))));
ok('basemap: land rings clipped hard to the box (no margin)',
  layers.land.coordinates.every(poly => poly[0].every(([x, y]) =>
    x >= -110 && x <= 5 && y >= -10 && y <= 45)));
// border policy: US state lines live in US latitudes; no admin-1 south of 24N
// (Mexican/Brazilian internals would violate this)
ok('basemap: admin-1 confined to the US (border policy)',
  layers.usStates.coordinates.every(line => line.every(([, y]) => y >= 24)));

// --- TCM forecast/advisory -----------------------------------------------------

const TCM_FIX = `ZCZC MIATCMAT3 ALL
TTAA00 KNHC DDHHMM

HURRICANE LEE FORECAST/ADVISORY NUMBER  23
NWS NATIONAL HURRICANE CENTER MIAMI FL       AL132023
0300 UTC MON SEP 11 2023

HURRICANE CENTER LOCATED NEAR 22.6N  62.2W AT 11/0300Z
POSITION ACCURATE WITHIN  15 NM

PRESENT MOVEMENT TOWARD THE NORTHWEST OR 305 DEGREES AT   7 KT

ESTIMATED MINIMUM CENTRAL PRESSURE  950 MB
MAX SUSTAINED WINDS 105 KT WITH GUSTS TO 130 KT.
64 KT....... 65NE  40SE  40SW  55NW.
50 KT.......110NE  80SE  60SW  90NW.
34 KT.......150NE 140SE 100SW 140NW.

REPEAT...CENTER LOCATED NEAR 22.6N  62.2W AT 11/0300Z

FORECAST VALID 11/1200Z 23.1N  63.1W
MAX WIND 115 KT...GUSTS 140 KT.
64 KT... 65NE  50SE  45SW  60NW.

FORECAST VALID 12/0000Z 23.6N  64.4W
MAX WIND 120 KT...GUSTS 145 KT.

FORECAST VALID 13/0000Z 24.6N  66.4W
MAX WIND 110 KT...GUSTS 135 KT.

FORECAST VALID 14/0000Z 26.5N  67.7W
MAX WIND  95 KT...GUSTS 115 KT.

OUTLOOK VALID 15/0000Z 30.2N  67.9W
MAX WIND  85 KT...GUSTS 105 KT.

OUTLOOK VALID 16/0000Z 35.5N  67.0W...POST-TROP/EXTRATROP
MAX WIND  70 KT...GUSTS  85 KT.

NEXT ADVISORY AT 11/0900Z

$$`;

const tcm = P.parseTCM(TCM_FIX);
ok('TCM: header parsed', tcm && tcm.name === 'Lee' && tcm.classification === 'Hurricane' &&
  tcm.stormId === 'AL132023' && tcm.advisory === 23);
ok('TCM: center + intensity', tcm && tcm.center.lat === 22.6 && tcm.center.lon === -62.2 &&
  tcm.windKt === 105 && tcm.gustKt === 130 && tcm.pressureMb === 950);
ok('TCM: motion from degrees form', tcm && tcm.motion && tcm.motion.bearing === 305 && tcm.motion.slowKt === 7);
ok('TCM: six track points', tcm && tcm.track.length === 6);
ok('TCM: hour offsets from valid times', tcm &&
  tcm.track.map(p => p.hours).join(',') === '9,21,45,69,93,117');
ok('TCM: track coordinate values', tcm && tcm.track[0].lat === 23.1 && tcm.track[0].lon === -63.1 &&
  tcm.track[5].lat === 35.5 && tcm.track[5].lon === -67.0);
ok('TCM: track winds', tcm && tcm.track[0].windKt === 115 && tcm.track[4].windKt === 85);
ok('TCM: post-tropical end state tagged', tcm && tcm.track[5].state === 'post-tropical');
ok('TCM: month rollover hours', (() => {
  const t = P.parseTCM(TCM_FIX.replace('AT 11/0300Z', 'AT 30/2100Z')
    .replace('FORECAST VALID 11/1200Z', 'FORECAST VALID 01/0600Z'));
  return t && t.track[0].hours === 33; // 30/2100Z -> 01/0600Z across a 31-day month
})());
ok('TCM: garbage returns null', P.parseTCM('not a product') === null && P.parseTCM('') === null);
ok('TCM: dissipated end state tagged', (() => {
  const t = P.parseTCM(TCM_FIX.replace('...POST-TROP/EXTRATROP', '...DISSIPATED'));
  return t && t.track[5].state === 'dissipated';
})());

// --- cone geometry -------------------------------------------------------------

// ray-cast point-in-polygon for test purposes
function inRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.lon > pt.lon) !== (b.lon > pt.lon) &&
        pt.lat < (b.lat - a.lat) * (pt.lon - a.lon) / (b.lon - a.lon) + a.lat) inside = !inside;
  }
  return inside;
}

const conePts = [{ hours: 0, lat: tcm.center.lat, lon: tcm.center.lon }].concat(tcm.track);
const ring = P.coneFromTrack(conePts);
ok('cone: returns a ring', Array.isArray(ring) && ring.length > 20);
ok('cone: every track point inside', conePts.every(p => inRing(p, ring)));
ok('cone: width grows with forecast hour', (() => {
  // ring width near the first forecast point vs near the last one
  function widthNear(p) {
    let min = Infinity, max = -Infinity;
    ring.forEach(r => {
      if (Math.abs(r.lat - p.lat) < 1.5) { min = Math.min(min, r.lon); max = Math.max(max, r.lon); }
    });
    return max - min;
  }
  return widthNear(conePts[conePts.length - 1]) > widthNear(conePts[1]);
})());
ok('cone: null for a single point', P.coneFromTrack([conePts[0]]) === null);

// polygon must be simple (no self-intersections) — regression for the
// 0/360-straddling heading bug on recurving tracks (Lee's due-north leg)
function segsCross(a, b, c, d) {
  function o(p, q, r) {
    const v = (q.lon - p.lon) * (r.lat - p.lat) - (q.lat - p.lat) * (r.lon - p.lon);
    return v > 1e-12 ? 1 : v < -1e-12 ? -1 : 0;
  }
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}
ok('cone: ring is a simple polygon (no self-intersection)', (() => {
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    for (let j = i + 2; j < ring.length; j++) {
      if (i === 0 && j === ring.length - 1) continue; // shared endpoint
      const c = ring[j], d = ring[(j + 1) % ring.length];
      if (segsCross(a, b, c, d)) return false;
    }
  }
  return true;
})());

// --- issuance time parsing -----------------------------------------------------

const iss1 = P.parseIssued('805 AM EDT Mon Jul 7 2026');
ok('issued: EDT 12-hour to UTC (8:05 EDT = 12:05Z)',
  iss1 && iss1.getTime() === Date.UTC(2026, 6, 7, 12, 5));
const iss2 = P.parseIssued('0300 UTC MON SEP 11 2023');
ok('issued: UTC 24-hour passthrough',
  iss2 && iss2.getTime() === Date.UTC(2023, 8, 11, 3, 0));
ok('issued: 12:30 AM EST is 05:30Z (midnight-hour wrap)',
  (() => { const d = P.parseIssued('1230 AM EST Tue Dec 1 2026');
    return d && d.getTime() === Date.UTC(2026, 11, 1, 5, 30); })());
ok('issued: 12:15 PM AST is 16:15Z (noon-hour + Atlantic offset)',
  (() => { const d = P.parseIssued('1215 PM AST Wed Aug 5 2026');
    return d && d.getTime() === Date.UTC(2026, 7, 5, 16, 15); })());
ok('issued: unknown zone returns null (no guessing)',
  P.parseIssued('805 AM XYZ Mon Jul 7 2026') === null);
ok('issued: garbage/empty return null',
  P.parseIssued('not a timestamp') === null && P.parseIssued('') === null);

// --- app version (single source, CalVer) ---------------------------------------

const VER = require('./version.js');
ok('version: CalVer format YYYY.MM.DD[.N]', /^\d{4}\.\d{2}\.\d{2}(\.\d+)?$/.test(VER));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
