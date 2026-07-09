/*
 * app.js — Hurricane Console
 * Fetches the newest Atlantic TWDAT/TWOAT from api.weather.gov, parses it in the
 * browser, and renders the features on a tile-less Leaflet map drawn from
 * embedded vector coastlines. The header badge always tells the truth about the
 * data source: LIVE / CACHED / SAMPLE / PASTED / ERROR.
 */
(function () {
  'use strict';

  var BASIN = { minLat: 0, maxLat: 34, minLon: -100, maxLon: -6 };
  var TWD_URL = 'https://api.weather.gov/products/types/TWDAT';
  var TWO_URL = 'https://api.weather.gov/products/types/TWOAT';
  var mode = 'TWD'; // or 'TWO' (outlook formation areas, gazetteer-inferred)

  // --- map setup -------------------------------------------------------------
  var map = L.map('map', {
    center: [17, -55], zoom: 4, minZoom: 3, maxZoom: 7,
    zoomControl: true, attributionControl: false, worldCopyJump: false
  });
  map.setMaxBounds([[-8, -110], [42, 4]]);

  // graticule every 5deg
  var graticule = L.layerGroup().addTo(map);
  for (var la = -5; la <= 35; la += 5) graticule.addLayer(
    L.polyline([[la, -110], [la, 4]], { color: '#0f2f42', weight: 1, interactive: false }));
  for (var lo = -100; lo <= 0; lo += 5) graticule.addLayer(
    L.polyline([[-8, lo], [42, lo]], { color: '#0f2f42', weight: 1, interactive: false }));

  // Embedded NE 50m coastlines: the guaranteed basemap. Always on the map so
  // the chart works with zero network; dimmed (not removed) when tiles load.
  var coastGeo = L.geoJSON(window.BASIN_COASTLINES, {
    style: { color: '#2c5870', weight: 1, fill: false, interactive: false }
  }).addTo(map);

  // CARTO dark tiles: progressive enhancement when online. The badge never
  // describes the basemap — only the data product.
  var attrib = L.control.attribution({ prefix: false });
  attrib.addAttribution('&copy; OpenStreetMap contributors &copy; CARTO');
  var tiles = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png',
    { subdomains: 'abcd', maxZoom: 7 }
  );
  var tilesLoaded = false, tileErrors = 0;
  function tilesUp() {
    if (!map.hasLayer(tiles)) { tiles.addTo(map); attrib.addTo(map); }
  }
  function tilesDown() {
    if (map.hasLayer(tiles)) { map.removeLayer(tiles); attrib.remove(); }
    coastGeo.setStyle({ opacity: 1 });
  }
  tiles.on('load', function () {
    tilesLoaded = true;
    coastGeo.setStyle({ opacity: 0.35 }); // tiles carry the land; vectors stay as chart lines
  });
  tiles.on('tileerror', function () {
    // never loaded and repeatedly failing (offline boot, sandbox) -> vectors only
    if (!tilesLoaded && ++tileErrors >= 4) tilesDown();
  });
  window.addEventListener('offline', function () { coastGeo.setStyle({ opacity: 1 }); });
  window.addEventListener('online', function () { tilesLoaded = false; tileErrors = 0; tilesUp(); });
  tilesUp();

  var featureLayer = L.layerGroup().addTo(map);
  var twoLayer = L.layerGroup().addTo(map); // TWO formation areas (mode-exclusive)

  // --- rendering -------------------------------------------------------------
  function ll(p) { return [p.lat, p.lon]; }

  function popup(tag, src, inferred) {
    return '<span class="pop-tag' + (inferred ? ' inf' : '') + '">' +
      tag + (inferred ? ' ◇ INFERRED' : '') + '</span>' +
      '<div class="pop-src">' + escapeHtml(src || '') + '</div>';
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function render(parsed) {
    featureLayer.clearLayers();

    parsed.troughs.forEach(function (t) {
      L.polyline(t.line.map(ll), { color: '#4fc3d6', weight: 2, dashArray: '1 0' })
        .bindPopup(popup('TROUGH', t.source, false)).addTo(featureLayer);
    });

    parsed.convection.forEach(function (c) {
      L.rectangle([[c.bbox.s, c.bbox.w], [c.bbox.n, c.bbox.e]], {
        color: c.strong ? '#ff6b5a' : '#ffb98a', weight: 1, dashArray: '3 3',
        fillColor: c.strong ? '#ff6b5a' : '#ff9d6a', fillOpacity: 0.10
      }).bindPopup(popup(c.strong ? 'CONVECTION · STRONG' : 'CONVECTION', c.source, false))
        .addTo(featureLayer);
    });

    parsed.waves.forEach(function (w) {
      L.polyline(w.axis.map(ll), { color: '#ffa23a', weight: 3 })
        .bindPopup(popup('WAVE ' + w.id, w.source, false)).addTo(featureLayer);
      // small motion arrowhead label at the axis head
      L.circleMarker(ll(w.axis[0]), { radius: 3, color: '#ffa23a', fillOpacity: 1 })
        .addTo(featureLayer);
    });

    // Active cyclones from SPECIAL FEATURES. A stated center IS a fix — solid
    // marker, non-inferred popup; only the +24h projection is inferred.
    (parsed.cyclones || []).forEach(function (c) {
      var isHur = /hurricane/i.test(c.classification);
      var isStorm = /storm/i.test(c.classification);
      var style = isHur
        ? { radius: 9, color: '#ff6b5a', fillColor: '#ff6b5a', fillOpacity: 0.9, weight: 2 }
        : isStorm
          ? { radius: 7, color: '#ffa23a', fillColor: '#ffa23a', fillOpacity: 0.85, weight: 2 }
          : { radius: 6, color: '#dce8ef', fillColor: '#dce8ef', fillOpacity: 0.7, weight: 2 };
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
          stats + ' — ' + c.source, false))
        .addTo(featureLayer);
    });

    parsed.projections.forEach(function (p) {
      var pts = p.band ? [ll(p.slow), ll(p.fast)] : [ll(p.slow)];
      if (p.band) {
        L.polyline([ll(p.from), ll(p.slow)], { color: '#9a86c9', weight: 2, dashArray: '5 4' })
          .addTo(featureLayer);
        L.polyline([ll(p.from), ll(p.fast)], { color: '#9a86c9', weight: 2, dashArray: '5 4' })
          .addTo(featureLayer);
        L.circleMarker(ll(p.slow), { radius: 3, color: '#9a86c9', fillOpacity: .6 })
          .bindPopup(popup('+24h ' + (p.id || p.waveId) + ' (slow)', p.source, true)).addTo(featureLayer);
        L.circleMarker(ll(p.fast), { radius: 3, color: '#9a86c9', fillOpacity: .6 })
          .bindPopup(popup('+24h ' + (p.id || p.waveId) + ' (fast)', p.source, true)).addTo(featureLayer);
      } else {
        L.polyline([ll(p.from), ll(p.slow)], { color: '#9a86c9', weight: 2, dashArray: '5 4' })
          .addTo(featureLayer);
        L.circleMarker(ll(p.slow), { radius: 3, color: '#9a86c9', fillOpacity: .6 })
          .bindPopup(popup('+24h ' + (p.id || p.waveId), p.source, true)).addTo(featureLayer);
      }
    });

    parsed.fixes.forEach(function (f) {
      L.circleMarker(ll(f), { radius: 4, color: '#dce8ef', weight: 1.5, fillOpacity: 0 })
        .bindPopup(popup('FIX', f.source, false)).addTo(featureLayer);
    });

    parsed.inferred.forEach(function (f) {
      L.circleMarker(ll(f), {
        radius: 5, color: '#9a86c9', weight: 1.5, dashArray: '3 3', fillOpacity: 0
      }).bindPopup(popup('POSITION', f.source, true)).addTo(featureLayer);
    });

    var nCyc = (parsed.cyclones || []).length;
    var n = nCyc + parsed.waves.length + parsed.troughs.length + parsed.convection.length +
      parsed.fixes.length + parsed.inferred.length;
    document.getElementById('meta').innerHTML =
      n + ' features · ' + parsed.waves.length + ' waves' +
      (nCyc ? ' · ' + nCyc + ' cyclone' + (nCyc === 1 ? '' : 's') : '') + '<br>' +
      (parsed.issued ? escapeHtml(parsed.issued) : 'issuance n/a');
  }

  // TWO formation areas: prose locations, so every circle is inferred by
  // definition. Colored by the 7-day chance using NHC's yellow/orange/red.
  function renderTWO(parsed) {
    featureLayer.clearLayers();
    twoLayer.clearLayers();
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
        fillColor: color, fillOpacity: 0.08
      }).bindPopup(popup(label, d.source, true)).addTo(twoLayer);
    });
    var n = parsed.disturbances.length;
    document.getElementById('meta').innerHTML =
      n + ' outlook area' + (n === 1 ? '' : 's') +
      (unmapped ? ' · ' + unmapped + ' not mappable — see product text' : '') + '<br>' +
      (parsed.issued ? escapeHtml(parsed.issued) : 'issuance n/a');
  }

  // --- data source -----------------------------------------------------------
  function setBadge(state) {
    var b = document.getElementById('badge');
    b.className = 'badge ' + state;
    b.textContent = state;
  }

  // api.weather.gov: list products -> newest @id -> product text
  function fetchLatest(listUrl) {
    return fetch(listUrl, { headers: { Accept: 'application/ld+json' } })
      .then(function (r) {
        var cached = r.headers.get('X-From-Cache') === '1';
        if (!r.ok) throw new Error('list ' + r.status);
        return r.json().then(function (j) {
          var items = j['@graph'] || j.features || [];
          if (!items.length) throw new Error('no products');
          var id = items[0]['@id'] || items[0].id;
          return fetch(id).then(function (pr) {
            var c2 = cached || pr.headers.get('X-From-Cache') === '1';
            return pr.json().then(function (p) {
              return { text: p.productText || '', cached: c2 };
            });
          });
        });
      });
  }

  function loadTWD() {
    setBadge('LIVE'); // optimistic; corrected on resolution
    fetchLatest(TWD_URL).then(function (res) {
      if (!res.text) throw new Error('empty');
      // Fetch succeeded: a parse/render failure here is a real error, and
      // falling back to SAMPLE would lie about the data source.
      try {
        render(window.BasinParser.parse(res.text));
        setBadge(res.cached ? 'CACHED' : 'LIVE');
      } catch (e) {
        setBadge('ERROR');
      }
    }).catch(function () {
      // no network + nothing cached -> embedded sample
      if (!window.TWD_SAMPLE) { setBadge('ERROR'); return; }
      try {
        render(window.BasinParser.parse(window.TWD_SAMPLE));
        setBadge('SAMPLE');
      } catch (e) {
        setBadge('ERROR');
      }
    });
  }

  function loadTWO() {
    setBadge('LIVE'); // optimistic; corrected on resolution
    fetchLatest(TWO_URL).then(function (res) {
      if (!res.text) throw new Error('empty');
      try {
        renderTWO(window.BasinParser.parseTWO(res.text));
        setBadge(res.cached ? 'CACHED' : 'LIVE');
      } catch (e) {
        setBadge('ERROR');
      }
    }).catch(function () {
      if (!window.TWO_SAMPLE) { setBadge('ERROR'); return; }
      try {
        renderTWO(window.BasinParser.parseTWO(window.TWO_SAMPLE));
        setBadge('SAMPLE');
      } catch (e) {
        setBadge('ERROR');
      }
    });
  }

  // --- UI wiring -------------------------------------------------------------
  document.getElementById('refresh').addEventListener('click', function () {
    mode === 'TWD' ? loadTWD() : loadTWO();
  });

  var whichBtn = document.getElementById('which');
  function setMode(m) {
    mode = m;
    whichBtn.textContent = mode === 'TWD' ? 'TWD / TWO' : 'TWO / TWD';
    // One badge, one product: never show both products at once.
    if (mode === 'TWD') twoLayer.clearLayers();
    else featureLayer.clearLayers();
  }
  whichBtn.addEventListener('click', function () {
    setMode(mode === 'TWD' ? 'TWO' : 'TWD');
    mode === 'TWD' ? loadTWD() : loadTWO();
  });

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
    // Route by product: a pasted outlook gets the TWO treatment.
    try {
      if (/tropical weather outlook/i.test(txt.slice(0, 300))) {
        setMode('TWO');
        renderTWO(window.BasinParser.parseTWO(txt));
      } else {
        setMode('TWD');
        render(window.BasinParser.parse(txt));
      }
      setBadge('PASTED');
    } catch (e) {
      setBadge('ERROR');
    }
  });

  // --- boot ------------------------------------------------------------------
  // Render the embedded sample instantly so the map is never blank, then try
  // live data. If the fetch wins it silently replaces the sample.
  try {
    render(window.BasinParser.parse(window.TWD_SAMPLE));
  } catch (e) {
    setBadge('ERROR');
  }
  loadTWD();
})();
