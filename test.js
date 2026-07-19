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

// 2023-era archive phrasings (found via the committed corpus: waves in
// TWDAT.202308291005 parsed to zero). Open-ended "from 18N southward" works
// like "south of 18N"; a slash span "17W/18W" averages like "61W-62W".
const TWD_WAVEV2 = `TWDAT
Tropical Weather Discussion
NWS National Hurricane Center Miami FL
1005 UTC Tue Aug 29 2023

...TROPICAL WAVES...

A tropical wave is in the Atlantic Ocean along 43W, from 18N
southward, moving W at around 20 kt. No significant convection is
evident with this tropical wave.

A tropical wave is in the Atlantic Ocean approaching the Leeward
Islands along 60W, from 17N southward to along the border of
Guyana and Venezuela, moving W around 20 kt. Scattered moderate
isolated strong convection is evident from 10N to 15N between 52W
and 60W.

A tropical wave is near 17W/18W, south of 20N, moving W at 10 kt.

An Atlantic Ocean tropical wave is along 29W, from 17N southward,
moving westward from 10 knots to 15 knots. Precipitation:
isolated moderate to locally strong is within 360 nm to the east
of the tropical wave from 07N to 12N.

A Caribbean Sea tropical wave is along 73W, from 19N
in Haiti southward, moving westward from 15 knots to 20 knots.
Precipitation: widely scattered moderate is within 300 nm to the
east of the tropical wave from 16N to 21N.

$$`;
const wv2 = P.parse(TWD_WAVEV2).waves;
ok('archive phrasings: all five waves parsed', wv2.length === 5);
ok('"from 18N southward" resolves like "south of 18N"',
  wv2[0] && wv2[0].axis[0].lat === 18 && wv2[0].axis[0].lon === -43 && wv2[0].axis[1].lat < 18);
ok('"southward to along the border..." prose does not break the axis',
  wv2[1] && wv2[1].axis[0].lat === 17 && wv2[1].axis[0].lon === -60);
ok('slash longitude span "17W/18W" averages to the axis meridian',
  wv2[2] && wv2[2].axis[0].lon === -17.5 && wv2[2].axis[0].lat === 20);
ok('earliest extent wins: "Precipitation: ... from 07N to 12N" cannot hijack the axis',
  wv2[3] && wv2[3].axis[0].lat === 17 && wv2[3].axis[0].lon === -29);
ok('place interjection: "from 19N in Haiti southward" resolves the extent',
  wv2[4] && wv2[4].axis[0].lat === 19 && wv2[4].axis[0].lon === -73);

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

// Real TWDATs don't always carry a SPECIAL FEATURES section: on 29 Aug 2023
// the discussion described Franklin and Idalia in the untitled preamble
// instead. Distilled from TWDAT.202308291005 (nhc.noaa.gov archive).
const TWD_PRE = `AXNT20 KNHC 291005
TWDAT

Tropical Weather Discussion
NWS National Hurricane Center Miami FL
1205 UTC Tue Aug 29 2023

Tropical Weather Discussion for North America, Central America
Gulf of Mexico, Caribbean Sea, northern sections of South
America, and Atlantic Ocean to the African coast from the
Equator to 31N.

Major Hurricane Franklin is centered near 30.2N 70.8W at 29/0900
UTC or 330 nm WSW of Bermuda, moving NNE at 8 kt. Estimated
minimum central pressure is 935 mb. Maximum sustained wind speed
is 120 kt with gusts to 145 kt.

Recently upgraded Hurricane Idalia is centered near 23.1N 85.0W
at 29/0900 UTC or 70 nm N of the western tip of Cuba, moving N
at 12 kt. Estimated minimum central pressure is 981 mb. Maximum
sustained wind speed is 65 kt with gusts to 80 kt.

...TROPICAL WAVES...

A tropical wave has its axis along 22W from 05N to 17N, moving
west at 10 to 15 kt.

$$`;

const pre = P.parse(TWD_PRE);
ok('preamble cyclones extracted when no SPECIAL FEATURES section',
  pre.cyclones.length === 2 && pre.cyclones[0].name === 'Franklin' &&
  pre.cyclones[1].name === 'Idalia' && pre.cyclones[0].srcSection === 'PREAMBLE');
ok('preamble cyclone centers and "wind speed is" phrasing',
  pre.cyclones[0].lat === 30.2 && pre.cyclones[0].lon === -70.8 && pre.cyclones[0].windKt === 120 &&
  pre.cyclones[1].lat === 23.1 && pre.cyclones[1].lon === -85 && pre.cyclones[1].windKt === 65);
ok('preamble cyclone centers not double-counted as fixes',
  !pre.fixes.some(f => (f.lat === 30.2 && f.lon === -70.8) || (f.lat === 23.1 && f.lon === -85)));
ok('preamble cyclones get +24h projections',
  pre.projections.some(p => p.id === 'Franklin') && pre.projections.some(p => p.id === 'Idalia'));

// Subtropical Depression Don (TWDAT 16 Jul 2023, distilled): "maximum
// sustained wind speeds are 30 knots" — plural "speeds", spelled-out "knots" —
// and no "centered near", so the center comes from the coordinate-pair
// fallback. The PTC chunk is synthetic, covering the RE_CYCLONE addition.
const TWD_DON = `TWDAT
Tropical Weather Discussion
NWS National Hurricane Center Miami FL
205 PM EDT Sun Jul 16 2023

Tropical Weather Discussion for the Atlantic Ocean.

...SPECIAL FEATURES...

The center of Subtropical Depression Don, at 16/1500 UTC, is
near 39.0N 48.1W. Don is moving toward the ENE, or 070 degrees,
07 knots. The estimated minimum central pressure is 1009 mb.
The maximum sustained wind speeds are 30 knots with gusts to
40 knots.

Potential Tropical Cyclone Eight is centered near 32.0N 78.0W
moving northwest at 6 kt. Maximum sustained winds are 40 kt.

$$`;

const don = P.parse(TWD_DON);
ok('Don: subtropical depression, center from pair fallback',
  don.cyclones[0] && don.cyclones[0].classification === 'Subtropical Depression' &&
  don.cyclones[0].lat === 39 && don.cyclones[0].lon === -48.1);
ok('Don: "wind speeds are NN knots" phrasing parsed',
  don.cyclones[0].windKt === 30 && don.cyclones[0].pressureMb === 1009);
ok('Potential Tropical Cyclone recognized in special features',
  don.cyclones[1] && don.cyclones[1].classification === 'Potential Tropical Cyclone' &&
  don.cyclones[1].name === 'Eight' && don.cyclones[1].windKt === 40);

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
ok('untitled disturbances carry no invest tag', d1.invest === null && d2.invest === null);

// Titled current-format TWO with an invest tag in the title line.
const TWO_INVEST = `Tropical Weather Outlook
NWS National Hurricane Center Miami FL
800 AM EDT Tue Jul 8 2026

For the North Atlantic...Caribbean Sea and the Gulf of America:

1. Central Tropical Atlantic (AL92):
A tropical wave in the central tropical Atlantic is becoming better
organized.

* Formation chance through 48 hours...medium...50 percent.
* Formation chance through 7 days...high...70 percent.

$$`;
const twoInv = P.parseTWO(TWO_INVEST);
ok('invest tag captured from the title line',
  twoInv.disturbances.length === 1 && twoInv.disturbances[0].invest === 'AL92');

// Real June 2026 TWOATs interpose a "Regardless of tropical cyclone
// formation..." advisory paragraph between the titled prose and the star
// lines — in the SAME chunk as the stars. The star chunk then neither starts
// with '*' nor carries a title, so the titled chunk a step back must be
// inherited or the invest tag and location vanish (AL90 shipped into the
// void this way; see fixtures TWOAT.202606160502.txt). The old untitled
// format (TWO_FIX above) must NOT inherit — its positions pin that.
const TWO_GAP = `Tropical Weather Outlook
NWS National Hurricane Center Miami FL
200 AM EDT Tue Jun 16 2026

For the North Atlantic...Caribbean Sea and the Gulf of America:

Northwestern Gulf of America (AL90):
A trough of low pressure located inland near the Texas/Mexico border
continues to produce a large area of disorganized showers and
thunderstorms.

Regardless of tropical cyclone formation, interests across southern
and eastern Texas should monitor the progress of this system.
* Formation chance through 48 hours...low...20 percent.
* Formation chance through 7 days...medium...60 percent.

$$`;
const twoGap = P.parseTWO(TWO_GAP);
ok('gap layout: "Regardless of..." star chunk inherits the titled chunk (tag survives)',
  twoGap.disturbances.length === 1 && twoGap.disturbances[0].invest === 'AL90');
ok('gap layout: location resolves from the recovered title, in the Gulf',
  twoGap.disturbances[0].lat !== null && twoGap.disturbances[0].lat >= 20 && twoGap.disturbances[0].lat <= 31 &&
  twoGap.disturbances[0].lon >= -100 && twoGap.disturbances[0].lon <= -84);
ok('gap layout: chances still parse from the star lines',
  twoGap.disturbances[0].chance7 && twoGap.disturbances[0].chance7.pct === 60);

// Control: the dominant 2026 format — title + prose + stars in ONE chunk —
// must not inherit anything (310 of 376 archived season products).
const TWO_SELFTITLED = `Tropical Weather Outlook
NWS National Hurricane Center Miami FL
800 AM EDT Tue Jul 8 2026

For the North Atlantic...Caribbean Sea and the Gulf of America:

1. Central Tropical Atlantic (AL93):
A tropical wave over the central tropical Atlantic continues to
produce disorganized showers and thunderstorms.
* Formation chance through 48 hours...low...10 percent.
* Formation chance through 7 days...low...20 percent.

$$`;
const twoSelf = P.parseTWO(TWO_SELFTITLED);
ok('self-titled chunk: tag from its own title, nothing inherited',
  twoSelf.disturbances.length === 1 && twoSelf.disturbances[0].invest === 'AL93' &&
  twoSelf.disturbances[0].chance48 && twoSelf.disturbances[0].chance48.pct === 10);

// --- invest alerter (tools/alert-invests.js, pure logic only — offline) --------

const ALERTS = require('./tools/alert-invests.js');
const stPlain = ALERTS.stateFromTWO(two, 'prod-1');
const stInvest = ALERTS.stateFromTWO(twoInv, 'prod-2');
ok('alerts: state keys are stable (gazetteer grid for untagged, tag for invests)',
  stPlain.disturbances[0].key === 'G15,-60' && stInvest.disturbances[0].key === 'AL92');
ok('alerts: cold start primes silently', ALERTS.diffAlerts(null, stInvest).length === 0);
ok('alerts: same product id never re-alerts',
  ALERTS.diffAlerts(stInvest, { ...stInvest }).length === 0);
ok('alerts: new invest designation fires', (() => {
  const a = ALERTS.diffAlerts(stPlain, stInvest);
  return a.length >= 1 && a[0].type === 'new-invest' && a[0].d.invest === 'AL92';
})());
ok('alerts: brand-new untagged area fires new-area', (() => {
  const a = ALERTS.diffAlerts(stInvest, { productId: 'prod-3', disturbances: stPlain.disturbances });
  return a.length === 2 && a.every((x) => x.type === 'new-area');
})());
ok('alerts: 7-day chance crossing 40 and 60 upward fires, in-band moves do not', (() => {
  const at = (pct, pid) => ({ productId: pid, disturbances: [{ key: 'AL92', invest: 'AL92', pct7: pct, where: 'X' }] });
  const fired = (a, b) => ALERTS.diffAlerts(a, b).length;
  return fired(at(35, 'a'), at(45, 'b')) === 1 &&   // crosses 40
    fired(at(55, 'a'), at(65, 'b')) === 1 &&        // crosses 60
    fired(at(45, 'a'), at(55, 'b')) === 0 &&        // between thresholds
    fired(at(65, 'a'), at(70, 'b')) === 0 &&        // above both already
    fired(at(65, 'a'), at(35, 'b')) === 0;          // downward never fires
})());
ok('alerts: formatAlert produces a titled message for each type', (() => {
  const inv = ALERTS.formatAlert({ type: 'new-invest', d: { invest: 'AL92', pct7: 70, where: 'Central Tropical Atlantic ' } });
  const area = ALERTS.formatAlert({ type: 'new-area', d: { pct7: 20, where: null } });
  const thr = ALERTS.formatAlert({ type: 'threshold', d: { invest: 'AL92', pct7: 60, where: 'X' }, t: 60, from: 50 });
  return /Invest AL92/.test(inv.title) && /Atlantic/.test(area.body) && /Crossed 60%/.test(thr.body);
})());

// Staleness + tgftp fallback (pure pieces; the mirror fetch itself is network
// and stays untested here, like latestTWOs). Fixed clocks — no wall time.
const NOW = Date.parse('2026-07-15T12:00:00Z');
ok('alerts: a 2h-old product is fresh, an 8h-old one is stale',
  !ALERTS.isStale('2026-07-15T10:00:00+00:00', NOW) &&
  ALERTS.isStale('2026-07-15T04:00:00+00:00', NOW));
ok('alerts: unprovable issuance counts as stale',
  ALERTS.isStale(null, NOW) && ALERTS.isStale('not a date', NOW));
ok('alerts: WMO stamp resolves against the current month',
  ALERTS.wmoStampToDate('151143', NOW).toISOString() === '2026-07-15T11:43:00.000Z');
ok('alerts: WMO stamp with a future day-of-month rolls back a month',
  ALERTS.wmoStampToDate('302351', Date.parse('2026-07-01T02:00:00Z'))
    .toISOString() === '2026-06-30T23:51:00.000Z');
ok('alerts: malformed or impossible WMO stamps yield null',
  ALERTS.wmoStampToDate('9x1143', NOW) === null &&
  ALERTS.wmoStampToDate('321143', NOW) === null &&
  ALERTS.wmoStampToDate('151160', NOW) === null);
ok('alerts: tgftpProduct builds a stable synthetic id + issuance from the header', (() => {
  const p = ALERTS.tgftpProduct('\n000\nABNT20 KNHC 151143\nTWOAT \n\nTropical Weather Outlook\n', NOW);
  return p && p.id === 'tgftp-ABNT20-151143' && p.issuanceTime === '2026-07-15T11:43:00.000Z';
})());
ok('alerts: tgftpProduct refuses text without a readable WMO line',
  ALERTS.tgftpProduct('Tropical Weather Outlook\nno header here\n', NOW) === null);
