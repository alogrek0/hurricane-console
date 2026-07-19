/*
 * tools/build-basemap.js — regenerate ../basemap.js from Natural Earth.
 *
 * Usage:  node tools/build-basemap.js
 *
 * Downloads five public-domain Natural Earth 1:50m datasets plus two 1:10m
 * datasets (github.com/nvkelso/natural-earth-vector), clips the 50m data to
 * the basin box (lon -145..5, lat -5..45 — the UNION of the Atlantic and East
 * Pacific frames, so one embedded basemap serves both views), swaps in 10m
 * land/coast for the Lesser Antilles INSET (the arc reads as 6-30-vertex dots
 * at 50m), rounds to 2 decimals, and rewrites basemap.js AND countries.js.
 * Border policy: country borders (admin-0)
 * everywhere; state/province lines (admin-1) ONLY for ADM0_A3 === 'USA'.
 * countries.js carries per-country NAMED polygons (invisible hover hit-targets
 * for the country-name tooltip) — same NE snapshot as the drawn admin-0 border
 * lines, so hit edges and visible borders stay in registration. Dev-time only;
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
  countries: 'ne_50m_admin_0_countries.geojson',
  // 10m sources feed ONLY the Lesser Antilles inset below. NOTE: the fetch
  // destructure is positional — new keys go at the END.
  land10: 'ne_10m_land.geojson',
  coast10: 'ne_10m_coastline.geojson',
};
// The box is the UNION of both basin frames: w -145 reaches the EP frame's
// western edge (140W coverage + label margin), e 5 keeps the Atlantic's African
// coast, and s/n span both. s matches the frames' shared hard 5S edge (app.js
// PAN_BOUNDS). Land outside the ACTIVE frame is hidden at runtime by app.js's
// letterbox masks, so the wider box never leaks into either view.
const BOX = { w: -145, e: 5, s: -5, n: 45 };
const OUT = path.join(__dirname, '..', 'basemap.js');
const OUT_COUNTRIES = path.join(__dirname, '..', 'countries.js');
// Simplification tolerance for the invisible hover hit-targets (degrees).
// 0.03 deg ~= 2.7 px at the app's maxZoom 7 — hover flips visually AT the
// drawn border. Hit polygons are never drawn, so fidelity beyond that is waste.
const HIT_EPS = 0.03;
// NE 10m inset: the Lesser Antilles arc, where 50m turns real islands into
// 6-30-vertex dots. Whole rings/lines only — a 50m feature is dropped and a
// 10m feature appended ONLY when EVERY vertex lies inside the inset, so
// nothing is ever clipped at the inset edge: no seam, no doubling, no gap.
// Bounds chosen so no big landmass straddles them (Trinidad whole at s 9.8;
// the Virgin Islands in at w -65.7; Puerto Rico straddles and stays 50m).
const INSET = { w: -65.7, e: -59.0, s: 9.8, n: 19.0 };
// ~6 km^2 at 15N: keeps real small islands (Saba ~13 km^2), drops the rocks
// and islets 10m data is full of. Applied to appended 10m rings only.
const MIN_RING_AREA = 0.0005; // deg^2

const inBox = (p) => p[0] >= BOX.w && p[0] <= BOX.e && p[1] >= BOX.s && p[1] <= BOX.n;
const r2 = (v) => Math.round(v * 100) / 100;
const inInset = (p) => p[0] >= INSET.w && p[0] <= INSET.e && p[1] >= INSET.s && p[1] <= INSET.n;
const allInInset = (pts) => pts.every(inInset);
// shoelace |area| in deg^2 (planar — fine for an islet threshold at 10-19N)
function ringAreaDeg2(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a / 2);
}
// 10m vertex spacing is often finer than the 0.01-deg rounding, leaving runs
// of identical points — collapse them (keeps the closing duplicate).
function dedupe(pts) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i], l = out[out.length - 1];
    if (p[0] !== l[0] || p[1] !== l[1]) out.push(p);
  }
  return out;
}

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

// Douglas-Peucker on a ring's vertex list (endpoints pinned). Planar distance
// in degrees is fine at this tolerance/latitude range. Independent per-country
// simplification can open ~km-scale slivers along shared borders — harmless
// for an invisible hit target.
function simplifyRing(pts, eps) {
  if (pts.length <= 4) return pts;
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = 0, idx = -1;
    const ax = pts[a][0], ay = pts[a][1];
    const dx = pts[b][0] - ax, dy = pts[b][1] - ay;
    const len2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      let d;
      if (len2 === 0) {
        d = Math.hypot(pts[i][0] - ax, pts[i][1] - ay);
      } else {
        const t = Math.max(0, Math.min(1, ((pts[i][0] - ax) * dx + (pts[i][1] - ay) * dy) / len2));
        d = Math.hypot(pts[i][0] - (ax + t * dx), pts[i][1] - (ay + t * dy));
      }
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > eps) { keep[idx] = true; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
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

Promise.all(Object.values(SRC).map((f) => fetchJson(BASE + f))).then(([coastJ, landJ, adm0J, adm1J, countriesJ, land10J, coast10J]) => {
  // 50m coast, minus lines wholly inside the inset (replaced by 10m below)
  const coast = clipLines(coastJ.features).filter((line) => !allInInset(line));
  const countries = clipLines(adm0J.features);
  const usStates = clipLines(adm1J.features.filter((f) => f.properties.ADM0_A3 === 'USA'));
  const land = [];
  for (const f of landJ.features) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) {
      // outer rings only: NE 50m land has no lake holes inside this clip box
      if (allInInset(poly[0])) continue; // replaced by the 10m inset
      const c = clipRing(poly[0]);
      if (c && c.length >= 3) land.push([c]); // each ring -> its own single-ring polygon
    }
  }

  // Lesser Antilles inset: append 10m land rings and coast lines wholly inside
  // INSET. Rings stay closed (the 50m convention); each is its own single-ring
  // polygon, so this is pure concatenation — no union, no winding work.
  let insetLand = 0, insetCoast = 0;
  for (const f of land10J.features) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) {
      const ring = poly[0]; // outer only — no lake holes among the islands
      if (!allInInset(ring)) continue;
      if (ringAreaDeg2(ring) < MIN_RING_AREA) continue;
      const r = dedupe(ring.map((p) => [r2(p[0]), r2(p[1])]));
      if (r.length < 4) continue;
      if (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1]) r.push([r[0][0], r[0][1]]);
      land.push([r]);
      insetLand++;
    }
  }
  for (const f of coast10J.features) {
    const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates]
      : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [];
    for (const line of lines) {
      if (!allInInset(line)) continue;
      // a closed islet loop below the land threshold must not outlive its ring
      const closed = line[0][0] === line[line.length - 1][0] && line[0][1] === line[line.length - 1][1];
      if (closed && ringAreaDeg2(line) < MIN_RING_AREA) continue;
      const r = dedupe(line.map((p) => [r2(p[0]), r2(p[1])]));
      if (r.length >= 2) { coast.push(r); insetCoast++; }
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
  // countries.js — per-country hover hit-targets. Outer rings only (holes
  // dropped: hovering Lake Nicaragua saying "Nicaragua" is fine and smaller),
  // clipRing then Douglas-Peucker at HIT_EPS. Small Caribbean islands are kept
  // — they're where hover earns its keep.
  const hitFeatures = [];
  for (const f of countriesJ.features) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    const rings = [];
    for (const poly of polys) {
      const c = clipRing(poly[0]);
      if (!c || c.length < 3) continue;
      const s = simplifyRing(c, HIT_EPS);
      if (s.length < 4) continue;
      if (s[0][0] !== s[s.length - 1][0] || s[0][1] !== s[s.length - 1][1]) s.push(s[0]); // close the ring
      rings.push([s]);
    }
    if (!rings.length) continue;
    hitFeatures.push({
      type: 'Feature',
      properties: { name: f.properties.NAME },
      geometry: { type: 'MultiPolygon', coordinates: rings },
    });
  }
  const cfc = { type: 'FeatureCollection', features: hitFeatures };
  const cjs = JSON.stringify(cfc);
  const cfile = `/*
 * countries.js — Hurricane Console
 * GENERATED by tools/build-basemap.js — do not hand-edit.
 * Natural Earth 1:50m admin-0 countries (public domain), clipped to
 * lon -145..5 / lat -5..45, outer rings only, Douglas-Peucker eps ${HIT_EPS} deg,
 * rounded to 0.01 deg. ${hitFeatures.length} named countries; ~${Math.round(cjs.length / 1024)} KB.
 * These are INVISIBLE hover hit-targets for the country-name tooltip — never
 * drawn; the visible borders live in basemap.js. Loaded lazily by app.js on
 * hover-capable (desktop) pointers only.
 */
