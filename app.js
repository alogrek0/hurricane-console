/*
 * app.js — Hurricane Console
 * Fetches the newest Atlantic TWDAT/TWOAT from api.weather.gov, parses it in the
 * browser, and renders the features on a Leaflet map drawn from an embedded
 * all-vector Natural Earth basemap (land, coast, borders). The header badge always
 * tells the truth about the data source: LIVE / CACHED / SAMPLE / PASTED / ERROR.
 */
(function () {
  'use strict';

  var BASIN = { minLat: 0, maxLat: 34, minLon: -100, maxLon: -6 };
  var TWD_URL = 'https://api.weather.gov/products/types/TWD';
  var TWO_URL = 'https://api.weather.gov/products/types/TWO';
  var TCM_URL = 'https://api.weather.gov/products/types/TCM';
  var mode = 'TWD'; // or 'TWO' (outlook formation areas, gazetteer-inferred)

  // --- map setup -------------------------------------------------------------
  var map = L.map('map', {
    center: [17, -55], zoom: 4, minZoom: 3, maxZoom: 7,
    zoomControl: true, attributionControl: false, worldCopyJump: false,
    maxBoundsViscosity: 1.0, // hard edge: a drag can never overshoot the frame
    // Fractional zoom: the fill-viewport floor leaves only ~2 integer levels
    // of range, which made wheel zoom feel like an on/off switch. Quarter
    // steps + a gentler wheel rate give a usable, smooth range.
    zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 200
  });
  var PAN_BOUNDS = [[-8, -110], [45, 4]];
  map.setMaxBounds(PAN_BOUNDS);

  // Zoom-out floor: the whole basin fits the viewport (chart-fit). Below the
  // window's aspect this letterboxes with dark margins, but the frame edges
  // stay labeled so they read as chart borders — and nothing is ever hidden.
  function fitMinZoom() {
    // snap DOWN to the zoomSnap grid so the full basin is guaranteed visible
    var fit = Math.max(3, Math.floor(map.getBoundsZoom(PAN_BOUNDS, false) * 4) / 4);
    map.setMinZoom(fit);
    if (map.getZoom() < fit) map.setZoom(fit);
  }
  fitMinZoom();
  window.addEventListener('resize', fitMinZoom);

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

  // graticule every 5deg
  var graticule = L.layerGroup().addTo(map);
  for (var la = -5; la <= 45; la += 5) graticule.addLayer(
    L.polyline([[la, -110], [la, 4]], { color: '#0f2f42', weight: 1, interactive: false }));
  for (var lo = -100; lo <= 0; lo += 5) graticule.addLayer(
    L.polyline([[-8, lo], [45, lo]], { color: '#0f2f42', weight: 1, interactive: false }));

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
    var yRow = Math.min(size.y - 12, map.latLngToContainerPoint([-10, 0]).y + 9);
    // (frame bottom stays at 10S; the north edge is 45N)
    var xCol = Math.max(4, map.latLngToContainerPoint([0, -110]).x + 6);
    for (var lo = -100; lo <= 0; lo += 5) {
      if (lo % step || lo < b.getWest() || lo > b.getEast()) continue;
      var x = map.latLngToContainerPoint([0, lo]).x;
      if (x < 16 || x > size.x - 16) continue;
      html += '<span style="left:' + Math.round(x) + 'px;top:' + Math.round(yRow) +
        'px;transform:translate(-50%,-50%)">' + fmtDeg(lo, 'E', 'W') + '</span>';
    }
    for (var la = -5; la <= 45; la += 5) {
      if (la % step || la < b.getSouth() || la > b.getNorth() + 0.01) continue;
      var y = map.latLngToContainerPoint([la, 0]).y;
      // clamp the frame-top label into view instead of suppressing it —
      // 45N must stay labeled even when it sits at the viewport's top edge
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

  var featureLayer = L.layerGroup().addTo(map);
  var twoLayer = L.layerGroup().addTo(map); // TWO formation areas (mode-exclusive)
  var tcmLayer = L.layerGroup().addTo(map); // forecast track + cone

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

  var metaBase = '—';
  function updateMeta() {
    document.getElementById('meta').innerHTML =
      metaBase + (tcmNote ? ' · ' + tcmNote : '') +
      '<br><span class="ver">' + (window.APP_VERSION || '') + '</span>';
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
    metaBase = n + ' features · ' + parsed.waves.length + ' waves' +
      (nCyc ? ' · ' + nCyc + ' cyclone' + (nCyc === 1 ? '' : 's') : '') + '<br>' +
      (parsed.issued ? escapeHtml(parsed.issued) : 'issuance n/a');
    updateMeta();
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
    metaBase = n + ' outlook area' + (n === 1 ? '' : 's') +
      (unmapped ? ' · ' + unmapped + ' not mappable — see product text' : '') + '<br>' +
      (parsed.issued ? escapeHtml(parsed.issued) : 'issuance n/a');
    updateMeta();
  }

  // --- data source -----------------------------------------------------------
  function setBadge(state) {
    var b = document.getElementById('badge');
    b.className = 'badge ' + state;
    b.textContent = state;
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

  function loadTWD() {
    setBadge('LIVE'); // optimistic; corrected on resolution
    fetchLatestMatching(TWD_URL, 'TWDAT', 8).then(function (res) {
      if (!res.text) throw new Error('empty');
      // Fetch succeeded: a parse/render failure here is a real error, and
      // falling back to SAMPLE would lie about the data source.
      try {
        render(window.BasinParser.parse(res.text));
        setBadge(res.cached ? 'CACHED' : 'LIVE');
        twdState = res.cached ? 'cached' : 'live';
      } catch (e) {
        setBadge('ERROR');
        twdState = 'error';
      }
      loadTCM();
    }).catch(function () {
      // no network + nothing cached -> embedded sample
      if (!window.TWD_SAMPLE) { setBadge('ERROR'); twdState = 'error'; loadTCM(); return; }
      try {
        render(window.BasinParser.parse(window.TWD_SAMPLE));
        setBadge('SAMPLE');
        twdState = 'sample';
      } catch (e) {
        setBadge('ERROR');
        twdState = 'error';
      }
      loadTCM();
    });
  }

  function loadTWO() {
    setBadge('LIVE'); // optimistic; corrected on resolution
    fetchLatestMatching(TWO_URL, 'TWOAT', 8).then(function (res) {
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

  var twdState = 'sample'; // 'live' | 'cached' | 'sample' | 'error' — set by loadTWD
  var tcmNote = '';

  function loadTCM() {
    fetchRecent(TCM_URL, 8).then(function (texts) {
      if (mode !== 'TWD') return;
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
      if (mode !== 'TWD') return;
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
      if (s.track.length) {
        L.polyline(pts.map(ll), { color: '#dce8ef', weight: 2 })
          .bindPopup(popup('TRACK ' + s.name.toUpperCase(),
            'NHC forecast/advisory #' + s.advisory + ' - positions at ' +
            s.track[0].hours + '-' + s.track[s.track.length - 1].hours + ' h.', false))
          .addTo(tcmLayer);
      }
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
    else { featureLayer.clearLayers(); tcmLayer.clearLayers(); tcmNote = ''; }
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
    // Route by product: TCM check first, then TWO, then TWD.
    try {
      if (/FORECAST\/ADVISORY/i.test(txt.slice(0, 400))) {
        setMode('TWD');
        var ptcm = window.BasinParser.parseTCM(txt);
        if (!ptcm) throw new Error('unparseable TCM');
        renderTCM([ptcm]);
        tcmNote = '1 forecast track (pasted)';
        updateMeta();
      } else if (/tropical weather outlook/i.test(txt.slice(0, 300))) {
        setMode('TWO');
        renderTWO(window.BasinParser.parseTWO(txt));
      } else {
        setMode('TWD');
        tcmLayer.clearLayers();
        tcmNote = '';
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
