# All-Vector Basemap + Border Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the CARTO raster basemap with a fully embedded all-vector basemap — Natural Earth land fill, coastlines, country borders everywhere, state/province lines only for the USA — matching the approved demo (https://claude.ai/code/artifact/24a22f2b-2007-4054-83c2-3a433f72ba95, "Proposed" panels).

**Architecture:** `tools/build-coastlines.js` grows into `tools/build-basemap.js`, emitting one generated `basemap.js` (a GeoJSON FeatureCollection with four layer-tagged features: land polygons, coastlines, admin-0 lines, USA-only admin-1 lines). app.js renders it as two `L.geoJSON` layers (land below the graticule, lines above) and deletes the entire tile/attribution/mask/dimming machinery. This also unblocks the future LCC projection work (vector-only basemaps survive a CRS change; raster tiles don't).

**Tech Stack:** Plain ES5-ish JS, Leaflet (already present), Natural Earth 50m GeoJSON (public domain), node test harness.

## Global Constraints

- No backend, no proxy, no new dependencies, no build step at runtime (generator is dev-only, zero deps).
- Generated file must run in browser AND node (IIFE `root` pattern + module.exports, like coastlines.js today).
- Coordinates in generated data are GeoJSON `[lon, lat]`; app map coords are `{lat, lon}`, west/south negative.
- Badge contract untouched. No legend changes — borders are basemap furniture, not data layers.
- `node test.js` must stay green after every task (currently 55 assertions; Task 1 revises the 4 coastline-integrity assertions and adds border/land ones → expected 57 total).
- sw.js VERSION bump ships at the end (v12 → v13).
- **Cleanup discipline (hard rule):** when cleaning up after browser verification, delete ONLY the `.playwright-mcp/` directory and PNG files you yourself created, by exact name. NEVER delete any other file or folder, even if it looks stray. If unsure, leave it and mention it in your report.
- Clip box everywhere: lon -110..5, lat -10..45 (the app's frame).
- Style values (from the approved demo, keep exact): land fill `#10202b` opacity 1 no stroke; coastline `#2c5870` weight 1; country borders `#24485c` weight 1.2 solid; US state lines `#1b3a4a` weight 1 dashArray `'3 3'`. All `interactive: false`.

---

### Task 1: `tools/build-basemap.js` + generated `basemap.js` + test migration

**Files:**
- Create: `tools/build-basemap.js`
- Delete: `tools/build-coastlines.js`, `coastlines.js` (after basemap.js is generated and referenced)
- Create (generated): `basemap.js`
- Modify: `index.html` (script tag `coastlines.js` → `basemap.js`), `sw.js` (SHELL list entry `'./coastlines.js'` → `'./basemap.js'` — do NOT bump VERSION yet, that's Task 3), `test.js` (integrity block)

**Interfaces:**
- Produces: global `BASIN_BASEMAP` (window/node) — GeoJSON FeatureCollection with exactly four features, in this order, each with `properties: { layer: '<name>' }`:
  1. `land` — MultiPolygon (each clipped ring as its own single-ring polygon)
  2. `usStates` — MultiLineString (admin-1 lines where `ADM0_A3 === 'USA'`)
  3. `countries` — MultiLineString (admin-0 boundary lines)
  4. `coast` — MultiLineString (coastline)
  Task 2 renders via `f.properties.layer` lookups and relies on these exact layer names.

- [ ] **Step 1: Write `tools/build-basemap.js`** (replaces build-coastlines.js; same clip box, same line-clip logic, plus polygon clipping and attribute filtering)

```js
/*
 * tools/build-basemap.js — regenerate ../basemap.js from Natural Earth.
 *
 * Usage:  node tools/build-basemap.js
 *
 * Downloads four public-domain Natural Earth 1:50m datasets
 * (github.com/nvkelso/natural-earth-vector), clips them to the Atlantic basin
 * box (lon -110..5, lat -10..45 — the app's frame), rounds to 2 decimals, and
 * rewrites basemap.js. Border policy: country borders (admin-0) everywhere;
 * state/province lines (admin-1) ONLY for ADM0_A3 === 'USA'. Dev-time only;
 * zero dependencies; never runs in the browser.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

const BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';
const SRC = {
  coast: 'ne_50m_coastline.geojson',
  land: 'ne_50m_land.geojson',
  adm0: 'ne_50m_admin_0_boundary_lines_land.geojson',
  adm1: 'ne_50m_admin_1_states_provinces_lines.geojson',
};
const BOX = { w: -110, e: 5, s: -10, n: 45 };
const OUT = path.join(__dirname, '..', 'basemap.js');

const inBox = (p) => p[0] >= BOX.w && p[0] <= BOX.e && p[1] >= BOX.s && p[1] <= BOX.n;
const r2 = (v) => Math.round(v * 100) / 100;

// Keep runs of in-box points; retain one out-of-box point at each entry/exit
// so lines meet the frame edge instead of stopping short of it.
function clipLines(features) {
  const out = [];
  for (const f of features) {
    const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates]
      : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [];
    for (const line of lines) {
      let run = [];
      for (let i = 0; i < line.length; i++) {
        const p = line[i];
        if (inBox(p)) {
          if (!run.length && i > 0) run.push([r2(line[i - 1][0]), r2(line[i - 1][1])]);
          run.push([r2(p[0]), r2(p[1])]);
        } else if (run.length) {
          run.push([r2(p[0]), r2(p[1])]);
          if (run.length >= 2) out.push(run);
          run = [];
        }
      }
      if (run.length >= 2) out.push(run);
    }
  }
  return out;
}

// Sutherland-Hodgman rectangle clip for polygon outer rings.
function clipRing(ring) {
  const edges = [(p) => p[0] >= BOX.w, (p) => p[0] <= BOX.e, (p) => p[1] >= BOX.s, (p) => p[1] <= BOX.n];
  const inter = [
    (a, b) => [BOX.w, a[1] + (b[1] - a[1]) * (BOX.w - a[0]) / (b[0] - a[0])],
    (a, b) => [BOX.e, a[1] + (b[1] - a[1]) * (BOX.e - a[0]) / (b[0] - a[0])],
    (a, b) => [a[0] + (b[0] - a[0]) * (BOX.s - a[1]) / (b[1] - a[1]), BOX.s],
    (a, b) => [a[0] + (b[0] - a[0]) * (BOX.n - a[1]) / (b[1] - a[1]), BOX.n],
  ];
  let pts = ring;
  for (let e = 0; e < 4; e++) {
    const next = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const ain = edges[e](a), bin = edges[e](b);
      if (ain) next.push(a);
      if (ain !== bin) next.push(inter[e](a, b));
    }
    pts = next;
    if (!pts.length) return null;
  }
  return pts.map((p) => [r2(p[0]), r2(p[1])]);
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode + ' ' + url));
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve(JSON.parse(body)));
    }).on('error', reject);
  });
}

Promise.all(Object.values(SRC).map((f) => fetchJson(BASE + f))).then(([coastJ, landJ, adm0J, adm1J]) => {
  const coast = clipLines(coastJ.features);
  const countries = clipLines(adm0J.features);
  const usStates = clipLines(adm1J.features.filter((f) => f.properties.ADM0_A3 === 'USA'));
  const land = [];
  for (const f of landJ.features) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) {
      const c = clipRing(poly[0]);
      if (c && c.length >= 3) land.push([c]); // each ring -> its own single-ring polygon
    }
  }

  const fc = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { layer: 'land' },
        geometry: { type: 'MultiPolygon', coordinates: land } },
      { type: 'Feature', properties: { layer: 'usStates' },
        geometry: { type: 'MultiLineString', coordinates: usStates } },
      { type: 'Feature', properties: { layer: 'countries' },
        geometry: { type: 'MultiLineString', coordinates: countries } },
      { type: 'Feature', properties: { layer: 'coast' },
        geometry: { type: 'MultiLineString', coordinates: coast } },
    ],
  };
  const js = JSON.stringify(fc);
  const file = `/*
 * basemap.js — Hurricane Console
 * GENERATED by tools/build-basemap.js — do not hand-edit.
 * Natural Earth 1:50m (public domain), clipped to lon -110..5 / lat -10..45,
 * rounded to 0.01 deg. Layers: land fill, coastline, country borders (admin-0
 * everywhere), state lines (admin-1, USA only — deliberate border policy).
 * ${land.length} land rings, ${coast.length} coast lines, ${countries.length} country lines, ${usStates.length} US state lines; ~${Math.round(js.length / 1024)} KB.
 * This embedded layer IS the basemap — fully offline, no tile server.
 */
(function (root) {
  'use strict';
  root.BASIN_BASEMAP =
${js};
  if (typeof module !== 'undefined' && module.exports) module.exports = root.BASIN_BASEMAP;
})(typeof window !== 'undefined' ? window : globalThis);
`;
  fs.writeFileSync(OUT, file);
  console.log('wrote', OUT, '—', Math.round(file.length / 1024), 'KB',
    '| land', land.length, '| coast', coast.length, '| countries', countries.length, '| usStates', usStates.length);
}).catch((e) => { console.error('build failed:', e.message); process.exit(1); });
```

- [ ] **Step 2: Run the generator**

Run: `node tools/build-basemap.js`
Expected: `wrote ...basemap.js — ~260 KB | land ~174 | coast ~178 | countries ~71 | usStates ~106` (counts within ±10%).

- [ ] **Step 3: Swap references**

- `index.html`: change `<script src="coastlines.js"></script>` to `<script src="basemap.js"></script>`.
- `sw.js`: in the `SHELL` array, change `'./coastlines.js'` to `'./basemap.js'` (VERSION stays v12 in this task).
- Delete `coastlines.js` and `tools/build-coastlines.js` (`git rm`).

- [ ] **Step 4: Replace the coastline-integrity test block in test.js**

Replace the whole `// --- coastlines.js integrity ...` block (the `require('./coastlines.js')` through the four `ok('coastlines: ...')` assertions) with:

```js
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
```

- [ ] **Step 5: Run tests**

Run: `node test.js`
Expected: `57 passed, 0 failed` (55 − 4 removed coastline assertions + 6 new basemap assertions). If the count differs but everything passes and the six new names appear, report the actual number.

- [ ] **Step 6: Syntax check + commit**

Run: `node --check basemap.js && node --check tools/build-basemap.js`

```bash
git add -A
git commit -m "Generate all-vector basemap: land, coast, country borders, US-only states"
```

---

### Task 2: app.js renders the vector basemap; tile machinery removed

**Files:**
- Modify: `app.js`, `index.html` (remove attribution CSS block)

**Interfaces:**
- Consumes: `window.BASIN_BASEMAP` with layer-tagged features from Task 1.
- Produces: two module-level layers — `landLayer` (added before the graticule) and `lineLayer` (added after) — replacing `coastGeo`, `tiles`, `attrib`, and the frame-mask polygon.

- [ ] **Step 1: Replace the coastline layer + insert land under the graticule**

In app.js, the current order is: map setup → fitMinZoom → graticule → graticule labels → `coastGeo` (`L.geoJSON(window.BASIN_COASTLINES, ...)`) → tiles block → mask polygon → feature layer groups.

New order: map setup → fitMinZoom → **landLayer** → graticule → graticule labels → **lineLayer** → feature layer groups. Concretely:

Immediately BEFORE the `// graticule every 5deg` comment, add:

```js
  // All-vector basemap, generated from Natural Earth (see tools/build-basemap.js).
  // Land fill sits under the graticule; line work (coast, borders) above it.
  // Border policy: country borders everywhere, state lines only for the USA.
  var BASEMAP_STYLES = {
    land: { stroke: false, fillColor: '#10202b', fillOpacity: 1 },
    usStates: { color: '#1b3a4a', weight: 1, dashArray: '3 3', fill: false },
    countries: { color: '#24485c', weight: 1.2, fill: false },
    coast: { color: '#2c5870', weight: 1, fill: false },
  };
  function basemapLayer(names) {
    return L.geoJSON(window.BASIN_BASEMAP, {
      filter: function (f) { return names.indexOf(f.properties.layer) !== -1; },
      style: function (f) { return BASEMAP_STYLES[f.properties.layer]; },
      interactive: false,
    });
  }
  var landLayer = basemapLayer(['land']).addTo(map);
```

Immediately AFTER the `drawGratLabels();` call (end of the labels block), add:

```js
  var lineLayer = basemapLayer(['usStates', 'countries', 'coast']).addTo(map);
```

- [ ] **Step 2: Delete the retired machinery**

Remove from app.js, entirely:
- the `coastGeo` block (`// Embedded NE 50m coastlines...` comment + `var coastGeo = L.geoJSON(window.BASIN_COASTLINES, ...)`),
- the whole CARTO tiles block: `attrib`, `tiles`, `tilesLoaded`/`tileErrors`, `tilesUp`, `tilesDown`, both `tiles.on(...)` handlers, the `window.addEventListener('offline'/'online', ...)` pair, and the `tilesUp();` call,
- the frame-mask polygon block (`// Frame mask: ...` + the `L.polygon([...world ring / basin hole...])` call) — with no tiles there is nothing to paint outside the clipped vectors, so the mask is dead weight.

Remove from index.html: the `.leaflet-control-attribution` CSS rules (two rules).

- [ ] **Step 3: Syntax check + tests**

Run: `node --check app.js && node test.js`
Expected: clean; `57 passed, 0 failed` (Task 2 adds no assertions).

- [ ] **Step 4: Browser verification** (per `.claude/skills/verify/SKILL.md`; serve on a FRESH port, e.g. `python -m http.server 8353`, background; Playwright MCP)

1. Load → map shows filled land (`#10202b`) with coastlines, country borders across South America/Africa, dashed state lines across the US Southeast; **no** tile `<img>` elements in `.leaflet-tile-pane`; **no** attribution control in the DOM.
2. Zoom to the Gulf close-up (3× zoom-in clicks, pan west): US states visible, Mexico shows NO internal lines — compare against the approved demo's left close-up panel.
3. Weather layers still render above the basemap (sample features: wave axes, trough, TWO/TCM per current sample state), popups open.
4. Zoom to min: frame still ends cleanly at the clip box (no painted content outside 45N/10S/110W/5E), graticule labels intact.
5. Console: only the favicon.ico 404.
6. Screenshot for the report. Cleanup per the Global Constraints cleanup rule (delete only `.playwright-mcp/` and PNGs you created, by name).

- [ ] **Step 5: Commit**

```bash
git add app.js index.html
git commit -m "Render all-vector basemap; retire CARTO tiles, attribution, and frame mask"
```

---

### Task 3: Docs + SW version

**Files:**
- Modify: `CLAUDE.md`, `README.md`, `sw.js`

**Interfaces:** consumes everything above; produces ship-ready v13.

- [ ] **Step 1: sw.js**

- `const VERSION = 'v12';` → `const VERSION = 'v13';`
- Delete the cartocdn bypass block in the fetch handler (the `// TILES: never intercept...` comment + `if (url.hostname.endsWith('cartocdn.com')) return;`) — no tile requests exist anymore.

- [ ] **Step 2: CLAUDE.md**

- File table: replace the `coastlines.js` row and its generator row with:

```
| `basemap.js`     | embedded Natural Earth 50m basemap: land, coast, country borders, US-only state lines — GENERATED, do not hand-edit (regenerate: `node tools/build-basemap.js`) |
| `tools/build-basemap.js` | dev-only generator: downloads/clips NE 50m → basemap.js |
```

- Conventions: replace the entire "**Basemap is hybrid**" bullet with:

```
- **Basemap is all-vector and embedded**: Natural Earth 50m land/coast/borders in
  `basemap.js` render identically online and offline — no tile server, no
  attribution requirements, no network dependency. Border policy is deliberate:
  country borders everywhere, admin-1 state lines only for the USA (filtered at
  generation time by `ADM0_A3`). This also keeps the basemap portable to a future
  non-Mercator display CRS (see docs/projection_decision.md), which raster tiles
  would not survive.
```

- [ ] **Step 3: README.md**

Replace the "Coastlines are Natural Earth 1:50m vectors..." bullet in Honest limitations with:

```
- The basemap is fully embedded Natural Earth 1:50m vector data (public domain):
  land, coastlines, country borders, and US state lines — identical online and
  offline, no tile server. Internal borders of other countries are deliberately
  omitted to keep the chart quiet.
```

- [ ] **Step 4: Tests + commit**

Run: `node test.js` → expected `57 passed, 0 failed`.

```bash
git add sw.js CLAUDE.md README.md
git commit -m "Ship all-vector basemap (VERSION v13)"
```

---

### Task 4 (controller): final whole-branch review, deploy, memory

- Final whole-branch review (most capable model) over the three tasks; fix loop if needed.
- Push to main; poll Pages until sw serves v13; confirm `basemap.js` serves (~260 KB) and `coastlines.js` 404s.
- Update the `map-ux-decisions` memory (basemap is now all-vector; CARTO retired; border policy).