(function (root) {
  'use strict';
  root.HC_COUNTRIES =
${cjs};
  if (typeof module !== 'undefined' && module.exports) module.exports = root.HC_COUNTRIES;
})(typeof window !== 'undefined' ? window : globalThis);
`;

  const js = JSON.stringify(fc);
  const file = `/*
 * basemap.js — Hurricane Console
 * GENERATED by tools/build-basemap.js — do not hand-edit.
 * Natural Earth 1:50m (public domain), clipped to lon -145..5 / lat -5..45,
 * rounded to 0.01 deg, with a 1:10m Lesser Antilles inset (lon ${INSET.w}..${INSET.e} /
 * lat ${INSET.s}..${INSET.n} — whole-feature swap, no clip seam). Layers: land fill,
 * coastline, country borders (admin-0
 * everywhere), state lines (admin-1, USA only — deliberate border policy).
 * ${land.length} land rings (${insetLand} inset), ${coast.length} coast lines (${insetCoast} inset), ${countries.length} country lines, ${usStates.length} US state lines; ~${Math.round(js.length / 1024)} KB.
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
    '| land', land.length, '(inset', insetLand + ')', '| coast', coast.length, '(inset', insetCoast + ')',
    '| countries', countries.length, '| usStates', usStates.length);
  fs.writeFileSync(OUT_COUNTRIES, cfile);
  console.log('wrote', OUT_COUNTRIES, '—', Math.round(cfile.length / 1024), 'KB',
    '| named countries', hitFeatures.length, '| eps', HIT_EPS);
}).catch((e) => { console.error('build failed:', e.message); process.exit(1); });
