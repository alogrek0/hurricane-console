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
  var mode = 'TWD'; // or 'TWO' (outlook is text-only, no geo)

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

  // coastlines
  L.geoJSON(window.BASIN_COASTLINES, {
    style: { color: '#2c5870', weight: 1, fill: false, interactive: false }
  }).addTo(map);

  var featureLayer = L.layerGroup().addTo(map);

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

    parsed.projections.forEach(function (p) {
      var pts = p.band ? [ll(p.slow), ll(p.fast)] : [ll(p.slow)];
      if (p.band) {
        L.polyline([ll(p.from), ll(p.slow)], { color: '#9a86c9', weight: 2, dashArray: '5 4' })
          .addTo(featureLayer);
        L.polyline([ll(p.from), ll(p.fast)], { color: '#9a86c9', weight: 2, dashArray: '5 4' })
          .addTo(featureLayer);
        L.circleMarker(ll(p.slow), { radius: 3, color: '#9a86c9', fillOpacity: .6 })
          .bindPopup(popup('+24h ' + p.waveId + ' (slow)', p.source, true)).addTo(featureLayer);
        L.circleMarker(ll(p.fast), { radius: 3, color: '#9a86c9', fillOpacity: .6 })
          .bindPopup(popup('+24h ' + p.waveId + ' (fast)', p.source, true)).addTo(featureLayer);
      } else {
        L.polyline([ll(p.from), ll(p.slow)], { color: '#9a86c9', weight: 2, dashArray: '5 4' })
          .addTo(featureLayer);
        L.circleMarker(ll(p.slow), { radius: 3, color: '#9a86c9', fillOpacity: .6 })
          .bindPopup(popup('+24h ' + p.waveId, p.source, true)).addTo(featureLayer);
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

    var n = parsed.waves.length + parsed.troughs.length + parsed.convection.length +
      parsed.fixes.length + parsed.inferred.length;
    document.getElementById('meta').innerHTML =
      n + ' features · ' + parsed.waves.length + ' waves<br>' +
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
      setBadge(res.cached ? 'CACHED' : 'LIVE');
      render(window.BasinParser.parse(res.text));
    }).catch(function () {
      // no network + nothing cached -> embedded sample
      setBadge('SAMPLE');
      render(window.BasinParser.parse(window.TWD_SAMPLE));
    });
  }

  function loadTWO() {
    // Outlook is a text product with no reliable geo; show it in the paste dlg
    // read-only so users can still read the discussion offline.
    fetchLatest(TWO_URL).then(function (res) {
      setBadge(res.cached ? 'CACHED' : 'LIVE');
      showText(res.text || window.TWO_SAMPLE);
    }).catch(function () {
      setBadge('SAMPLE');
      showText(window.TWO_SAMPLE);
    });
  }

  function showText(txt) {
    var dlg = document.getElementById('pasteDlg');
    document.getElementById('pasteText').value = txt;
    document.querySelector('#pasteDlg h2').textContent = 'Tropical Weather Outlook';
    dlg.showModal();
  }

  // --- UI wiring -------------------------------------------------------------
  document.getElementById('refresh').addEventListener('click', function () {
    mode === 'TWD' ? loadTWD() : loadTWO();
  });

  document.getElementById('which').addEventListener('click', function () {
    mode = mode === 'TWD' ? 'TWO' : 'TWD';
    this.textContent = mode === 'TWD' ? 'TWD / TWO' : 'TWO / TWD';
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
    if (txt.trim()) { setBadge('PASTED'); render(window.BasinParser.parse(txt)); }
  });

  // --- boot ------------------------------------------------------------------
  // Render the embedded sample instantly so the map is never blank, then try
  // live data. If the fetch wins it silently replaces the sample.
  render(window.BasinParser.parse(window.TWD_SAMPLE));
  loadTWD();
})();
