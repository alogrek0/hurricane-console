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
ok('basemap: layer volumes sane', layers.land.coordinates.length >= 120 &&
  layers.coast.coordinates.length >= 150 && layers.countries.coordinates.length >= 50 &&
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
    .every((f) => EXP.tcm[f] || EXP.twdat[f] || EXP.twdep[f]));

// --- app version (single source, CalVer) ---------------------------------------

const VER = require('./version.js');
ok('version: CalVer format YYYY.MM.DD[.N]', /^\d{4}\.\d{2}\.\d{2}(\.\d+)?$/.test(VER));

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