ok('alerts: api<->tgftp product-id churn on the same issuance fires nothing', (() => {
  const viaApi = ALERTS.stateFromTWO(two, '10c93f07-uuid');
  const viaMirror = ALERTS.stateFromTWO(two, 'tgftp-ABNT20-151143');
  return ALERTS.diffAlerts(viaApi, viaMirror).length === 0 &&
    ALERTS.diffAlerts(viaMirror, viaApi).length === 0;
})());

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

// --- inferred-dot dedup (audit follow-up: 106 residual dots on 34 TWDATs) ------
// Each sentence below isolates one suppression rule; the two keeps prove the
// rules don't over-suppress genuine prose-only features.
const TWD_DEDUP = `TWDAT
Tropical Weather Discussion
NWS National Hurricane Center Miami FL
1005 UTC Tue Aug 29 2023

...TROPICAL WAVES...

A tropical wave is along 62W, from 18N southward, moving W at 15 kt.

...MONSOON TROUGH/ITCZ...

The monsoon trough axis extends from 09N16W to 08N30W to 08N44W.

...CARIBBEAN SEA...

Squalls and thunderstorms are ahead of the tropical wave in the eastern Caribbean.
A tropical wave is near the Leeward Islands.
The pressure gradient between the Atlantic ridge and the Colombian low is supporting strong winds over the central Caribbean.
A strong tropical wave will reach the Lesser Antilles by Wednesday.
A tropical wave has moved into the eastern Pacific.
Refer to the Tropical Waves section above for details on a tropical wave over the central Caribbean.
The GFS model shows a trough over the central Caribbean.
No significant convection is noted near the trough axis over the eastern Caribbean.
A disturbed area between Hispaniola and the southeastern Bahamas bears watching.
A tropical wave is moving through the central sections of the Caribbean Sea.

$$`;
const dd = P.parse(TWD_DEDUP);
ok('dedup: coordinate wave and trough parsed (preconditions)',
  dd.waves.length === 1 && dd.troughs.length === 1);
ok('dedup: only the two genuine prose-only features survive', dd.inferred.length === 2);
ok('dedup: "the tropical wave" re-mention suppressed (wave drawn from its own section)',
  !dd.inferred.some((d) => /ahead of the tropical wave/.test(d.source)));
ok('dedup: same-kind dot on the parsed axis suppressed (Leeward Islands vs 62W wave)',
  !dd.inferred.some((d) => /Leeward/.test(d.source)));
ok('dedup: climo nouns ("Colombian low") cannot satisfy the feature gate',
  !dd.inferred.some((d) => /pressure gradient/.test(d.source)));
ok('dedup: future position ("will reach the Lesser Antilles") yields no dot',
  !dd.inferred.some((d) => /will reach/.test(d.source)));
ok('dedup: a wave that left for the Pacific is off the chart',
  !dd.inferred.some((d) => /eastern Pacific/.test(d.source)));
ok('dedup: cross-references and model fields are not analyzed positions',
  !dd.inferred.some((d) => /Refer to|GFS/.test(d.source)));
ok('dedup: "near the trough axis" re-mention suppressed',
  !dd.inferred.some((d) => /trough axis over/.test(d.source)));
ok('dedup: canonical between-anchors disturbance still infers',
  dd.inferred.some((d) => d.lat === 20.5 && d.lon === -72.25));
ok('dedup: distant same-kind wave survives (central Caribbean vs 62W axis)',
  dd.inferred.some((d) => d.lon === -75 && /central sections/.test(d.source)));

// --- popup context (paragraph + section carried on every prose feature) --------
// Load-bearing invariant: context is built with the SAME normalization as that
// feature's source, so the popup can locate the source span via indexOf.

const ctxAll = [].concat(r.waves, r.convection, r.troughs, r.fixes, r.inferred, r.projections);
ok('context: every prose feature carries context and srcSection',
  ctxAll.length > 0 && ctxAll.every((f) => f.context && f.srcSection));
ok('context: source is always locatable inside context (indexOf invariant)',
  ctxAll.every((f) => f.context.indexOf(f.source) !== -1));
ok('context: projections inherit the parent wave paragraph',
  r.projections[0].context === r.waves[0].context &&
  r.projections[0].srcSection === r.waves[0].srcSection);
ok('context: convection context is the surrounding sentence, not just the coord phrase',
  r.convection[0].context.length > r.convection[0].source.length);

// The cap: a giant paragraph is trimmed word-safely with the source span kept.
ok('context: >600-char paragraphs are capped without losing the source span', (() => {
  const pad = 'The wave remains poorly organized while conditions stay hostile. '.repeat(15);
  const big = P.parse('TWDAT\n\n...TROPICAL WAVES...\n\nA tropical wave is along 40W, from 15N southward, moving W at 10 kt. ' + pad + '\n\n$$');
  const w = big.waves[0];
  return w && w.context.length <= 602 && w.context.indexOf(w.source) !== -1;
})());

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
// re-baselined after the 10m Lesser Antilles inset (land 208 / coast 210)
ok('basemap: layer volumes sane', layers.land.coordinates.length >= 190 &&
  layers.coast.coordinates.length >= 195 && layers.countries.coordinates.length >= 50 &&
  layers.usStates.coordinates.length >= 80);
// clip box is the union of both basin frames (lon -145..5 / lat -5..45).
// Lines keep one continuity vertex past each edge, so allow 1 deg margin.
const inClip = ([x, y]) => x >= -146 && x <= 6 && y >= -6 && y <= 46;
ok('basemap: all line coords inside clip box (+1 deg margin)',
  ['coast', 'countries', 'usStates'].every(k =>
    layers[k].coordinates.every(line => line.every(inClip))));
ok('basemap: land rings clipped hard to the box (no margin)',
  layers.land.coordinates.every(poly => poly[0].every(([x, y]) =>
    x >= -145 && x <= 5 && y >= -5 && y <= 45)));
// border policy: US state lines live in US latitudes; no admin-1 south of 24N
// (Mexican/Brazilian internals would violate this)
ok('basemap: admin-1 confined to the US (border policy)',
  layers.usStates.coordinates.every(line => line.every(([, y]) => y >= 24)));
// 10m Lesser Antilles inset: real islands must resolve as exactly ONE ring
// (exactly-1 doubles as the no-50m-leftover / no-doubling check) with 10m-class
// vertex counts (at 50m: Dominica ~14 verts, Barbados 9, so the floors below
// separate the scales cleanly).
function landRingsAt(lon, lat) {
  return layers.land.coordinates.filter(poly => {
    const ring = poly[0];
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)
        inside = !inside;
    }
    return inside;
  });
}
ok('basemap: Dominica resolved by the 10m inset (one ring, 10m-class detail)',
  (() => { const r = landRingsAt(-61.34, 15.42); return r.length === 1 && r[0][0].length >= 40; })());
ok('basemap: Barbados resolved by the 10m inset',
  (() => { const r = landRingsAt(-59.55, 13.17); return r.length === 1 && r[0][0].length >= 20; })());
ok('basemap: Trinidad whole and resolved (inset south edge did not truncate it)',
  (() => { const r = landRingsAt(-61.3, 10.3); return r.length === 1 && r[0][0].length >= 60; })());
// the embedded basemap is a shell payload; a bad regeneration (wrong box, a
// forgotten islet guard) must not silently balloon it (currently ~305 KB)
ok('basemap: payload under 340 KB',
  fs.statSync(__dirname + '/basemap.js').size <= 340 * 1024);

// --- countries.js integrity (generated hover hit-targets) ----------------------

const CT = require('./countries.js');
ok('countries: FeatureCollection of named MultiPolygons',
  CT.type === 'FeatureCollection' && CT.features.every(f =>
    f.geometry.type === 'MultiPolygon' &&
    typeof f.properties.name === 'string' && f.properties.name.length > 0));
// exact count is brittle across NE revisions; a range guards a bad regeneration
ok('countries: feature count sane (55-80)',
  CT.features.length >= 55 && CT.features.length <= 80);
ok('countries: rings clipped hard to the box, closed, non-trivial',
  CT.features.every(f => f.geometry.coordinates.every(poly => {
    const ring = poly[0];
    const [fx, fy] = ring[0], [lx, ly] = ring[ring.length - 1];
    return ring.length >= 4 && fx === lx && fy === ly &&
      ring.every(([x, y]) => x >= -145 && x <= 5 && y >= -5 && y <= 45);
  })));
// hover hit-targets must not blow the payload budget a bad eps would
ok('countries: payload under 130 KB',
  fs.statSync(__dirname + '/countries.js').size <= 130 * 1024);
// ray-cast point-in-polygon: does any country's MultiPolygon contain [lon,lat]?
function countryAt(lon, lat) {
  for (const f of CT.features) {
    for (const poly of f.geometry.coordinates) {
      const ring = poly[0];
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)
          inside = !inside;
      }
      if (inside) return f.properties.name;
    }
  }
  return null;
}
ok('countries: 23N 102W is Mexico', countryAt(-102, 23) === 'Mexico');
ok('countries: 33N 81W is the US', countryAt(-81, 33) === 'United States of America');
ok('countries: 22.3N 80W is Cuba', countryAt(-80, 22.3) === 'Cuba');
ok('countries: open Atlantic (25N 55W) is no country', countryAt(-55, 25) === null);

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
ok('TCM: issuance header line extracted', tcm.issuedHeader === '0300 UTC MON SEP 11 2023');
ok('TCM: issuance header round-trips through parseIssued', (() => {
  const d = P.parseIssued(tcm.issuedHeader);
  return d && d.getTime() === Date.UTC(2023, 8, 11, 3, 0);
})());
ok('TCM: missing issuance header yields null, not a bad guess', (() => {
  const t = P.parseTCM(TCM_FIX.replace('0300 UTC MON SEP 11 2023', ''));
  return t && t.issuedHeader === null;
})());
ok('TCM: dissipated end state tagged', (() => {
  const t = P.parseTCM(TCM_FIX.replace('...POST-TROP/EXTRATROP', '...DISSIPATED'));
  return t && t.track[5].state === 'dissipated';
})());

// --- TCM wind radii + wind-field geometry ---------------------------------------

ok('TCM: current wind radii parsed per quadrant at 34/50/64 kt',
  tcm.windRadiiNm && tcm.windRadiiNm[34].ne === 150 &&
  tcm.windRadiiNm[50].sw === 60 && tcm.windRadiiNm[64].nw === 55);
ok('TCM: radii come from the current position, not the +12h block (40SE, not 50SE)',
  tcm.windRadiiNm[64].se === 40);
ok('TCM: no radii lines yields windRadiiNm null', (() => {
  const t = P.parseTCM(TCM_FIX.replace(/^\d{2} KT\.+.*$/gm, ''));
  return t && t.windRadiiNm === null;
})());

const wf = P.windFieldFromTCM(tcm);
ok('wind field: three nested bands, ascending kt (34 painted first)',
  wf && wf.length === 3 && wf[0].kt === 34 && wf[1].kt === 50 && wf[2].kt === 64);
ok('wind field: due-north edge sits exactly 150 nm (2.5 deg) from center',
  Math.abs(wf[0].ring[0].lat - (22.6 + 150 / 60)) < 1e-9 &&
  Math.abs(wf[0].ring[0].lon - -62.2) < 1e-9);
ok('wind field: crisp quadrant step at bearing 090 (NE 150 nm vs SE 140 nm), not smoothed',
  (() => { const a = wf[0].ring[15], b = wf[0].ring[16];
    return Math.abs(a.lat - b.lat) < 1e-6 && a.lon > b.lon; })());
ok('wind field: null for advisories without radii and for null input',
  P.windFieldFromTCM(P.parseTCM(TCM_FIX.replace(/^\d{2} KT\.+.*$/gm, ''))) === null &&
  P.windFieldFromTCM(null) === null);

// Real PTC advisory (Potential Tropical Cyclone Eight, Sep 2024): PTC header
// classification, a prior-position "CENTER WAS LOCATED" line that must not win
// the center match, INLAND / TROPICAL CYCLONE track suffixes, and a
// position-less DISSIPATED outlook. Distilled from
// nhc.noaa.gov/archive/2024/al08/al082024.fstadv.001.shtml.
const PTC_FIX = `ZCZC MIATCMAT3 ALL
TTAA00 KNHC DDHHMM

POTENTIAL TROPICAL CYCLONE EIGHT FORECAST/ADVISORY NUMBER   1
NWS NATIONAL HURRICANE CENTER MIAMI FL       AL082024
2100 UTC SUN SEP 15 2024

POTENTIAL TROP CYCLONE CENTER LOCATED NEAR 32.0N  78.0W AT 15/2100Z
POSITION ACCURATE WITHIN  30 NM

PRESENT MOVEMENT TOWARD THE NORTHWEST OR 320 DEGREES AT   6 KT

ESTIMATED MINIMUM CENTRAL PRESSURE 1006 MB
MAX SUSTAINED WINDS  40 KT WITH GUSTS TO  50 KT.

REPEAT...CENTER LOCATED NEAR 32.0N  78.0W AT 15/2100Z
AT 15/1800Z CENTER WAS LOCATED NEAR 31.8N  77.8W

FORECAST VALID 16/0600Z 32.4N  78.7W...TROPICAL CYCLONE
MAX WIND  40 KT...GUSTS  50 KT.

FORECAST VALID 16/1800Z 33.1N  79.4W...INLAND
MAX WIND  45 KT...GUSTS  55 KT.

FORECAST VALID 17/0600Z 34.1N  80.0W...POST-TROPICAL
MAX WIND  25 KT...GUSTS  35 KT.

OUTLOOK VALID 19/1800Z...DISSIPATED

$$`;

const ptc = P.parseTCM(PTC_FIX);
ok('PTC: header parsed', ptc && ptc.classification === 'Potential Tropical Cyclone' &&
  ptc.name === 'Eight' && ptc.stormId === 'AL082024' && ptc.advisory === 1);
ok('PTC: initial center wins over prior-position line',
  ptc && ptc.center.lat === 32 && ptc.center.lon === -78 && ptc.issued === '15/2100Z');
ok('PTC: positioned points only (dissipated outlook excluded)',
  ptc && ptc.track.length === 3 && ptc.track.map(p => p.hours).join(',') === '9,21,33');
ok('PTC: post-tropical track suffix tagged', ptc && ptc.track[2].state === 'post-tropical');
ok('PTC: issuance header line extracted', ptc && ptc.issuedHeader === '2100 UTC SUN SEP 15 2024');

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

