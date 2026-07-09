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

// --- coastlines.js integrity (generated file; guards a bad regeneration) ------

const COAST = require('./coastlines.js');
const geom = COAST.features && COAST.features[0] && COAST.features[0].geometry;
ok('coastlines: FeatureCollection with MultiLineString',
  COAST.type === 'FeatureCollection' && geom && geom.type === 'MultiLineString');
ok('coastlines: >=150 clipped lines', geom && geom.coordinates.length >= 150);
// clip keeps one continuity vertex past each frame edge, so allow 1 deg margin
ok('coastlines: all coords inside clip box (+1 deg margin)',
  geom && geom.coordinates.every(line =>
    line.every(([x, y]) => x >= -111 && x <= 6 && y >= -11 && y <= 49)));
ok('coastlines: western hemisphere is negative',
  geom && geom.coordinates.some(line => line.some(([x]) => x < -60)));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
