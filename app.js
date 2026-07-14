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
      portraitCenter: [16, -63],
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
    if (map.getSize().x < map.getSize().y) {
      // snap UP to the zoomSnap grid so the basin truly fills (no dark bands)
      var fill = Math.ceil(map.getBoundsZoom(PAN_BOUNDS, true) * 8) / 8;
      map.setView(basin.portraitCenter, fill, { animate: false });
    } else {
      map.setView(L.latLngBounds(PAN_BOUNDS).getCenter(), map.getMinZoom(), { animate: false });
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
  var PANES = { mask: 402, areas: 410, lines: 420, points: 430 };
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

  // One layer group per feature category so the legend can toggle each class
  // independently. 'fix' has no legend row (small explicit markers, always on).
  var cat = {};
  var TWD_CATS = ['trough', 'convection', 'wave', 'cyclone', 'projection', 'fix', 'inferred'];
  var TCM_CATS = ['track', 'cone', 'wind'];
  TWD_CATS.concat(TCM_CATS).concat(['two']).forEach(function (k) {
    cat[k] = L.layerGroup().addTo(map);
  });
  // selClear first: a re-render (refresh, scrubber step, basin switch) can pull
  // the highlighted path out from under an open popup.
  function clearCats(keys) {
    selClear();
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
  // (maxWidth constrains the CONTENT; Leaflet's wrapper adds ~50px of chrome)
  var POPUP_OPTS = { maxWidth: Math.min(340, window.innerWidth - 90), maxHeight: 280 };
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  var featureLine = '—'; // "N features · X waves ..." — set by render/renderTWO
  var issuedStr = null;  // raw product issuance line, or null
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
    var line1 = featureLine + (tcmNote ? ' · ' + tcmNote : '');

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
    t.setStyle({ weight: sel.weight + 2 });
    L.DomUtil.addClass(t._path, 'hc-sel');
    if (t._isLine && t._path.ownerSVGElement) {
      var g = ensureGrad(t._path.ownerSVGElement);
      var stops = g.childNodes;
      stops[0].setAttribute('stop-color', sel.color);
      stops[1].setAttribute('stop-color', lighten(sel.color, 0.55));
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

  function render(parsed) {
    clearCats(TWD_CATS);

    parsed.troughs.forEach(function (t) {
      tapline(t.line.map(ll), { color: '#4fc3d6', weight: 2, dashArray: '1 0' },
        popup('TROUGH', t.source, false, t.context, t.srcSection))
        .addTo(cat.trough);
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
      tapline(w.axis.map(ll), { color: '#ffa23a', weight: 3 },
        popup('WAVE ' + w.id, w.source, false, w.context, w.srcSection))
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
        .bindPopup(popup(c.classification.toUpperCase() + ' ' + c.name.toUpperCase(),
          c.source, false, c.context, c.srcSection, stats), POPUP_OPTS)
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
  }

  // TWO formation areas: prose locations, so every circle is inferred by
  // definition. Colored by the 7-day chance using NHC's yellow/orange/red.
  function renderTWO(parsed) {
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
      }).bindPopup(popup(label, d.source, true, d.context), POPUP_OPTS).addTo(cat.two);
    });
    var n = parsed.disturbances.length;
    featureLine = plural(n, 'outlook area') +
      (unmapped ? ' · ' + unmapped + ' not mappable — see product text' : '');
    issuedStr = parsed.issued || null;
    updateMeta();
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

  // api.weather.gov's product types are 3-letter AWIPS categories (TWD, TWO)
  // that mix basins and offices — the newest TWD may be the East Pacific
  // issuance or Guam's. Scan the recent list for the newest product carrying
  // the wanted AWIPS id (TWDAT / TWOAT, on the product's third line).
  function fetchLatestMatching(listUrl, awipsId, n) {
    return fetch(listUrl, { headers: { Accept: 'application/ld+json' } }).then(function (r) {
      var cached = r.headers.get('X-From-Cache') === '1';
      if (!r.ok) throw new Error('list ' + r.status);
      return r.json().then(function (j) {
        var items = (j['@graph'] || j.features || []).slice(0, n);
        if (!items.length) throw new Error('no products');
        var idx = 0;
        function tryNext() {
          if (idx >= items.length) throw new Error('no ' + awipsId + ' in newest ' + n);
          var it = items[idx++];
          return fetch(it['@id'] || it.id).then(function (pr) {
            var c2 = cached || pr.headers.get('X-From-Cache') === '1';
            return pr.json().then(function (p) {
              var text = p.productText || '';
              if (text.indexOf(awipsId) !== -1) return { text: text, cached: c2 };
              return tryNext();
            });
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
        render(window.BasinParser.parse(res.text, { basin: basin.id }));
        setBadge(res.cached ? 'CACHED' : 'LIVE');
        twdState = res.cached ? 'cached' : 'live';
        var key = basin.id + 'TWD';
        if (fromUser && !res.cached && res.text === lastFetched[key]) noNewProductToast();
        if (!res.cached) lastFetched[key] = res.text;
      } catch (e) {
        setBadge('ERROR');
        twdState = 'error';
      }
      loadTCM(gen);
    }).catch(function () {
      if (gen !== loadGen) return;
      // no network + nothing cached -> embedded sample
      var sample = sampleText('TWD');
      if (!sample) { setBadge('ERROR'); twdState = 'error'; loadTCM(gen); return; }
      try {
        render(window.BasinParser.parse(sample, { basin: basin.id }));
        setBadge('SAMPLE');
        twdState = 'sample';
      } catch (e) {
        setBadge('ERROR');
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
        renderTWO(window.BasinParser.parseTWO(res.text, { basin: basin.id }));
        setBadge(res.cached ? 'CACHED' : 'LIVE');
        var key = basin.id + 'TWO';
        if (fromUser && !res.cached && res.text === lastFetched[key]) noNewProductToast();
        if (!res.cached) lastFetched[key] = res.text;
      } catch (e) {
        setBadge('ERROR');
      }
    }).catch(function () {
      if (gen !== loadGen) return;
      var sample = sampleText('TWO');
      if (!sample) { setBadge('ERROR'); return; }
      try {
        renderTWO(window.BasinParser.parseTWO(sample, { basin: basin.id }));
        setBadge('SAMPLE');
      } catch (e) {
        setBadge('ERROR');
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
    return fetch(listUrl, { headers: { Accept: 'application/ld+json' } }).then(function (r) {
      if (!r.ok) throw new Error('list ' + r.status);
      return r.json().then(function (j) {
        var items = (j['@graph'] || j.features || []).slice(0, n);
        if (!items.length) return [];
        return Promise.all(items.map(function (it) {
          return fetch(it['@id'] || it.id)
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
    updateScrub();
  }

  function fetchHistory(listUrl, awipsId) {
    return fetch(listUrl, { headers: { Accept: 'application/ld+json' } }).then(function (r) {
      if (!r.ok) throw new Error('list ' + r.status);
      return r.json().then(function (j) {
        var items = (j['@graph'] || j.features || []).slice(0, HIST_SCAN);
        return Promise.all(items.map(function (it) {
          return fetch(it['@id'] || it.id)
            .then(function (pr) { return pr.json(); })
            .then(function (p) { return p.productText || ''; })
            .catch(function () { return ''; });
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
    }).catch(function () {
      if ((gen != null && gen !== loadGen) || mode !== 'TWD') return;
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
      if (ring) {
        L.polygon(ring.map(ll), {
          color: '#7ea3b8', weight: 1.5, dashArray: '4 4',
          fillColor: '#dce8ef', fillOpacity: 0.07, interactive: true, pane: 'hc-areas'
        }).bindPopup(popup('CONE ' + s.name.toUpperCase(),
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
        }).bindPopup(popup(band.kt + ' KT WIND FIELD · ' + s.name.toUpperCase(),
          'Official advisory wind radii, nm (largest anywhere in quadrant): NE ' +
          q.ne + ' / SE ' + q.se + ' / SW ' + q.sw + ' / NW ' + q.nw +
          '. Advisory #' + s.advisory + '.', false))
          .addTo(cat.wind);
      });
      if (s.track.length) {
        tapline(pts.map(ll), { color: '#dce8ef', weight: 2 },
          popup('TRACK ' + s.name.toUpperCase(),
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
    // Clear ALL feature paths BEFORE rebuilding masks (z-order invariant above).
    clearCats(TWD_CATS.concat(TCM_CATS).concat(['two']));
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

  function updateScrub() {
    // Only the fetched-product states can scrub; SAMPLE/PASTED/ERROR/LOADING
    // have no history list behind them.
    var show = badgeState === 'LIVE' || badgeState === 'CACHED' || badgeState === 'HISTORY';
    scrubEl.hidden = !show;
    if (!show) return;
    var maxIdx = hist.texts ? hist.texts.length - 1 : null;
    scrubBack.disabled = hist.loading || (maxIdx !== null && hist.idx >= maxIdx);
    scrubFwd.disabled = hist.loading || hist.idx === 0;
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
    // -0 restores the true source badge captured when the scan started
    setBadge(i > 0 ? 'HISTORY' : hist.srcBadge);
    if (returning0 && mode === 'TWD') loadTCM(loadGen);
  }

  scrubBack.addEventListener('click', function () {
    if (hist.texts) {
      if (hist.idx < hist.texts.length - 1) scrubTo(hist.idx + 1);
      return;
    }
    // First tap: scan the recent list once, then step. Note texts[0] is the
    // scan's newest — if NOAA issued between load and this tap, -0 will show
    // that newer text under the badge captured here; network-first transport
    // keeps the badge truthful, and Refresh self-heals the window.
    hist.srcBadge = badgeState; // LIVE or CACHED — control is hidden otherwise
    hist.loading = true;
    var gen = hist.gen;
    updateScrub();
    fetchHistory(mode === 'TWD' ? TWD_URL : TWO_URL, mode === 'TWD' ? basin.awipsTWD : basin.awipsTWO)
      .then(function (texts) {
        if (gen !== hist.gen) return; // a refresh/mode switch invalidated this scan
        hist.loading = false;
        if (texts.length < 2) { toast('No older issuances found.'); updateScrub(); return; }
        hist.texts = texts;
        scrubTo(1);
      })
      .catch(function () {
        if (gen !== hist.gen) return;
        hist.loading = false;
        toast('Could not fetch history.');
        updateScrub();
      });
  });
  scrubFwd.addEventListener('click', function () {
    if (hist.texts && hist.idx > 0) scrubTo(hist.idx - 1);
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
    try {
      if (/FORECAST\/ADVISORY/i.test(txt.slice(0, 400))) {
        setMode('TWD');
        var ptcm = window.BasinParser.parseTCM(txt);
        if (!ptcm) throw new Error('unparseable TCM');
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
        setMode('TWO');
        renderTWO(window.BasinParser.parseTWO(txt));
      } else {
        setMode('TWD');
        clearCats(TCM_CATS);
        tcmNote = '';
        render(window.BasinParser.parse(txt));
      }
      setBadge('PASTED');
    } catch (e) {
      setBadge('ERROR');
    }
  });

  // --- boot ------------------------------------------------------------------
  // Sync the subtitle to the persisted basin, then render its embedded sample
  // instantly so the map is never blank, then try live data. If the fetch wins
  // it silently replaces the sample.
  updateSubtitle();
  try {
    var bootSample = sampleText('TWD');
    if (bootSample) render(window.BasinParser.parse(bootSample, { basin: basin.id }));
  } catch (e) {
    setBadge('ERROR');
  }
  loadTWD();
})();