// Hyphenated classifications follow NHC style ("Post-Tropical", capital T);
// exercised against the committed archive fixture.
ok('TCM: hyphenated classification title-cased NHC-style',
  P.parseTCM(fs.readFileSync(__dirname + '/fixtures/al132023.fstadv.044.txt', 'utf8'))
    .classification === 'Post-Tropical Cyclone');

// Seasonal-constant guard: CONE_RADII_NM must be refreshed each season from
// nhc.noaa.gov/aboutcone.shtml. This DELIBERATELY starts failing every January
// until the radii (and CONE_SEASON beside them) are updated. One CONE_SEASON
// governs every basin table (the page updates them together).
ok('cone: CONE_SEASON (' + P.CONE_SEASON + ') is not behind the calendar year',
  P.CONE_SEASON >= new Date().getUTCFullYear());

// Per-basin cone tables: AL and EP from the two aboutcone.shtml columns; CP
// aliases EP because NHC publishes one combined Eastern/Central column.
ok('cone: AL/EP/CP tables exist with sane shape',
  ['AL', 'EP', 'CP'].every((b) => {
    const t = P.CONE_RADII_NM[b];
    return Array.isArray(t) && t.length >= 8 &&
      t.every(([h, r], i) => r > 0 && (i === 0 || h > t[i - 1][0]));
  }));
ok('cone: CP aliases EP (single published column)', P.CONE_RADII_NM.CP === P.CONE_RADII_NM.EP);
ok('cone: EP table differs from AL at long lead (120h: 138 vs 200 nm)',
  P.CONE_RADII_NM.EP[P.CONE_RADII_NM.EP.length - 1][1] !==
  P.CONE_RADII_NM.AL[P.CONE_RADII_NM.AL.length - 1][1]);
ok('cone: one-arg coneFromTrack is byte-identical to explicit AL (backcompat)',
  (() => {
    const pts = [{ lat: 15, lon: -100, hours: 0 }, { lat: 17, lon: -104, hours: 48 },
      { lat: 19, lon: -108, hours: 120 }];
    return JSON.stringify(P.coneFromTrack(pts)) === JSON.stringify(P.coneFromTrack(pts, 'AL'));
  })());
ok('cone: EP cone is narrower than AL for the same track',
  (() => {
    const pts = [{ lat: 15, lon: -100, hours: 0 }, { lat: 17, lon: -104, hours: 48 },
      { lat: 19, lon: -108, hours: 120 }];
    const spread = (ring) => Math.max(...ring.map((p) => p.lat)) - Math.min(...ring.map((p) => p.lat));
    return spread(P.coneFromTrack(pts, 'EP')) < spread(P.coneFromTrack(pts, 'AL'));
  })());

// --- basin detection + East Pacific parsing ------------------------------------

ok('basin: TWDEP/AXPZ20 header detects EP',
  P.detectBasin('\n000\nAXPZ20 KNHC 140801\nTWDEP \n\nTropical Weather Discussion\n') === 'EP');
ok('basin: TWOEP/ABPZ20 header detects EP',
  P.detectBasin('\n000\nABPZ20 KNHC 141151\nTWOEP \n\nTropical Weather Outlook\n') === 'EP');
ok('basin: area line alone detects EP',
  P.detectBasin('Tropical Weather Outlook\nNWS National Hurricane Center Miami FL\n' +
    '500 AM PDT Tue Jul 14 2026\n\nFor the eastern and central North Pacific east of 180 longitude:\n') === 'EP');
ok('basin: TWDAT fixture detects AT',
  P.detectBasin(fs.readFileSync(__dirname + '/fixtures/TWDAT.202308291005.txt', 'utf8')) === 'AT');
ok('basin: garbage/empty default AT',
  P.detectBasin('') === 'AT' && P.detectBasin('hello world') === 'AT');
ok('basin: body mention of "eastern Pacific" does NOT flip an Atlantic product',
  (() => {
    // "moved into the eastern Pacific" prose sits deep in the body, past the
    // 400-char header window detectBasin examines
    const t = 'TWDAT \n\nTropical Weather Discussion\n' + 'x'.repeat(400) +
      '\nThe wave moved into the eastern Pacific.';
    return P.detectBasin(t) === 'AT';
  })());

const TWDEP_SYNTH = `
000
AXPZ20 KNHC 140801
TWDEP

Tropical Weather Discussion
NWS National Hurricane Center Miami FL
1005 UTC Tue Jul 14 2026

Tropical Weather Discussion for the eastern Pacific Ocean from
03.4S to 30N, east of 120W including the Gulf of California.

...TROPICAL WAVES...

The axis of a tropical wave is near 88.5W, north of 01N to across
portions of El Salvador, moving quickly westward at 20 to 25 kt.
Scattered moderate convection is noted from 11N to 13.5N between
87W and 93W.

...INTERTROPICAL CONVERGENCE ZONE/MONSOON TROUGH...

The monsoon trough extends from 11N74W to 09N88W. Segments of the
ITCZ are from 07.5N89W to 05N122W to 03.4S135W.

...OFFSHORE WATERS WITHIN 250 NM OF MEXICO...

A broad area of low pressure is over the Gulf of Tehuantepec.
Fresh to strong gap winds are pulsing across the Gulf of
Tehuantepec area tonight.
`;

const epr = P.parse(TWDEP_SYNTH);
ok('EP: basin auto-detected on parse', epr.basin === 'EP');
ok('EP: opts.basin override wins', P.parse(TWDEP_SYNTH, { basin: 'AT' }).basin === 'AT');
ok('EP: decimal wave axis near 88.5W parsed',
  epr.waves.length === 1 && Math.abs(epr.waves[0].axis[0].lon - -88.5) < 1e-9);
ok('EP: decimal convection box (13.5N)',
  epr.convection.length >= 1 && epr.convection.some((c) => c.bbox.n === 13.5));
ok('EP: ITCZ polyline carries a south-latitude point (03.4S)',
  epr.troughs.some((t) => t.line.some((p) => Math.abs(p.lat - -3.4) < 1e-9)),);
ok('EP: Tehuantepec low earns an inferred dot at the EP anchor',
  epr.inferred.some((f) => f.lat === 16.0 && f.lon === -95.0 && /low pressure/i.test(f.source)));
ok('EP: gap-wind sentence with "area" noun suppressed by EP climo guard',
  !epr.inferred.some((f) => /gap winds/i.test(f.source)));

// The load-bearing left-basin asymmetry: in an EP product, "moved into the
// eastern Pacific" is an ARRIVAL and must keep its dot; departures (central
// Pacific / inland) must lose theirs. The Atlantic rule is unchanged.
const EP_HEAD = '\n000\nAXPZ20 KNHC 140801\nTWDEP \n\nTropical Weather Discussion\n\n...TROPICAL WAVES...\n\n';
ok('EP: departure to the central Pacific -> no dot',
  P.parse(EP_HEAD + 'The remnant low moved into the central Pacific near the Revillagigedo Islands.')
    .inferred.length === 0);
ok('EP: arrival "moved into the eastern Pacific" keeps its dot',
  P.parse(EP_HEAD + 'A tropical wave moved into the eastern Pacific and is now a disturbance over the Gulf of Tehuantepec.')
    .inferred.length === 1);
ok('AT: departure to the Pacific still drops the dot (unchanged)',
  P.parse('TWDAT \n\nTropical Weather Discussion\n\n...TROPICAL WAVES...\n\n' +
    'The wave moved into the eastern Pacific from the northwestern Caribbean disturbance area.')
    .inferred.length === 0);

// TWOEP: EP/CP invest tags captured; CP location honestly unmapped (no Hawaii
// anchor exists BY DESIGN — the frame ends at 140W).
const TWOEP_SYNTH = `
000
ABPZ20 KNHC 141151
TWOEP

Tropical Weather Outlook
NWS National Hurricane Center Miami FL
500 AM PDT Tue Jul 14 2026

For the eastern and central North Pacific east of 180 longitude:

Offshore of Southwestern Mexico (EP96):
Showers and thunderstorms have become better organized offshore of
southwestern Mexico.
* Formation chance through 48 hours...high...90 percent.
* Formation chance through 7 days...high...near 100 percent.

Well South of the Hawaiian Islands (CP91):
Shower and thunderstorm activity has decreased south of the
Hawaiian Islands.
* Formation chance through 48 hours...medium...60 percent.
* Formation chance through 7 days...medium...60 percent.
`;
const eptwo = P.parseTWO(TWOEP_SYNTH);
ok('TWOEP: basin detected EP', eptwo.basin === 'EP');
ok('TWOEP: two disturbances', eptwo.disturbances.length === 2);
ok('TWOEP: EP96 invest tag captured + mapped at the offshore anchor',
  (() => { const d = eptwo.disturbances[0];
    return d.invest === 'EP96' && d.lat === 17.0 && d.lon === -102.0 && d.chance7.pct === 100; })());
ok('TWOEP: CP91 tag captured but location honestly unmapped',
  (() => { const d = eptwo.disturbances[1];
    return d.invest === 'CP91' && d.lat === null && d.lon === null && d.chance48.pct === 60; })());

// --- directional offsets ("several hundred miles south-southwest of X") --------
// The gazetteer must not park a feature ON the landmark when the text places it
// hundreds of miles away — EP94 lurched 17 deg in 6 h that way. Vague hundreds
// use nominal midpoints (couple 200 / few 300 / several 400), statute unless
// "nautical" is written; a phrase with NO stated scale ("well southwest of")
// stays at the anchor — offsetting it would invent magnitude. Expected values
// are offsetNm math (0.1-deg rounded), computed outside the parser.
const offDot = (body) => {
  const r = P.parse(EP_HEAD + body);
  return r.inferred.length === 1 ? r.inferred[0] : null;
};
ok('offset: "several hundred miles south of the southern tip of the Baja California Peninsula" lands off Cabo, not mid-peninsula',
  (() => { const d = offDot('An area of low pressure has formed along the tropical wave located several hundred miles south of the southern tip of the Baja California Peninsula.');
    return d && d.lat === 17.1 && d.lon === -109.9 && d.inferred === true; })());
ok('offset: 16-point compound bearing ("a few hundred miles south-southwest of the coast of southwestern Mexico")',
  (() => { const d = offDot('A tropical wave located a few hundred miles south-southwest of the coast of southwestern Mexico continues to produce disorganized showers.');
    return d && d.lat === 13 && d.lon === -103.7; })());
ok('offset: numeric nautical miles taken as-is ("about 500 nautical miles south of the southern tip of Baja California")',
  (() => { const d = offDot('A broad low pressure area is centered about 500 nautical miles south of the southern tip of Baja California.');
    return d && d.lat === 14.6 && d.lon === -109.9; })());
ok('offset: numeric statute miles converted to nm (Atlantic, "about 175 miles southeast of the Cabo Verde Islands")',
  (() => { const r = P.parse('TWDAT \n\nTropical Weather Discussion\n\n...TROPICAL WAVES...\n\n' +
    'A tropical wave is located about 175 miles southeast of the Cabo Verde Islands.');
    return r.inferred.length === 1 && r.inferred[0].lat === 14.2 && r.inferred[0].lon === -22.1; })());
ok('offset: "to the" infix form resolves the same bearing',
  (() => { const d = offDot('A tropical wave is located several hundred miles to the south-southwest of the coast of southwestern Mexico.');
    return d && d.lat === 11.6 && d.lon === -104.3; })());
ok('offset: teletype line-wrap inside the phrase still offsets',
  (() => { const d = offDot('An area of low pressure is located several hundred\nmiles south of the southern tip of the Baja California Peninsula.');
    return d && d.lat === 17.1 && d.lon === -109.9; })());
ok('offset: "well southwest of X" states no distance -> stays at the anchor (nothing invented)',
  (() => { const d = offDot('A broad area of low pressure is located well southwest of the Baja California Peninsula.');
    return d && d.lat === 29.0 && d.lon === -114.0; })());
ok('offset: "within N miles ... of" is a radius, not a position -> anchor unchanged',
  (() => { const d = offDot('A surface trough is within 200 miles south of the Baja California Peninsula.');
    return d && d.lat === 29.0 && d.lon === -114.0; })());
ok('offset TWO: CP landmarks stay honestly unmapped (conjoined Hawaiian/Johnston offsets -> null)',
  (() => { const t = P.parseTWO(TWOEP_SYNTH.replace(
    'Shower and thunderstorm activity has decreased south of the\nHawaiian Islands.',
    'A broad area of low pressure located several hundred miles southwest of the Hawaiian Islands and around 400 miles southeast of Johnston Atoll is producing disorganized showers.'));
    const d = t.disturbances[1];
    return d.invest === 'CP91' && d.lat === null && d.lon === null; })());
ok('offset TWO: EP94 evidence prose resolves to the offset point, tag + chances intact',
  (() => { const t = P.parseTWO(`
000
ABPZ20 KNHC 231151
TWOEP

Tropical Weather Outlook
NWS National Hurricane Center Miami FL
500 AM PDT Tue Jun 23 2026

For the eastern North Pacific east of 140 degrees west longitude:

Central and Western Portion of the East Pacific (EP94):
An area of low pressure has formed along the tropical wave located
several hundred miles south of the southern tip of the Baja
California Peninsula.
* Formation chance through 48 hours...medium...50 percent.
* Formation chance through 7 days...high...80 percent.
`);
    const d = t.disturbances[0];
    return d && d.invest === 'EP94' && d.lat === 17.1 && d.lon === -109.9 && d.chance48.pct === 50; })());
ok('offset TWO: future "expected to form ... offshore of" keeps pre-existing anchor behavior (offshore has no bearing)',
  (() => { const t = P.parseTWO(`
000
ABPZ20 KNHC 231151
TWOEP

Tropical Weather Outlook
NWS National Hurricane Center Miami FL
500 AM PDT Tue Jun 23 2026

For the eastern North Pacific east of 140 degrees west longitude:

Central East Pacific:
An area of low pressure is expected to form late this week several
hundred miles offshore of the coast of southwestern Mexico.
* Formation chance through 48 hours...low...10 percent.
* Formation chance through 7 days...medium...50 percent.
`);
    const d = t.disturbances[0];
    return d && d.invest === null && d.lat === 17.0 && d.lon === -102.0; })());

