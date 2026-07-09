# Forecast track + cone from TCM advisories — design

Date: 2026-07-09
Status: approved (user), pending implementation

## Purpose

When a storm is active, the app must answer "where is it going?" It currently shows
analyzed positions (TWD SPECIAL FEATURES) and its own +24h dead-reckoning, but not
the official NHC 5-day forecast. This feature adds the official forecast track and a
computed cone of uncertainty, sourced from the TCM (Marine/Aviation Tropical Cyclone
Forecast/Advisory) text product.

## Constraints

- No backend, no proxy, no API keys. NHC's official cone GeoJSON is CORS-blocked
  (verified: no Access-Control-Allow-Origin on nhc.noaa.gov), so the cone is
  **computed** from the TCM track using NHC's published seasonal cone radii, and
  labeled as computed.
- The header badge continues to describe the TWD product only. TCM fetch failure
  never sets ERROR; the layer is simply absent and the meta line notes it.
- Parser code runs in browser and node (test.js), ES5-ish, no dependencies.

## Data flow

1. In TWD mode, after the TWD fetch, request the recent product list for type `TCM`
   from api.weather.gov (CORS-open; network-first via existing SW rules).
2. Fetch up to the 8 newest TCM product texts (covers 5 simultaneous Atlantic
   storms with margin); parse each; keep the latest advisory per storm ID; keep
   only Atlantic storms (ID starts `AL`).
3. Render all active storms' tracks + cones on `tcmLayer`.
4. No active storms → empty product list or no AL storms → no layer, no error.
5. Pasting a TCM text (detected by `FORECAST/ADVISORY` in the first lines) renders
   that single track, badge PASTED.
6. `TCM_SAMPLE` added to sample.js so SAMPLE mode demos the feature.

## Parser: `parseTCM(raw)` in parser.js

Input: raw TCM text. Output (or `null` if the header/center can't be parsed):

```
{ stormId: 'AL092026', name: 'Erin', classification: 'Hurricane',
  advisory: 12, issuedZ: '10/0900Z',
  center: { lat, lon }, windKt, gustKt, pressureMb, motion,
  track: [ { hours, validZ, lat, lon, windKt, state } ] }
```

- Header: `HURRICANE ERIN FORECAST/ADVISORY NUMBER 12` + the `AL092026` line →
  name, classification (title-cased), advisory number, storm ID.
- `CENTER LOCATED NEAR 26.5N 75.0W AT 10/0900Z` → initial position/time.
- `PRESENT MOVEMENT TOWARD ...` via existing `parseMotion`; pressure/winds via
  regexes in the style of `extractCyclones`.
- `FORECAST VALID 10/1800Z 27.5N 76.5W` and `OUTLOOK VALID ...` blocks, each with
  `MAX WIND ... KT`: one track entry per block. `hours` computed from day/time
  arithmetic vs the initial time (day rollover handled month-free: if forecast day
  < initial day, add days across the boundary).
- End states: a block containing `DISSIPATED` / `POST-TROP` sets
  `state: 'dissipated' | 'post-tropical'` on that entry (position may be absent for
  dissipated; entry then omitted from geometry but kept in data).
- Never throws on malformed input; returns null or a partial track.

## Cone: `coneFromTrack(points)` in parser.js

- `CONE_RADII_NM`: table of forecast-hour → radius (nm) from NHC's published cone
  sizes for the current season (source: nhc.noaa.gov/aboutcone.shtml; verify the
  2026 Atlantic values at implementation time; cite year + URL in a comment).
  Hour 0 uses a small fixed radius (~10 nm) so the cone starts near the center.
- Geometry (planar approximation, same lat-scaled-lon math as `project()`):
  for each track point compute left/right offset points perpendicular to the local
  track heading at that hour's radius; polygon = left side outbound, semicircular
  arc (sampled ~8 points) around the final point, right side inbound, arc around
  the start. Interpolate radii for any nonstandard hour.
- Returns `[{lat,lon}, ...]` polygon ring. Sanity property: every track point lies
  inside the ring; width is non-decreasing with hours.

## Rendering (app.js)

- `var tcmLayer = L.layerGroup().addTo(map)` — populated in TWD mode, cleared when
  entering TWO mode (mode-exclusive, same rule as other layers).
- Cone: `L.polygon(ring)` translucent fill (~0.08), dashed outline, drawn beneath
  the track. Popup: `CONE ◇ computed from NHC <year> radii — official cone at
  hurricanes.gov` (inferred styling; this is the provenance contract for a
  reconstructed product).
- Track: solid polyline from current center through forecast points; circle marker
  per point, color by intensity using the cyclone palette (red ≥64 kt, orange
  ≥34 kt, pale <34 kt), radius slightly smaller than the analyzed-center marker.
  Popup per point: `+48h · 10/1800Z · 95 kt` style. Permanent name tooltip only on
  the current center (already provided by the TWD cyclone marker; the TCM layer
  does not add a second permanent label).
- Legend: add `Forecast track` (solid swatch) and `Cone · computed ◇` (dashed).
- Meta line: append `· N forecast tracks` when present; `track n/a` when the TCM
  fetch failed while TWD succeeded.

## Error handling

- TCM list/product fetch failure, or zero AL storms → no layer; meta notes it;
  badge untouched.
- `parseTCM` null → skip that product.
- Paste routing precedence: `FORECAST/ADVISORY` → TCM; else `Tropical Weather
  Outlook` → TWO; else TWD.

## Testing (test.js)

- Real archived TCM fixture (from nhc.noaa.gov text archive) + a synthetic one:
  - header fields (name, ID, advisory), center coords, windKt/pressure values
  - track length and hour offsets (12/24/36/48/60/72/96/120), coordinate values
  - day-rollover case (forecast crossing into the next day/month boundary)
  - dissipated/post-tropical end-state handling
  - `parseTCM('garbage')` → null, no throw
- `coneFromTrack`: all track points inside ring; ring width grows with hours.
- All 39 existing assertions stay green.

## Shipping

- sw.js VERSION bump; CLAUDE.md architecture table + parser pass list updated;
  README feature list updated.
- Verify end-to-end: local serve + Playwright (paste fixture → track + cone render,
  popups correct, TWO toggle clears layer); live deploy check.

## Out of scope

Wind-radii quadrants (34/50/64 kt), TCP public advisories, watches/warnings
overlay, notifications, East Pacific TCM (EP storm IDs filtered out for now).
