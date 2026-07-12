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

  // One layer group per feature category so the legend can toggle each class
  // independently. 'fix' has no legend row (small explicit markers, always on).
  var cat = {};
  var TWD_CATS = ['trough', 'convection', 'wave', 'cyclone', 'projection', 'fix', 'inferred'];
  var TCM_CATS = ['track', 'cone', 'wind'];
  TWD_CATS.concat(TCM_CATS).concat(['two']).forEach(function (k) {
    cat[k] = L.layerGroup().addTo(map);
  });
  function clearCats(keys) { keys.forEach(function (k) { cat[k].clearLayers(); }); }

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
      if (keys.every(function (k) { return offCats.indexOf(k) !== -1; })) {
        row.classList.add('off');
        setCatVisible(keys, false);
      }
      row.addEventListener('click', function () {
        var turningOff = !row.classList.contains('off');
        row.classList.toggle('off', turningOff);
        setCatVisible(keys, !turningOff);
        keys.forEach(function (k) {
          var i = offCats.indexOf(k);
          if (turningOff && i === -1) offCats.push(k);
          if (!turningOff && i !== -1) offCats.splice(i, 1);
        });
        try { localStorage.setItem(LAYERS_OFF_KEY, JSON.stringify(offCats)); } catch (e) { }
      });
    });
  }
  initLegendToggles();

  // On phones the legend starts as a chip; tapping the header expands it and
  // tapping the map collapses it again so it never lingers over the chart.
  // Desktop keeps the always-open legend (header click still works, harmless).
  var PHONE = matchMedia('(max-width:520px)');
  var legendEl = document.getElementById('legend');
  if (PHONE.matches) legendEl.classList.add('collapsed');
  document.getElementById('legendHead').addEventListener('click', function (e) {
    e.stopPropagation(); // a chip tap must not fall through as a row toggle
    legendEl.classList.toggle('collapsed');
  });
  map.on('click', function () {
    if (PHONE.matches) legendEl.classList.add('collapsed');
  });

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

  function render(parsed) {
    clearCats(TWD_CATS);

    parsed.troughs.forEach(function (t) {
      L.polyline(t.line.map(ll), { color: '#4fc3d6', weight: 2, dashArray: '1 0' })
        .bindPopup(popup('TROUGH', t.source, false, t.context, t.srcSection), POPUP_OPTS)
        .addTo(cat.trough);
    });

    parsed.convection.forEach(function (c) {
      L.rectangle([[c.bbox.s, c.bbox.w], [c.bbox.n, c.bbox.e]], {
        color: c.strong ? '#ff6b5a' : '#ffb98a', weight: 1, dashArray: '3 3',
        fillColor: c.strong ? '#ff6b5a' : '#ff9d6a', fillOpacity: 0.10
      }).bindPopup(popup(c.strong ? 'CONVECTION · STRONG' : 'CONVECTION', c.source, false,
        c.context, c.srcSection), POPUP_OPTS)
        .addTo(cat.convection);
    });

    parsed.waves.forEach(function (w) {
      L.polyline(w.axis.map(ll), { color: '#ffa23a', weight: 3 })
        .bindPopup(popup('WAVE ' + w.id, w.source, false, w.context, w.srcSection), POPUP_OPTS)
        .addTo(cat.wave);
      // small motion arrowhead label at the axis head
      L.circleMarker(ll(w.axis[0]), { radius: 3, color: '#ffa23a', fillOpacity: 1 })
        .addTo(cat.wave);
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
          c.source, false, c.context, c.srcSection, stats), POPUP_OPTS)
        .addTo(cat.cyclone);
    });

    parsed.projections.forEach(function (p) {
      var pts = p.band ? [ll(p.slow), ll(p.fast)] : [ll(p.slow)];
      if (p.band) {
        L.polyline([ll(p.from), ll(p.slow)], { color: '#9a86c9', weight: 2, dashArray: '5 4' })
          .addTo(cat.projection);
        L.polyline([ll(p.from), ll(p.fast)], { color: '#9a86c9', weight: 2, dashArray: '5 4' })
          .addTo(cat.projection);
        L.circleMarker(ll(p.slow), { radius: 3, color: '#9a86c9', fillOpacity: .6 })
          .bindPopup(popup('+24h ' + (p.id || p.waveId) + ' (slow)', p.source, true, p.context, p.srcSection), POPUP_OPTS).addTo(cat.projection);
        L.circleMarker(ll(p.fast), { radius: 3, color: '#9a86c9', fillOpacity: .6 })
          .bindPopup(popup('+24h ' + (p.id || p.waveId) + ' (fast)', p.source, true, p.context, p.srcSection), POPUP_OPTS).addTo(cat.projection);
      } else {
        L.polyline([ll(p.from), ll(p.slow)], { color: '#9a86c9', weight: 2, dashArray: '5 4' })
          .addTo(cat.projection);
        L.circleMarker(ll(p.slow), { radius: 3, color: '#9a86c9', fillOpacity: .6 })
          .bindPopup(popup('+24h ' + (p.id || p.waveId), p.source, true, p.context, p.srcSection), POPUP_OPTS).addTo(cat.projection);
      }
    });

    parsed.fixes.forEach(function (f) {
      L.circleMarker(ll(f), { radius: 4, color: '#dce8ef', weight: 1.5, fillOpacity: 0 })
        .bindPopup(popup('FIX', f.source, false, f.context, f.srcSection), POPUP_OPTS)
        .addTo(cat.fix);
    });

    parsed.inferred.forEach(function (f) {
      L.circleMarker(ll(f), {
        radius: 5, color: '#9a86c9', weight: 1.5, dashArray: '3 3', fillOpacity: 0
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
        fillColor: color, fillOpacity: 0.08
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
    setBadge('LOADING'); // in-flight; resolves to the real source below
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
    setBadge('LOADING'); // in-flight; resolves to the real source below
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
      tcmNote = storms.length ? plural(storms.length, 'track') : '';
      updateMeta();
    }).catch(function () {
      if (mode !== 'TWD') return;
      // SAMPLE state demos the feature; a live TWD with dead TCM is reported honestly
      if (twdState === 'sample' && window.TCM_SAMPLE) {
        var p = window.BasinParser.parseTCM(window.TCM_SAMPLE);
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
      var ring = window.BasinParser.coneFromTrack(pts);
      if (ring) {
        L.polygon(ring.map(ll), {
          color: '#7ea3b8', weight: 1.5, dashArray: '4 4',
          fillColor: '#dce8ef', fillOpacity: 0.07, interactive: true
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
          interactive: true
        }).bindPopup(popup(band.kt + ' KT WIND FIELD · ' + s.name.toUpperCase(),
          'Official advisory wind radii, nm (largest anywhere in quadrant): NE ' +
          q.ne + ' / SE ' + q.se + ' / SW ' + q.sw + ' / NW ' + q.nw +
          '. Advisory #' + s.advisory + '.', false))
          .addTo(cat.wind);
      });
      if (s.track.length) {
        L.polyline(pts.map(ll), { color: '#dce8ef', weight: 2 })
          .bindPopup(popup('TRACK ' + s.name.toUpperCase(),
            'NHC forecast/advisory #' + s.advisory + ' - positions at ' +
            s.track[0].hours + '-' + s.track[s.track.length - 1].hours + ' h.', false))
          .addTo(cat.track);
      }
      s.track.forEach(function (p) {
        L.circleMarker(ll(p), {
          radius: 5, color: intensityColor(p.windKt || 0),
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
    mode === 'TWD' ? loadTWD() : loadTWO();
  });

  var whichBtn = document.getElementById('which');
  function setMode(m) {
    mode = m;
    whichBtn.textContent = mode === 'TWD' ? 'TWD / TWO' : 'TWO / TWD';
    // One badge, one product: never show both products at once.
    if (mode === 'TWD') cat.two.clearLayers();
    else { clearCats(TWD_CATS.concat(TCM_CATS)); tcmNote = ''; }
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
  // Render the embedded sample instantly so the map is never blank, then try
  // live data. If the fetch wins it silently replaces the sample.
  try {
    render(window.BasinParser.parse(window.TWD_SAMPLE));
  } catch (e) {
    setBadge('ERROR');
  }
  loadTWD();
})();
