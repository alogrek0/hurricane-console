/*
 * diff.js — Hurricane Console issuance diff. Pure logic, no Leaflet, no DOM:
 * pairs high-signal features between two PARSED products (parser.js output)
 * so the app can draw "what changed" ghosts. Runs in the browser AND node
 * (test harness), same dual pattern as parser.js.
 *
 * Deliberately diffed: cyclones (name is identity), waves (nearest mean axis
 * longitude — waves move 2-4° per 6-12h product interval), TWO disturbances
 * (invest tag is identity when both sides carry one; proximity otherwise).
 * Deliberately NOT diffed: ITCZ/monsoon polylines (quasi-stationary —
 * coordinate deltas are noise), convection boxes (ephemeral), fixes and
 * inferred dots (re-derived from scratch each product). Signal over noise.
 */
(function (root) {
  'use strict';

  var WAVE_LON_MAX = 6; // deg — beyond this, it's a different wave, not movement
  var DIST_DEG_MAX = 4; // deg — TWO disturbance proximity gate (untagged areas)

  function meanLon(axis) {
    var s = 0;
    axis.forEach(function (p) { s += p.lon; });
    return s / axis.length;
  }

  // Greedy nearest-first one-to-one pairing. distFn returns null to forbid a
  // pair outright (e.g. two DIFFERENT invest tags at the same spot).
  function pairBy(prevList, curList, distFn, maxDist) {
    var cands = [];
    prevList.forEach(function (p, i) {
      curList.forEach(function (c, j) {
        var d = distFn(p, c);
        if (d != null && d <= maxDist) cands.push({ d: d, i: i, j: j });
      });
    });
    cands.sort(function (a, b) { return a.d - b.d; });
    var usedP = {}, usedC = {}, pairs = [];
    cands.forEach(function (k) {
      if (usedP[k.i] || usedC[k.j]) return;
      usedP[k.i] = usedC[k.j] = true;
      pairs.push({ prev: prevList[k.i], cur: curList[k.j] });
    });
    return {
      pairs: pairs,
      removed: prevList.filter(function (_, i) { return !usedP[i]; }),
      added: curList.filter(function (_, j) { return !usedC[j]; })
    };
  }

  function flatDist(a, b) {
    if (a.lat == null || b.lat == null) return null;
    var dLat = a.lat - b.lat, dLon = a.lon - b.lon;
    return Math.sqrt(dLat * dLat + dLon * dLon);
  }

  function diffTWD(prev, cur) {
    // Cyclones: the name IS the identity — a renamed storm is a new storm.
    var prevByName = {}, pairs = [], added = [], removed = [];
    (prev.cyclones || []).forEach(function (c) { prevByName[c.name.toUpperCase()] = c; });
    (cur.cyclones || []).forEach(function (c) {
      var old = prevByName[c.name.toUpperCase()];
      if (old) { pairs.push({ prev: old, cur: c }); delete prevByName[c.name.toUpperCase()]; }
      else added.push(c);
    });
    Object.keys(prevByName).forEach(function (k) { removed.push(prevByName[k]); });
    return {
      kind: 'TWD',
      cyclones: { pairs: pairs, added: added, removed: removed },
      waves: pairBy(prev.waves || [], cur.waves || [], function (p, c) {
        return Math.abs(meanLon(p.axis) - meanLon(c.axis));
      }, WAVE_LON_MAX)
    };
  }

  function diffTWO(prev, cur) {
    // Invest tags first: a tag match can never be beaten by distance, and two
    // DIFFERENT tags never proximity-pair (that would render a silent rename).
    var prevRest = [], curRest = [], pairs = [], prevByTag = {};
    (prev.disturbances || []).forEach(function (d) {
      if (d.invest) prevByTag[d.invest] = d; else prevRest.push(d);
    });
    (cur.disturbances || []).forEach(function (d) {
      if (d.invest && prevByTag[d.invest]) {
        pairs.push({ prev: prevByTag[d.invest], cur: d });
        delete prevByTag[d.invest];
      } else curRest.push(d);
    });
    Object.keys(prevByTag).forEach(function (k) { prevRest.push(prevByTag[k]); });
    var prox = pairBy(prevRest, curRest, function (p, c) {
      if (p.invest && c.invest && p.invest !== c.invest) return null;
      return flatDist(p, c);
    }, DIST_DEG_MAX);
    return {
      kind: 'TWO',
      disturbances: {
        pairs: pairs.concat(prox.pairs),
        added: prox.added,
        removed: prox.removed
      }
    };
  }

  function diffProducts(prev, cur, kind) {
    var out = kind === 'TWO' ? diffTWO(prev, cur) : diffTWD(prev, cur);
    out.prevIssued = prev.issued || null;
    out.curIssued = cur.issued || null;
    return out;
  }

  var api = { diffProducts: diffProducts, meanLon: meanLon };
  root.HCDiff = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