// --- invest alerter, East Pacific (both-basin support) -------------------------
// The alerter now polls TWOAT + TWOEP and keeps per-basin state. Reuse the EP
// fixture above: EP96 fires a headline new-invest stamped basin 'EP' with
// East-Pacific-labelled copy; CP91 must NOT get the headline invest treatment.
const epPrime = { productId: 'ep-0', disturbances: [] };
const epCur = ALERTS.stateFromTWO(eptwo, 'ep-1');
ok('alerts EP: EP96 invest key captured', epCur.disturbances[0].key === 'EP96');
ok('alerts EP: new EP invest fires, stamped basin EP', (() => {
  const inv = ALERTS.diffAlerts(epPrime, epCur, 'EP').find((x) => x.type === 'new-invest');
  return !!inv && inv.d.invest === 'EP96' && inv.basin === 'EP';
})());
ok('alerts EP: CP91 is not treated as a headline invest',
  !ALERTS.diffAlerts(epPrime, epCur, 'EP').some((x) => x.type === 'new-invest' && x.d.invest === 'CP91'));
ok('alerts EP: formatAlert labels East Pacific; Atlantic stays the default', (() => {
  const ep = ALERTS.formatAlert({ type: 'new-area', basin: 'EP', d: { pct7: 30, where: null } });
  const at = ALERTS.formatAlert({ type: 'new-area', d: { pct7: 20, where: null } });
  return /East Pacific/.test(ep.title) && /East Pacific/.test(ep.body) && /New Atlantic/.test(at.title);
})());
ok('alerts: loadBasinStates migrates an old flat state into AT, EP cold-starts', (() => {
  const flat = { productId: 'old-1', disturbances: [{ key: 'AL92' }] };
  const m = ALERTS.loadBasinStates(flat);
  const shaped = ALERTS.loadBasinStates({ AT: flat, EP: { productId: 'ep-9', disturbances: [] } });
  return m.AT === flat && m.EP === null && shaped.AT === flat && shaped.EP.productId === 'ep-9';
})());

// --- ITCZ vs monsoon trough vs surface trough ----------------------------------
// Three different features. The product names each in the sentence that
// positions it, so the classification is read, never guessed. Prose below is
// verbatim from the live TWDEP of 2026-07-14.
const TROUGH_TXT = 'TWDEP\n\n...INTERTROPICAL CONVERGENCE ZONE/MONSOON TROUGH...\n\n' +
  'The monsoon trough extends from 11N74.5W to 10N83W to 08N88W. ' +
  'Segments of the ITCZ are from 07.5N90W to 10N103.5W, then from ' +
  '10.5N110.5W to 06.5N125W to 09.5N130W, then from 13.5N136W to 10.5N140W.\n\n' +
  '...OFFSHORE WATERS...\n\n' +
  'A surface trough is analyzed from 17N127W to 10N126.5W.';
const tk = P.parse(TROUGH_TXT).troughs;
ok('trough: monsoon trough classified from its own sentence',
  tk.filter((t) => t.subtype === 'monsoon').length === 1);
ok('trough: every ITCZ segment in the "then from ..." chain is tagged itcz',
  tk.filter((t) => t.subtype === 'itcz').length === 3);
ok('trough: a plain surface trough is not swept into the ITCZ',
  tk.filter((t) => t.subtype === 'trough').length === 1);
ok('trough: subtypes carry the right geometry (monsoon starts at 11N 74.5W)',
  (() => { const m = tk.find((t) => t.subtype === 'monsoon');
    return m.line[0].lat === 11 && m.line[0].lon === -74.5; })());
// a sentence naming BOTH must still tag each polyline by its nearest cue
ok('trough: one sentence naming both tags each segment by the nearest cue',
  (() => {
    const r = P.parse('TWDAT\n\n...ITCZ...\n\nThe monsoon trough runs from 10N20W to 09N30W, ' +
      'while the ITCZ continues from 08N40W to 07N50W.');
    return r.troughs.length === 2 && r.troughs[0].subtype === 'monsoon' && r.troughs[1].subtype === 'itcz';
  })());

// --- a cyclone must be REAL (no fabricated storms) ------------------------------
// NHC discusses storms that don't exist yet ("a tropical depression OR tropical
// storm IS expected to form"). The classification match used to swallow the next
// word as the name and plot "Tropical Depression Or" at a nearby coordinate —
// a named storm that does not exist. These pin the guards. Verbatim prose from
// TWDEP 2026-07-14 (the products that shipped the bug) leads the list.

// Every genesis phrasing must yield ZERO cyclones.
[
  ['live "or" phrasing (the phantom "Or")',
    'Environmental conditions are favorable for continued development, and a tropical depression or tropical storm is expected to form later today or tonight while the system moves west-northwestward.'],
  ['live "is expected" phrasing (the phantom "Is")',
    'A tropical depression is expected to form over the next couple of days while the system moves generally westward.'],
  ['"could form" phrasing',
    'A tropical depression could form by the end of the weekend while it moves west-northwestward.'],
  ['ALL-CAPS archive genesis',
    'A TROPICAL DEPRESSION IS EXPECTED TO FORM DURING THE NEXT DAY OR SO WHILE THE SYSTEM MOVES WESTWARD.'],
].forEach(([label, prose]) => {
  const r = P.parse('TWDAT\n\n...SPECIAL FEATURES...\n\nA 1007 mb low is near 14.5N 106W. ' + prose);
  ok('cyclone: genesis forecast is NOT a cyclone — ' + label, r.cyclones.length === 0);
});

// ...but the analyzed low in that same paragraph still earns an honest fix,
// rather than vanishing along with the phantom.
ok('cyclone: cyclone-less SPECIAL FEATURES still fixes the stated center',
  (() => {
    const r = P.parse('TWDAT\n\n...SPECIAL FEATURES...\n\nA 1007 mb low pressure circulation ' +
      'has developed near 14.5N 106W. A tropical depression is expected to form later today.');
    return r.cyclones.length === 0 && r.fixes.length === 1 &&
      r.fixes[0].lat === 14.5 && r.fixes[0].lon === -106 && r.fixes[0].inferred === false;
  })());

// Real storms must survive every guard.
[
  ['mixed-case', 'Tropical Storm Otis is centered near 14.8N 99.1W, moving north at 8 kt.', 'Tropical Storm', 'Otis'],
  ['ALL-CAPS archive', 'HURRICANE LEE IS CENTERED NEAR 25.0N 65.0W. MAXIMUM SUSTAINED WINDS ARE 105 KT.', 'Hurricane', 'Lee'],
  ['spelled-number TD', 'Tropical Depression Ten is centered near 25.0N 85.0W.', 'Tropical Depression', 'Ten'],
  ['post-tropical (hyphen)', 'Post-Tropical Cyclone Lee is centered near 45.0N 67.0W.', 'Post-Tropical Cyclone', 'Lee'],
  ['remnants', 'Remnants of Otis are located near 17.0N 100.0W.', 'Remnants Of', 'Otis'],
  ['"landfall as a category 5 hurricane" prose',
    'Hurricane Otis made landfall in Acapulco as a category 5 hurricane with maximum sustained winds of 145 kt. Otis is centered near 16.8N 99.9W.',
    'Hurricane', 'Otis'],
].forEach(([label, prose, cls, name]) => {
  const r = P.parse('TWDAT\n\n...SPECIAL FEATURES...\n\n' + prose);
  ok('cyclone: real storm survives — ' + label,
    r.cyclones.length === 1 && r.cyclones[0].name === name && r.cyclones[0].classification === cls);
});

