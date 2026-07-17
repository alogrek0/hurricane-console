/*
 * tools/corpus-summary.js — snapshot shape for the committed archive corpus
 * (fixtures/ + fixtures/expected.json).
 *
 * Required by BOTH test.js (checker) and tools/archive-audit.js --save-fixtures
 * (writer) so the two can't drift. Both sides build the object with the same
 * literal key order, so JSON.stringify equality is a valid deep-equal — keep
 * the key order stable if you add fields, and regenerate expected.json.
 *
 * Pure functions, no fs, no network.
 */
'use strict';

// parseTCM result -> pinned snapshot (null in, null out).
function summarizeTCM(t) {
  if (!t) return null;
  return {
    classification: t.classification,
    name: t.name,
    stormId: t.stormId,
    advisory: t.advisory,
    center: { lat: t.center.lat, lon: t.center.lon },
    windKt: t.windKt,
    gustKt: t.gustKt,
    pressureMb: t.pressureMb,
    windRadiiKt: t.windRadiiNm
      ? Object.keys(t.windRadiiNm).map(Number).sort(function (a, b) { return a - b; })
      : [],
    trackPoints: t.track.length,
    postTropTrack: t.track.some(function (p) { return p.state === 'post-tropical'; }),
  };
}

// parse() (TWDAT) result -> pinned snapshot of feature counts.
function summarizeTWDAT(r) {
  if (!r) return null;
  return {
    sections: r.sections.length,
    cyclones: r.cyclones.map(function (c) { return c.classification + ' ' + c.name; }),
    waves: r.waves.length,
    convection: r.convection.length,
    troughs: r.troughs.length,
    // pins the ITCZ / monsoon / surface-trough classification against real text
    troughKinds: ['itcz', 'monsoon', 'trough'].map(function (k) {
      return k + ':' + r.troughs.filter(function (t) { return t.subtype === k; }).length;
    }).join(' '),
    fixes: r.fixes.length,
    inferred: r.inferred.length,
    projections: r.projections.length,
  };
}

// parseTWO() result -> pinned snapshot of each disturbance. Chances collapse
// to "cat:pct" strings (troughKinds style); null lat/lon stay null — an
// unmappable formation area is pinned as honestly unmapped, not resolved.
function summarizeTWO(r) {
  if (!r) return null;
  return {
    basin: r.basin,
    disturbances: r.disturbances.map(function (d) {
      return {
        invest: d.invest,
        lat: d.lat,
        lon: d.lon,
        chance48: d.chance48 ? d.chance48.cat + ':' + d.chance48.pct : null,
        chance7: d.chance7 ? d.chance7.cat + ':' + d.chance7.pct : null,
      };
    }),
  };
}

module.exports = { summarizeTCM, summarizeTWDAT, summarizeTWO };
