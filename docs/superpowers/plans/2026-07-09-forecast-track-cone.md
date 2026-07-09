# Forecast Track + Cone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the official NHC forecast track and a computed cone of uncertainty for every active Atlantic storm, parsed from TCM forecast/advisory text.

**Architecture:** New parser pass `parseTCM` + geometry helper `coneFromTrack` in parser.js (browser+node); app.js fetches the 8 newest TCM products from api.weather.gov after each TWD load, dedupes to latest-per-storm, renders track+cone on a dedicated `tcmLayer`. Cone geometry is computed from NHC's published seasonal cone radii and labeled as computed.

**Tech Stack:** Plain ES5-ish JS, Leaflet (already present), api.weather.gov (CORS-open), node test harness (`node test.js`).

## Global Constraints

- No backend, no proxy, no new dependencies, no build step.
- Parser must run unchanged in browser and node (IIFE + module.exports pattern in parser.js).
- Header badge describes the TWD product only; TCM failure never sets ERROR.
- Every shell-file change ships with a sw.js VERSION bump (v11 → v12 at the end).
- Coordinates `{lat, lon}`, west/south negative.
- `node test.js` must stay green after every task (39 existing assertions).
- Spec: docs/superpowers/specs/2026-07-09-forecast-track-cone-design.md

## Reference: real TCM format (Hurricane Lee adv 23, AL132023 — fixture source)

```
HURRICANE LEE FORECAST/ADVISORY NUMBER  23
NWS NATIONAL HURRICANE CENTER MIAMI FL       AL132023
0300 UTC MON SEP 11 2023

HURRICANE CENTER LOCATED NEAR 22.6N  62.2W AT 11/0300Z
POSITION ACCURATE WITHIN  15 NM

PRESENT MOVEMENT TOWARD THE NORTHWEST OR 305 DEGREES AT   7 KT

ESTIMATED MINIMUM CENTRAL PRESSURE  950 MB
MAX SUSTAINED WINDS 105 KT WITH GUSTS TO 130 KT.
64 KT....... 65NE  40SE  40SW  55NW.

REPEAT...CENTER LOCATED NEAR 22.6N  62.2W AT 11/0300Z

FORECAST VALID 11/1200Z 23.1N  63.1W
MAX WIND 115 KT...GUSTS 140 KT.
64 KT... 65NE  50SE  45SW  60NW.

OUTLOOK VALID 15/0000Z 30.2N  67.9W
MAX WIND  85 KT...GUSTS 105 KT.
```

Gotchas: double spaces inside coordinates (`22.6N  62.2W`) and after NUMBER; the
`REPEAT...CENTER LOCATED` line duplicates the first center (parse takes first match,
identical coords so harmless); wind-radii lines (`64 KT...`) must not be confused
with `MAX WIND`; blocks are blank-line separated.

---

### Task 1: `parseTCM` in parser.js

**Files:**
- Modify: `parser.js` (add after `parseTWO`, before orchestration; extend exports)
- Test: `test.js` (append before the final summary lines)

**Interfaces:**
- Consumes: existing `dehyphenate`, `parseMotion`, `lat`, `lon` (parser.js internals).
- Produces: `BasinParser.parseTCM(raw)` returning
  `{ stormId, name, classification, advisory, center:{lat,lon}, issued:'11/0300Z', windKt, gustKt, pressureMb, motion, track:[{kind:'FORECAST'|'OUTLOOK', hours, validZ, lat, lon, windKt, state?}] }`
  or `null`. Task 2 consumes `track`; Task 3 consumes the whole object.

- [ ] **Step 1: Add fixture + failing tests to test.js** (insert before `console.log('\n' + pass ...)`)

```js
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
    .replace('NEAR 22.6N  62.2W AT 30/2100Z', 'NEAR 22.6N  62.2W AT 30/2100Z')
    .replace('FORECAST VALID 11/1200Z', 'FORECAST VALID 01/0600Z'));
  return t && t.track[0].hours === 33; // 30/2100Z -> 01/0600Z across a 31-day month
})());
ok('TCM: garbage returns null', P.parseTCM('not a product') === null && P.parseTCM('') === null);
```

Note on the rollover test: only the center time and the first FORECAST line change;
the remaining track entries get large-but-valid hour values we don't assert.

- [ ] **Step 2: Run tests, verify the new ones fail**