// The scan walks PAST a genesis mention to the real storm in the same paragraph
// (it used to stop at the first match, phantom or not).
ok('cyclone: genesis prose before a real storm yields the REAL storm',
  (() => {
    const r = P.parse('TWDAT\n\n...SPECIAL FEATURES...\n\nA tropical depression is expected to ' +
      'form later today. Elsewhere, Hurricane Lee is centered near 25.0N 65.0W.');
    return r.cyclones.length === 1 && r.cyclones[0].name === 'Lee';
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

// --- committed archive corpus (fixtures/ + fixtures/expected.json) --------------
// Real archived NHC products with pinned parser snapshots. A failing snapshot
// means parser behavior changed on real-world text: if the change is deliberate,
// regenerate with `node tools/archive-audit.js --save-fixtures` (network,
// dev-only) and review the diff; never hand-edit expected.json.

const SUM = require('./tools/corpus-summary.js');
const FIXDIR = __dirname + '/fixtures';
const EXP = JSON.parse(fs.readFileSync(FIXDIR + '/expected.json', 'utf8'));

for (const [type, summarize, parseFn] of [
  ['tcm', SUM.summarizeTCM, (t) => P.parseTCM(t)],
  ['twdat', SUM.summarizeTWDAT, (t) => P.parse(t)],
  ['twdep', SUM.summarizeTWDAT, (t) => P.parse(t)],
  ['twoat', SUM.summarizeTWO, (t) => P.parseTWO(t)],
  ['twoep', SUM.summarizeTWO, (t) => P.parseTWO(t)],
]) {
  for (const [file, want] of Object.entries(EXP[type] || {})) {
    const txt = fs.readFileSync(FIXDIR + '/' + file, 'utf8');
    // CRLF would silently change parse results; .gitattributes pins these to LF,
    // and this assertion turns a misconfigured checkout into one loud failure.
    ok('corpus ' + file + ': LF only (see .gitattributes)', !/\r/.test(txt));
    const got = summarize(parseFn(txt));
    const same = JSON.stringify(got) === JSON.stringify(want.snap);
    ok('corpus ' + file + ': snapshot (' + want.covers + ')', same);
    if (!same) {
      console.log('       want ' + JSON.stringify(want.snap));
      console.log('       got  ' + JSON.stringify(got));
    }
  }
}

ok('corpus: every fixtures/*.txt has expectations',
  fs.readdirSync(FIXDIR)
    .filter((f) => f.endsWith('.txt'))
    .every((f) => EXP.tcm[f] || EXP.twdat[f] || EXP.twdep[f] || EXP.twoat[f] || EXP.twoep[f]));

// --- archive derived-data shape (Track C M1) ------------------------------------
// tools/derive-summary.js is the shared writer/checker shape module (like
// corpus-summary.js): archive-sync.js --derive WRITES archive/derived/ with it,
// and these checks validate the committed records against the same module. The
// pure-helper units always run; the data-dependent block is GUARDED on archive/
// existing, so the suite stays green on the tool-only commit before the backfill
// lands in the same PR (then the backfill makes the cross-checks bite).

const NTA = require('./tools/nhc-text-archive.js');
const SYNC = require('./tools/archive-sync.js');
const DER = require('./tools/derive-summary.js');

// listingNames: a real listing repeats each name (link text + href) and carries
// out-of-pattern hrefs; the helper must dedupe, type-filter, and sort.
{
  const html = '<a href="TWDAT.202606011800.txt">TWDAT.202606011800.txt</a> ' +
    '<a href="TWDAT.202606010600.txt">TWDAT.202606010600.txt</a> ' +
    'TWDAT.notastamp.txt TWDEP.202606011200.txt';
  const names = NTA.listingNames(html, 'TWDAT');
  ok('listingNames: unique + sorted, type-filtered',
    names.length === 2 && names[0] === 'TWDAT.202606010600.txt' && names[1] === 'TWDAT.202606011800.txt');
  ok('listingNames: drops other types and malformed stamps',
    !names.some((n) => /TWDEP|notastamp/.test(n)));
}

// stampOf / stampDate: filename -> 12-digit stamp -> UTC Date.
ok('stampOf: pulls the 12-digit stamp', NTA.stampOf('TWDAT.202607141800.txt') === '202607141800');
ok('stampOf: null when there is no stamp', NTA.stampOf('README.md') === null);
{
  const d = NTA.stampDate('202607141800');
  ok('stampDate: UTC Y/M/D/H/M', d && d.getTime() === Date.UTC(2026, 6, 14, 18, 0));
  ok('stampDate: null on malformed / impossible date',
    NTA.stampDate('nope') === null && NTA.stampDate('202602300000') === null);
}

// archive-sync pure helpers: type -> basin/kind, and the --since boundary.
ok('basinForType: AT/EP suffix', SYNC.basinForType('TWDAT') === 'AT' && SYNC.basinForType('TWOEP') === 'EP');
ok('kindForType: TWD/TWO prefix', SYNC.kindForType('TWDEP') === 'TWD' && SYNC.kindForType('TWOAT') === 'TWO');
{
  // boundary is inclusive of 00:00Z on the since day; the May 31 file drops.
  const names = ['TWDAT.202605312300.txt', 'TWDAT.202606010000.txt', 'TWDAT.202607010600.txt'];
  const kept = SYNC.filterSince(names, '2026-06-01');
  ok('filterSince: keeps stamps >= since 00:00Z, drops earlier',
    kept.length === 2 && !kept.includes('TWDAT.202605312300.txt') && kept.includes('TWDAT.202606010000.txt'));
}

// derive-summary over an existing fixture — pins WRITER behavior with no network.
const TWD_KEYS = ['file', 'kind', 'stamp', 'issuedISO', 'cyclones', 'waves', 'convection', 'troughs', 'fixes', 'inferred', 'projections'];
const TWO_KEYS = ['file', 'kind', 'stamp', 'issuedISO', 'disturbances'];
const ERR_KEYS = ['file', 'kind', 'stamp', 'error'];
{
  const txt = fs.readFileSync(FIXDIR + '/TWDAT.202308291005.txt', 'utf8');
  const rec = DER.summarizeTWD(P.parse(txt, { basin: 'AT' }),
    { file: 'TWDAT.202308291005.txt', kind: 'TWD', stamp: '202308291005' });
  ok('derive TWD: literal key order matches the module shape',
    JSON.stringify(Object.keys(rec)) === JSON.stringify(TWD_KEYS));
  ok('derive TWD: both hurricanes captured (Idalia + Franklin)',
    ['Idalia', 'Franklin'].every((n) => rec.cyclones.some((c) => c.name === n)));
  ok('derive TWD: cyclone records carry classification/lat/lon/windKt',
    rec.cyclones.every((c) => 'classification' in c && 'lat' in c && 'lon' in c && 'windKt' in c));
  ok('derive TWD: waves carry axis geometry + inferred flag + motion slot',
    rec.waves.every((w) => Array.isArray(w.axis) && 'inferred' in w && 'motion' in w));
  ok('derive TWD: convection/troughs recorded as counts',
    typeof rec.convection === 'number' && typeof rec.troughs === 'number');
}

// When the backfill has landed, validate every committed derived file offline.
const archiveDir = __dirname + '/archive';
if (fs.existsSync(archiveDir)) {
  const keyset = (arr) => JSON.stringify(arr.slice().sort());
  const SHAPES = [keyset(TWD_KEYS), keyset(TWO_KEYS), keyset(ERR_KEYS)];
  const RAW_RE = /^TW[DO](?:AT|EP)\.\d{12}\.txt$/;
  for (const basin of ['AT', 'EP']) {
    const jf = archiveDir + '/derived/' + SYNC.SEASON + '-' + basin + '.json';
    if (!fs.existsSync(jf)) continue; // a basin may legitimately have no products yet
    let data = null;
    try { data = JSON.parse(fs.readFileSync(jf, 'utf8')); } catch (e) { /* asserted below */ }
    ok('archive ' + basin + ': derived JSON parses', !!data);
    if (!data) continue;
    ok('archive ' + basin + ': season/basin fields match the filename',
      data.season === SYNC.SEASON && data.basin === basin);
    const recs = data.products || [];
    // records sorted by ascending stamp, ties broken by filename — the writer's
    // exact order (TWD and TWO share the dir, so equal stamps are legitimate)
    let monotone = true;
    for (let i = 1; i < recs.length; i++) {
      const a = recs[i - 1], b = recs[i];
      if (!(a.stamp < b.stamp || (a.stamp === b.stamp && a.file < b.file))) monotone = false;
    }
    ok('archive ' + basin + ': records sorted by stamp then filename', monotone);
    // every record is either a known-shape summary or an honest {file,kind,stamp,error}
    ok('archive ' + basin + ': every record matches a known shape',
      recs.every((r) => SHAPES.indexOf(keyset(Object.keys(r))) !== -1));
    // 1:1 raw-file <-> derived-record cross-check, both directions at once
    const rawDir = archiveDir + '/' + SYNC.SEASON + '/' + basin;
    const rawFiles = fs.existsSync(rawDir)
      ? fs.readdirSync(rawDir).filter((f) => RAW_RE.test(f)).sort() : [];
    const recFiles = recs.map((r) => r.file).sort();
    ok('archive ' + basin + ': one derived record per raw file (and vice versa)',
      rawFiles.length === recFiles.length && rawFiles.every((f, i) => f === recFiles[i]));
  }
}

// --- ATCF b-deck snapshots (Track C M5, data-capture slice) -----------------------
// tools/bdeck-sync.js captures NHC's working best-track files, which MUTATE in
// place (rows append each 6h; past rows get revised), so the text archive's
// skip-if-filename-exists idempotency does not apply. Instead each capture is a
// content-stamped snapshot: stamp = max DTG in the file, so re-fetching
// unchanged data is a zero diff and a recycled invest tag (90-99 reuse) starts
// new snapshot names while the old invest's snapshots persist. Pure units
// always run; the committed-data block is GUARDED on archive/{season}/atcf/
// existing, so the suite stays green on the tool-only commit before the first
// cron capture lands.

const BTK = require('./tools/bdeck-sync.js');

// btkListingNames: the Apache index repeats each name (href + link text) and
// carries a-decks, bcp* (Central Pacific, out of scope) and stray years; only
// current-season bal/bep b-decks survive, deduped and sorted.
{
  const html = '<a href="bep962026.dat">bep962026.dat</a> ' +
    '<a href="bal912026.dat">bal912026.dat</a> ' +
    '<a href="bal012026.dat">bal012026.dat</a> ' +
    '<a href="bcp012026.dat">bcp012026.dat</a> ' +
    '<a href="bal902025.dat">bal902025.dat</a> ' +
    '<a href="aal012026.dat">aal012026.dat</a>';
  const names = BTK.btkListingNames(html);
  ok('btk listing: unique + sorted, bal/bep current season only',
    JSON.stringify(names) === JSON.stringify(['bal012026.dat', 'bal912026.dat', 'bep962026.dat']));
  ok('btk listing: drops bcp (out of scope), a-decks, and other years',
    !names.some((n) => /bcp|aal|2025/.test(n)));
}

// maxDtg: field 3 of comma-separated ATCF rows, space padding tolerated,
// out-of-order rows, blank lines, and a 12-digit minute-bearing special row.
{
  const text = 'AL, 91, 2026071800,   , BEST,   0, 111N,  455W,  25, 1009, DB\n' +
    '\n' +
    'AL, 91, 2026071812,   , BEST,   0, 115N,  470W,  30, 1007, DB\n' +
    'AL, 91, 2026071806,   , BEST,   0, 113N,  462W,  30, 1008, DB\n';
  ok('btk maxDtg: max of out-of-order 10-digit DTGs, padded to 12',
    BTK.maxDtg(text) === '202607181200');
  ok('btk maxDtg: a minute-bearing 12-digit special row can be the max',
    BTK.maxDtg(text + 'AL, 91, 202607181430,   , BEST,   0, 116N,  472W,  35, 1005, DB\n') === '202607181430');
  ok('btk maxDtg: null on empty / DTG-less text (never an invented stamp)',
    BTK.maxDtg('') === null && BTK.maxDtg('no commas here\nstill none\n') === null);
}

ok('btk snapshotName: stamp inserted before .dat',
  BTK.snapshotName('bal912026.dat', '202607180000') === 'bal912026.202607180000.dat');

// writeAction: the three-way snapshot decision — absent -> write, identical ->
// skip (zero diff on re-fetch), different bytes at the same stamp -> overwrite
// (in-place revision; git history keeps the prior state).
ok('btk writeAction: absent -> write', BTK.writeAction(null, 'abc') === 'write');
ok('btk writeAction: identical -> skip', BTK.writeAction('abc', 'abc') === 'skip');
ok('btk writeAction: revised -> overwrite', BTK.writeAction('abc', 'abd') === 'overwrite');

// invest recycling: the same source filename in two DTG eras (June invest,
// tag recycled in September) yields distinct snapshot names — the old
// invest's capture is preserved by construction, never overwritten.
{
  const june = 'AL, 91, 2026061512,   , BEST,   0, 100N,  400W,  25, 1009, DB\n';
  const sept = 'AL, 91, 2026090300,   , BEST,   0, 120N,  300W,  20, 1010, DB\n';
  ok('btk recycling: two DTG eras of one tag -> two distinct snapshots',
    BTK.snapshotName('bal912026.dat', BTK.maxDtg(june)) !== BTK.snapshotName('bal912026.dat', BTK.maxDtg(sept)));
}

// When captures have landed, validate every committed snapshot offline.
{
  const atcfDir = __dirname + '/archive/' + BTK.SEASON + '/atcf';
  if (fs.existsSync(atcfDir)) {
    const snaps = fs.readdirSync(atcfDir);
    const SNAP_RE = new RegExp('^b(al|ep)\\d{2}' + BTK.SEASON + '\\.\\d{12}\\.dat$');
    ok('btk archive: every snapshot name matches b(al|ep)NN' + BTK.SEASON + '.STAMP.dat',
      snaps.every((f) => SNAP_RE.test(f)));
    ok('btk archive: snapshots are LF-only and non-empty, and each filename ' +
      'stamp equals the content max DTG (the writer invariant)',
      snaps.every((f) => {
        const text = fs.readFileSync(atcfDir + '/' + f, 'utf8');
        return text.length > 0 && !/\r/.test(text) &&
          f === BTK.snapshotName(f.replace(/\.\d{12}\.dat$/, '.dat'), BTK.maxDtg(text));
      }));
  }
}

// --- lineage engine (Track C M2) ------------------------------------------------
// tools/build-lineage.js composes diff.js's adjacent-issuance pairing across the
// whole season archive into wave/invest/cyclone chains + genesis links. The
// credibility rule is absolute — prefer broken chains over invented links — so
// EVERY join rule gets a negative test alongside its positive. Synthetic units
// drive the pure exports on parse-shaped objects; the real-corpus block is
// GUARDED on archive/derived/lineage-2026.json existing (the build runs after
// this tool commit, in the same PR), and asserts growth-proof INVARIANTS (not
// counts — the 6-hourly cron grows the archive) plus one immutable-history pin.

const LIN = require('./tools/build-lineage.js');

// product-record builders — the { stamp, file, parsed } shape the streams hold.
const twdProd = (stamp, waves, cyclones) =>
  ({ stamp, file: 'TWDAT.' + stamp + '.txt', parsed: { waves: waves || [], cyclones: cyclones || [] } });
const twoProd = (stamp, disturbances) =>
  ({ stamp, file: 'TWOAT.' + stamp + '.txt', parsed: { disturbances: disturbances || [] } });
const waveF = (lon) => ({ axis: [{ lat: 8, lon }, { lat: 16, lon }] });
const distF = (invest, lat, lon) => ({ invest, lat, lon, chance48: null, chance7: invest ? { cat: 'low', pct: 20 } : null });
const cycF = (name, lat, lon) => ({ name, classification: 'Tropical Storm', lat, lon, windKt: 40 });

// rule: wave pairing within diff.js's 6° gate holds; beyond it breaks.
{
  const near = LIN.chainWaves([twdProd('202606010000', [waveF(-40)]), twdProd('202606010600', [waveF(-43)])], 'AT');
  ok('lineage wave: within 6° is one chain, second sighting linked "axis"',
    near.length === 1 && near[0].sightings.length === 2 && near[0].sightings[1].link === 'axis');
  ok('lineage wave: chain id is <basin>-W-<firstStamp>-n', near[0].id === 'AT-W-202606010000-1');
  const far = LIN.chainWaves([twdProd('202606010000', [waveF(-40)]), twdProd('202606010600', [waveF(-50)])], 'AT');
  ok('lineage wave: beyond 6° does NOT chain (two chains, no invented link)', far.length === 2);
}

// rule: wave drift east > 2° breaks the chain; jitter ≤ 2° holds.
{
  const jitter = LIN.chainWaves([twdProd('202606010000', [waveF(-40)]), twdProd('202606010600', [waveF(-39)])], 'AT');
  ok('lineage wave: 1° eastward jitter (re-analysis) stays one chain', jitter.length === 1);
  const east = LIN.chainWaves([twdProd('202606010000', [waveF(-40)]), twdProd('202606010600', [waveF(-37)])], 'AT');
  ok('lineage wave: 3° eastward drift breaks (waves go west) — two chains', east.length === 2);
  ok('lineage wave: waveDriftReject fires >2° east, not ≤2°',
    LIN.waveDriftReject([{ lat: 10, lon: -40 }], [{ lat: 10, lon: -37 }]) === true &&
    LIN.waveDriftReject([{ lat: 10, lon: -40 }], [{ lat: 10, lon: -38.5 }]) === false);
}

// rule: time-gap guard — ≤18h holds, >18h closes all chains at the gap.
{
  const held = LIN.chainWaves([twdProd('202606010000', [waveF(-40)]), twdProd('202606011200', [waveF(-40)])], 'AT');
  ok('lineage gap: 12h gap keeps the chain', held.length === 1 && held[0].sightings.length === 2);
  const broke = LIN.chainWaves([twdProd('202606010000', [waveF(-40)]), twdProd('202606012000', [waveF(-40)])], 'AT');
  ok('lineage gap: 20h gap breaks the chain (no pairing across it)', broke.length === 2);
  ok('lineage gap: gapExceeded is the 18h boundary',
    LIN.gapExceeded('202606010000', '202606012000') === true &&
    LIN.gapExceeded('202606010000', '202606011200') === false);
}

// rule: invest tag identity beats proximity across a big move; different tags
// never merge; an untagged→tagged proximity merge (the AL90 pattern) works.
{
  const move = LIN.chainInvests([twoProd('202606010000', [distF('AL92', 15, -45)]), twoProd('202606010600', [distF('AL92', 16, -50)])], 'AT');
  ok('lineage invest: same tag chains across a 5° move, link "tag"',
    move.length === 1 && move[0].tag === 'AL92' && move[0].sightings[1].link === 'tag');
  const diff2 = LIN.chainInvests([twoProd('202606010000', [distF('AL92', 15, -45)]), twoProd('202606010600', [distF('AL93', 15, -45)])], 'AT');
  ok('lineage invest: two DIFFERENT tags never merge (two chains)', diff2.length === 2);
  const al90 = LIN.chainInvests([
    twoProd('202606010000', [distF(null, 15, -45)]),
    twoProd('202606010600', [distF('AL90', 15, -45)]),
    twoProd('202606011200', [distF('AL90', 15, -46)]),
  ], 'AT');
  ok('lineage invest: untagged→tagged proximity then tag (AL90 pattern)',
    al90.length === 1 && al90[0].tag === 'AL90' &&
    JSON.stringify(al90[0].sightings.map((s) => s.link)) === JSON.stringify([null, 'proximity', 'tag']));
  // a different tag can't be dragged in through an untagged bridge either
  const bridge = LIN.chainInvests([
    twoProd('202606010000', [distF('AL90', 15, -45)]),
    twoProd('202606010600', [distF(null, 15, -45)]),
    twoProd('202606011200', [distF('AL91', 15, -45)]),
  ], 'AT');
  ok('lineage invest: an untagged bridge cannot merge AL90 with AL91 (two chains)',
    bridge.length === 2 && bridge.every((c) => c.sightings.every(() => true)));
}

// rule: a null-position sighting joins nothing by proximity, but a tag extends it.
{
  const nulls = LIN.chainInvests([twoProd('202606010000', [distF(null, null, null)]), twoProd('202606010600', [distF(null, null, null)])], 'AT');
  ok('lineage invest: untagged null-position sightings join nothing (two chains)', nulls.length === 2);
  const byTag = LIN.chainInvests([twoProd('202606010000', [distF('AL90', 15, -45)]), twoProd('202606010600', [distF('AL90', null, null)])], 'AT');
  ok('lineage invest: a null-position sighting still extends by tag match',
    byTag.length === 1 && byTag[0].sightings.length === 2 && byTag[0].sightings[1].link === 'tag');
}

// rule: cyclone chains by name identity, classification change within a chain.
{
  const cyc = LIN.chainCyclones([
    twdProd('202606010000', [], [cycF('Alberto', 20, -60)]),
    twdProd('202606010600', [], [{ name: 'Alberto', classification: 'Hurricane', lat: 21, lon: -62, windKt: 70 }]),
  ], 'AT');
  ok('lineage cyclone: name identity holds through a TS→H reclassification',
    cyc.length === 1 && cyc[0].name === 'Alberto' && cyc[0].sightings[1].link === 'name' &&
    cyc[0].sightings[1].classification === 'Hurricane');
  const renamed = LIN.chainCyclones([twdProd('202606010000', [], [cycF('Alberto', 20, -60)]), twdProd('202606010600', [], [cycF('Beryl', 20, -60)])], 'AT');
  ok('lineage cyclone: a different name is a different storm (two chains)', renamed.length === 2);
}

// rule: wave→invest genesis link fires within gates; no link on lon>4° or ambiguity.
{
  const waves = LIN.chainWaves([twdProd('202606010000', [waveF(-44)])], 'AT');
  const invNear = LIN.chainInvests([twoProd('202606011200', [distF('AL90', 12, -45)])], 'AT');
  const gNear = LIN.linkGenesis('AT', { waves, invests: invNear, cyclones: [] });
  ok('lineage genesis: wave→invest fires within lon/lat/time gates, confidence inferred-genesis',
    gNear.length === 1 && gNear[0].kind === 'wave-invest' && gNear[0].from === waves[0].id &&
    gNear[0].to === invNear[0].id && gNear[0].confidence === 'inferred-genesis');
  const invFar = LIN.chainInvests([twoProd('202606011200', [distF('AL90', 12, -52)])], 'AT');
  ok('lineage genesis: no wave→invest link when lon is >4° off', LIN.linkGenesis('AT', { waves, invests: invFar, cyclones: [] }).length === 0);
  const twoWaves = LIN.chainWaves([twdProd('202606010000', [waveF(-44)])], 'AT')
    .concat(LIN.chainWaves([twdProd('202606010000', [waveF(-45)])], 'AT'));
  ok('lineage genesis: two waves within 2° → ambiguous → no link',
    LIN.linkGenesis('AT', { waves: twoWaves, invests: invNear, cyclones: [] }).length === 0);
}

// rule: invest→cyclone genesis link fires; no link beyond 3° or 36h; ambiguity kills it.
{
  const inv = LIN.chainInvests([twoProd('202606010000', [distF('AL90', 14, -45)])], 'AT');
  const cycNear = LIN.chainCyclones([twdProd('202606011200', [], [cycF('Alberto', 15, -46)])], 'AT');
  const g = LIN.linkGenesis('AT', { waves: [], invests: inv, cyclones: cycNear });
  ok('lineage genesis: invest→cyclone fires within 3°/36h',
    g.length === 1 && g[0].kind === 'invest-cyclone' && g[0].from === inv[0].id && g[0].to === cycNear[0].id);
  const cycFar = LIN.chainCyclones([twdProd('202606011200', [], [cycF('Alberto', 20, -50)])], 'AT');
  ok('lineage genesis: no invest→cyclone link beyond 3°', LIN.linkGenesis('AT', { waves: [], invests: inv, cyclones: cycFar }).length === 0);
  const cycLate = LIN.chainCyclones([twdProd('202606030000', [], [cycF('Alberto', 15, -46)])], 'AT');
  ok('lineage genesis: no invest→cyclone link beyond 36h', LIN.linkGenesis('AT', { waves: [], invests: inv, cyclones: cycLate }).length === 0);
  const twoInv = LIN.chainInvests([twoProd('202606010000', [distF('AL90', 14, -45)])], 'AT')
    .concat(LIN.chainInvests([twoProd('202606010000', [distF('AL91', 15, -46)])], 'AT'));
  ok('lineage genesis: two qualifying invests → ambiguous → no link',
    LIN.linkGenesis('AT', { waves: [], invests: twoInv, cyclones: cycNear }).length === 0);
}

// rule (symmetric ambiguity, the June 21 EP lesson): one SOURCE may claim at
// most one target. Gazetteer coarseness can stack two same-product areas on
// one anchor; a wave linking to both would invent a lineage for a system NHC
// only forecast. Comparable candidates (within 2°) → link neither.
{
  // one wave, two invest chains opening at the same stamp + same anchor
  const waves = LIN.chainWaves([twdProd('202606010000', [waveF(-44)])], 'AT');
  const twins = LIN.chainInvests([twoProd('202606011200',
    [distF('AL90', 12, -45), distF('AL91', 12, -45)])], 'AT');
  ok('lineage genesis: one wave, two same-anchor invests → links NEITHER',
    LIN.linkGenesis('AT', { waves, invests: twins, cyclones: [] }).length === 0);
  // clear margin (dist 1 vs 3.5, margin > 2) → exactly one link, to the nearer
  const spread = LIN.chainInvests([twoProd('202606011200',
    [distF('AL90', 12, -45), distF('AL91', 12, -47.5)])], 'AT');
  const g = LIN.linkGenesis('AT', { waves, invests: spread, cyclones: [] });
  ok('lineage genesis: one wave, two invests with clear margin → only the nearer links',
    g.length === 1 && g[0].to === spread.find((c) => c.tag === 'AL90').id);
  // one invest, two cyclones both qualifying at identical distance
  const inv = LIN.chainInvests([twoProd('202606010000', [distF('AL90', 14, -45)])], 'AT');
  const twinCycs = LIN.chainCyclones([twdProd('202606011200', [],
    [cycF('Alberto', 15, -46), cycF('Beryl', 15, -46)])], 'AT');
  ok('lineage genesis: one invest, two equidistant cyclones → links NEITHER',
    LIN.linkGenesis('AT', { waves: [], invests: inv, cyclones: twinCycs }).length === 0);
  // clear margin (dist 0.5 vs ~2.83) → only the nearer cyclone links
  const spreadCycs = LIN.chainCyclones([twdProd('202606011200', [],
    [cycF('Alberto', 14, -45.5), cycF('Beryl', 16, -47)])], 'AT');
  const gc = LIN.linkGenesis('AT', { waves: [], invests: inv, cyclones: spreadCycs });
  ok('lineage genesis: one invest, two cyclones with clear margin → only the nearer links',
    gc.length === 1 && gc[0].to === spreadCycs.find((c) => c.name === 'Alberto').id);
}

// determinism: the pure builders are order-stable — rebuild == build.
{
  const seq = [twdProd('202606010000', [waveF(-40)]), twdProd('202606010600', [waveF(-43)]), twdProd('202606011200', [waveF(-46)])];
  ok('lineage determinism: rebuilding the same stream is byte-identical',
    JSON.stringify(LIN.chainWaves(seq, 'AT')) === JSON.stringify(LIN.chainWaves(seq, 'AT')));
}

// Real-corpus INVARIANTS over the committed lineage JSON — guarded on existence
// (the main loop builds it after this tool commit, in the same PR). Growth-proof:
// invariants + one immutable-history pin, never counts.
{
  const lf = __dirname + '/archive/derived/lineage-' + LIN.SEASON + '.json';
  if (fs.existsSync(lf)) {
    let lin = null;
    try { lin = JSON.parse(fs.readFileSync(lf, 'utf8')); } catch (e) { /* asserted below */ }
    ok('lineage corpus: JSON parses', !!lin);
    if (lin) {
      ok('lineage corpus: season + AT/EP basins present',
        lin.season === LIN.SEASON && lin.basins && lin.basins.AT && lin.basins.EP);
      let filesOk = true, sortedOk = true, tagOk = true, genesisOk = true;
      let al90 = false;
      for (const basin of ['AT', 'EP']) {
        const b = lin.basins[basin];
        const rawDir = __dirname + '/archive/' + LIN.SEASON + '/' + basin + '/';
        const waveIds = {}, investIds = {}, cycloneIds = {};
        (b.waves || []).forEach((c) => { waveIds[c.id] = 1; });
        (b.invests || []).forEach((c) => { investIds[c.id] = 1; });
        (b.cyclones || []).forEach((c) => { cycloneIds[c.id] = 1; });
        const allChains = [].concat(b.waves || [], b.invests || [], b.cyclones || []);
        for (const c of allChains) {
          for (let i = 0; i < c.sightings.length; i++) {
            if (!fs.existsSync(rawDir + c.sightings[i].file)) filesOk = false;
            if (i > 0 && !(c.sightings[i - 1].stamp < c.sightings[i].stamp)) sortedOk = false; // strictly increasing
          }
        }
        // an invest chain carries a single tag (string or null) — the tag field IS the identity
        for (const c of (b.invests || [])) {
          if (!(c.tag === null || typeof c.tag === 'string')) tagOk = false;
          if (basin === 'AT' && c.tag === 'AL90' && c.sightings[0].stamp <= '202606151151') al90 = true;
        }
        // genesis links reference existing chain ids of the correct kinds
        for (const g of (b.genesis || [])) {
          if (g.kind === 'wave-invest') { if (!waveIds[g.from] || !investIds[g.to]) genesisOk = false; }
          else if (g.kind === 'invest-cyclone') { if (!investIds[g.from] || !cycloneIds[g.to]) genesisOk = false; }
          else genesisOk = false;
        }
      }
      ok('lineage corpus: every sighting file exists in the raw archive', filesOk);
      ok('lineage corpus: sightings strictly increase in stamp within a chain', sortedOk);
      ok('lineage corpus: every invest chain has a single tag identity', tagOk);
      ok('lineage corpus: genesis links reference real chain ids of the right kinds', genesisOk);
      ok('lineage corpus: AL90 chain exists (AT) with earliest sighting ≤ 202606151151', al90);
    }
  }
}

// --- genesis truth ledger (Track C M4) ------------------------------------------
// tools/build-genesis-ledger.js turns lineage chains into per-statement 48h/7d
// verdicts + season calibration. The honesty rule extends to outcomes: formed
// REQUIRES a lineage genesis link; an unattributed cyclone nearby makes the
// window unresolved (never a claimed not-formed); open windows are pending,
// never guessed. Synthetic units drive the pure exports on lineage-shaped
// objects; the corpus block is guarded on genesis-2026.json existing and
// asserts growth-proof invariants plus two immutable-history pins.

const GL = require('./tools/build-genesis-ledger.js');

// lineage-shaped builders (mirror the real JSON, not the parser shapes)
const gSight = (stamp, c48, c7, lat, lon, tagged) => ({
  stamp, file: 'TWOAT.' + stamp + '.txt',
  lat: lat === undefined ? 15 : lat, lon: lon === undefined ? -45 : lon,
  chance48: c48 || null, chance7: c7 || null, tagged: !!tagged, link: null,
});
const gInv = (id, tag, sightings) => ({ id, tag, sightings });
const gCyc = (id, name, stamp, lat, lon) => ({
  id, name,
  sightings: [{ stamp, file: 'TWDAT.' + stamp + '.txt', lat, lon, classification: 'Tropical Depression', windKt: 30, link: null }],
});
const gLin = (invests, cyclones, genesis) =>
  ({ season: 2026, basins: { AT: { waves: [], invests, cyclones: cyclones || [], genesis: genesis || [] } } });
const gColl = (lin) => lin.basins.AT;
const LO = { cat: 'low', pct: 20 }, MED = { cat: 'medium', pct: 50 };
const FUTURE = '202609010000'; // "now" far past every synthetic window

// rule: formed requires a genesis link inside the window — and gets it.
{
  const inv = gInv('AT-I-A-1', 'AL95', [gSight('202606010000', LO, LO)]);
  const lin = gLin([inv], [gCyc('AT-C-B-1', 'One', '202606020000', 15, -45)],
    [{ kind: 'invest-cyclone', from: 'AT-I-A-1', to: 'AT-C-B-1', atStamp: '202606020000', confidence: 'inferred-genesis' }]);
  const r = GL.ledgerRecord(inv, gColl(lin), FUTURE);
  ok('ledger verdict: genesis link within 48h → formed on both horizons',
    r.outcome.kind === 'formed' && r.statements[0].verdict48 === 'formed' && r.statements[0].verdict7 === 'formed');
}

// rule: formed-late is honest verification — 48h missed, 7d verified.
{
  const inv = gInv('AT-I-A-1', 'AL95', [gSight('202606010000', LO, MED)]);
  const lin = gLin([inv], [gCyc('AT-C-B-1', 'One', '202606031200', 15, -45)], // +60h
    [{ kind: 'invest-cyclone', from: 'AT-I-A-1', to: 'AT-C-B-1', atStamp: '202606031200', confidence: 'inferred-genesis' }]);
  const r = GL.ledgerRecord(inv, gColl(lin), FUTURE);
  ok('ledger verdict: genesis at ~60h → 48h not-formed, 7d formed (formed-late is honest)',
    r.statements[0].verdict48 === 'not-formed' && r.statements[0].verdict7 === 'formed');
}

// rule: a window past nowStamp is pending — never guessed.
{
  const inv = gInv('AT-I-A-1', null, [gSight('202606010000', LO, LO)]);
  const r = GL.ledgerRecord(inv, gColl(gLin([inv])), '202606010600'); // now = T+6h
  ok('ledger verdict: window past nowStamp → pending, never guessed',
    r.statements[0].verdict48 === 'pending' && r.statements[0].verdict7 === 'pending' && r.outcome.kind === 'open');
}

// rule: window closed, no link, clear air → not-formed.
{
  const inv = gInv('AT-I-A-1', 'AL95', [gSight('202606010000', LO, LO)]);
  const r = GL.ledgerRecord(inv, gColl(gLin([inv])), FUTURE);
  ok('ledger verdict: chain ended, window closed, clear air → not-formed',
    r.outcome.kind === 'no-cyclone' && r.statements[0].verdict48 === 'not-formed' && r.statements[0].verdict7 === 'not-formed');
}

// rule: an UNATTRIBUTED cyclone opening nearby in-window shadows the verdict —
// unresolved, and never formed without a link (both directions refused).
{
  const inv = gInv('AT-I-A-1', 'AL95', [gSight('202606010000', LO, LO)]);
  const lin = gLin([inv], [gCyc('AT-C-B-1', 'One', '202606020000', 18, -48)]); // 24h later, ~5.8° — no link
  const r = GL.ledgerRecord(inv, gColl(lin), FUTURE);
  ok('ledger verdict: unattributed cyclone nearby in-window → unresolved (nothing invented)',
    r.outcome.kind === 'unresolved-nearby-cyclone' &&
    r.statements[0].verdict48 === 'unresolved' && r.statements[0].verdict7 === 'unresolved');
  ok('ledger verdict: formed NEVER without an invest→cyclone genesis link',
    r.statements.every((s) => s.verdict48 !== 'formed' && s.verdict7 !== 'formed'));
}

// rule: a cyclone attributed to ANOTHER invest does not shadow this one.
{
  const a = gInv('AT-I-A-1', 'AL95', [gSight('202606010000', LO, LO)]);
  const b = gInv('AT-I-B-1', 'AL96', [gSight('202606010000', LO, LO, 18, -48)]);
  const lin = gLin([a, b], [gCyc('AT-C-C-1', 'One', '202606020000', 18, -48)],
    [{ kind: 'invest-cyclone', from: 'AT-I-B-1', to: 'AT-C-C-1', atStamp: '202606020000', confidence: 'inferred-genesis' }]);
  const r = GL.ledgerRecord(a, gColl(lin), FUTURE);
  ok('ledger verdict: cyclone attributed to another invest → this one\'s not-formed stands',
    r.outcome.kind === 'no-cyclone' && r.statements[0].verdict48 === 'not-formed');
}

// rule: beyond the 10° shadow radius is clear air; an unmeasurable distance is not.
{
  const inv = gInv('AT-I-A-1', 'AL95', [gSight('202606010000', LO, LO)]);
  const far = GL.ledgerRecord(inv, gColl(gLin([inv], [gCyc('AT-C-B-1', 'One', '202606020000', 15, -60)])), FUTURE);
  ok('ledger verdict: cyclone beyond NEAR_CYC_DEG → clear air, not-formed', far.statements[0].verdict48 === 'not-formed');
  const blind = gInv('AT-I-A-1', 'AL95', [gSight('202606010000', LO, LO, null, null)]);
  const r = GL.ledgerRecord(blind, gColl(gLin([blind], [gCyc('AT-C-B-1', 'One', '202606020000', 15, -60)])), FUTURE);
  ok('ledger verdict: no mappable sighting → cannot rule out → unresolved (never invent clear air)',
    r.statements[0].verdict48 === 'unresolved');
}

// rule: chance-less horizons carry null verdicts; chance-less sightings are not
// statements; a chain that never states a chance gets no record at all.
{
  const inv = gInv('AT-I-A-1', null, [
    gSight('202606010000', null, LO),
    gSight('202606010600', null, null),
  ]);
  const r = GL.ledgerRecord(inv, gColl(gLin([inv])), FUTURE);
  ok('ledger: chance-null horizon → null verdict; chance-null sighting → no statement',
    r.statements.length === 1 && r.statements[0].verdict48 === null && r.statements[0].verdict7 === 'not-formed');
  const none = gInv('AT-I-B-1', null, [gSight('202606010000', null, null)]);
  ok('ledger: untagged chain with chances gets a record; chance-less chain gets none',
    r.id === 'AT-I-A-1' && GL.ledgerRecord(none, gColl(gLin([none])), FUTURE) === null);
}

// rule: waveOrigin carried from the wave-invest genesis link.
{
  const inv = gInv('AT-I-A-1', 'AL95', [gSight('202606010000', LO, LO)]);
  const lin = gLin([inv], [],
    [{ kind: 'wave-invest', from: 'AT-W-X-1', to: 'AT-I-A-1', atStamp: '202606010000', confidence: 'inferred-genesis' }]);
  const r = GL.ledgerRecord(inv, gColl(lin), FUTURE);
  ok('ledger: waveOrigin carried from the wave-invest genesis link',
    r.waveOrigin && r.waveOrigin.waveId === 'AT-W-X-1' && r.waveOrigin.atStamp === '202606010000');
}

// rule: same-tag chains stay separate records, cross-referenced only.
{
  const a = gInv('AT-I-A-1', 'AL90', [gSight('202606010000', LO, LO)]);
  const b = gInv('AT-I-B-1', 'AL90', [gSight('202606050000', LO, LO)]);
  const led = GL.buildLedger(gLin([a, b]), { nowStamp: FUTURE });
  const recs = led.basins.AT.invests;
  ok('ledger: same-tag chains stay separate records, cross-referenced in siblingChains',
    recs.length === 2 && recs[0].siblingChains[0] === 'AT-I-B-1' && recs[1].siblingChains[0] === 'AT-I-A-1');
}

// rule: calibration buckets by STATED category per horizon; counts sum; a cell
// with nothing resolved reads null, never 0.
{
  const a = gInv('AT-I-A-1', null, [gSight('202606010000', LO, MED)]);      // closed, clear air
  const b = gInv('AT-I-B-1', null, [gSight('202608310000', LO, LO)]);      // windows straddle FUTURE
  const led = GL.buildLedger(gLin([a, b]), { nowStamp: FUTURE });
  const cal = led.basins.AT.calibration;
  ok('ledger calibration: buckets by stated category per horizon',
    cal.h48.low.statements === 2 && cal.d7.medium.statements === 1 && cal.d7.low.statements === 1);
  const sums = ['h48', 'd7'].every((h) => ['low', 'medium', 'high'].every((c) => {
    const cell = cal[h][c];
    return cell.statements === cell.formed + cell.notFormed + cell.unresolved + cell.pending;
  }));
  ok('ledger calibration: cell counts sum to statements', sums);
  ok('ledger calibration: observedRate null when nothing resolved (never 0/0 as 0)',
    cal.d7.low.observedRate === null && cal.d7.medium.observedRate === 0 &&
    led.calibrationTotal.h48.low.statements === 2);
}

// rule: nowStamp defaults to the max stamp across all basins; determinism.
{
  const a = gInv('AT-I-A-1', null, [gSight('202606010000', LO, LO), gSight('202607011200', LO, LO)]);
  const lin = gLin([a], [gCyc('AT-C-B-1', 'One', '202607021800', 15, -45)]);
  ok('ledger: nowStamp = max stamp across the lineage (maxStamp)',
    GL.maxStamp(lin) === '202607021800' && GL.buildLedger(lin).nowStamp === '202607021800');
  ok('ledger determinism: rebuilding the same lineage is byte-identical',
    JSON.stringify(GL.buildLedger(lin, { nowStamp: FUTURE })) === JSON.stringify(GL.buildLedger(lin, { nowStamp: FUTURE })));
}

// Real-corpus INVARIANTS over the committed ledger JSON — guarded on existence
// (built after build-lineage, in the same PR / cron run). Growth-proof:
// invariants + two immutable pins (both chains closed in June — no future
// archive growth can change them), never counts.
{
  const gf = __dirname + '/archive/derived/genesis-' + GL.SEASON + '.json';
  const lf = __dirname + '/archive/derived/lineage-' + GL.SEASON + '.json';
  if (fs.existsSync(gf) && fs.existsSync(lf)) {
    let led = null, lin = null;
    try {
      led = JSON.parse(fs.readFileSync(gf, 'utf8'));
      lin = JSON.parse(fs.readFileSync(lf, 'utf8'));
    } catch (e) { /* asserted below */ }
    ok('ledger corpus: JSON parses', !!led && !!lin);
    if (led && lin) {
      ok('ledger corpus: season + nowStamp + AT/EP present',
        led.season === GL.SEASON && typeof led.nowStamp === 'string' && led.basins.AT && led.basins.EP);
      ok('ledger corpus: nowStamp equals maxStamp(lineage)', led.nowStamp === GL.maxStamp(lin));
      let idsOk = true, stmtsOk = true, formedOk = true, sumsOk = true;
      for (const basin of ['AT', 'EP']) {
        const chains = {};
        (lin.basins[basin].invests || []).forEach((c) => { chains[c.id] = c; });
        const links = {};
        (lin.basins[basin].genesis || []).forEach((g) => { if (g.kind === 'invest-cyclone') links[g.from] = 1; });
        for (const r of led.basins[basin].invests) {
          const chain = chains[r.id];
          if (!chain) { idsOk = false; continue; }
          const bearing = chain.sightings.filter((s) => s.chance48 || s.chance7);
          if (r.statements.length !== bearing.length) stmtsOk = false;
          for (const st of r.statements) {
            if ((st.verdict48 === 'formed' || st.verdict7 === 'formed') && !links[r.id]) formedOk = false;
          }
        }
        const cal = led.basins[basin].calibration;
        for (const h of ['h48', 'd7']) {
          for (const c of ['low', 'medium', 'high']) {
            const cell = cal[h][c];
            if (cell.statements !== cell.formed + cell.notFormed + cell.unresolved + cell.pending) sumsOk = false;
          }
        }
      }
      ok('ledger corpus: every record id references a real lineage invest chain', idsOk);
      ok('ledger corpus: statements equal the chain\'s chance-bearing sightings', stmtsOk);
      ok('ledger corpus: no formed verdict without an invest-cyclone genesis link', formedOk);
      ok('ledger corpus: calibration cell counts sum to statements', sumsOk);
      // immutable pins — closed June chains; One/Arthur can never gain links
      const al90 = led.basins.AT.invests.find((r) => r.id === 'AT-I-202606131720-1');
      const al90last = al90 && al90.statements[al90.statements.length - 1];
      ok('ledger corpus: AL90 pin — final statement (202606161142) unresolved on both horizons',
        !!al90last && al90last.stamp === '202606161142' &&
        al90last.verdict48 === 'unresolved' && al90last.verdict7 === 'unresolved');
      const ep91 = led.basins.EP.invests.find((r) => r.id === 'EP-I-202606031143-2');
      ok('ledger corpus: EP91 pin — formed into EP-C-202606071546-1 at 202606071546',
        !!ep91 && ep91.outcome.kind === 'formed' &&
        ep91.outcome.cycloneId === 'EP-C-202606071546-1' && ep91.outcome.genesisStamp === '202606071546');
    }
  }
}

// --- b-deck truth overlay (Track C M6) ------------------------------------------
// tools/bdeck-truth.js cross-checks the derived record against the captured ATCF
// best tracks. The honesty rule extends one more layer: truth FLAGS, it never
// retro-fits — and "no explicit handoff evidence" means no-data, never an
// overlap-inferred link (that inference is the linker's job; truth must stay
// an independent witness). Pure units on synthetic rows; corpus block guarded.

const BT = require('./tools/bdeck-truth.js');

ok('truth parseTenths: hemisphere tenths ("235N" 23.5, "1003W" -100.3, "034S" -3.4)',
  BT.parseTenths('235N') === 23.5 && BT.parseTenths('1003W') === -100.3 &&
  BT.parseTenths('034S') === -3.4 && BT.parseTenths('') === null && BT.parseTenths('23.5') === null);

// synthetic b-deck: dual radii rows at one DTG, GENESIS/INVEST name phases, a
// truncated short row, explicit handoff tags, TD onset
const BT_SYN =
  'EP, 05, 2026071300,   , BEST,   0, 120N,  981W,  25,    0, DB,   0,    ,    0,    0,    0,    0,    0,    0,   0,   0,   0,   E,   0,    ,   0,   0,\n' +
  'EP, 05, 2026071312,   , BEST,   0, 128N, 1010W,  30, 1009, DB,   0,    ,    0,    0,    0,    0, 1010,  180, 120,   0,   0,   E,   0,    ,   0,   0, GENESIS008,  ,  0,    ,    0,    0,    0,    0, genesis-num, 008, SPAWNINVEST, ep782026 to ep962026,\n' +
  'EP, 05, 2026071418,   , BEST,   0, 147N, 1086W,  30, 1006, TD,   0,    ,    0,    0,    0,    0, 1009,  170, 130,   0,   0,   E,   0,    ,   0,   0,       FIVE, S,  0,    ,    0,    0,    0,    0, genesis-num, 008, TRANSITIONED, epA62026 to ep052026,\n' +
  'EP, 05, 2026071506,   , BEST,   0, 152N, 1109W,  35,  999, TS,  34, NEQ,   60,   60,    0,    0, 1008,  200,  40,  50,   0,   E,   0,    ,   0,   0,      ELIDA, M,  0,    ,    0,    0,    0,    0, genesis-num, 008,\n' +
  'EP, 05, 2026071506,   , BEST,   0, 152N, 1109W,  35,  999, TS,  50, NEQ,   20,   10,    0,    0, 1008,  200,  40,  50,   0,   E,   0,    ,   0,   0,      ELIDA, M,  0,    ,    0,    0,    0,    0, genesis-num, 008,\n';
{
  const p = BT.parseBdeck(BT_SYN);
  ok('truth parseBdeck: per-DTG dedupe (dual radii rows collapse), 12-digit DTGs',
    !!p && p.rows.length === 4 && p.minDtg === '202607130000' && p.maxDtg === '202607150600');
  ok('truth parseBdeck: name phases skip GENESIS###/INVEST/blank',
    p.names.length === 2 && p.names[0] === 'FIVE' && p.names[1] === 'ELIDA');
  ok('truth parseBdeck: genesis-num + handoff refs extracted (both sides of "A to B")',
    p.genesisNum === '008' && p.refs.indexOf('ep962026') >= 0 &&
    p.refs.indexOf('ep782026') >= 0 && p.refs.indexOf('ep052026') >= 0);
  ok('truth parseBdeck: first TD-or-stronger DTG is the genesis truth',
    p.firstTdDtg === '202607141800');
  ok('truth parseBdeck: truncated short row still yields a fix (no name required)',
    p.rows[0].lat === 12 && p.rows[0].lon === -98.1 && p.rows[0].name === '');
  ok('truth parseBdeck: garbage yields null', BT.parseBdeck('not atcf\n') === null);
}
ok('truth snapshotParts: base/id/stamp round-trip, malformed rejected',
  (() => { const s = BT.snapshotParts('bal012026.202606180000.dat');
    return s && s.base === 'bal012026' && s.id === 'al012026' && s.num === '01' &&
      s.stamp === '202606180000' && BT.snapshotParts('bal012026.dat') === null; })());
ok('truth liveEras: pure growth superseded, disjoint recycled eras both kept',
  (() => {
    const june = { stamp: '202606100000', minDtg: '202606010000', maxDtg: '202606100000' };
    const grow1 = { stamp: '202607010000', minDtg: '202606200000', maxDtg: '202607010000' };
    const grow2 = { stamp: '202607020000', minDtg: '202606200000', maxDtg: '202607020000' };
    const live = BT.liveEras([june, grow1, grow2]);
    return live.length === 2 && live.indexOf(june) >= 0 && live.indexOf(grow2) >= 0;
  })());

// investTruth: explicit evidence only — refs or shared genesis-num, never bare
// track overlap
{
  const rec = (tag) => ({ tag, firstStamp: '202607070500', lastStamp: '202607141152' });
  const inv = { id: 'ep962026', base: 'bep962026', basin: 'EP', num: '96', genesisNum: '008',
    refs: ['ep052026'], firstTdDtg: null, minDtg: '202607121200', maxDtg: '202607141800',
    rows: [{ dtg: '202607121200', lat: 11.6, lon: -95.4, status: 'DB', name: '' }] };
  const cyc = { id: 'ep052026', base: 'bep052026', basin: 'EP', num: '05', genesisNum: '008',
    refs: [], firstTdDtg: '202607141800', names: ['FIVE', 'ELIDA'],
    minDtg: '202607121200', maxDtg: '202607190000',
    rows: [{ dtg: '202607141800', lat: 14.7, lon: -108.6, status: 'TD', name: 'FIVE' }] };
  const t = BT.investTruth(rec('EP96'), [inv, cyc], '202607190000');
  ok('truth investTruth: shared genesis-num links invest to cyclone -> formed',
    !!t && t.kind === 'formed' && t.cycloneBdeck === 'bep052026' && t.firstTdDtg === '202607141800');
  const stripped = Object.assign({}, cyc, { genesisNum: null, refs: [] });
  const invStripped = Object.assign({}, inv, { genesisNum: null, refs: [] });
  const t2 = BT.investTruth(rec('EP96'), [invStripped, stripped], '202607190000');
  ok('truth investTruth: track overlap alone is NOT evidence — invest-only truth, no cyclone link',
    !!t2 && t2.cycloneBdeck === null && t2.kind === 'not-formed');
  const ended = Object.assign({}, invStripped, { maxDtg: '202607010000', minDtg: '202606200000' });
  const t3 = BT.investTruth({ tag: 'EP96', firstStamp: '202606210000', lastStamp: '202606280000' },
    [ended], '202607190000');
  ok('truth investTruth: invest file ended long before btkNow -> not-formed',
    !!t3 && t3.kind === 'not-formed');
  ok('truth investTruth: era mismatch (recycled tag) -> no match -> null',
    BT.investTruth({ tag: 'EP96', firstStamp: '202609010000', lastStamp: '202609050000' },
      [inv, cyc], '202609060000') === null);
  ok('truth investTruth: untagged record is un-truthable',
    BT.investTruth({ tag: null, firstStamp: '202607070500', lastStamp: '202607141152' },
      [inv, cyc], '202607190000') === null);
}
ok('truth agreementOf: the matrix honors the honesty rule',
  BT.agreementOf('unresolved-nearby-cyclone', { kind: 'formed' }) === 'resolves' &&
  BT.agreementOf('no-cyclone', { kind: 'formed' }) === 'refutes' &&
  BT.agreementOf('no-cyclone', { kind: 'not-formed' }) === 'confirms' &&
  BT.agreementOf('formed', { kind: 'formed' }) === 'confirms' &&
  BT.agreementOf('formed', { kind: 'not-formed' }) === 'refutes' &&
  BT.agreementOf('formed', null) === 'no-data' &&
  BT.agreementOf('open', { kind: 'open' }) === 'open');
{
  const formed = { kind: 'formed', firstTdDtg: '202607141800' };
  const open = { kind: 'open', firstTdDtg: null };
  ok('truth statementTruth: formed inside the window',
    BT.statementTruth('202607130500', 48, formed, '202607190000') === 'formed');
  ok('truth statementTruth: formed late — not-formed at 48h, formed at 7d',
    BT.statementTruth('202607120500', 48, formed, '202607190000') === 'not-formed' &&
    BT.statementTruth('202607120500', 168, formed, '202607190000') === 'formed');
  ok('truth statementTruth: window past btkNow -> pending, never guessed',
    BT.statementTruth('202607180500', 168, open, '202607190000') === 'pending');
  ok('truth statementTruth: live invest, closed window, no TD -> not-formed (the track would show one)',
    BT.statementTruth('202607150500', 48, open, '202607190000') === 'not-formed');
  ok('truth statementTruth: no truth -> null', BT.statementTruth('202607150500', 48, null, '202607190000') === null);
}
ok('truth truthCalibrate: observedRate null when nothing resolved (never 0/0 as 0)',
  (() => {
    const recs = [{ statements: [
      { chance48: { cat: 'high', pct: 70 }, chance7: { cat: 'high', pct: 90 }, truth48: 'formed', truth7: 'pending' },
      { chance48: { cat: 'low', pct: 10 }, chance7: null, truth48: 'not-formed', truth7: null },
    ] }];
    const cal = BT.truthCalibrate(recs);
    return cal.h48.high.observedRate === 1 && cal.h48.low.observedRate === 0 &&
      cal.d7.high.statements === 1 && cal.d7.high.observedRate === null;
  })());

// corpus block: guarded on the overlay + its inputs existing (the cron rebuilds
// the overlay every cycle; invariants + immutable-history pins only, no counts)
{
  const btFile = __dirname + '/archive/derived/bdeck-truth-' + BT.SEASON + '.json';
  const gFile = __dirname + '/archive/derived/genesis-' + BT.SEASON + '.json';
  if (fs.existsSync(btFile) && fs.existsSync(gFile)) {
    let bt = null;
    try { bt = JSON.parse(fs.readFileSync(btFile, 'utf8')); } catch (e) { /* fall through */ }
    ok('truth corpus: JSON parses', !!bt);
    if (bt) {
      const led = JSON.parse(fs.readFileSync(gFile, 'utf8'));
      const all = bt.basins.AT.invests.concat(bt.basins.EP.invests);
      ok('truth corpus: season + 12-digit btkNow + summary counts add up',
        bt.season === BT.SEASON && /^\d{12}$/.test(bt.btkNow) &&
        bt.summary.invests === all.length &&
        bt.summary.confirms + bt.summary.resolves + bt.summary.refutes +
          bt.summary.open + bt.summary.noData === all.length);
      ok('truth corpus: every record id references a real ledger record',
        ['AT', 'EP'].every((b) => bt.basins[b].invests.every((r) =>
          led.basins[b].invests.some((lr) => lr.id === r.id))));
      ok('truth corpus: agreement vocabulary is closed, and never a judgment without truth',
        all.every((r) => ['confirms', 'resolves', 'refutes', 'open', 'no-data'].indexOf(r.agreement) >= 0 &&
          (r.truth !== null || r.agreement === 'no-data')));
      ok('truth corpus: a formed truth always names its b-deck storm and TD onset',
        all.every((r) => !r.truth || r.truth.kind !== 'formed' ||
          (r.truth.cycloneBdeck && r.truth.firstTdDtg)));
      const al90 = bt.basins.AT.invests.find((r) => r.tag === 'AL90');
      ok('truth corpus: AL90 pin — b-deck truth RESOLVES the ledger\'s honest unresolved to formed into bal012026',
        !!al90 && al90.agreement === 'resolves' && al90.truth.kind === 'formed' &&
        al90.truth.cycloneBdeck === 'bal012026');
      const ep95 = bt.basins.EP.invests.find((r) => r.id === 'EP-I-202606280508-1');
      ok('truth corpus: EP95 pin — truth REFUTES the ledger\'s not-formed (EP95 became bep042026), flagged not rewritten',
        !!ep95 && ep95.agreement === 'refutes' && ep95.truth.cycloneBdeck === 'bep042026' &&
        bt.flags.some((f) => f.subject === 'EP-I-202606280508-1' && f.kind === 'truth-refutes-no-cyclone'));
    }
  }
}

// --- app version (single source, CalVer) ---------------------------------------

const VER = require('./version.js');
ok('version: CalVer format YYYY.MM.DD[.N]', /^\d{4}\.\d{2}\.\d{2}(\.\d+)?$/.test(VER));

// --- phonetics.js (storm-name respellings, NHC pronunciation guides) ------------
// Data hygiene only — the display suffix lives in app.js (not node-testable).
// The syllable check enforces the file's own convention: hyphen-joined syllables,
// each all-lowercase or ALL-UPPERCASE (uppercase = primary stress), never Title-case.

const PH = require('./phonetics.js');
ok('phonetics: AT + EP tables, full rotations (120+ names each)',
  PH && PH.AT && PH.EP &&
  Object.keys(PH.AT).length >= 120 && Object.keys(PH.EP).length >= 120);
ok('phonetics: keys are lowercase alpha',
  ['AT', 'EP'].every((b) => Object.keys(PH[b]).every((k) => /^[a-z]+$/.test(k))));
ok('phonetics: syllables all-lower or ALL-UPPER, hyphen-joined',
  ['AT', 'EP'].every((b) => Object.keys(PH[b]).every((k) =>
    /^([a-z]+|[A-Z]+)(-([a-z]+|[A-Z]+))*$/.test(PH[b][k]))));
ok('phonetics: spot checks (stressed, identity, EP)',
  PH.AT.erin === 'AIR-rin' && PH.AT.lee === 'lee' && PH.EP.xavier === 'ZAY-vee-ur');

// --- trough polyline without a "from" anchor ------------------------------------
// Verbatim from the live TWDAT of 2026-07-16: the chain regex keys on "from",
// so this monsoon trough degraded to two "near" fixes and dropped 09N34W.

const NEAR_CHAIN = 'TWDAT\n\n...MONSOON TROUGH/ITCZ...\n\n' +
  'The monsoon trough enters the Atlantic through the coast of Africa near ' +
  '21N17W and continues southwestward to a 1013 mb low pres near 12N21W to ' +
  '09N34W. Scattered moderate convection is observed near 08N30W and near 07N38W.\n\n';
const nc = P.parse(NEAR_CHAIN);
const ncMon = nc.troughs.filter((t) => t.subtype === 'monsoon');
ok('trough: near-anchored chain parses as one monsoon polyline',
  ncMon.length === 1 && ncMon[0].line.length === 3);
ok('trough: the "to 09N34W" tail vertex survives',
  ncMon.length === 1 && ncMon[0].line.some((p) => p.lat === 9 && p.lon === -34));
ok('trough: near-fixes duplicating polyline vertices are dropped',
  !nc.fixes.some((f) => (f.lat === 21 && f.lon === -17) || (f.lat === 12 && f.lon === -21)));
ok('trough: convection sentence in the same section stays out of the fallback',
  nc.troughs.length === 1);
ok('trough: non-vertex fixes in the section survive the dedup',
  nc.fixes.some((f) => f.lat === 8 && f.lon === -30));

// --- issuance diff (diff.js) ----------------------------------------------------

const D = require('./diff.js');

// real consecutive EP fixture pair (same-day issuances, both genesis-prose —
// zero pinned cyclones on either side, so any cyclone pair here is a phantom)
{
  const a = P.parse(fs.readFileSync(FIXDIR + '/TWDEP.202607140308.txt', 'utf8'));
  const b = P.parse(fs.readFileSync(FIXDIR + '/TWDEP.202607141611.txt', 'utf8'));
  const d = D.diffProducts(a, b, 'TWD');
  ok('diff: fixture pair invents no cyclones',
    d.cyclones.pairs.length === 0 && d.cyclones.added.length === 0 &&
    d.cyclones.removed.length === 0);
  ok('diff: fixture pair carries both issuance stamps', !!d.prevIssued && !!d.curIssued);
  ok('diff: wave pairing is one-to-one and accounts for every wave',
    d.waves.pairs.length + d.waves.added.length === b.waves.length &&
    d.waves.pairs.length + d.waves.removed.length === a.waves.length);
}

// synthetic TWD cases
{
  const wave = (lon) => ({ id: 'W', axis: [{ lat: 10, lon }, { lat: 16, lon }] });
  const cyc = (name, kt, lat, lon) =>
    ({ name, classification: 'Hurricane', windKt: kt, lat, lon });
  const d = D.diffProducts(
    { issued: null, waves: [wave(-40)], cyclones: [cyc('ERIN', 85, 20, -60), cyc('OLD', 40, 12, -30)] },
    { issued: null, waves: [wave(-43), wave(-70)], cyclones: [cyc('Erin', 95, 21, -62)] }, 'TWD');
  ok('diff: cyclone matched by name, case-insensitive, deltas readable',
    d.cyclones.pairs.length === 1 && d.cyclones.pairs[0].prev.windKt === 85 &&
    d.cyclones.pairs[0].cur.windKt === 95);
  ok('diff: unmatched previous cyclone lands in removed, none invented',
    d.cyclones.removed.length === 1 && d.cyclones.removed[0].name === 'OLD' &&
    d.cyclones.added.length === 0);
  ok('diff: wave within 6° pairs; the far one is added',
    d.waves.pairs.length === 1 && d.waves.added.length === 1 && d.waves.removed.length === 0);
  const far = D.diffProducts(
    { issued: null, waves: [wave(-40)], cyclones: [] },
    { issued: null, waves: [wave(-50)], cyclones: [] }, 'TWD');
  ok('diff: wave beyond the 6° threshold does NOT pair (added + removed instead)',
    far.waves.pairs.length === 0 && far.waves.added.length === 1 && far.waves.removed.length === 1);
}

// synthetic TWO cases
{
  const dist = (invest, lat, lon, p48, p7) => ({ id: 1, invest, lat, lon,
    chance48: p48 == null ? null : { pct: p48 }, chance7: p7 == null ? null : { pct: p7 } });
  const d = D.diffProducts(
    { issued: null, disturbances: [dist('AL92', 15, -45, 20, 40), dist(null, 25, -75, 10, 20)] },
    { issued: null, disturbances: [dist('AL92', 16, -50, 40, 60), dist(null, 26, -76, 10, 20), dist(null, 10, -30, 0, 10)] },
    'TWO');
  ok('diff: invest tag pairs across a 5° move (identity beats the proximity gate)',
    d.disturbances.pairs.some((p) => p.prev.invest === 'AL92' && p.cur.chance7.pct === 60));
  ok('diff: untagged disturbance pairs by proximity; the new one is added',
    d.disturbances.pairs.length === 2 && d.disturbances.added.length === 1 &&
    d.disturbances.removed.length === 0);
  const ren = D.diffProducts(
    { issued: null, disturbances: [dist('AL92', 15, -45, 20, 40)] },
    { issued: null, disturbances: [dist('AL93', 15, -45, 20, 40)] }, 'TWO');
  ok('diff: two DIFFERENT invest tags never pair (no silent rename)',
    ren.disturbances.pairs.length === 0 && ren.disturbances.added.length === 1 &&
    ren.disturbances.removed.length === 1);
}

// empty-product edges
{
  const empty = { issued: null, waves: [], cyclones: [], disturbances: [] };
  const one = { issued: null, waves: [{ id: 'W', axis: [{ lat: 10, lon: -40 }] }], cyclones: [] };
  ok('diff: everything added from an empty previous product',
    D.diffProducts(empty, one, 'TWD').waves.added.length === 1);
  ok('diff: everything removed into an empty current product',
    D.diffProducts(one, empty, 'TWD').waves.removed.length === 1);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
