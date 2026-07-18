/*
 * app.js — Hurricane Console
 * Fetches the newest Atlantic TWDAT/TWOAT from api.weather.gov, parses it in the
 * browser, and renders the features on a Leaflet map drawn from an embedded
 * all-vector Natural Earth basemap (land, coast, borders). The header badge always
 * tells the truth about the data source: LIVE / CACHED / SAMPLE / PASTED / ERROR /
 * HISTORY (deliberately viewing a past issuance via the scrubber).
 */
(function () {
  'use strict';

  // Per-basin config. Everything that differs between the Atlantic and East
  // Pacific views lives here so the setup section reads it once and the runtime
  // switches by swapping the object. Frame edges are documented per basin.
  //   AT: 5S..45N / 110W..4W — the pre-basin frame, unchanged.
  //   EP: 5S..35N / 145W..70W — south 5S (03.4S coverage + shared basemap clip),
  //       west 145W (140W coverage + label margin; CP east of 140W is honestly
  //       unmapped), north 35N (30N coverage + Gulf of California + Baja), east
  //       70W (monsoon trough starts ~74W; cross-basin waves).
  var BASINS = {
    AT: {
      id: 'AT',
      frame: [[-5, -110], [45, 4]],
      portraitCenter: [13, -45], // fallback if openBounds is absent
      // Phone opening region, centred on the Main Development Region (~13N 45W).
      // The portrait view fills this box, so it opens on the MDR at a regional
      // zoom — wide enough to show the tropical wave belt / ITCZ with context,
      // not a tight crop of empty ocean, and not the whole (wide) basin.
      openBounds: [[-3, -58], [29, -32]],
      awipsTWD: 'TWDAT', awipsTWO: 'TWOAT',
      tcmPrefixes: ['AL'],
      label: 'ATLANTIC',
      gratLon: [-100, 0], gratLat: [-5, 45],
      samples: { TWD: 'TWD_SAMPLE', TWO: 'TWO_SAMPLE', TCM: 'TCM_SAMPLE' }
    },
    EP: {
      id: 'EP',
      frame: [[-5, -145], [35, -70]],
      portraitCenter: [14, -100],
      awipsTWD: 'TWDEP', awipsTWO: 'TWOEP',
      tcmPrefixes: ['EP', 'CP'],
      label: 'E PACIFIC',
      gratLon: [-140, -75], gratLat: [-5, 35],
      samples: { TWD: 'TWDEP_SAMPLE', TWO: 'TWOEP_SAMPLE', TCM: null }
    }
  };
  // Resolve the basin BEFORE map init (from localStorage) so the whole setup
  // section is per-basin — no Atlantic flash when EP is the persisted view.
  var BASIN_KEY = 'hc-basin';
  var basin = BASINS.AT;
  try { var savedBasin = localStorage.getItem(BASIN_KEY); if (BASINS[savedBasin]) basin = BASINS[savedBasin]; } catch (e) { }

  var TWD_URL = 'https://api.weather.gov/products/types/TWD';
  var TWO_URL = 'https://api.weather.gov/products/types/TWO';
  var TCM_URL = 'https://api.weather.gov/products/types/TCM';
  var mode = 'TWD'; // or 'TWO' (outlook formation areas, gazetteer-inferred)
  // Monotonic load token: every loadTWD/loadTWO/paste/switchBasin bumps it so a
  // fetch that resolves after a basin switch or newer load bails instead of
  // rendering into the wrong context.
  var loadGen = 0;

  // --- map setup -------------------------------------------------------------
  var map = L.map('map', {
    center: [17, -55], zoom: 4, minZoom: 3, maxZoom: 7,
    zoomControl: true, attributionControl: false, worldCopyJump: false,
    maxBoundsViscosity: 1.0, // hard edge: a drag can never overshoot the frame
    // Fractional zoom: the fill-viewport floor leaves only ~2 integer levels
    // of range, which made wheel zoom feel like an on/off switch. Eighth-step
    // wheel/pinch snap, quarter-step +/- buttons, and a wheel rate of a
    // quarter-step per notch give a usable, smooth range.
    zoomSnap: 0.125, zoomDelta: 0.25, wheelPxPerZoomLevel: 400
  });
  var PAN_BOUNDS = basin.frame; // 5S hard southern edge — nothing south of it is pannable
  map.setMaxBounds(PAN_BOUNDS);

  // Opening-focus state (portrait/phone). The default fill view centers on the
  // basin's portraitCenter (Atlantic = the MDR), UNLESS an invest-or-higher is
  // active, in which case the first render frames that system instead. The
  // focus is a one-shot opening gesture: consumed once applied, and cancelled
  // the instant the user pans/zooms — so a later refresh never yanks the view.
  var wantOpeningFocus = false; // armed just before the live boot load, so the placeholder sample render never consumes it
  var userMoved = false;
  var programmaticMove = false; // true while WE move the map, so it isn't read as a user pan
  map.on('movestart zoomstart', function () { if (!programmaticMove) userMoved = true; });
  function moveProgrammatic(fn) { programmaticMove = true; try { fn(); } finally { programmaticMove = false; } }

  // Zoom-out floor: the whole basin fits the viewport (chart-fit). Below the
  // window's aspect this letterboxes with dark margins, but the frame edges
  // stay labeled so they read as chart borders — and nothing is ever hidden.
  function fitMinZoom() {
    // snap DOWN to the zoomSnap grid so the full basin is guaranteed visible
    var fit = Math.max(3, Math.floor(map.getBoundsZoom(PAN_BOUNDS, false) * 8) / 8);
    map.setMinZoom(fit);
    if (map.getZoom() < fit) map.setZoom(fit);
  }
  // Opening view. Landscape/desktop: chart-fit (the old fixed 17N 55W @ zoom 4
  // approximated it only on wide windows; on other aspects it opened on an
  // arbitrary mid-ocean slice). Portrait: chart-fit letterboxes badly — the
  // basin is wide, phones are tall — so fill the frame instead, centered on
  // the basin's wave alley (portraitCenter); the rest of the basin pans.
  function applyOpeningView() {
    moveProgrammatic(function () {
      if (map.getSize().x < map.getSize().y) {
        // Portrait/phone: fill the viewport with the opening REGION (Atlantic =
        // the MDR) so it opens centred on that region at a regional zoom, not on
        // the whole wide basin. Filling an interior box leaves no dark bands.
        // Basins without an openBounds fall back to filling the whole frame on
        // portraitCenter (the original behaviour). Snap UP to the zoomSnap grid.
        var region = basin.openBounds ? L.latLngBounds(basin.openBounds) : L.latLngBounds(PAN_BOUNDS);
        var fill = Math.ceil(map.getBoundsZoom(region, true) * 8) / 8;
        map.setView(basin.openBounds ? region.getCenter() : basin.portraitCenter, fill, { animate: false });
      } else {
        map.setView(L.latLngBounds(PAN_BOUNDS).getCenter(), map.getMinZoom(), { animate: false });
      }
    });
  }

  // The invest-or-higher opening focus (portrait only). Called at the end of
  // render()/renderTWO(): while the opening gesture is still pending (not yet
  // consumed, user hasn't moved) and we're in the fill view, frame any active
  // system instead of the MDR default. TWD contributes cyclones (TD and up);
  // TWO contributes AL9x invests that have a mapped spot. A plain disturbance or
  // wave stays below the threshold and does not trigger. When the discussion is
  // quiet (no cyclones), peek at the outlook ONCE for an invest before settling
  // on the MDR — so the common "storm is up" path adds no extra network.
  var openingPeeked = false;
  function activePoints(parsed, kind) {
    var pts = [];
    if (kind === 'TWD') {
      (parsed.cyclones || []).forEach(function (c) {
        if (c.lat != null && c.lon != null) pts.push(ll(c));
      });
    } else {
      (parsed.disturbances || []).forEach(function (d) {
        if (d.lat != null && /^AL9\d$/.test(d.invest || '')) pts.push(ll(d));
      });
    }
    return pts;
  }
  function focusPoints(pts) {
    moveProgrammatic(function () {
      map.fitBounds(L.latLngBounds(pts), { padding: [48, 48], maxZoom: 5.25, animate: false });
    });
    wantOpeningFocus = false; // consumed
  }
  function portrait() { return map.getSize().x < map.getSize().y; }
  function focusOpening(parsed, kind) {
    if (!wantOpeningFocus || userMoved || !portrait()) return;
    var pts = activePoints(parsed, kind);
    if (pts.length) { focusPoints(pts); return; } // focuses + consumes the opening
    // Quiet discussion (no cyclones): peek at the outlook once for an invest,
    // then settle. Consume the opening after the peek resolves so a later
    // refresh or TWO-mode switch never re-grabs the view.
    if (kind === 'TWD' && !openingPeeked) {
      openingPeeked = true;
      var gen = loadGen;
      fetchLatestMatching(TWO_URL, basin.awipsTWO, 12).then(function (res) {
        if (gen !== loadGen || userMoved || !portrait()) return; // superseded — let the newer load decide
        if (wantOpeningFocus && res && res.text) {
          var inv = activePoints(window.BasinParser.parseTWO(res.text, { basin: basin.id }), 'TWO');
          if (inv.length) focusPoints(inv);
        }
        wantOpeningFocus = false; // decision made: system or MDR default
      }).catch(function (e) { console.warn('outlook peek failed', e); wantOpeningFocus = false; }); // no network → keep the MDR default
    } else {
      wantOpeningFocus = false; // no system and no peek to run → settle on the default
    }
  }
  fitMinZoom();
  applyOpeningView();
  window.addEventListener('resize', fitMinZoom);
  // The map container also resizes WITHOUT a window resize — the toolbar grows
  // when the readout fills in after a fetch — and Leaflet only watches the
  // window, so its cached size goes stale and bottom-pinned graticule labels
  // drift under the clipped edge. Watch the container itself.
  if (window.ResizeObserver) {
    new ResizeObserver(function () {
      map.invalidateSize({ animate: false });
      fitMinZoom();
    }).observe(map.getContainer());
  }

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

  // graticule every 5deg — lines span the frame, drawn at the basin's label
  // longitudes/latitudes. Rebuilt per basin switch (AT output is byte-identical
  // to the pre-basin hardcoded loops).
  var graticule = L.layerGroup().addTo(map);
  function buildGraticule() {
    graticule.clearLayers();
    var fs = PAN_BOUNDS[0][0], fw = PAN_BOUNDS[0][1], fn = PAN_BOUNDS[1][0], fe = PAN_BOUNDS[1][1];
    for (var la = basin.gratLat[0]; la <= basin.gratLat[1]; la += 5) graticule.addLayer(
      L.polyline([[la, fw], [la, fe]], { color: '#0f2f42', weight: 1, interactive: false }));
    for (var lo = basin.gratLon[0]; lo <= basin.gratLon[1]; lo += 5) graticule.addLayer(
      L.polyline([[fs, lo], [fn, lo]], { color: '#0f2f42', weight: 1, interactive: false }));
  }
  buildGraticule();

  // graticule labels: chart-frame style — longitude along the bottom edge,
  // latitude along the left, repositioned as the view moves. Density follows
  // zoom so the frame never crowds.
  var gratLabels = document.createElement('div');
  gratLabels.className = 'grat-labels';
  map.getContainer().appendChild(gratLabels);
  function fmtDeg(v, pos, neg) {
    return Math.abs(v) + '°' + (v < 0 ? neg : v > 0 ? pos : '');
  }
  function drawGratLabels() {
    var size = map.getSize();
    var b = map.getBounds();
    var step = map.getZoom() <= 3 ? 10 : 5;
    var html = '';
    // pin rows to the chart margin: just under the frame's bottom edge and
    // just inside its left edge, clamped to the viewport when the frame
    // extends past it
    // 18px keep-out matches the latitude column's bottom margin — enough for
    // the full glyph box + halo even one frame before a size invalidation
    var yRow = Math.min(size.y - 18, map.latLngToContainerPoint([basin.gratLat[0] - 2, 0]).y + 9);
    // (the row anchors 2° below the frame's bottom edge, floating in the
    // letterbox margin when the whole frame is on screen)
    var xCol = Math.max(4, map.latLngToContainerPoint([0, PAN_BOUNDS[0][1]]).x + 6);
    for (var lo = basin.gratLon[0]; lo <= basin.gratLon[1]; lo += 5) {
      if (lo % step || lo < b.getWest() || lo > b.getEast()) continue;
      var x = map.latLngToContainerPoint([0, lo]).x;
      if (x < 16 || x > size.x - 16) continue;
      html += '<span style="left:' + Math.round(x) + 'px;top:' + Math.round(yRow) +
        'px;transform:translate(-50%,-50%)">' + fmtDeg(lo, 'E', 'W') + '</span>';
    }
    for (var la = basin.gratLat[0]; la <= basin.gratLat[1]; la += 5) {
      if (la % step || la < b.getSouth() || la > b.getNorth() + 0.01) continue;
      var y = map.latLngToContainerPoint([la, 0]).y;
      // clamp the frame-top label into view instead of suppressing it —
      // the north edge must stay labeled even when it sits at the viewport's top edge
      if (y >= -2 && y < 12) y = 12;
      if (y < 12 || y > size.y - 18 || Math.abs(y - yRow) < 12) continue;
      html += '<span style="left:' + Math.round(xCol) + 'px;top:' + Math.round(y) +
        'px;transform:translateY(-50%)">' + fmtDeg(la, 'N', 'S') + '</span>';
    }
    gratLabels.innerHTML = html;
  }
  map.on('move zoom viewreset resize', drawGratLabels);
  drawGratLabels();

  var lineLayer = basemapLayer(['usStates', 'countries', 'coast']).addTo(map);

  // Z-ORDER IS DECLARATIVE. Leaflet stacks paths in the order they are ADDED, so
  // add-order stacking is a trap here: a convection box drawn after a trough
  // covers it and steals its taps, and the TCM cone/wind polygons arrive later
  // still (loadTCM resolves after render). Panes pin the stacking regardless of
  // when anything is added: masks < areas < lines < points. A thin line must win
  // a tap over the area fill it crosses — that is the whole point.
  // (overlayPane, which holds the basemap + graticule, is 400; .grat-labels is
  // 450 and the legend/scrub chips 500, so these all stay clear.)
  // 'trail' (415) sits between areas and lines: the history-trail overlay (Track
  // C M3) underlays the live lines/points and is non-interactive, so it annotates
  // the archive under the current features and never steals a tap.
  var PANES = { mask: 402, areas: 410, lines: 420, points: 430, diff: 405, trail: 415 };
  Object.keys(PANES).forEach(function (name) {
    map.createPane('hc-' + name).style.zIndex = PANES[name];
  });

  // Letterbox masks. The embedded basemap spans a box (145W..5E) wider than
  // either frame, so land exists OUTSIDE the current frame (AT would leak
  // Pacific Mexico west of 110W; EP would leak the Caribbean east of 70W and the
  // US coast north of 35N). Four rectangles paint the box-minus-frame in the map
  // background color. They live in their own pane, so a rebuild can never bury
  // the features (the old add-order invariant is gone).
  var maskGroup = L.layerGroup().addTo(map);
  function buildMasks() {
    maskGroup.clearLayers();
    var s = PAN_BOUNDS[0][0], w = PAN_BOUNDS[0][1], n = PAN_BOUNDS[1][0], e = PAN_BOUNDS[1][1];
    // Full-coverage spans, not a fixed margin: the EP frame sits 75deg from the
    // basemap's east edge, and an ultrawide viewport at the zoom-3 floor can
    // show >200deg of longitude — any finite margin invites a leak. Latitude
    // caps at 85 (Leaflet's Mercator clamp).
    var style = { stroke: false, fillColor: '#04101a', fillOpacity: 1, interactive: false,
      pane: 'hc-mask' };
    maskGroup.addLayer(L.rectangle([[-85, -540], [85, w]], style)); // west of frame
    maskGroup.addLayer(L.rectangle([[-85, e], [85, 540]], style));  // east of frame
    maskGroup.addLayer(L.rectangle([[n, w], [85, e]], style));      // north of frame
    maskGroup.addLayer(L.rectangle([[-85, w], [s, e]], style));     // south of frame
  }
  buildMasks();

  // Country-name hover (desktop pointers only). countries.js carries invisible
  // per-country hit polygons (generated alongside basemap.js from the same NE
  // snapshot, so hit edges match the drawn borders). Loaded lazily ONLY on
  // hover-capable pointers: phones never download or parse the ~87 KB, and
  // land stays non-interactive there. Treatment picked in tools/hover-lab.html:
  // cursor chip + faint acknowledgment fill on the hovered country, with a
  // pause-to-show delay — the fill acknowledges the hover immediately, but the
  // name appears only once the cursor RESTS, so it never flickers across every
  // country the pointer merely passes through.
  if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
    var countryScript = document.createElement('script');
    countryScript.src = 'countries.js';
    countryScript.onload = function () {
      var ACK_FILL = 0.06;       // hovered-country acknowledgment (hover-lab dial)
      var HOVER_DELAY_MS = 300;  // pause-to-show rest time (hover-lab dial)
      var countryTip = L.tooltip({ direction: 'top', className: 'country-tip',
        offset: [0, -8], opacity: 1 });
      var hoveredCountry = null;
      var hoverTimer = null;     // pending pause-to-show timeout, or null
      var tipShown = false;      // is the name currently displayed
      var lastHover = null;      // latest {name, latlng} for the timer to show
      var countryHitLayer = L.geoJSON(window.HC_COUNTRIES, {
        // Default overlayPane (400): under the mask (402) and every feature
        // pane, so parsed features always win the pointer. No click handler —
        // path clicks bubble to the map (bubblingMouseEvents default), so
        // click-to-close-popup on land keeps working.
        style: { stroke: false, fillColor: '#dce8ef', fillOpacity: 0,
          className: 'hc-country-hit' },
        interactive: true
      }).addTo(map);
      function clearCountryHover() {
        clearTimeout(hoverTimer); hoverTimer = null;
        tipShown = false;
        if (hoveredCountry) { hoveredCountry.setStyle({ fillOpacity: 0 }); hoveredCountry = null; }
        if (map.hasLayer(countryTip)) map.removeLayer(countryTip);
      }
      countryHitLayer.on('mousemove', function (e) {
        // The letterbox masks are interactive:false, so the pointer reaches hit
        // polygons UNDER them — refuse to name land outside the active frame.
        // Reading PAN_BOUNDS live means switchBasin needs no hook here.
        if (!L.latLngBounds(PAN_BOUNDS).contains(e.latlng)) { clearCountryHover(); return; }
        var layer = e.propagatedFrom || e.layer;
        var entered = hoveredCountry !== layer;
        if (entered) {
          if (hoveredCountry) hoveredCountry.setStyle({ fillOpacity: 0 });
          hoveredCountry = layer;
          layer.setStyle({ fillOpacity: ACK_FILL }); // fill is immediate; the name waits
        }
        lastHover = { name: layer.feature.properties.name, latlng: e.latlng };
        if (tipShown && !entered) {
          // already showing this country's name: just follow the cursor
          countryTip.setContent(lastHover.name).setLatLng(e.latlng);
        } else {
          // pause-to-show: every move restarts the clock; the name appears only
          // once the cursor rests HOVER_DELAY_MS (hover-lab behavior 2).
          tipShown = false;
          if (map.hasLayer(countryTip)) map.removeLayer(countryTip);
          clearTimeout(hoverTimer);
          hoverTimer = setTimeout(function () {
            hoverTimer = null;
            if (!hoveredCountry) return; // hover cleared while the clock ran
            tipShown = true;
            countryTip.setContent(lastHover.name).setLatLng(lastHover.latlng);
            if (!map.hasLayer(countryTip)) countryTip.addTo(map);
          }, HOVER_DELAY_MS);
        }
      });
      countryHitLayer.on('mouseout', clearCountryHover);
    };
    countryScript.onerror = function () {
      console.warn('countries.js failed to load — country hover disabled');
    };
    document.head.appendChild(countryScript);
  }

  // One layer group per feature category so the legend can toggle each class
  // independently. 'fix' has no legend row (small explicit markers, always on).
  // Convergence features, coloured apart. Keep them in the same cyan/teal family
  // — they are one class of feature — and let the legend + popup carry the name.
  var TROUGH_STYLES = {
    itcz:    { color: '#4fc3d6', tag: 'ITCZ', cat: 'itcz' },
    monsoon: { color: '#46c98d', tag: 'MONSOON TROUGH', cat: 'monsoon' },
    trough:  { color: '#1a5c6e', tag: 'TROUGH', cat: 'trough' }
  };

  var cat = {};
  var TWD_CATS = ['itcz', 'monsoon', 'trough', 'convection', 'wave', 'cyclone', 'projection', 'fix', 'inferred'];
  var TCM_CATS = ['track', 'cone', 'wind'];
  TWD_CATS.concat(TCM_CATS).concat(['two', 'diff']).forEach(function (k) {
    cat[k] = L.layerGroup().addTo(map);
  });
  // selClear first: a re-render (refresh, scrubber step, basin switch) can pull
  // the highlighted path out from under an open popup.
  function clearCats(keys) {
    selClear();
    // Any product redraw (refresh, paste, scrubber step, basin switch, error)
    // invalidates the shown chain's history trail — clear it here so the one hook
    // covers every path (the history-scrubber/basin/refresh clears the spec asks for).
    clearTrail();
    keys.forEach(function (k) { cat[k].clearLayers(); });
  }

  // Legend rows carry data-cat="key [key2]"; clicking hides/shows those groups.
  // Hidden groups still receive features on re-render (they're just not on the
  // map), so a toggle is never desynced from the data. Choice persists locally.
  var LAYERS_OFF_KEY = 'hc-layers-off';
  var offCats = [];
  try { offCats = JSON.parse(localStorage.getItem(LAYERS_OFF_KEY) || '[]'); } catch (e) { }
  function setCatVisible(keys, on) {
    keys.forEach(function (k) {
      if (!cat[k]) return;
      if (on) map.addLayer(cat[k]); else map.removeLayer(cat[k]);
    });
  }
  function initLegendToggles() {
    var rows = Array.prototype.slice.call(document.querySelectorAll('#legend [data-cat]'));
    rows.forEach(function (row) {
      var keys = row.getAttribute('data-cat').split(' ');
      // one sync point for class + toggle-button state + map layers
      function setRow(off) {
        row.classList.toggle('off', off);
        row.setAttribute('aria-pressed', String(!off));
        setCatVisible(keys, !off);
      }
      if (keys.every(function (k) { return offCats.indexOf(k) !== -1; })) setRow(true);
      function toggle() {
        var turningOff = !row.classList.contains('off');
        setRow(turningOff);
        keys.forEach(function (k) {
          var i = offCats.indexOf(k);
          if (turningOff && i === -1) offCats.push(k);
          if (!turningOff && i !== -1) offCats.splice(i, 1);
        });
        try { localStorage.setItem(LAYERS_OFF_KEY, JSON.stringify(offCats)); } catch (e) { }
      }
      row.addEventListener('click', toggle);
      row.addEventListener('keydown', function (ev) {
        // 'Spacebar' covers older iOS Safari key values
        if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
          ev.preventDefault(); // Space must not scroll the page
          toggle();
        }
      });
    });
  }
  initLegendToggles();

  // On phones the legend starts as a chip; tapping the header expands it and
  // tapping the map collapses it again so it never lingers over the chart.
  // Desktop keeps the always-open legend, and the toggle is gated on the
  // phone breakpoint so aria-expanded never claims "collapsed" while all
  // nine rows are plainly visible.
  var PHONE = matchMedia('(max-width:520px)');
  var legendEl = document.getElementById('legend');
  var legendHeadEl = document.getElementById('legendHead');
  function syncLegendHead() {
    // Desktop never collapses (the collapse CSS lives behind the phone
    // breakpoint), so a leftover .collapsed class from a phone-sized window
    // must not leak into aria-expanded after a resize.
    legendHeadEl.setAttribute('aria-expanded',
      String(!(PHONE.matches && legendEl.classList.contains('collapsed'))));
  }
  function toggleLegend() {
    if (!PHONE.matches) return; // desktop legend never collapses
    legendEl.classList.toggle('collapsed');
    syncLegendHead();
  }
  if (PHONE.matches) legendEl.classList.add('collapsed');
  syncLegendHead();
  legendHeadEl.addEventListener('click', function (e) {
    e.stopPropagation(); // a chip tap must not fall through as a row toggle
    toggleLegend();
  });
  legendHeadEl.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
      ev.preventDefault();
      toggleLegend();
    }
  });
  map.on('click', function () {
    if (PHONE.matches) { legendEl.classList.add('collapsed'); syncLegendHead(); }
  });
  PHONE.addEventListener('change', syncLegendHead); // resync across the breakpoint

  // --- rendering -------------------------------------------------------------
  function ll(p) { return [p.lat, p.lon]; }

  // Callout HTML. With `ctx` (the source's paragraph, built by the parser in
  // the same normalization as `src`), the popup shows the whole paragraph with
  // the key sentence emphasized; `section` adds a product-section chip. Locate
  // src inside ctx BEFORE escaping, then escape the three segments separately.
  function popup(tag, src, inferred, ctx, section, sub) {
    var head = '<span class="pop-tag' + (inferred ? ' inf' : '') + '">' +
      tag + (inferred ? ' ◇ INFERRED' : '') + '</span>' +
      (section ? '<span class="pop-sec">' + escapeHtml(section) + '</span>' : '') +
      (sub ? '<div class="pop-sub">' + escapeHtml(sub) + '</div>' : '');
    if (ctx && src) {
      var at = ctx.indexOf(src);
      if (at !== -1) {
        return head + '<div class="pop-ctx">' + escapeHtml(ctx.slice(0, at)) +
          '<mark class="pop-key">' + escapeHtml(src) + '</mark>' +
          escapeHtml(ctx.slice(at + src.length)) + '</div>';
      }
    }
    return head + '<div class="pop-src">' + escapeHtml(ctx || src || '') + '</div>';
  }
  // popups keep ~20px per side on narrow viewports instead of going edge-to-edge
  // (maxWidth constrains the CONTENT; Leaflet's wrapper adds ~50px of chrome).
  // maxHeight also respects SHORT viewports (landscape phones) so the scrolling
  // content box can always fit inside the map frame.
  var POPUP_OPTS = { maxWidth: Math.min(340, window.innerWidth - 90),
    maxHeight: Math.min(280, Math.max(140, window.innerHeight - 220)) };

  // A popup anchored high in the basin opens upward past the map frame's top,
  // and autopan CANNOT rescue it — maxBoundsViscosity pins the map at the frame
  // (chart-fit leaves zero pan slack). When the settled popup is clipped above
  // the frame, slide it down over its anchor instead (bounded by the frame
  // bottom). Delayed so Leaflet's ~0.25s autopan animation finishes first —
  // where autopan CAN fix it, the measured clip is 0 and nothing moves.
  // Three settle passes: the popup grows asynchronously (charts arrive after
  // open) and Leaflet's autopan animates ~0.25s, so a single early measurement
  // can capture a stale height/position. Each pass is idempotent — reset,
  // re-measure, re-apply — so once things settle the margin stops changing.
  function fitPopupInView(pop) {
    var tries = 0;
    function settle() {
      var c = pop._container;
      if (!c || !pop.isOpen || !pop.isOpen()) return;
      // Leaflet anchors the popup by its BOTTOM edge (container.style.bottom),
      // so vertical shifts must go through margin-bottom: the stylesheet's 20px
      // is the tip gap; subtracting from it slides the popup DOWN over its
      // anchor. margin-top has no effect on a bottom-positioned box.
      c.style.marginBottom = ''; // re-measure from the natural anchored position
      var mapR = map.getContainer().getBoundingClientRect();
      var r = c.getBoundingClientRect();
      var clip = (mapR.top + 8) - r.top;
      if (clip > 0) {
        var room = (mapR.bottom - 8) - r.bottom;
        var base = parseFloat(getComputedStyle(c).marginBottom) || 0;
        c.style.marginBottom = (base - Math.min(clip, Math.max(0, room))) + 'px';
      }
      if (++tries < 3) setTimeout(settle, 450);
    }
    setTimeout(settle, 300);
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  // Storm-name popup title: NAME (fuh-NEH-tik) — respelling from phonetics.js,
  // constants picked in tools/phonetics-lab.html. Identity entries (lee -> lee)
  // are suppressed, and CP-named storms miss honestly (no CP pronunciation
  // guide). Returns HTML — popup() interpolates the tag unescaped, so only the
  // escaped phonetic ever rides in the span.
  var PHON_SEP = ' ', PHON_PRE = '(', PHON_POST = ')';
  function withPhonetic(name, basinCode) {
    var t = typeof PHONETICS !== 'undefined' && basinCode ? PHONETICS[basinCode] : null;
    var p = t && name ? t[String(name).toLowerCase()] : null;
    var up = String(name).toUpperCase();
    if (!p || p.toLowerCase() === String(name).toLowerCase()) return up;
    return up + PHON_SEP + '<span class="hc-phon">' +
      escapeHtml(PHON_PRE + p + PHON_POST) + '</span>';
  }

  var featureLine = '—'; // "N features · X waves ..." — set by render/renderTWO
  var issuedStr = null;  // raw product issuance line, or null
  var curParsed = null;  // last parsed product actually DRAWN — the diff's "current" side
  var diffOn = false;    // issuance-diff overlay toggle (scrubber row Δ button)
  var diffNote = '';     // "Δ vs <old time>: ..." folded into the meta line while on
  var badgeState = 'SAMPLE'; // last badge; gates the "next update" hint

  // "1 wave" / "3 waves" — count with a naively pluralized noun.
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }

  // Bare relative-age phrase: 'just now' / '12m ago' / '3h ago' / '2d ago'.
  // Returns '' when the product reads more than a couple minutes AHEAD of the
  // client clock — a relative age would be bogus (clock skew or a stale device
  // clock), so the caller shows just the stated time instead of inventing "3h ago".
  function relAge(date) {
    var min = Math.round((Date.now() - date.getTime()) / 60000);
    if (min < -2) return '';
    if (min < 1) return 'just now';
    if (min < 60) return min + 'm ago';
    var hr = Math.round(min / 60);
    if (hr < 48) return hr + 'h ago';
    return Math.round(hr / 24) + 'd ago';
  }

  // Next routine NHC issuance, always relative to NOW. TWD/TWO land on the
  // 00/06/12/18Z synoptic cycle (a few minutes past, hence the "~"). Keyed off
  // the wall clock, not the displayed product's time, so a stale CACHED product
  // still names the real upcoming cycle rather than a long-past one.
  function nextSynoptic() {
    var now = new Date();
    var nextH = (Math.floor(now.getUTCHours() / 6) + 1) * 6; // 6, 12, 18, or 24
    var slot = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + nextH * 3600000;
    var min = Math.round((slot - now.getTime()) / 60000);
    return {
      z: (nextH % 24 < 10 ? '0' : '') + (nextH % 24) + '00Z',
      until: min < 60 ? 'in ' + min + 'm'
        : 'in ' + Math.floor(min / 60) + 'h' + (min % 60 ? (min % 60) + 'm' : ''),
    };
  }

  // Time+zone prefix of a header ("805 AM EDT Mon Jul 7 2026" -> "805 AM EDT").
  // The calendar date is normally carried by the relative age, so the readout
  // shows just the time — but updateMeta re-appends the date (statedDate) when
  // the product is not from today, since touch devices can't reach the hover title.
  function statedTime(header) {
    var m = header.match(/^\s*(\d{3,4}\s*(?:AM|PM)?\s*[A-Z]{1,4})\b/i);
    return m ? m[1].replace(/\s+/g, ' ').trim() : header;
  }
  // Short "Jul 7" date (month + day, no weekday) from a header's "Mon Jul 7 2026"
  // tail, or '' if it has no recognizable date. Anchored on the 4-digit year.
  function statedDate(header) {
    var m = header.match(/\b([A-Za-z]{3})[a-z]*\s+(\d{1,2})\s+\d{4}\b/);
    // normalize the month token: TWD headers say "Jul", TCM headers say "SEP"
    return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() + ' ' + m[2] : '';
  }

  // parseIssued is regex-based and updateMeta runs on every 60s tick and each
  // setBadge, yet issuedStr changes only on load — so memoize on the string value.
  // Keying on issuedStr auto-invalidates when it changes; no separate state to sync.
  var issuedCache = { str: undefined, date: null };
  function issuedDate() {
    if (issuedCache.str !== issuedStr) {
      issuedCache.str = issuedStr;
      var d = issuedStr ? window.BasinParser.parseIssued(issuedStr) : null;
      issuedCache.date = d && !isNaN(d.getTime()) ? d : null;
    }
    return issuedCache.date;
  }

  // The readout (bottom-right). Three lines:
  //   1  features · waves · cyclones · forecast tracks
  //   2  issued <age> · <stated time[ · date]> · local <viewer time>[ · ahead of clock]
  //   3  next ~HHMMZ in ...            (live cycle only)      <version, right>
  function updateMeta() {
    // Line 1: features, with the forecast-track count folded in from tcmNote.
    var line1 = featureLine + (tcmNote ? ' · ' + tcmNote : '') +
      (diffNote ? ' · ' + diffNote : '');

    var d = issuedDate();

    // Line 2: freshness, the product's stated time, and the viewer's local time.
    var line2, titleAttr = '';
    if (!issuedStr) {
      line2 = 'issuance n/a';
    } else if (d) {
      titleAttr = ' title="' + escapeHtml(issuedStr) + '"'; // full header on hover
      var now = new Date();
      var age = relAge(d); // '' only when the product reads ahead of the clock
      var stated = statedTime(issuedStr);
      // Add the calendar date when the product isn't from today — otherwise a
      // touch user (no hover title) can't tell which day an older product is from.
      var sameDay = d.getUTCFullYear() === now.getUTCFullYear() &&
        d.getUTCMonth() === now.getUTCMonth() && d.getUTCDate() === now.getUTCDate();
      var sd = sameDay ? '' : statedDate(issuedStr);
      line2 = 'issued ' + (age ? age + ' · ' : '') + escapeHtml(stated) +
        (sd ? ' · ' + escapeHtml(sd) : '') +
        ' · local ' + escapeHtml(d.toLocaleString([], {
          hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
        })) +
        (age ? '' : ' · ahead of clock'); // skew signal, since age was suppressed
    } else {
      titleAttr = ' title="' + escapeHtml(issuedStr) + '"';
      line2 = 'issued ' + escapeHtml(issuedStr); // unparseable: raw header, no age
    }

    // Line 3: next-issuance hint (only while tracking the live cycle — never over
    // a fixed SAMPLE or a pasted archived product) at left, version at right.
    var nextHtml = '';
    if (badgeState === 'LIVE' || badgeState === 'CACHED') {
      var nx = nextSynoptic();
      nextHtml = '<span class="next">next ~' + nx.z + ' ' + nx.until + '</span>';
    }
    var line3 = '<div class="rd-last">' + nextHtml +
      '<span class="ver">' + escapeHtml(window.APP_VERSION || '') + '</span></div>';

    document.getElementById('meta').innerHTML =
      line1 + '<br><span' + titleAttr + '>' + line2 + '</span>' + line3;
  }

  // Relative age drifts as a storm-watching tab sits open; refresh each minute.
  setInterval(updateMeta, 60000);

  // A 2-3px polyline is a hopeless touch target. Pair every tappable line
  // with an invisible 16px twin and bind the popup to the pair — a near-miss
  // tap still opens it. The twin lives in the same category group, so the
  // legend toggle hides both.
  function tapline(latlngs, style, html) {
    var vis = L.polyline(latlngs, L.extend({}, style, { pane: 'hc-lines' }));
    var hit = L.polyline(latlngs, { weight: 16, opacity: 0, pane: 'hc-lines' });
    var g = L.featureGroup([vis, hit]);
    // _hi = the layer the selection highlight styles. Tagged on ALL THREE
    // because L.FeatureGroup rewrites popup._source to the CHILD that was
    // clicked — usually the invisible twin, which sits on top. Highlighting
    // that twin would style an opacity:0 path (no visible glow at all), so
    // every route must resolve back to the visible line.
    vis._hi = hit._hi = g._hi = vis;
    vis._isLine = true; // selection sheen applies to lines only (see selHighlight)
    return html ? g.bindPopup(html, POPUP_OPTS) : g;
  }

  // --- selection highlight ----------------------------------------------------
  // The popup names the feature, but the map should say so too: a thin trough
  // crossing a dotted convection box is otherwise ambiguous. The selected path
  // keeps its identity color, gains weight, and (for lines) a sheen.

  // The sheen is a 3-stop gradient along the line: its own color at both ends,
  // brightening through the middle. SYMMETRIC on purpose — a one-way fade would
  // read as the feature weakening along its length, and this map does not imply
  // information it doesn't have. It's polish, and it only exists while selected.
  //
  // userSpaceOnUse, not the objectBoundingBox default: a wave axis is a straight
  // line of constant longitude, so its bounding box has ZERO width — and SVG
  // declines to render an objectBoundingBox gradient on a zero-area box, which
  // would make the selected wave disappear entirely.
  var GRAD_ID = 'hc-sel-sheen';
  function ensureGrad(svg) {
    var found = svg.querySelector('#' + GRAD_ID);
    if (found) return found;
    var defs = svg.querySelector('defs');
    if (!defs) { defs = L.SVG.create('defs'); svg.insertBefore(defs, svg.firstChild); }
    var g = L.SVG.create('linearGradient');
    g.setAttribute('id', GRAD_ID);
    g.setAttribute('gradientUnits', 'userSpaceOnUse');
    ['0%', '50%', '100%'].forEach(function (off) {
      var s = L.SVG.create('stop');
      s.setAttribute('offset', off);
      g.appendChild(s);
    });
    defs.appendChild(g);
    return g;
  }
  // mix a hex color toward white
  function lighten(hex, amt) {
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
    if (!m) return hex;
    function up(c) { var v = parseInt(c, 16); return Math.round(v + (255 - v) * amt); }
    return 'rgb(' + up(m[1]) + ',' + up(m[2]) + ',' + up(m[3]) + ')';
  }
  // Anchor the gradient to the line's on-screen run. _parts holds the clipped,
  // projected points, so this follows pan/zoom (hence the moveend/zoomend hook).
  function gradCoords(layer, g) {
    var parts = layer._parts;
    if (!parts || !parts.length || !parts[0].length) return false;
    var tail = parts[parts.length - 1];
    var a = parts[0][0], b = tail[tail.length - 1];
    if (a.x === b.x && a.y === b.y) return false; // degenerate: no direction to shade
    g.setAttribute('x1', a.x); g.setAttribute('y1', a.y);
    g.setAttribute('x2', b.x); g.setAttribute('y2', b.y);
    return true;
  }

  var sel = null; // { layer, weight, color, grad } — restore target for the open popup
  function selHighlight(src) {
    var t = (src && src._hi) || src; // tapline group -> its visible line
    if (!t || !t.setStyle || !t._path) return;
    sel = { layer: t, weight: t.options.weight || 1, color: t.options.color, grad: null };
    // additive, not multiplicative: a 1px box border and a 3px wave axis should
    // land in the same "selected" range rather than the thin ones staying thin
    t.setStyle({ weight: sel.weight + 1.5 });
    L.DomUtil.addClass(t._path, 'hc-sel');
    if (t._isLine && t._path.ownerSVGElement) {
      var g = ensureGrad(t._path.ownerSVGElement);
      var stops = g.childNodes;
      stops[0].setAttribute('stop-color', sel.color);
      stops[1].setAttribute('stop-color', lighten(sel.color, 0.33));
      stops[2].setAttribute('stop-color', sel.color);
      // paint through Leaflet (options.color) rather than the DOM, so a redraw
      // re-applies the gradient instead of reverting to the flat color
      if (gradCoords(t, g)) { sel.grad = g; t.setStyle({ color: 'url(#' + GRAD_ID + ')' }); }
    }
  }
  function selClear() {
    if (!sel) return;
    var t = sel.layer;
    if (t._path) { // still on the map — a re-render may have removed it
      L.DomUtil.removeClass(t._path, 'hc-sel');
      t.setStyle({ weight: sel.weight, color: sel.color });
    }
    sel = null;
  }
  // the sheen is pinned to screen coordinates, so re-anchor it as the map moves
  map.on('moveend zoomend', function () {
    if (sel && sel.grad) gradCoords(sel.layer, sel.grad);
  });
  // _source is Leaflet-private but stable across 1.x: the layer the popup opened from
  map.on('popupopen', function (e) { selClear(); selHighlight(e.popup._source); });
  map.on('popupclose', selClear);

  // --- history trail (Track C M3): one lineage chain's breadcrumb trail -------
  // A popup "history" link (cyclones, waves, tagged disturbances only) draws the
  // tapped feature's archived sighting chain UNDER the live features, styled to
  // the stage-A pick locked in tools/lineage-lab.html:
  //   HC_TRAIL = { mode:'breadcrumbs', n:'all', fade:'linear', w:3, dotR:4 }
  // Breadcrumbs = per-sighting dots fading linearly with age (newest full), a
  // thin constant connector, dashed where the join is weak (proximity/inferred).
  // Honesty invariants (not options): null-position sightings are skipped WITHOUT
  // bridging, broken chains stay separate (they are separate chain objects),
  // proximity/inferred joins stay dashed, genesis links stay dotted-gold, and a
  // stacked anchor collapses to a point (no invented spread). Untagged
  // disturbances get NO link — matching one to a chain risks a wrong lineage, the
  // worst lie this map can tell. w is unused by breadcrumbs (the connector is a
  // fixed thin line, as in the lab); dotR sizes the dots.
  var HC_TRAIL = { mode: 'breadcrumbs', n: 'all', fade: 'linear', w: 3, dotR: 4 };
  // Identity colors from app.js's own feature palette so a trail reads as the same
  // family: waves amber (the wave-axis color), cyclones red (the strong-cyclone
  // color), invests yellow (the TWO base / diff-ghost color), genesis gold (the
  // lab's cross-family link tone).
  var TRAIL_COL = { waves: '#ffa23a', invests: '#ffd23a', cyclones: '#ff6b5a', genesis: '#e8c34f' };

  var trailGroup = L.layerGroup().addTo(map); // all trail layers live in hc-trail
  var trailKey = null;   // specKey of the feature whose trail is drawn, or null
  var lineage = null;    // parsed lineage-2026.json, cached for the session

  function clearTrail() { if (trailGroup) trailGroup.clearLayers(); trailKey = null; }

  // Lazy, session-cached fetch of the season lineage. Relative URL so it resolves
  // on Pages (project subpath) and localhost alike; no SW cache entry is added.
  // On ANY failure cb(null) — the caller shows a quiet note, never a fake trail.
  function loadLineage(cb) {
    if (lineage) { cb(lineage); return; }
    fetchTimed('archive/derived/lineage-2026.json').then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    }).then(function (j) { lineage = j; cb(j); })
      .catch(function (e) { console.warn('lineage fetch failed', e); cb(null); });
  }

  function lineageBasin(j) { return (j && j.basins && j.basins[basin.id]) || null; }
  function stampMs(s) {
    if (!s || s.length < 12) return NaN;
    return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12));
  }
  // Reference "now" for the wave time window: the displayed product's issuance
  // when known (so a matched chain is recent relative to what's on screen), else
  // the wall clock.
  function trailRefMs() { var d = issuedDate(); return d ? d.getTime() : Date.now(); }

  // mappable position of a sighting; null for a null-position invest sighting
  function trailAxisMid(s) {
    var a = s.axis;
    if (a && a.length) { var f = a[0], l = a[a.length - 1]; return [(f.lat + l.lat) / 2, (f.lon + l.lon) / 2]; }
    if (s.meanLon != null) return [12, s.meanLon];
    return null;
  }
  function trailPos(kind, s) {
    if (kind === 'waves') return trailAxisMid(s);
    if (s.lat == null || s.lon == null) return null;
    return [s.lat, s.lon];
  }
  function isSolidLink(link) { return link === 'tag' || link === 'name' || link === 'axis'; }
  // solid only for a strong link on a non-inferred sighting; proximity + inferred
  // stay dashed (the same weak-join honesty as the lab's baseline render)
  function segSolid(s) { return isSolidLink(s.link) && !s.inferred; }
  function waveMeanLon(w) {
    var a = w.axis || [], sum = 0, i; if (!a.length) return null;
    for (i = 0; i < a.length; i++) sum += a[i].lon;
    return sum / a.length;
  }

  // Feature -> chain matching. Conservative: no confident match returns null and
  // the caller says "no tracked lineage" rather than guessing at a wrong chain.
  function matchCyclone(b, name) {
    var nm = String(name || '').toLowerCase(), best = null;
    (b.cyclones || []).forEach(function (ch) {
      if (String(ch.name || '').toLowerCase() !== nm) return;
      var last = ch.sightings[ch.sightings.length - 1].stamp; // several same-name -> newest last-sighting
      if (!best || last > best.last) best = { chain: ch, last: last };
    });
    return best ? { chain: best.chain, kind: 'cyclones' } : null;
  }
  function matchInvest(b, tag) {
    if (!tag) return null;
    var best = null;
    (b.invests || []).forEach(function (ch) {
      if (ch.tag !== tag) return;                  // exact invest-tag match only
      var last = ch.sightings[ch.sightings.length - 1].stamp;
      if (!best || last > best.last) best = { chain: ch, last: last };
    });
    return best ? { chain: best.chain, kind: 'invests' } : null;
  }
  function matchWave(b, meanLon) {
    if (meanLon == null) return null;
    var ref = trailRefMs(), cands = [];
    (b.waves || []).forEach(function (ch) {
      var last = ch.sightings[ch.sightings.length - 1];
      if (last.meanLon == null) return;
      var dlon = Math.abs(last.meanLon - meanLon);
      if (dlon > 6) return;                         // 6deg mean-lon gate
      var t = stampMs(last.stamp);
      if (isNaN(t) || Math.abs(ref - t) > 30 * 3600000) return; // 30h recency gate
      cands.push({ chain: ch, dlon: dlon, meanLon: last.meanLon });
    });
    if (!cands.length) return null;
    cands.sort(function (a, z) { return a.dlon - z.dlon; });
    // two best candidates too close to tell apart -> ambiguous, refuse to guess
    if (cands.length >= 2 && Math.abs(cands[0].meanLon - cands[1].meanLon) <= 2) return { ambiguous: true };
    return { chain: cands[0].chain, kind: 'waves' };
  }
  function matchFor(spec, b) {
    if (spec.kind === 'cyclone') return matchCyclone(b, spec.name);
    if (spec.kind === 'invest') return matchInvest(b, spec.tag);
    if (spec.kind === 'wave') return matchWave(b, spec.meanLon);
    return null;
  }
  function countMappable(chain, kind) {
    var n = 0;
    chain.sightings.forEach(function (s) { if (trailPos(kind, s)) n++; });
    return n;
  }

  // --- trail drawing (breadcrumbs, ported from the lab at the locked dials) ---
  function trailEndpoint(pos, glyph, color) {
    L.marker(pos, { pane: 'hc-trail', interactive: false, keyboard: false,
      icon: L.divIcon({ className: 'hc-trail-ep', iconSize: [14, 14], iconAnchor: [7, 7],
        html: '<span style="color:' + color + '">' + glyph + '</span>' }) }).addTo(trailGroup);
  }
  function drawTrail(chain, kind, b) {
    var color = TRAIL_COL[kind] || TRAIL_COL.waves;
    var pts = [], i; // mappable sightings, oldest->newest (n:'all'); nulls skipped, no bridge
    chain.sightings.forEach(function (s) { var p = trailPos(kind, s); if (p) pts.push({ pos: p, s: s }); });
    if (!pts.length) return;
    var last = pts.length - 1;
    var degenerate = true; // stacked anchor (every sighting one point) -> no fake spread
    for (i = 1; i <= last; i++) {
      if (pts[i].pos[0] !== pts[0].pos[0] || pts[i].pos[1] !== pts[0].pos[1]) { degenerate = false; break; }
    }
    if (!degenerate) {
      for (i = 1; i <= last; i++) {                 // thin constant connector, dashed on weak joins
        var cs = pts[i].s;
        L.polyline([pts[i - 1].pos, pts[i].pos], { pane: 'hc-trail', color: color, weight: 1.2,
          opacity: 0.5, interactive: false, dashArray: segSolid(cs) ? null : '5 6' }).addTo(trailGroup);
      }
    }
    var r = HC_TRAIL.dotR;
    for (i = 0; i <= last; i++) {                    // dots, fill + stroke fading with age
      var fade = last > 0 ? i / last : 1;           // linear: 0 oldest .. 1 newest (newest full)
      L.circleMarker(pts[i].pos, { pane: 'hc-trail', radius: r, color: color, weight: 1.4,
        opacity: 0.35 + 0.65 * fade, fillColor: color, fillOpacity: 0.12 + 0.68 * fade,
        interactive: false }).addTo(trailGroup);
    }
    trailEndpoint(pts[0].pos, '○', color);      // ring: chain start
    trailEndpoint(pts[last].pos, '×', color);   // cross: chain end
    drawTrailGenesis(chain, kind, b);
  }
  function findChainInBasin(b, id) {
    var kinds = ['waves', 'invests', 'cyclones'], i, j;
    for (i = 0; i < kinds.length; i++) {
      var arr = b[kinds[i]] || [];
      for (j = 0; j < arr.length; j++) if (arr[j].id === id) return { chain: arr[j], kind: kinds[i] };
    }
    return null;
  }
  function chainAnchor(entry, atStamp, which) {
    // nearest MAPPABLE sighting to atStamp: 'from' last at/before, 'to' first at/after
    var vis = [], i;
    entry.chain.sightings.forEach(function (s) { var p = trailPos(entry.kind, s); if (p) vis.push({ s: s, pos: p }); });
    if (!vis.length) return null;
    var pick = null;
    if (which === 'from') { for (i = 0; i < vis.length; i++) if (vis[i].s.stamp <= atStamp) pick = vis[i]; if (!pick) pick = vis[0]; }
    else { for (i = 0; i < vis.length; i++) if (vis[i].s.stamp >= atStamp) { pick = vis[i]; break; } if (!pick) pick = vis[vis.length - 1]; }
    return pick.pos;
  }
  // Genesis links touching the drawn chain: a dotted-gold segment to the adjacent
  // endpoint of the linked chain (which is itself NOT drawn — only the segment + a
  // small marker), visually distinct from the breadcrumb connector.
  function drawTrailGenesis(chain, kind, b) {
    (b.genesis || []).forEach(function (link) {
      if (link.from !== chain.id && link.to !== chain.id) return;
      var from = findChainInBasin(b, link.from), to = findChainInBasin(b, link.to);
      if (!from || !to) return;
      var pFrom = chainAnchor(from, link.atStamp, 'from'), pTo = chainAnchor(to, link.atStamp, 'to');
      if (!pFrom || !pTo) return;
      L.polyline([pFrom, pTo], { pane: 'hc-trail', color: TRAIL_COL.genesis, weight: 2,
        opacity: 0.95, dashArray: '2 6', interactive: false }).addTo(trailGroup);
      var other = link.from === chain.id ? pTo : pFrom; // the linked chain's endpoint
      L.circleMarker(other, { pane: 'hc-trail', radius: 3, color: TRAIL_COL.genesis, weight: 1.5,
        opacity: 0.95, fillColor: TRAIL_COL.genesis, fillOpacity: 0.6, interactive: false }).addTo(trailGroup);
    });
  }

  // --- history-link popup affordance -----------------------------------------
  function specKey(spec) {
    if (spec.kind === 'cyclone') return 'cyclone:' + String(spec.name).toLowerCase();
    if (spec.kind === 'invest') return 'invest:' + spec.tag;
    if (spec.kind === 'wave') return 'wave:' + Number(spec.meanLon).toFixed(1);
    return '';
  }
  // Tag-like link + a note slot, carrying the match spec as escaped JSON. Wired on
  // popupopen (Leaflet rebuilds the popup DOM per open), so the label reflects
  // whether THIS feature's trail is the currently shown one.
  function histLink(spec) {
    return '<div class="hc-hist" data-spec="' + escapeHtml(JSON.stringify(spec)) +
      '"><span class="hc-hist-link" role="button" tabindex="0">history</span>' +
      '<div class="hc-hist-note" hidden></div></div>';
  }
  // Reflow the popup after we mutate its DOM, WITHOUT Leaflet's _updateContent
  // (which re-sets innerHTML from the bound string and would drop our live edits +
  // the click handler). Same private-API idiom as the selection sheen above.
  function reflowPopup(pop) {
    var c = pop._container;
    if (c) c.style.visibility = 'hidden';
    if (pop._updateLayout) pop._updateLayout();
    if (pop._updatePosition) pop._updatePosition();
    if (c) c.style.visibility = '';
    if (pop._adjustPan) pop._adjustPan();
    fitPopupInView(pop); // grown content may re-clip at the frame top
  }
  function wireHistLink(pop) {
    var el = pop.getElement && pop.getElement();
    if (!el) return;
    var host = el.querySelector('.hc-hist');
    if (!host) return;
    var link = host.querySelector('.hc-hist-link');
    var note = host.querySelector('.hc-hist-note');
    var spec;
    try { spec = JSON.parse(host.getAttribute('data-spec')); } catch (e) { return; }
    var key = specKey(spec);
    function showNote(msg) { note.textContent = msg; note.hidden = false; }
    function caption(chain, kind) {
      var n = countMappable(chain, kind);
      return n + ' archived sighting' + (n === 1 ? '' : 's') + ' · computed lineage — breaks are honest';
    }
    function paint() {
      var active = trailKey === key;
      link.textContent = active ? 'hide history' : 'history';
      // reopening the active feature's popup restores its provenance caption
      if (active && lineage) {
        var b = lineageBasin(lineage), m = b ? matchFor(spec, b) : null;
        if (m && m.chain) showNote(caption(m.chain, m.kind));
      }
    }
    function activate() {
      if (trailKey === key) { clearTrail(); note.hidden = true; note.textContent = ''; paint(); reflowPopup(pop); return; }
      loadLineage(function (j) {
        if (!j) { showNote('season archive unavailable'); reflowPopup(pop); return; } // honest: no data, no trail
        var b = lineageBasin(j), m = b ? matchFor(spec, b) : null;
        clearTrail(); // one trail at a time; replace whatever was shown
        if (!m || m.ambiguous || !m.chain) { showNote('no tracked lineage'); paint(); reflowPopup(pop); return; }
        drawTrail(m.chain, m.kind, b);
        trailKey = key;
        showNote(caption(m.chain, m.kind));
        paint(); // label -> "hide history"
        reflowPopup(pop);
      });
    }
    paint();
    link.onclick = function (ev) { ev.preventDefault(); activate(); };
    link.onkeydown = function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') { ev.preventDefault(); activate(); }
    };
  }
  map.on('popupopen', function (e) { wireHistLink(e.popup); wireGenesis(e.popup); fitPopupInView(e.popup); });

  // --- genesis ledger popup (Track C M4 stage B) ------------------------------
  // A tagged-invest popup renders that invest's genesis ledger record: the
  // step-dual chance sparkline + the ruler timeline, styled to the stage-B pick
  // locked in tools/genesis-lab.html. Verdicts are READ from genesis-2026.json,
  // never recomputed in the browser. Honesty invariants (not options): null
  // chances gap — never interpolated; the pending window is hatched, never
  // guessed; unresolved is cross-hatched gold naming the nearby cyclone(s); the
  // genesis ★ appears ONLY on a formed lineage link. Untagged areas get nothing
  // (no tag, no record match — same rule as the history affordance).
  var HC_GENESIS = { timeline: 'ruler', tlRow: 15, tlGlyph: 10, tlChips: true, tlHatch: 5,
    spark: 'step-dual', sparkW: 10, sparkH: 36, spark48: true,
    spacing: 'time', bandOp: 0.23, dotR: 2, sparkStroke: 1.5 };
  // the TWO 7d-pct threshold colors (same values as renderTWO's inline pick)
  function genPctCol(pct) { return pct >= 60 ? '#ff4d3d' : pct >= 40 ? '#ff9d3a' : '#ffd23a'; }
  var GEN_GOLD = '#e8c34f', GEN_AMBER = '#ffa23a', GEN_DIM = '#6f8ea0', GEN_SLATE = '#4a6474';

  var genesisData = null; // parsed genesis-2026.json, cached for the session
  function loadGenesis(cb) {
    if (genesisData) { cb(genesisData); return; }
    fetchTimed('archive/derived/genesis-2026.json').then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    }).then(function (j) { genesisData = j; cb(j); })
      .catch(function (e) { console.warn('genesis ledger fetch failed', e); cb(null); });
  }

  // exact tag match; several same-tag chains (a broken then re-used tag) ->
  // newest last-sighting, the record the on-screen area belongs to
  function genesisRecordFor(j, tag) {
    var b = (j && j.basins && j.basins[basin.id]) || null;
    if (!b || !tag) return null;
    var best = null;
    (b.invests || []).forEach(function (r) {
      if (r.tag !== tag) return;
      if (!best || r.lastStamp > best.lastStamp) best = r;
    });
    return best;
  }

  var GEN_SVGNS = 'http://www.w3.org/2000/svg';
  var genPatSeq = 0;
  function genSv(tag, attrs) {
    var e = document.createElementNS(GEN_SVGNS, tag);
    if (attrs) for (var k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    return e;
  }
  function genText(x, y, s, attrs) {
    var e = genSv('text', attrs); e.setAttribute('x', x); e.setAttribute('y', y); e.textContent = s; return e;
  }
  function genHatch(defs, color, cross) {
    var id = 'hcgx' + (genPatSeq++), gap = 4 + (10 - HC_GENESIS.tlHatch);
    var p = genSv('pattern', { id: id, width: gap, height: gap, patternUnits: 'userSpaceOnUse',
      patternTransform: 'rotate(45)' });
    p.appendChild(genSv('line', { x1: 0, y1: 0, x2: 0, y2: gap, stroke: color, 'stroke-width': 1, opacity: 0.7 }));
    if (cross) p.appendChild(genSv('line', { x1: 0, y1: 0, x2: gap, y2: 0, stroke: color, 'stroke-width': 1, opacity: 0.7 }));
    defs.appendChild(p);
    return 'url(#' + id + ')';
  }
  var GEN_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function genFmt(s) {
    if (!s || s.length < 12) return String(s || '');
    var d = new Date(stampMs(s));
    function p2(n) { return (n < 10 ? '0' : '') + n; }
    return GEN_MON[d.getUTCMonth()] + ' ' + d.getUTCDate() + ' ' + p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()) + 'Z';
  }
  var GEN_DAY = 86400000;

  // ruler timeline (lab tlRuler at the locked dials, popup-sized viewBox)
  function genesisRuler(rec, nowStamp) {
    var glyph = HC_GENESIS.tlGlyph;
    var W = 270, PADX = 40, H = 108, axisY = 62;
    var svg = genSv('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: H,
      class: 'hc-gen-ruler', preserveAspectRatio: 'xMinYMid meet' });
    var defs = genSv('defs'); svg.appendChild(defs);
    var startMs = stampMs(rec.firstStamp), lastMs = stampMs(rec.lastStamp), nowMs = stampMs(nowStamp);
    var winEnd = lastMs + 7 * GEN_DAY;
    var endMs = Math.max(winEnd, lastMs, nowMs > lastMs ? Math.min(nowMs, winEnd) : lastMs);
    if (endMs <= startMs) endMs = startMs + GEN_DAY;
    var x0 = PADX, x1 = W - 26;
    function X(ms) { return x0 + (ms - startMs) / (endMs - startMs) * (x1 - x0); }

    if (winEnd > nowMs && nowMs >= startMs && rec.outcome.kind !== 'formed') {
      var pStart = Math.max(nowMs, lastMs);
      svg.appendChild(genSv('rect', { x: X(pStart), y: axisY - 14, width: Math.max(2, X(winEnd) - X(pStart)),
        height: 28, fill: genHatch(defs, GEN_AMBER, false), stroke: GEN_AMBER,
        'stroke-opacity': 0.5, 'stroke-dasharray': '3 3' }));
      svg.appendChild(genText((X(pStart) + X(winEnd)) / 2, axisY + 30, 'pending window',
        { fill: GEN_AMBER, 'font-size': 9, 'text-anchor': 'middle' }));
    }
    if (rec.outcome.kind === 'unresolved-nearby-cyclone') {
      var firstUn = null;
      rec.statements.forEach(function (s) {
        if (firstUn == null && (s.verdict7 === 'unresolved' || s.verdict48 === 'unresolved')) firstUn = s.stamp;
      });
      var uStart = firstUn ? stampMs(firstUn) : startMs, earliest = null;
      rec.outcome.nearby.forEach(function (n) {
        var m = stampMs(n.firstStamp); if (earliest == null || m < earliest) earliest = m;
      });
      var uEnd = earliest != null ? Math.min(Math.max(earliest, lastMs), endMs) : lastMs;
      svg.appendChild(genSv('rect', { x: X(uStart), y: axisY - 16, width: Math.max(3, X(uEnd) - X(uStart)),
        height: 32, fill: genHatch(defs, GEN_GOLD, true), stroke: GEN_GOLD, 'stroke-opacity': 0.6 }));
      var names = rec.outcome.nearby.map(function (n) { return n.name; }).join(' · ');
      svg.appendChild(genText((X(uStart) + X(uEnd)) / 2, axisY + 30, 'unresolved — ' + names,
        { fill: GEN_GOLD, 'font-size': 9, 'text-anchor': 'middle', 'font-weight': 700 }));
    }
    if (nowMs >= startMs && nowMs <= endMs) {
      svg.appendChild(genSv('line', { x1: X(nowMs), y1: axisY - 24, x2: X(nowMs), y2: axisY + 18,
        stroke: GEN_DIM, 'stroke-width': 1, 'stroke-dasharray': '2 3' }));
      svg.appendChild(genText(X(nowMs), axisY - 27, 'now', { fill: GEN_DIM, 'font-size': 8, 'text-anchor': 'middle' }));
    }
    svg.appendChild(genSv('line', { x1: x0, y1: axisY, x2: x1, y2: axisY, stroke: '#2c5870', 'stroke-width': 1.4 }));
    svg.appendChild(genText(x0 - 6, axisY + 4, '○', { fill: GEN_DIM, 'font-size': glyph + 3, 'text-anchor': 'end' }));
    svg.appendChild(genText(x0 - 6, axisY + 16, genFmt(rec.firstStamp).slice(0, 6),
      { fill: GEN_DIM, 'font-size': 7, 'text-anchor': 'end' }));
    var tagDone = false;
    rec.statements.forEach(function (s) {
      var xx = X(stampMs(s.stamp)), has7 = s.chance7 != null;
      var col = has7 ? genPctCol(s.chance7.pct) : GEN_SLATE;
      svg.appendChild(genSv('line', { x1: xx, y1: axisY - glyph, x2: xx, y2: axisY + glyph,
        stroke: col, 'stroke-width': has7 ? 2.2 : 1.2, 'stroke-dasharray': has7 ? null : '2 2',
        'stroke-linecap': 'round' }));
      if (!has7) svg.appendChild(genText(xx, axisY - glyph - 3, 'null', { fill: GEN_DIM, 'font-size': 6, 'text-anchor': 'middle' }));
      if (!tagDone && s.tagged && rec.tag) {
        tagDone = true;
        svg.appendChild(genText(xx, axisY - glyph - 6, rec.tag,
          { fill: GEN_AMBER, 'font-size': 9, 'font-weight': 700, 'text-anchor': 'middle' }));
      }
    });
    if (rec.outcome.kind === 'formed' && rec.outcome.genesisStamp) {
      var gx = X(stampMs(rec.outcome.genesisStamp));
      svg.appendChild(genText(gx, axisY - glyph - 7, '★', { fill: GEN_GOLD, 'font-size': glyph + 7, 'text-anchor': 'middle' }));
      svg.appendChild(genSv('line', { x1: gx, y1: axisY - glyph, x2: gx, y2: axisY + glyph, stroke: GEN_GOLD, 'stroke-width': 2 }));
      svg.appendChild(genText(gx, axisY + 30, rec.outcome.cycloneName || 'genesis',
        { fill: GEN_GOLD, 'font-size': 9, 'text-anchor': 'middle', 'font-weight': 700 }));
    }
    svg.appendChild(genText(X(lastMs), axisY + 4, '×', { fill: GEN_DIM, 'font-size': glyph + 5, 'text-anchor': 'middle' }));
    svg.appendChild(genText(x1, axisY + 16, genFmt(rec.lastStamp), { fill: GEN_DIM, 'font-size': 7, 'text-anchor': 'end' }));
    return svg;
  }

  // step-dual sparkline (lab drawSpark/sparkStep at the locked dials, scale 1)
  function genesisSpark(rec) {
    var w = HC_GENESIS.sparkW, h = HC_GENESIS.sparkH, padL = 4, padR = 4, padY = 3;
    var sts = rec.statements, n = sts.length;
    var xs; // time-true x spacing: honest issuance gaps (the locked pick)
    if (HC_GENESIS.spacing === 'time' && n > 1) {
      var t0 = stampMs(sts[0].stamp), span = (stampMs(sts[n - 1].stamp) - t0) || 1;
      var totalW = (n - 1) * w;
      xs = sts.map(function (s) { return (stampMs(s.stamp) - t0) / span * totalW; });
    } else {
      xs = sts.map(function (_, i) { return i * w; });
    }
    var W = (xs.length ? xs[xs.length - 1] : 0) + padL + padR;
    var plotH = h - padY * 2;
    function Y(pct) { return padY + (100 - pct) / 100 * plotH; }
    function X(i) { return padL + xs[i]; }
    var svg = genSv('svg', { width: W, height: h, viewBox: '0 0 ' + W + ' ' + h, class: 'hc-gen-spark' });
    var op = HC_GENESIS.bandOp;
    svg.appendChild(genSv('rect', { x: 0, y: Y(100), width: W, height: Y(60) - Y(100), fill: '#ff4d3d', opacity: op }));
    svg.appendChild(genSv('rect', { x: 0, y: Y(60), width: W, height: Y(40) - Y(60), fill: '#ff9d3a', opacity: op }));
    svg.appendChild(genSv('rect', { x: 0, y: Y(40), width: W, height: Y(0) - Y(40), fill: '#ffd23a', opacity: op * 0.7 }));
    function stepPath(key) { // step, never smoothed; null -> gap, path breaks
      var d = '', have = false, py = null;
      for (var i = 0; i < n; i++) {
        var c = sts[i][key];
        if (!c) { have = false; py = null; continue; }
        var x = X(i), y = Y(c.pct);
        if (!have) { d += 'M' + x + ',' + y; have = true; }
        else { d += 'L' + x + ',' + py + 'L' + x + ',' + y; }
        py = y;
      }
      return d;
    }
    if (HC_GENESIS.spark48) {
      svg.appendChild(genSv('path', { d: stepPath('chance48'), fill: 'none', stroke: '#ff9d3a',
        'stroke-width': Math.max(0.6, (HC_GENESIS.sparkStroke - 1) * 0.7), opacity: 0.6, 'stroke-linejoin': 'round' }));
    }
    svg.appendChild(genSv('path', { d: stepPath('chance7'), fill: 'none', stroke: '#dce8ef',
      'stroke-width': HC_GENESIS.sparkStroke, 'stroke-linejoin': 'round' }));
    sts.forEach(function (s, i) {
      if (s.chance7) svg.appendChild(genSv('circle', { cx: X(i), cy: Y(s.chance7.pct), r: HC_GENESIS.dotR, fill: genPctCol(s.chance7.pct) }));
      if (HC_GENESIS.spark48 && s.chance48) svg.appendChild(genSv('circle', { cx: X(i), cy: Y(s.chance48.pct),
        r: HC_GENESIS.dotR * 0.7, fill: 'none', stroke: '#ff9d3a', 'stroke-width': 0.8 }));
    });
    if (rec.outcome.kind === 'formed' && rec.outcome.genesisStamp) { // ★ formed only
      var gm = stampMs(rec.outcome.genesisStamp), gi = n - 1;
      for (var i = 0; i < n; i++) if (stampMs(sts[i].stamp) >= gm) { gi = i; break; }
      svg.appendChild(genText(X(gi), h - 1, '★', { fill: GEN_GOLD, 'font-size': 8, 'text-anchor': 'middle' }));
    }
    return svg;
  }

  function genesisOutcomeLine(rec) {
    var o = rec.outcome;
    if (o.kind === 'formed') return 'formed → ' + (o.cycloneName || o.cycloneId) + ' @ ' + genFmt(o.genesisStamp);
    if (o.kind === 'open') return 'open — pending';
    if (o.kind === 'unresolved-nearby-cyclone') {
      return 'unresolved — nearby ' + o.nearby.map(function (n) { return n.name; }).join(' · ');
    }
    return 'no cyclone';
  }

  // Fill the popup's .hc-gen host: sparkline + ruler + provenance caption. On any
  // miss the note is quiet and honest — no data, no chart.
  function wireGenesis(pop) {
    var el = pop.getElement && pop.getElement();
    if (!el) return;
    var host = el.querySelector('.hc-gen');
    if (!host || host.getAttribute('data-done')) return;
    var tag = host.getAttribute('data-tag');
    if (!tag) return;
    host.setAttribute('data-done', '1');
    loadGenesis(function (j) {
      var note = document.createElement('div');
      note.className = 'hc-hist-note';
      if (!j) { note.textContent = 'season ledger unavailable'; host.appendChild(note); reflowPopup(pop); return; }
      var rec = genesisRecordFor(j, tag);
      if (!rec) { note.textContent = 'no season ledger entry'; host.appendChild(note); reflowPopup(pop); return; }
      var wrap = document.createElement('div');
      wrap.className = 'hc-gen-scroll';
      wrap.appendChild(genesisSpark(rec));
      host.appendChild(wrap);
      host.appendChild(genesisRuler(rec, j.nowStamp));
      note.textContent = rec.statements.length + ' stated outlook' + (rec.statements.length === 1 ? '' : 's') +
        ' · ' + genesisOutcomeLine(rec) + ' · ★ only on a genesis link';
      host.appendChild(note);
      reflowPopup(pop);
    });
  }

  function render(parsed) {
    curParsed = parsed;
    clearCats(TWD_CATS);

    // The ITCZ, the monsoon trough and an ordinary surface trough are different
    // features and the parser now tells them apart (parser.js troughKind). NHC's
    // own chart labels the first two in text and dashes the third; we colour-code
    // instead — a house convention, not NHC's, so the popup always names it.
    parsed.troughs.forEach(function (t) {
      var st = TROUGH_STYLES[t.subtype] || TROUGH_STYLES.trough;
      tapline(t.line.map(ll), { color: st.color, weight: 2 },
        popup(st.tag, t.source, false, t.context, t.srcSection))
        .addTo(cat[st.cat]);
    });

    parsed.convection.forEach(function (c) {
      L.rectangle([[c.bbox.s, c.bbox.w], [c.bbox.n, c.bbox.e]], {
        color: c.strong ? '#ff6b5a' : '#ffb98a', weight: 1, dashArray: '3 3',
        fillColor: c.strong ? '#ff6b5a' : '#ff9d6a', fillOpacity: 0.10,
        pane: 'hc-areas'
      }).bindPopup(popup(c.strong ? 'CONVECTION · STRONG' : 'CONVECTION', c.source, false,
        c.context, c.srcSection), POPUP_OPTS)
        .addTo(cat.convection);
    });

    parsed.waves.forEach(function (w) {
      var wLon = waveMeanLon(w); // history matches on the wave's mean axis lon
      tapline(w.axis.map(ll), { color: '#ffa23a', weight: 3 },
        popup('WAVE ' + w.id, w.source, false, w.context, w.srcSection) +
          (wLon != null ? histLink({ kind: 'wave', meanLon: wLon }) : ''))
        .addTo(cat.wave);
      // small motion arrowhead label at the axis head
      L.circleMarker(ll(w.axis[0]), { radius: 3, color: '#ffa23a', fillOpacity: 1,
        pane: 'hc-points' })
        .addTo(cat.wave);
    });

    // Active cyclones from SPECIAL FEATURES. A stated center IS a fix — solid
    // marker, non-inferred popup; only the +24h projection is inferred.
    (parsed.cyclones || []).forEach(function (c) {
      var isHur = /hurricane/i.test(c.classification);
      var isStorm = /storm/i.test(c.classification);
      var style = isHur
        ? { radius: 9, color: '#ff6b5a', fillColor: '#ff6b5a', fillOpacity: 0.9, weight: 2, pane: 'hc-points' }
        : isStorm
          ? { radius: 7, color: '#ffa23a', fillColor: '#ffa23a', fillOpacity: 0.85, weight: 2, pane: 'hc-points' }
          : { radius: 6, color: '#dce8ef', fillColor: '#dce8ef', fillOpacity: 0.7, weight: 2, pane: 'hc-points' };
      var motionTxt = !c.motion ? 'motion n/a'
        : c.motion.stationary ? 'stationary'
          : c.motion.bearing + '° at ' + c.motion.slowKt +
            (c.motion.fastKt !== c.motion.slowKt ? '-' + c.motion.fastKt : '') + ' kt' +
            (c.motion.unit === 'mph' ? ' (stated in mph)' : '');
      var stats = (c.windKt != null ? c.windKt + ' kt' : 'winds n/a') + ' · ' +
        (c.pressureMb != null ? c.pressureMb + ' mb' : 'pressure n/a') + ' · ' + motionTxt;
      L.circleMarker(ll(c), style)
        .bindTooltip(c.name, { permanent: true, direction: 'top', className: 'cyc-label' })
        .bindPopup(popup(c.classification.toUpperCase() + ' ' + withPhonetic(c.name, basin.id),
          c.source, false, c.context, c.srcSection, stats) +
          histLink({ kind: 'cyclone', name: c.name }), POPUP_OPTS)
        .addTo(cat.cyclone);
    });

    parsed.projections.forEach(function (p) {
      var pts = p.band ? [ll(p.slow), ll(p.fast)] : [ll(p.slow)];
      if (p.band) {
        tapline([ll(p.from), ll(p.slow)], { color: '#9a86c9', weight: 2, dashArray: '5 4' },
          popup('+24h ' + (p.id || p.waveId) + ' (slow)', p.source, true, p.context, p.srcSection))
          .addTo(cat.projection);
        tapline([ll(p.from), ll(p.fast)], { color: '#9a86c9', weight: 2, dashArray: '5 4' },
          popup('+24h ' + (p.id || p.waveId) + ' (fast)', p.source, true, p.context, p.srcSection))
          .addTo(cat.projection);
        L.circleMarker(ll(p.slow), { radius: 3, color: '#9a86c9', fillOpacity: .6, pane: 'hc-points' })
          .bindPopup(popup('+24h ' + (p.id || p.waveId) + ' (slow)', p.source, true, p.context, p.srcSection), POPUP_OPTS).addTo(cat.projection);
        L.circleMarker(ll(p.fast), { radius: 3, color: '#9a86c9', fillOpacity: .6, pane: 'hc-points' })
          .bindPopup(popup('+24h ' + (p.id || p.waveId) + ' (fast)', p.source, true, p.context, p.srcSection), POPUP_OPTS).addTo(cat.projection);
      } else {
        tapline([ll(p.from), ll(p.slow)], { color: '#9a86c9', weight: 2, dashArray: '5 4' },
          popup('+24h ' + (p.id || p.waveId), p.source, true, p.context, p.srcSection))
          .addTo(cat.projection);
        L.circleMarker(ll(p.slow), { radius: 3, color: '#9a86c9', fillOpacity: .6, pane: 'hc-points' })
          .bindPopup(popup('+24h ' + (p.id || p.waveId), p.source, true, p.context, p.srcSection), POPUP_OPTS).addTo(cat.projection);
      }
    });

    parsed.fixes.forEach(function (f) {
      L.circleMarker(ll(f), { radius: 4, color: '#dce8ef', weight: 1.5, fillOpacity: 0, pane: 'hc-points' })
        .bindPopup(popup('FIX', f.source, false, f.context, f.srcSection), POPUP_OPTS)
        .addTo(cat.fix);
    });

    parsed.inferred.forEach(function (f) {
      L.circleMarker(ll(f), {
        radius: 5, color: '#9a86c9', weight: 1.5, dashArray: '3 3', fillOpacity: 0,
        pane: 'hc-points'
      }).bindPopup(popup('POSITION', f.source, true, f.context, f.srcSection), POPUP_OPTS)
        .addTo(cat.inferred);
    });

    var nCyc = (parsed.cyclones || []).length;
    var n = nCyc + parsed.waves.length + parsed.troughs.length + parsed.convection.length +
      parsed.fixes.length + parsed.inferred.length;
    featureLine = plural(n, 'feature') + ' · ' + plural(parsed.waves.length, 'wave') +
      (nCyc ? ' · ' + plural(nCyc, 'cyclone') : '');
    issuedStr = parsed.issued || null;
    updateMeta();
    focusOpening(parsed, 'TWD');
  }

  // TWO formation areas: prose locations, so every circle is inferred by
  // definition. Colored by the 7-day chance using NHC's yellow/orange/red.
  function renderTWO(parsed) {
    curParsed = parsed;
    clearCats(TWD_CATS);
    cat.two.clearLayers();
    var unmapped = 0;
    parsed.disturbances.forEach(function (d) {
      if (d.lat == null) { unmapped++; return; } // honest: never invent a spot
      var pct7 = d.chance7 ? d.chance7.pct : 0;
      var color = pct7 >= 60 ? '#ff4d3d' : pct7 >= 40 ? '#ff9d3a' : '#ffd23a';
      var label = 'TWO ' + d.id +
        ' · 48h ' + (d.chance48 ? d.chance48.pct + '%' : 'n/a') +
        ' / 7d ' + (d.chance7 ? d.chance7.pct + '%' : 'n/a');
      L.circle(ll(d), {
        radius: 300000, color: color, weight: 2, dashArray: '6 5',
        fillColor: color, fillOpacity: 0.08, pane: 'hc-areas'
        // history only for a TAGGED disturbance — an untagged area has no invest
        // id to match a chain on, so offering the link would risk a wrong lineage.
      }).bindPopup(popup(label, d.source, true, d.context) +
        (d.invest ? histLink({ kind: 'invest', tag: d.invest }) +
          '<div class="hc-gen" data-tag="' + escapeHtml(d.invest) + '"></div>' : ''),
        POPUP_OPTS).addTo(cat.two);
    });
    var n = parsed.disturbances.length;
    featureLine = plural(n, 'outlook area') +
      (unmapped ? ' · ' + unmapped + ' not mappable — see product text' : '');
    issuedStr = parsed.issued || null;
    updateMeta();
    focusOpening(parsed, 'TWO');
  }

  // --- data source -----------------------------------------------------------
  function setBadge(state) {
    badgeState = state;
    var b = document.getElementById('badge');
    b.className = 'badge ' + state;
    b.textContent = state;
    updateMeta(); // reflect the resolved provenance (e.g. show/hide next-update)
    updateScrub(); // scrubber visibility follows the badge (hidden unless LIVE/CACHED/HISTORY)
  }

  // A parse/render throw must never strand a half-drawn (or stale) map under
  // the previous product's readout: ERROR always means blank features and an
  // honest meta line. setBadge repaints the meta, so no updateMeta here.
  function clearToError(site, e) {
    console.error(site + ' failed', e);
    curParsed = null;
    clearCats(TWD_CATS.concat(TCM_CATS).concat(['two', 'diff']));
    tcmNote = '';
    featureLine = '—';
    issuedStr = null;
    setBadge('ERROR');
  }

  // api.weather.gov can accept the connection and then stall, which would pulse
  // LOADING forever — and LOADING is the one badge state that must resolve.
  // Bound every fetch so a stall falls into the normal catch → CACHED/SAMPLE/
  // ERROR chain instead of hanging.
  var FETCH_TIMEOUT_MS = 15000;
  function fetchTimed(url, opts) {
    if (typeof AbortController === 'undefined') return fetch(url, opts);
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, FETCH_TIMEOUT_MS);
    opts = opts || {};
    opts.signal = ctl.signal;
    return fetch(url, opts).then(
      function (r) { clearTimeout(timer); return r; },
      function (e) { clearTimeout(timer); throw e; });
  }

  // api.weather.gov's product types are 3-letter AWIPS categories (TWD, TWO)
  // that mix basins and offices — the newest TWD may be the East Pacific
  // issuance or Guam's. Scan the recent list for the newest product carrying
  // the wanted AWIPS id (TWDAT / TWOAT, on the product's third line).
  function fetchLatestMatching(listUrl, awipsId, n) {
    return fetchTimed(listUrl, { headers: { Accept: 'application/ld+json' } }).then(function (r) {
      var cached = r.headers.get('X-From-Cache') === '1';
      if (!r.ok) throw new Error('list ' + r.status);
      return r.json().then(function (j) {
        var items = (j['@graph'] || j.features || []).slice(0, n);
        if (!items.length) throw new Error('no products');
        var idx = 0;
        function tryNext() {
          if (idx >= items.length) throw new Error('no ' + awipsId + ' in newest ' + n);
          var it = items[idx++];
          return fetchTimed(it['@id'] || it.id).then(function (pr) {
            var c2 = cached || pr.headers.get('X-From-Cache') === '1';
            return pr.json().then(function (p) {
              return { text: p.productText || '', cached: c2 };
            });
          }).then(function (got) {
            if (got.text.indexOf(awipsId) !== -1) return got;
            return tryNext();
          }, function (e) {
            // One failed/malformed item must not abort the whole scan — a good
            // product may sit further down the list. Treat it as a no-match.
            console.warn('product scan item failed', e);
            return tryNext();
          });
        }
        return tryNext();
      });
    });
  }

  // Refresh feedback: NOAA confirmed there's nothing newer than what's shown.
  // Keyed on the fetched text itself (per product mode); pasted products don't
  // participate — the comparison is strictly fetch-vs-previous-fetch. Only a
  // LIVE (non-cached) answer earns the toast: a cache hit proves nothing.
  var lastFetched = {}; // keyed basin.id + mode, so the "no new product" toast never crosses basins
  var toastTimer = null;
  function toast(msg) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.hidden = false;
    el.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.style.opacity = '0';
      toastTimer = setTimeout(function () { el.hidden = true; }, 350);
    }, 4200);
  }
  function noNewProductToast() {
    var d = window.BasinParser.parseIssued(issuedStr || '');
    var z = d ? ('0' + d.getUTCHours()).slice(-2) + ('0' + d.getUTCMinutes()).slice(-2) + 'Z' : '';
    toast('No new product — still the latest' + (z ? ' (' + z + ' issuance)' : '') + '.');
  }

  function loadTWD(fromUser) {
    resetHistory();
    var gen = ++loadGen; // a later load or basin switch supersedes this fetch
    setBadge('LOADING'); // in-flight; resolves to the real source below
    // n 8->12: the TWD list mixes basins (TWDAT + TWDEP + ...), so scan deeper
    // for the wanted AWIPS id; sequential tryNext makes the deeper scan free.
    fetchLatestMatching(TWD_URL, basin.awipsTWD, 12).then(function (res) {
      if (gen !== loadGen) return; // stale: a basin switch / newer load won
      if (!res.text) throw new Error('empty');
      // Fetch succeeded: a parse/render failure here is a real error, and
      // falling back to SAMPLE would lie about the data source.
      try {
        // Parse fully before touching the map, so a parser throw can't leave
        // the previous product's layers up under a fresh readout.
        var parsed = window.BasinParser.parse(res.text, { basin: basin.id });
        render(parsed);
        setBadge(res.cached ? 'CACHED' : 'LIVE');
        twdState = res.cached ? 'cached' : 'live';
        var key = basin.id + 'TWD';
        if (fromUser && !res.cached && res.text === lastFetched[key]) noNewProductToast();
        if (!res.cached) lastFetched[key] = res.text;
        // Persist the last REAL product (live or cached) so a refresh can repaint
        // it instantly instead of flashing the fictional embedded sample.
        try { localStorage.setItem('hc-last-' + basin.id + '-TWD', res.text); } catch (e) { }
      } catch (e) {
        clearToError('TWD render', e);
        twdState = 'error';
      }
      loadTCM(gen);
    }).catch(function (e) {
      if (gen !== loadGen) return;
      // no network + nothing cached -> embedded sample
      console.warn('TWD fetch failed', e);
      var sample = sampleText('TWD');
      if (!sample) { clearToError('TWD fetch (no sample)', e); twdState = 'error'; loadTCM(gen); return; }
      try {
        render(window.BasinParser.parse(sample, { basin: basin.id }));
        setBadge('SAMPLE');
        twdState = 'sample';
      } catch (e2) {
        clearToError('TWD sample render', e2);
        twdState = 'error';
      }
      loadTCM(gen);
    });
  }

  function loadTWO(fromUser) {
    resetHistory();
    var gen = ++loadGen;
    setBadge('LOADING'); // in-flight; resolves to the real source below
    fetchLatestMatching(TWO_URL, basin.awipsTWO, 12).then(function (res) {
      if (gen !== loadGen) return;
      if (!res.text) throw new Error('empty');
      try {
        // Parse-before-render, as in loadTWD: never mutate layers on a throw.
        var parsed = window.BasinParser.parseTWO(res.text, { basin: basin.id });
        renderTWO(parsed);
        setBadge(res.cached ? 'CACHED' : 'LIVE');
        var key = basin.id + 'TWO';
        if (fromUser && !res.cached && res.text === lastFetched[key]) noNewProductToast();
        if (!res.cached) lastFetched[key] = res.text;
        try { localStorage.setItem('hc-last-' + basin.id + '-TWO', res.text); } catch (e) { }
      } catch (e) {
        clearToError('TWO render', e);
      }
    }).catch(function (e) {
      if (gen !== loadGen) return;
      console.warn('TWO fetch failed', e);
      var sample = sampleText('TWO');
      if (!sample) { clearToError('TWO fetch (no sample)', e); return; }
      try {
        renderTWO(window.BasinParser.parseTWO(sample, { basin: basin.id }));
        setBadge('SAMPLE');
      } catch (e2) {
        clearToError('TWO sample render', e2);
      }
    });
  }

  // Resolve the current basin's embedded sample for a product kind (TWD/TWO/TCM),
  // or null when that basin ships none (EP has no TCM sample).
  function sampleText(kind) {
    var name = basin.samples[kind];
    return name ? window[name] : null;
  }

  // like fetchLatest but returns the newest n product texts
  function fetchRecent(listUrl, n) {
    return fetchTimed(listUrl, { headers: { Accept: 'application/ld+json' } }).then(function (r) {
      if (!r.ok) throw new Error('list ' + r.status);
      return r.json().then(function (j) {
        var items = (j['@graph'] || j.features || []).slice(0, n);
        if (!items.length) return [];
        return Promise.all(items.map(function (it) {
          return fetchTimed(it['@id'] || it.id)
            .then(function (pr) { return pr.json(); })
            .then(function (p) { return p.productText || ''; })
            .catch(function (e) { console.warn('TCM product fetch failed', e); return ''; });
        }));
      });
    });
  }

  // --- product history (scrubber) --------------------------------------------
  // Lazy: nothing extra is fetched until the first ◀ tap. The TWD/TWO lists mix
  // basins and offices (TWDAT + TWDEP + ...), so scan the newest HIST_SCAN items
  // in parallel (same shape as fetchRecent) and keep the newest HIST_KEEP that
  // carry the wanted AWIPS id. Reusing the bare list URL means the SW's data
  // cache from the initial load can serve the scan offline.
  var HIST_SCAN = 30;
  var HIST_KEEP = 8;
  var hist = { texts: null, idx: 0, srcBadge: null, loading: false, gen: 0 };

  // Every fresh load or mode switch invalidates the scan (gen guards in-flight
  // fetches against resolving into the new context).
  function resetHistory() {
    hist.gen++;
    hist.texts = null;
    hist.idx = 0;
    hist.srcBadge = null;
    hist.loading = false;
    // The diff overlay compares against this history — it dies with it.
    diffOn = false;
    diffNote = '';
    cat.diff.clearLayers();
    syncDiffUI();
    updateScrub();
  }

  function fetchHistory(listUrl, awipsId) {
    return fetchTimed(listUrl, { headers: { Accept: 'application/ld+json' } }).then(function (r) {
      if (!r.ok) throw new Error('list ' + r.status);
      return r.json().then(function (j) {
        var items = (j['@graph'] || j.features || []).slice(0, HIST_SCAN);
        return Promise.all(items.map(function (it) {
          return fetchTimed(it['@id'] || it.id)
            .then(function (pr) { return pr.json(); })
            .then(function (p) { return p.productText || ''; })
            .catch(function (e) { console.warn('history item fetch failed', e); return ''; });
        }));
      });
    }).then(function (texts) {
      return texts.filter(function (t) {
        return t.indexOf(awipsId) !== -1;
      }).slice(0, HIST_KEEP);
    });
  }

  var twdState = 'sample'; // 'live' | 'cached' | 'sample' | 'error' — set by loadTWD
  var tcmNote = '';

  function loadTCM(gen) {
    fetchRecent(TCM_URL, 8).then(function (texts) {
      if ((gen != null && gen !== loadGen) || mode !== 'TWD') return;
      var byStorm = {};
      texts.forEach(function (t) {
        var p = window.BasinParser.parseTCM(t);
        if (!p || !p.stormId || basin.tcmPrefixes.indexOf(p.stormId.slice(0, 2)) === -1) return;
        if (!byStorm[p.stormId] || byStorm[p.stormId].advisory < p.advisory) byStorm[p.stormId] = p;
      });
      var storms = Object.keys(byStorm).map(function (k) { return byStorm[k]; });
      renderTCM(storms);
      tcmNote = storms.length ? plural(storms.length, 'track') : '';
      updateMeta();
    }).catch(function (e) {
      if ((gen != null && gen !== loadGen) || mode !== 'TWD') return;
      console.warn('TCM fetch failed', e);
      if (twdState === 'sample') {
        // SAMPLE demos the TCM feature only where a sample exists (Atlantic Lee).
        // EP ships no TCM sample by design: render nothing and stay quiet.
        // 'track n/a' is reserved for a LIVE TWD whose TCM fetch actually failed.
        var s = sampleText('TCM');
        var p = s ? window.BasinParser.parseTCM(s) : null;
        renderTCM(p ? [p] : []);
        tcmNote = p ? '1 track (sample)' : '';
      } else {
        renderTCM([]);
        tcmNote = 'track n/a';
      }
      updateMeta();
    });
  }

  function intensityColor(kt) {
    return kt >= 64 ? '#ff6b5a' : kt >= 34 ? '#ffa23a' : '#dce8ef';
  }
  // wind-field bands get their own 50-kt tier; intensityColor stays as-is so
  // 50-63 kt track dots keep their established color
  function windBandColor(kt) {
    return kt >= 64 ? '#ff6b5a' : kt >= 50 ? '#ff8749' : '#ffa23a';
  }

  function renderTCM(storms) {
    clearCats(TCM_CATS);
    (storms || []).forEach(function (s) {
      var pts = [{ hours: 0, lat: s.center.lat, lon: s.center.lon }].concat(s.track);
      // Cone radii are per-basin; derive the basin from the storm id so a pasted
      // EP TCM gets EP radii for free (AL/EP/CP). windFieldFromTCM needs no basin.
      var ring = window.BasinParser.coneFromTrack(pts, s.stormId ? s.stormId.slice(0, 2) : undefined);
      // Phonetic basin from the storm id too (a pasted TCM can be either basin,
      // whatever frame is active). CP is deliberately absent: no CP guide.
      var phonBasin = { AL: 'AT', EP: 'EP' }[s.stormId ? s.stormId.slice(0, 2) : ''];
      if (ring) {
        L.polygon(ring.map(ll), {
          color: '#7ea3b8', weight: 1.5, dashArray: '4 4',
          fillColor: '#dce8ef', fillOpacity: 0.07, interactive: true, pane: 'hc-areas'
        }).bindPopup(popup('CONE ' + withPhonetic(s.name, phonBasin),
          'Computed from NHC seasonal cone radii - the official cone lives at hurricanes.gov. Advisory #' + s.advisory + ' issued ' + s.issued + '.',
          true)).addTo(cat.cone);
      }
      // current wind field: nested quadrant bands, 34 kt first so the smaller,
      // stronger bands paint on top. Radii are official advisory data (unlike
      // the computed cone) and the popup shows the exact numbers.
      var wf = window.BasinParser.windFieldFromTCM(s);
      (wf || []).forEach(function (band) {
        var q = s.windRadiiNm[band.kt];
        L.polygon(band.ring.map(ll), {
          color: windBandColor(band.kt), weight: 1, opacity: 0.7,
          fillColor: windBandColor(band.kt),
          fillOpacity: band.kt >= 64 ? 0.22 : band.kt >= 50 ? 0.15 : 0.10,
          interactive: true, pane: 'hc-areas'
        }).bindPopup(popup(band.kt + ' KT WIND FIELD · ' + withPhonetic(s.name, phonBasin),
          'Official advisory wind radii, nm (largest anywhere in quadrant): NE ' +
          q.ne + ' / SE ' + q.se + ' / SW ' + q.sw + ' / NW ' + q.nw +
          '. Advisory #' + s.advisory + '.', false))
          .addTo(cat.wind);
      });
      if (s.track.length) {
        tapline(pts.map(ll), { color: '#dce8ef', weight: 2 },
          popup('TRACK ' + withPhonetic(s.name, phonBasin),
            'NHC forecast/advisory #' + s.advisory + ' - positions at ' +
            s.track[0].hours + '-' + s.track[s.track.length - 1].hours + ' h.', false))
          .addTo(cat.track);
      }
      s.track.forEach(function (p) {
        L.circleMarker(ll(p), {
          radius: 5, pane: 'hc-points', color: intensityColor(p.windKt || 0),
          fillColor: intensityColor(p.windKt || 0), fillOpacity: 0.85, weight: 1.5
        }).bindPopup(popup('+' + p.hours + 'h · ' + p.validZ,
          (p.windKt != null ? p.windKt + ' kt' : 'wind n/a') +
          (p.state ? ' · ' + p.state : ''), false))
          .addTo(cat.track);
      });
    });
  }

  // --- UI wiring -------------------------------------------------------------
  document.getElementById('refresh').addEventListener('click', function () {
    // fromUser: an explicit refresh earns "no new product" feedback
    mode === 'TWD' ? loadTWD(true) : loadTWO(true);
  });

  var whichBtn = document.getElementById('which');
  function setMode(m) {
    resetHistory(); // covers the paste path too — every paste branch calls setMode first
    mode = m;
    whichBtn.textContent = mode === 'TWD' ? 'TWD / TWO' : 'TWO / TWD';
    updateSubtitle(); // prodTag follows the product (TWDAT/TWOAT/TWDEP/TWOEP)
    // One badge, one product: never show both products at once.
    if (mode === 'TWD') cat.two.clearLayers();
    else { clearCats(TWD_CATS.concat(TCM_CATS)); tcmNote = ''; }
  }
  whichBtn.addEventListener('click', function () {
    setMode(mode === 'TWD' ? 'TWO' : 'TWD');
    mode === 'TWD' ? loadTWD() : loadTWO();
  });

  // --- basin switcher (header subtitle toggle) -------------------------------
  // The subtitle carries the live product tag and a tap-to-switch basin control.
  // basinBtn follows the legendHead a11y idiom (role=button + tabindex, not a
  // <button> — which would inherit the toolbar's button chrome).
  var prodTagEl = document.getElementById('prodTag');
  var basinBtnEl = document.getElementById('basinBtn');
  function updateSubtitle() {
    prodTagEl.textContent = mode === 'TWD' ? basin.awipsTWD : basin.awipsTWO;
    basinBtnEl.textContent = basin.label + ' ⇄';
    // aria-label names the DESTINATION basin (the tap target), not the current one
    basinBtnEl.setAttribute('aria-label',
      'Switch to ' + (basin.id === 'AT' ? 'East Pacific' : 'Atlantic') + ' basin');
  }

  // Switch the whole map frame + data source to the other basin.
  function switchBasin(id) {
    if (!BASINS[id] || basin.id === id) return;
    basin = BASINS[id];
    try { localStorage.setItem(BASIN_KEY, id); } catch (e) { }
    loadGen++; // kill any in-flight fetch that would resolve into the old basin
    // A basin switch is a fresh opening gesture: re-arm the invest-or-higher
    // focus (and its one-shot outlook peek) for the incoming basin's first load.
    wantOpeningFocus = true; userMoved = false; openingPeeked = false;
    // Clear ALL feature paths BEFORE rebuilding masks (z-order invariant above).
    clearCats(TWD_CATS.concat(TCM_CATS).concat(['two', 'diff']));
    tcmNote = '';
    PAN_BOUNDS = basin.frame;
    map.setMaxBounds(PAN_BOUNDS);
    // Release the min-zoom ratchet BEFORE refitting: getBoundsZoom clamps its
    // result to the CURRENT minZoom, so a tighter previous basin (EP->AT) would
    // keep minZoom pinned too high without dropping to the floor first.
    map.setMinZoom(3);
    fitMinZoom();
    buildMasks();
    buildGraticule();
    applyOpeningView();
    drawGratLabels();
    updateSubtitle();
    mode === 'TWD' ? loadTWD() : loadTWO();
  }
  basinBtnEl.addEventListener('click', function () {
    switchBasin(basin.id === 'AT' ? 'EP' : 'AT');
  });
  basinBtnEl.addEventListener('keydown', function (ev) {
    // 'Spacebar' covers older iOS Safari key values
    if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
      ev.preventDefault(); // Space must not scroll the page
      switchBasin(basin.id === 'AT' ? 'EP' : 'AT');
    }
  });

  // --- history scrubber: ◀ steps back through past issuances, ▶ forward ------
  var scrubEl = document.getElementById('scrub');
  var scrubBack = document.getElementById('scrubBack');
  var scrubFwd = document.getElementById('scrubFwd');
  var scrubLbl = document.getElementById('scrubLabel');
  var diffBtn = document.getElementById('scrubDiff');

  function updateScrub() {
    // Only the fetched-product states can scrub; SAMPLE/PASTED/ERROR/LOADING
    // have no history list behind them.
    var show = badgeState === 'LIVE' || badgeState === 'CACHED' || badgeState === 'HISTORY';
    scrubEl.hidden = !show;
    if (!show) return;
    var maxIdx = hist.texts ? hist.texts.length - 1 : null;
    var atOldest = maxIdx !== null && hist.idx >= maxIdx;
    scrubBack.disabled = hist.loading || atOldest;
    scrubFwd.disabled = hist.loading || hist.idx === 0;
    // The diff needs an older neighbour; at the oldest issuance (or mid-scan)
    // there is none. Before the first scan it stays enabled — the first tap
    // runs the same lazy scan as scrubBack.
    diffBtn.disabled = hist.loading || atOldest;
    scrubLbl.textContent = hist.loading ? 'loading…'
      : hist.idx === 0 ? 'latest'
        : statedTime(issuedStr || '') + ' −' + hist.idx + '/' + maxIdx;
  }

  function scrubTo(i) {
    var t = hist.texts[i];
    var parsed;
    try {
      parsed = mode === 'TWD' ? window.BasinParser.parse(t, { basin: basin.id })
        : window.BasinParser.parseTWO(t, { basin: basin.id });
    } catch (e) {
      console.warn('history parse failed', e);
      toast('Could not parse that issuance.');
      return;
    }
    // Leaving the present: the TCM overlay belongs to the CURRENT advisory —
    // drawing it over a past discussion would lie. Clear before rendering so
    // the render's updateMeta() already omits the track note. (Clearing, not
    // hiding: the legend toggle re-shows hidden layers on any click.)
    if (mode === 'TWD' && hist.idx === 0 && i > 0) { clearCats(TCM_CATS); tcmNote = ''; }
    var returning0 = i === 0 && hist.idx !== 0;
    if (mode === 'TWD') render(parsed); else renderTWO(parsed);
    hist.idx = i;
    renderDiff(); // recompute against the new step's older neighbour
    // -0 restores the true source badge captured when the scan started
    setBadge(i > 0 ? 'HISTORY' : hist.srcBadge);
    if (returning0 && mode === 'TWD') loadTCM(loadGen);
  }

  // First use of the scrubber OR the diff toggle runs the history scan once;
  // done() fires only if the scan is still current and found >=2 issuances.
  // Note texts[0] is the scan's newest — if NOAA issued between load and this
  // tap, -0 will show that newer text under the badge captured here;
  // network-first transport keeps the badge truthful, and Refresh self-heals.
  function ensureHistory(done) {
    if (hist.texts) { done(); return; }
    hist.srcBadge = badgeState; // LIVE or CACHED — controls are hidden otherwise
    hist.loading = true;
    var gen = hist.gen;
    updateScrub();
    fetchHistory(mode === 'TWD' ? TWD_URL : TWO_URL, mode === 'TWD' ? basin.awipsTWD : basin.awipsTWO)
      .then(function (texts) {
        if (gen !== hist.gen) return; // a refresh/mode switch invalidated this scan
        hist.loading = false;
        if (texts.length < 2) { toast('No older issuances found.'); updateScrub(); return; }
        hist.texts = texts;
        done();
      })
      .catch(function (e) {
        if (gen !== hist.gen) return;
        console.warn('history fetch failed', e);
        hist.loading = false;
        toast('Could not fetch history.');
        updateScrub();
      });
  }

  scrubBack.addEventListener('click', function () {
    if (hist.texts) {
      if (hist.idx < hist.texts.length - 1) scrubTo(hist.idx + 1);
      return;
    }
    ensureHistory(function () { scrubTo(1); });
  });
  scrubFwd.addEventListener('click', function () {
    if (hist.texts && hist.idx > 0) scrubTo(hist.idx - 1);
  });

  // --- issuance diff (Δ) ------------------------------------------------------
  // "What changed since the previous issuance?" Ghosts of the prior product's
  // high-signal features under the live ones — dashed, faded, and labeled with
  // the OLD issuance time, so past data can never read as current (the same
  // honesty rule as the badge and the inferred dots). The overlay never touches
  // the badge: that reports the CURRENT product's provenance; every ghost popup
  // carries its own. Compares curParsed against hist.texts[hist.idx + 1].
  var GHOST_ALPHA = 0.35;
  function syncDiffUI() {
    diffBtn.setAttribute('aria-pressed', diffOn ? 'true' : 'false');
    diffBtn.classList.toggle('on', diffOn);
  }
  function pctDelta(o, n) { // chance objects ({pct}|null) → "40%→60% ▲"
    var op = o ? o.pct + '%' : 'n/a', np = n ? n.pct + '%' : 'n/a';
    if (op === np) return np;
    return op + '→' + np + (o && n ? (n.pct > o.pct ? ' ▲' : ' ▼') : '');
  }
  function ghostMark(pt, color, title, body) {
    L.circleMarker(pt, { radius: 6, color: color, weight: 1.5, dashArray: '2 4',
      fillOpacity: 0, opacity: GHOST_ALPHA, pane: 'hc-diff' })
      .bindPopup(popup(title, body, true), POPUP_OPTS).addTo(cat.diff);
  }
  function ghostAxis(axis, color, title, body) {
    L.polyline(axis.map(ll), { color: color, weight: 2, dashArray: '2 6',
      opacity: GHOST_ALPHA, pane: 'hc-diff' })
      .bindPopup(popup(title, body, true), POPUP_OPTS).addTo(cat.diff);
  }
  function ghostConnector(a, b, color) {
    L.polyline([a, b], { color: color, weight: 1, dashArray: '1 5',
      opacity: GHOST_ALPHA, interactive: false, pane: 'hc-diff' }).addTo(cat.diff);
  }
  function renderDiff() {
    cat.diff.clearLayers();
    diffNote = '';
    if (!diffOn || !curParsed || !hist.texts || hist.idx + 1 >= hist.texts.length) {
      updateMeta();
      return;
    }
    var d;
    try {
      var opts = { basin: basin.id };
      var prev = mode === 'TWD'
        ? window.BasinParser.parse(hist.texts[hist.idx + 1], opts)
        : window.BasinParser.parseTWO(hist.texts[hist.idx + 1], opts);
      d = window.HCDiff.diffProducts(prev, curParsed, mode);
    } catch (e) {
      console.warn('diff failed', e);
      diffOn = false;
      syncDiffUI();
      updateMeta();
      toast('Could not compare with the previous issuance.');
      return;
    }
    var oldT = (d.prevIssued && statedTime(d.prevIssued)) || 'previous issuance';
    var was = 'was here · ' + oldT;
    var gonch = 'gone from this issuance · ' + oldT;
    var moved = 0, added = 0, gone = 0;
    if (mode === 'TWD') {
      d.cyclones.pairs.forEach(function (p) {
        moved++;
        var color = /hurricane/i.test(p.cur.classification) ? '#ff6b5a'
          : /storm/i.test(p.cur.classification) ? '#ffa23a' : '#dce8ef';
        ghostConnector(ll(p.prev), ll(p.cur), color);
        var dk = (p.prev.windKt != null && p.cur.windKt != null && p.prev.windKt !== p.cur.windKt)
          ? ' · ' + p.prev.windKt + '→' + p.cur.windKt + ' kt' +
            (p.cur.windKt > p.prev.windKt ? ' ▲' : ' ▼')
          : '';
        ghostMark(ll(p.prev), color,
          p.cur.classification.toUpperCase() + ' ' + p.cur.name.toUpperCase(), was + dk);
      });
      added += d.cyclones.added.length;
      d.cyclones.removed.forEach(function (c) {
        gone++;
        ghostMark(ll(c), '#dce8ef',
          c.classification.toUpperCase() + ' ' + c.name.toUpperCase(), gonch);
      });
      d.waves.pairs.forEach(function (p) {
        moved++;
        var shift = Math.round(Math.abs(
          window.HCDiff.meanLon(p.cur.axis) - window.HCDiff.meanLon(p.prev.axis)));
        ghostAxis(p.prev.axis, '#ffa23a', 'WAVE ' + p.cur.id,
          was + (shift ? ' · moved ~' + shift + '°' : ''));
        ghostConnector(ll(p.prev.axis[0]), ll(p.cur.axis[0]), '#ffa23a');
      });
      added += d.waves.added.length;
      d.waves.removed.forEach(function (w) {
        gone++;
        ghostAxis(w.axis, '#ffa23a', 'WAVE ' + w.id, gonch);
      });
    } else {
      d.disturbances.pairs.forEach(function (p) {
        var label = 'TWO ' + (p.cur.invest || p.cur.id);
        var deltas = '48h ' + pctDelta(p.prev.chance48, p.cur.chance48) +
          ' · 7d ' + pctDelta(p.prev.chance7, p.cur.chance7);
        if (p.prev.lat == null) return; // honest: no old spot, nothing to ghost
        if (p.cur.lat != null && (p.prev.lat !== p.cur.lat || p.prev.lon !== p.cur.lon)) {
          moved++;
          ghostConnector(ll(p.prev), ll(p.cur), '#ffd23a');
          ghostMark(ll(p.prev), '#ffd23a', label, was + ' · ' + deltas);
        } else {
          ghostMark(ll(p.prev), '#ffd23a', label, oldT + ' · ' + deltas);
        }
      });
      added += d.disturbances.added.length;
      d.disturbances.removed.forEach(function (dd) {
        gone++;
        if (dd.lat != null) ghostMark(ll(dd), '#ffd23a', 'TWO ' + (dd.invest || dd.id), gonch);
      });
    }
    diffNote = 'Δ vs ' + oldT + ': ' +
      moved + ' moved · ' + added + ' new · ' + gone + ' gone';
    updateMeta();
  }
  diffBtn.addEventListener('click', function () {
    if (diffOn) { diffOn = false; syncDiffUI(); renderDiff(); return; }
    ensureHistory(function () {
      diffOn = true;
      syncDiffUI();
      updateScrub(); // the first tap's scan may have just populated hist.texts
      renderDiff();
    });
  });

  var aboutDlg = document.getElementById('aboutDlg');
  document.getElementById('about').addEventListener('click', function () { aboutDlg.showModal(); });
  document.getElementById('aboutClose').addEventListener('click', function () { aboutDlg.close(); });

  var dlg = document.getElementById('pasteDlg');
  document.getElementById('paste').addEventListener('click', function () {
    document.getElementById('pasteText').value = '';
    document.querySelector('#pasteDlg h2').textContent = 'Paste an NHC product';
    dlg.showModal();
  });
  document.getElementById('pasteCancel').addEventListener('click', function () { dlg.close(); });
  document.getElementById('pasteMap').addEventListener('click', function () {
    var txt = document.getElementById('pasteText').value;
    dlg.close();
    if (!txt.trim()) return;
    loadGen++; // a pasted product supersedes any in-flight fetch (no resolve-over)
    // Route by product: TCM check first, then TWO, then TWD. Paste stays opts-less
    // (parser auto-detects the basin — a pasted TWDEP still renders clipped in the
    // AT frame if AT is active; the PASTED badge covers that documented looseness).
    // Parse BEFORE mutating any UI state: a bad paste must leave the prior
    // mode/map exactly as they were, with only the badge reporting the failure.
    try {
      if (/FORECAST\/ADVISORY/i.test(txt.slice(0, 400))) {
        var ptcm = window.BasinParser.parseTCM(txt);
        if (!ptcm) throw new Error('unparseable TCM');
        setMode('TWD');
        // Replace whatever was on screen: a pasted TCM stands alone, so drop the
        // previous product's features and its readout provenance rather than
        // leaving a stale issuance/counts under the PASTED badge.
        clearCats(TWD_CATS);
        renderTCM([ptcm]);
        featureLine = ptcm.classification + ' ' + ptcm.name + ' · adv ' + ptcm.advisory;
        issuedStr = ptcm.issuedHeader || null; // "2100 UTC SUN SEP 15 2024"
        tcmNote = '1 track (pasted)';
        updateMeta();
      } else if (/tropical weather outlook/i.test(txt.slice(0, 300))) {
        var ptwo = window.BasinParser.parseTWO(txt);
        setMode('TWO');
        renderTWO(ptwo);
      } else {
        var ptwd = window.BasinParser.parse(txt);
        setMode('TWD');
        clearCats(TCM_CATS);
        tcmNote = '';
        render(ptwd);
      }
      setBadge('PASTED');
    } catch (e) {
      console.error('paste parse failed', e);
      setBadge('ERROR');
    }
  });

  // --- boot ------------------------------------------------------------------
  // Sync the subtitle to the persisted basin, then repaint the LAST REAL product
  // (persisted from the previous visit) instantly so a refresh doesn't flash the
  // fictional sample — then try live data, which silently replaces it. On a
  // first-ever visit there's nothing to repaint: the map shows basemap-only
  // under LOADING, and loadTWD's catch still renders the embedded SAMPLE if the
  // fetch fails (offline / sandboxed preview). The badge is left to loadTWD.
  updateSubtitle();
  try {
    var lastReal = null;
    try { lastReal = localStorage.getItem('hc-last-' + basin.id + '-TWD'); } catch (e) { }
    if (lastReal) render(window.BasinParser.parse(lastReal, { basin: basin.id }));
  } catch (e) { console.warn('cached repaint failed', e); /* stale/unparseable cache — loadTWD will render live */ }
  wantOpeningFocus = true; // arm: the first LIVE render decides MDR vs. focus-on-system
  loadTWD();
})();