Run: `node test.js`
Expected: `P.parseTCM is not a function` (TypeError) — wrap the new block above in
nothing; the harness crashes OR shows FAILs. A crash before the summary is the
expected "failing" state here; proceed.

- [ ] **Step 3: Implement `parseTCM` in parser.js** (insert after the `parseTWO` function)

```js
  // --- TCM (Tropical Cyclone Forecast/Advisory) --------------------------------
  // The most rigid NHC text product: FORECAST/OUTLOOK VALID lines carry the
  // official track. Times are DD/HHMMZ with no month, so hour offsets resolve
  // month rollover by picking the month length that lands the delta in 0..6 days.

  function tcmHours(d0, h0, d1, h1) {
    var days = d1 - d0;
    if (days < 0) {
      var lens = [31, 30, 29, 28];
      for (var i = 0; i < lens.length; i++) {
        var cand = d1 - d0 + lens[i];
        if (cand >= 0 && cand <= 6) { days = cand; break; }
      }
      if (days < 0) return null;
    }
    return days * 24 + (h1 - h0);
  }

  function parseTCM(raw) {
    const text = dehyphenate(String(raw || ''));
    const head = text.match(
      /\b(HURRICANE|TROPICAL STORM|TROPICAL DEPRESSION|SUBTROPICAL STORM|SUBTROPICAL DEPRESSION|POST-TROPICAL CYCLONE|REMNANTS OF)\s+([A-Z][A-Za-z-]+)\s+(?:SPECIAL\s+)?FORECAST\/ADVISORY\s+NUMBER\s+(\d+)/i
    );
    const ctr = text.match(
      /CENTER LOCATED NEAR\s+(\d{1,2}(?:\.\d)?)\s*([NS])\s+(\d{1,3}(?:\.\d)?)\s*([EW])\s+AT\s+(\d{2})\/(\d{2})(\d{2})Z/i
    );
    if (!head || !ctr) return null;
    const idm = text.match(/\b(AL|EP|CP)(\d{6})\b/);
    const d0 = parseInt(ctr[5], 10), h0 = parseInt(ctr[6], 10);
    const wm = text.match(/MAX SUSTAINED WINDS\s+(\d{1,3})\s*KT(?:\s+WITH\s+GUSTS\s+TO\s+(\d{1,3})\s*KT)?/i);
    const pm = text.match(/MINIMUM CENTRAL PRESSURE\s+(\d{3,4})\s*MB/i);

    const track = [];
    for (const chunk of text.split(/\n\s*\n/)) {
      const v = chunk.match(
        /^\s*(FORECAST|OUTLOOK)\s+VALID\s+(\d{2})\/(\d{2})(\d{2})Z\s+(\d{1,2}(?:\.\d)?)\s*([NS])\s+(\d{1,3}(?:\.\d)?)\s*([EW])/i
      );
      if (!v) continue; // dissipated blocks carry no position; skip from geometry
      const mw = chunk.match(/MAX WIND\s+(\d{1,3})\s*KT/i);
      const hours = tcmHours(d0, h0, parseInt(v[2], 10), parseInt(v[3], 10));
      if (hours == null) continue;
      const entry = {
        kind: v[1].toUpperCase(),
        hours: hours,
        validZ: v[2] + '/' + v[3] + v[4] + 'Z',
        lat: lat(v[5], v[6].toUpperCase()),
        lon: lon(v[7], v[8].toUpperCase()),
        windKt: mw ? parseInt(mw[1], 10) : null,
      };
      if (/POST-TROP/i.test(chunk)) entry.state = 'post-tropical';
      if (/DISSIPAT/i.test(chunk)) entry.state = 'dissipated';
      track.push(entry);
    }

    return {
      stormId: idm ? (idm[1] + idm[2]) : null,
      name: titleCase(head[2]),
      classification: titleCase(head[1]),
      advisory: parseInt(head[3], 10),
      center: { lat: lat(ctr[1], ctr[2].toUpperCase()), lon: lon(ctr[3], ctr[4].toUpperCase()) },
      issued: ctr[5] + '/' + ctr[6] + ctr[7] + 'Z',
      windKt: wm ? parseInt(wm[1], 10) : null,
      gustKt: wm && wm[2] ? parseInt(wm[2], 10) : null,
      pressureMb: pm ? parseInt(pm[1], 10) : null,
      motion: parseMotion(text),
      track: track,
    };
  }
```

Also extend the export line at the bottom of parser.js:

