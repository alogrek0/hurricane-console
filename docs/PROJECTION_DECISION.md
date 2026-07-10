# Hurricane Console — Map Projection Decision & Handoff Brief

Purpose: hand off a cartographic decision reached in a separate design discussion so you
(Claude Code, which knows this codebase) can advise on and implement the changes. This
document is self-contained — it assumes no knowledge of that discussion.

---

## 1. Context & goal

The console is a Leaflet-based PWA that visualizes NHC Tropical Weather Discussions and
storm tracks. Leaflet's default map CRS is Web Mercator (EPSG:3857).

The design goal that drove this decision: **minimize distortion of recurving Atlantic
storm tracks.** The tracks we care about are born in the deep tropics (Cape Verde /
Main Development Region, ~10–15°N), move WNW toward SC/NC, then many recurve — turning
north and then northeast as "fish storms" out into the open Atlantic. The domain therefore
spans roughly **10°N to 45°N**, and the interesting feature (the recurve) happens up in the
mid-latitudes.

## 2. Key finding

The thing that distorts a recurve is **angle**, not distance or area. A recurve is a change
of heading, so the projection property that matters is **conformality** (local angle
preservation). This reframes the projection choice entirely:

- **Plate carrée / equirectangular (EPSG:4326)** — `x = lon, y = lat`. Equidistant along
  meridians only, and *not conformal*. Meridians stay parallel and evenly spaced at all
  latitudes, so as a track climbs into the mid-latitudes its eastward motion gets stretched.
  The northeast recurve leg shears — it flattens and leans too far east, and the implied
  heading is wrong. Great in the tropics, wrong exactly where our storms recurve.
- **Web Mercator (EPSG:3857)** — Leaflet's default. It *is* conformal (headings are true,
  rhumb lines straight), so track shape is actually fine. It was set aside only because of
  its poleward area inflation, which visually exaggerates the northward leg by ~1.4× at 45°N.
- **Equidistant conic** — considered as a "middle" option and rejected: it's conic but
  equidistant, not conformal, so it still shears angles. Not right for track fidelity.
- **Lambert Conformal Conic (LCC)** — conformal (preserves heading and recurve shape) AND on
  a cone that hugs the 10–45°N band (near-zero distortion across the whole track). This is the
  decision. It is also the operational standard: NHC, the GFS, and most mid-latitude synoptic
  products use LCC for exactly this reason.

## 3. Decision

**Adopt Lambert Conformal Conic as the display projection for the track-analysis view.**

Suggested parameters (tune standard parallels to the actual storm band — distortion is zero
*at* the standard parallels and minimal between them):

```
+proj=lcc +lat_1=20 +lat_2=40 +lat_0=30 +lon_0=-60 +datum=WGS84 +units=m +no_defs
```

- `lat_1=20`, `lat_2=40` bracket genesis-through-recurve. Adjust if the storm set skews.
- `lon_0` around -60 to -65 keeps the meridian fan symmetric over the Atlantic basin.

## 4. Implementation notes & constraints

**Custom CRS in Leaflet.** LCC is not a built-in Leaflet CRS. It needs `Proj4Leaflet`
(`proj4` + `proj4leaflet`) to define an `L.Proj.CRS` from the proj4 string above, with an
appropriate `origin`, `resolutions`/scales, and bounds for the basin.

**Imagery reprojection gotcha (important).** NHC and GOES raster products are almost always
delivered in equirectangular / plate carrée (EPSG:4326). Leaflet's `L.imageOverlay` does NOT
reproject — it linearly stretches the image between its corner lat/lons. On any non-4326 map
(Mercator today, LCC after this change) that means features drift progressively off-position
as you move away from the equator (too far south/misaligned in the mid-latitudes). So any
raster overlay must either be (a) warped to the display CRS before overlay, or (b) served as
projected tiles, or (c) placed via a projection-aware layer. A plain `imageOverlay` with
corner coords is the trap to avoid.

**Two-mode option (recommended to evaluate).** Warping full-disk / basin GOES imagery to LCC
in-browser per animation frame is expensive. A cleaner pattern may be:
- a "watch the satellite" tropical view that keeps imagery in native 4326 tiles, and
- an "analyze the track" view in LCC for the recurve, where tracks/vectors matter more than
  live imagery.
Whether this is worth it depends on whether the console is primarily imagery-driven or
track-driven — see open questions.

## 5. What I need from you (Claude Code)

You know the current code; I don't want to assume its structure. Please:

1. Inspect how the map/CRS is currently instantiated and how NHC TWD content and any storm
   tracks/overlays are added. Confirm whether raster imagery is used and how it's placed
   (`imageOverlay` corner coords vs tile layer vs GeoJSON).
2. Recommend the cleanest way to introduce a configurable display CRS (LCC via Proj4Leaflet),
   ideally so the projection is swappable rather than hardcoded — this keeps a fast 4326 path
   available and lets us A/B the LCC view.
3. Advise: reproject imagery server-side / at build time vs client-side, given this is a
   GitHub Pages static PWA (no server compute at runtime). Flag what that constraint rules out.
4. Propose a layer architecture for the two-mode idea in section 4, or argue against it if a
   single LCC map is simpler for how the code is actually organized.
5. Call out any refactors, dependencies (`proj4`, `proj4leaflet`), bundle-size, or
   PWA/offline-cache implications, and any interaction with the pending basin-console.zip
   extraction that's currently blocking the repo from going live.

## 6. Open questions for me to answer

- Is the console primarily "watch the live satellite" or "analyze the track"? (Decides whether
  the two-mode split is worth the complexity.)
- Do we need a live GOES basemap under the tracks, or is a static coastline/basemap enough for
  the LCC analysis view?
- What's the real latitude/longitude extent I want to support (affects standard parallels and
  CRS bounds)?

---

*Summary in one line: switch the track view from an angle-distorting projection to Lambert
Conformal Conic (conformal + conic over 10–45°N) so recurves keep their true heading, and
handle the 4326→LCC imagery reprojection deliberately instead of via a linear imageOverlay.*