```js
  root.BasinParser = { parse, parseTWO, parseTCM, pairsIn, sections, dehyphenate, parseMotion, project };
```

- [ ] **Step 4: Run tests, verify all pass**

Run: `node test.js`
Expected: `49 passed, 0 failed` (39 existing + 10 new), exit 0.

- [ ] **Step 5: Commit**

```bash
git add parser.js test.js
git commit -m "Parse TCM forecast/advisories into official track data"
```

---

### Task 2: `coneFromTrack` + `CONE_RADII_NM`

**Files:**
- Modify: `parser.js` (add after `parseTCM`; extend exports)
- Test: `test.js` (append after Task 1's block)

**Interfaces:**
- Consumes: `parseTCM(...).center` and `.track` from Task 1.
- Produces: `BasinParser.coneFromTrack(points)` where `points` is
  `[{hours:0, lat, lon}, ...track entries]` (caller prepends the center). Returns a
  closed polygon ring `[{lat,lon}, ...]` or `null` for <2 points. Task 3 passes the
  ring straight to `L.polygon`.

- [ ] **Step 1: Add failing tests to test.js**

```js
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
```

- [ ] **Step 2: Run tests, verify the new ones fail**

Run: `node test.js`
Expected: crash/FAIL at `P.coneFromTrack is not a function`.

- [ ] **Step 3: Implement in parser.js** (after `parseTCM`)

```js
  // NHC published cone circle radii (nm) by forecast hour, Atlantic basin.
  // Source: https://www.nhc.noaa.gov/aboutcone.shtml (current season; update
  // annually). Hour 0 uses a small fixed radius so the cone starts at the center.
  const CONE_RADII_NM = [
    [0, 10], [12, 25], [24, 39], [36, 49], [48, 62], [60, 77], [72, 95], [96, 134], [120, 200],
  ];

  function coneRadiusNm(hours) {
    const t = CONE_RADII_NM;
    if (hours <= t[0][0]) return t[0][1];
    for (let i = 1; i < t.length; i++) {
      if (hours <= t[i][0]) {
        const [h0, r0] = t[i - 1], [h1, r1] = t[i];
        return r0 + (r1 - r0) * (hours - h0) / (h1 - h0);
      }
    }
    return t[t.length - 1][1];
  }

  // Move nm from pt along bearingDeg (planar, lat-scaled lon — same approx as project()).
  function offsetNm(pt, bearingDeg, nm) {
    const dLat = (nm * Math.cos((bearingDeg * Math.PI) / 180)) / 60;
    const dLon = (nm * Math.sin((bearingDeg * Math.PI) / 180)) /
      (60 * Math.cos((pt.lat * Math.PI) / 180));
    return { lat: pt.lat + dLat, lon: pt.lon + dLon };
  }

  function headingDeg(a, b) {
    const dLat = b.lat - a.lat;
    const dLon = (b.lon - a.lon) * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
    return (Math.atan2(dLon, dLat) * 180 / Math.PI + 360) % 360;
  }

  // circular mean: averaging 357deg and 8deg must give ~2.5deg, not 182.5deg
  // (a naive arithmetic mean flips the cone sides where a track crosses north
  // and produces a self-intersecting ring — found in review on the Lee fixture)
  function meanHeading(a, b) {
    const ar = a * Math.PI / 180, br = b * Math.PI / 180;
    return (Math.atan2(Math.sin(ar) + Math.sin(br), Math.cos(ar) + Math.cos(br)) * 180 / Math.PI + 360) % 360;
  }

  // Track points (with .hours) -> cone polygon ring. The standard construction:
  // perpendicular left/right offsets at each point's radius, semicircular caps.
  function coneFromTrack(points) {
    if (!points || points.length < 2) return null;
    const left = [], right = [], hdgs = [];
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const hdg = i === 0 ? headingDeg(points[0], points[1])
        : i === points.length - 1 ? headingDeg(points[i - 1], points[i])
        : meanHeading(headingDeg(points[i - 1], p), headingDeg(p, points[i + 1]));
      const r = coneRadiusNm(p.hours || 0);
      hdgs.push(hdg);
      left.push(offsetNm(p, hdg - 90, r));
      right.push(offsetNm(p, hdg + 90, r));
    }
    function arc(center, fromDeg, toDeg, r) {
      const out = [];
      for (let k = 1; k < 8; k++) out.push(offsetNm(center, fromDeg + (toDeg - fromDeg) * k / 8, r));
      return out;
    }
    const last = points[points.length - 1], first = points[0];
    const ring = left
      .concat(arc(last, hdgs[hdgs.length - 1] - 90, hdgs[hdgs.length - 1] + 90, coneRadiusNm(last.hours || 0)))
      .concat(right.slice().reverse())
      .concat(arc(first, hdgs[0] + 90, hdgs[0] + 270, coneRadiusNm(first.hours || 0)));
    return ring;
  }
```

Extend exports:

```js
  root.BasinParser = { parse, parseTWO, parseTCM, coneFromTrack, pairsIn, sections, dehyphenate, parseMotion, project };
```

- [ ] **Step 4: Run tests, verify all pass**

Run: `node test.js`
Expected: `54 passed, 0 failed`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add parser.js test.js
git commit -m "Compute cone of uncertainty from NHC seasonal radii"
```

---

### Task 3: Fetch + render in the app

**Files:**
- Modify: `app.js` (new `TCM_URL`, `fetchRecent`, `loadTCM`, `renderTCM`, meta helper, paste routing, mode clearing)
- Modify: `sample.js` (add `window.TCM_SAMPLE`)
- Modify: `index.html` (two legend entries)

**Interfaces:**
- Consumes: `BasinParser.parseTCM`, `BasinParser.coneFromTrack` (Tasks 1–2);
  existing `map`, `popup()`, `escapeHtml()`, `setBadge()`, `setMode()`, `ll()`,
  cyclone intensity palette.
- Produces: `loadTCM()` called after every `loadTWD()` resolution; `tcmLayer`
  cleared by `setMode('TWO')`.

- [ ] **Step 1: Add `TCM_SAMPLE` to sample.js** (after `window.TWO_SAMPLE`, using the same fixture text as test.js — full copy, backticks)

```js
window.TCM_SAMPLE = `HURRICANE LEE FORECAST/ADVISORY NUMBER  23
NWS NATIONAL HURRICANE CENTER MIAMI FL       AL132023
0300 UTC MON SEP 11 2023

HURRICANE CENTER LOCATED NEAR 22.6N  62.2W AT 11/0300Z

PRESENT MOVEMENT TOWARD THE NORTHWEST OR 305 DEGREES AT   7 KT

ESTIMATED MINIMUM CENTRAL PRESSURE  950 MB
MAX SUSTAINED WINDS 105 KT WITH GUSTS TO 130 KT.

FORECAST VALID 11/1200Z 23.1N  63.1W
MAX WIND 115 KT...GUSTS 140 KT.

FORECAST VALID 12/0000Z 23.6N  64.4W
MAX WIND 120 KT...GUSTS 145 KT.

FORECAST VALID 13/0000Z 24.6N  66.4W
MAX WIND 110 KT...GUSTS 135 KT.

FORECAST VALID 14/0000Z 26.5N  67.7W
MAX WIND  95 KT...GUSTS 115 KT.

OUTLOOK VALID 15/0000Z 30.2N  67.9W
MAX WIND  85 KT...GUSTS 105 KT.

OUTLOOK VALID 16/0000Z 35.5N  67.0W
MAX WIND  70 KT...GUSTS  85 KT.

$$`;
```

- [ ] **Step 2: app.js — layer, fetch, render** (place `tcmLayer` next to the other layer groups; `TCM_URL` next to `TWO_URL`; functions after `loadTWO`)

```js
  var TCM_URL = 'https://api.weather.gov/products/types/TCM';
  var tcmLayer = L.layerGroup().addTo(map);

  // like fetchLatest but returns the newest n product texts
  function fetchRecent(listUrl, n) {
    return fetch(listUrl, { headers: { Accept: 'application/ld+json' } }).then(function (r) {
      if (!r.ok) throw new Error('list ' + r.status);
      return r.json().then(function (j) {
        var items = (j['@graph'] || j.features || []).slice(0, n);
        if (!items.length) return [];
        return Promise.all(items.map(function (it) {
          return fetch(it['@id'] || it.id)
            .then(function (pr) { return pr.json(); })
            .then(function (p) { return p.productText || ''; })
            .catch(function () { return ''; });
        }));
      });
    });
  }

  var twdState = 'sample'; // 'live' | 'cached' | 'sample' | 'error' — set by loadTWD
  var tcmNote = '';

  function loadTCM() {
    fetchRecent(TCM_URL, 8).then(function (texts) {
      var byStorm = {};
      texts.forEach(function (t) {
        var p = window.BasinParser.parseTCM(t);
        if (!p || !p.stormId || p.stormId.slice(0, 2) !== 'AL') return;
        if (!byStorm[p.stormId] || byStorm[p.stormId].advisory < p.advisory) byStorm[p.stormId] = p;
      });
      var storms = Object.keys(byStorm).map(function (k) { return byStorm[k]; });
      renderTCM(storms);
      tcmNote = storms.length ? storms.length + ' forecast track' + (storms.length === 1 ? '' : 's') : '';
      updateMeta();
    }).catch(function () {
      // SAMPLE state demos the feature; a live TWD with dead TCM is reported honestly
      if (twdState === 'sample' && window.TCM_SAMPLE) {
        var p = window.BasinParser.parseTCM(window.TCM_SAMPLE);
        renderTCM(p ? [p] : []);
        tcmNote = p ? '1 forecast track (sample)' : '';
      } else {
        renderTCM([]);
        tcmNote = 'forecast track n/a';
      }
      updateMeta();
    });
  }

  function intensityColor(kt) {
    return kt >= 64 ? '#ff6b5a' : kt >= 34 ? '#ffa23a' : '#dce8ef';
  }

  function renderTCM(storms) {
    tcmLayer.clearLayers();
    (storms || []).forEach(function (s) {
      var pts = [{ hours: 0, lat: s.center.lat, lon: s.center.lon }].concat(s.track);
      var ring = window.BasinParser.coneFromTrack(pts);
      if (ring) {
        L.polygon(ring.map(ll), {
          color: '#7ea3b8', weight: 1.5, dashArray: '4 4',
          fillColor: '#dce8ef', fillOpacity: 0.07, interactive: true
        }).bindPopup(popup('CONE ' + s.name.toUpperCase(),
          'Computed from NHC seasonal cone radii - the official cone lives at hurricanes.gov. Advisory #' + s.advisory + ' issued ' + s.issued + '.',
          true)).addTo(tcmLayer);
      }
      L.polyline(pts.map(ll), { color: '#dce8ef', weight: 2 })
        .bindPopup(popup('TRACK ' + s.name.toUpperCase(),
          'NHC forecast/advisory #' + s.advisory + ' - positions at 12-120 h.', false))
        .addTo(tcmLayer);
      s.track.forEach(function (p) {
        L.circleMarker(ll(p), {
          radius: 5, color: intensityColor(p.windKt || 0),
          fillColor: intensityColor(p.windKt || 0), fillOpacity: 0.85, weight: 1.5
        }).bindPopup(popup('+' + p.hours + 'h · ' + p.validZ,
          (p.windKt != null ? p.windKt + ' kt' : 'wind n/a') +
          (p.state ? ' · ' + p.state : ''), false))
          .addTo(tcmLayer);
      });
    });
  }
```

- [ ] **Step 3: app.js — meta helper + wire into loadTWD**

Replace the direct `document.getElementById('meta').innerHTML = ...` in `render()`
with a stored base + shared updater, and set `twdState` in `loadTWD`:

```js
  var metaBase = '—';
  function updateMeta() {
    document.getElementById('meta').innerHTML =
      metaBase + (tcmNote ? ' · ' + tcmNote : '');
  }
```

In `render()`, the existing two-line meta assignment becomes:

```js
    metaBase = n + ' features · ' + parsed.waves.length + ' waves' +
      (nCyc ? ' · ' + nCyc + ' cyclone' + (nCyc === 1 ? '' : 's') : '') + '<br>' +
      (parsed.issued ? escapeHtml(parsed.issued) : 'issuance n/a');
    updateMeta();
```

And `renderTWO`'s existing meta assignment becomes the same pattern:

```js
    metaBase = n + ' outlook area' + (n === 1 ? '' : 's') +
      (unmapped ? ' · ' + unmapped + ' not mappable — see product text' : '') + '<br>' +
      (parsed.issued ? escapeHtml(parsed.issued) : 'issuance n/a');
    updateMeta();
```

(`tcmNote = ''` is set in `setMode('TWO')` — see Step 4 — so no stale track note
appears in TWO mode.)

In `loadTWD()`: set `twdState = 'live'/'cached'` in the success path, `'sample'` in
the catch's sample path, `'error'` on ERROR; then call `loadTCM();` as the final
statement of BOTH the `.then` and `.catch` handlers. Also call `loadTCM()` once at
boot after the initial `loadTWD()`.

- [ ] **Step 4: app.js — mode + paste routing**

In `setMode`: entering TWO also clears the forecast layer:

```js
    if (mode === 'TWD') twoLayer.clearLayers();
    else { featureLayer.clearLayers(); tcmLayer.clearLayers(); tcmNote = ''; }
```

In the `pasteMap` handler, TCM detection comes FIRST (precedence per spec):

```js
      if (/FORECAST\/ADVISORY/i.test(txt.slice(0, 400))) {
        setMode('TWD');
        var ptcm = window.BasinParser.parseTCM(txt);
        if (!ptcm) throw new Error('unparseable TCM');
        renderTCM([ptcm]);
        tcmNote = '1 forecast track (pasted)';
        updateMeta();
      } else if (/tropical weather outlook/i.test(txt.slice(0, 300))) {
        // existing TWO branch — keep body unchanged
      } else {
        // existing TWD branch — keep body unchanged
      }
      setBadge('PASTED');
```

- [ ] **Step 5: index.html — legend entries** (after the `TWO area` row)

```html
      <div><span class="swatch" style="border-top-color:#dce8ef"></span>Forecast track</div>
      <div><span class="swatch" style="border-top-color:#7ea3b8;border-top-style:dashed"></span>Cone · computed</div>
```

- [ ] **Step 6: Syntax check + tests**

Run: `node --check app.js && node --check sample.js && node test.js`
Expected: `54 passed, 0 failed`.

- [ ] **Step 7: Browser verification** (serve on a FRESH port — python's dev server
has no cache headers and the SW caches aggressively; a previously-used port serves
stale files)

Run: `python -m http.server 8345` (from repo root, background)
Drive with Playwright per `.claude/skills/verify/SKILL.md`:
1. Load `http://localhost:8345` → SAMPLE badge → TCM fetch fails in sandbox →
   sample track renders: Lee cone (dashed, translucent) + white track polyline +
   6 intensity-colored points NE of the Antilles; meta shows `1 forecast track (sample)`.
2. Click a track point → popup `+9h · 11/1200Z / 115 kt`; click cone → popup
   contains `Computed from NHC seasonal cone radii` with `◇ INFERRED` tag.
3. Toggle TWO mode → cone/track disappear; back to TWD → they return.
4. Paste the TCM fixture text → PASTED badge, single track renders.
5. No console errors beyond the known favicon 404.

- [ ] **Step 8: Commit**

```bash
git add app.js sample.js index.html
git commit -m "Render NHC forecast track and computed cone from TCM advisories"
```

---

### Task 4: Ship it

**Files:**
- Modify: `sw.js` (VERSION), `CLAUDE.md`, `README.md`

**Interfaces:**
- Consumes: everything above. Produces: deployed v12.

- [ ] **Step 1: Bump `sw.js`**

`const VERSION = 'v11';` → `const VERSION = 'v12';`

- [ ] **Step 2: Docs**

CLAUDE.md — parser pass list gains one line under the parser section:

```
4. **TCM pass** — `parseTCM` reads the official forecast/advisory (track points,
   intensity); `coneFromTrack` computes the cone from NHC's published seasonal
   radii (update `CONE_RADII_NM` each season from nhc.noaa.gov/aboutcone.shtml).
   The cone is always labeled as computed — never presented as the official cone.
```

README.md — "What it does" gains:

```
- Plots the official NHC forecast track (TCM advisories) with a cone of
  uncertainty computed from NHC's published seasonal cone radii — labeled as
  computed; the official cone lives at hurricanes.gov.
```

- [ ] **Step 3: Full test + verify**

Run: `node test.js` → `54 passed, 0 failed`.
Re-run the Task 3 browser pass once more on a fresh port.

- [ ] **Step 4: Commit + deploy**

```bash
git add sw.js CLAUDE.md README.md
git commit -m "Ship forecast track + cone (VERSION v12)"
git push origin main
```

Then poll until Pages serves v12:
`until curl -s https://alogrek0.github.io/hurricane-console/sw.js | grep -q "VERSION = 'v12'"; do sleep 15; done`
and confirm `curl -s https://alogrek0.github.io/hurricane-console/parser.js | grep -c parseTCM` ≥ 1.
