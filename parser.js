/*
 * parser.js — Hurricane Console
 * NHC Tropical Weather Discussion (TWDAT) / Outlook (TWOAT) text -> geo features.
 *
 * Three passes:
 *   1. REGEX    explicit coordinates: point fixes, wave axes, convection boxes,
 *               trough/frontal polylines. High confidence.
 *   2. GAZETTEER prose-only positions ("between Hispaniola and the southeastern
 *               Bahamas"). Always tagged inferred:true — never presented as a fix.
 *   3. DEAD-RECKON project +24h wave positions from stated motion. When the text
 *               gives a speed range ("15 to 20 kt") the result is an uncertainty
 *               band between the slow and fast solutions.
 *
 * Runs unchanged in the browser (attaches to window.BasinParser) and in Node
 * (module.exports) so the same code powers the app and the test harness.
 */
(function (root) {
  'use strict';

  // --- coordinate primitives -------------------------------------------------

  // "14N76W", "05.5N", "22W", "17N" -> numeric degrees (W and S negative)
  function lat(v, hemi) {
    const n = parseFloat(v);
    return hemi === 'S' ? -n : n;
  }
  function lon(v, hemi) {
    const n = parseFloat(v);
    return hemi === 'W' ? -n : n;
  }

  // A paired coordinate token like 14N76W or 08N27W (lat first, lon second).
  const RE_PAIR = /(\d{1,2}(?:\.\d)?)\s*([NS])\s*(\d{1,3}(?:\.\d)?)\s*([EW])/g;

  function pairsIn(text) {
    const out = [];
    let m;
    RE_PAIR.lastIndex = 0;
    while ((m = RE_PAIR.exec(text)) !== null) {
      out.push({ lat: lat(m[1], m[2]), lon: lon(m[3], m[4]) });
    }
    return out;
  }

  // --- text normalisation ----------------------------------------------------

  // Teletype products hard-wrap at ~69 cols and hyphenate across the break
  // ("upper-\nlevel low"). Rejoin those so keyword/coordinate matches survive.
  function dehyphenate(text) {
    // Drop the wrap (newline + leading whitespace) but keep the hyphen, so a
    // real compound broken at the hyphen ("upper-\nlevel") rejoins to
    // "upper-level" and keyword matches survive.
    return text.replace(/-\n\s*/g, '-');
  }

  // Split the product into its named sections. TWDAT headers are ALL-CAPS lines
  // ending in "..." e.g. "TROPICAL WAVES..." or a keyword line.
  function sections(text) {
    const lines = text.split('\n');
    const secs = [];
    let cur = { name: 'PREAMBLE', body: [] };
    // NHC section headers are wrapped in dots: "...TROPICAL WAVES..."
    // Also tolerate a trailing-dots-only form for robustness.
    const HEADER = /^\.{2,}\s*([A-Z][A-Z /]{2,}?)\s*\.{2,}\s*$|^([A-Z][A-Z /]{4,}?)\.{3}\s*$/;
    for (const ln of lines) {
      const h = ln.match(HEADER);
      if (h) {
        if (cur.body.length) secs.push(cur);
        cur = { name: (h[1] || h[2]).trim(), body: [] };
      } else {
        cur.body.push(ln);
      }
    }
    if (cur.body.length) secs.push(cur);
    return secs.map((s) => ({ name: s.name, text: s.body.join('\n') }));
  }

  // --- gazetteer (pass 2) ----------------------------------------------------
  // Coarse anchor points for prose-only positions. ~0.5deg is plenty at the
  // resolution TWDAT itself works to; every hit is flagged inferred.
  const GAZ = {
    'hispaniola': { lat: 19.0, lon: -71.0 },
    'puerto rico': { lat: 18.2, lon: -66.5 },
    'lesser antilles': { lat: 15.5, lon: -61.3 },
    'greater antilles': { lat: 20.0, lon: -76.0 },
    'windward islands': { lat: 13.0, lon: -61.2 },
    'leeward islands': { lat: 17.5, lon: -62.5 },
    'southeastern bahamas': { lat: 22.0, lon: -73.5 },
    'central bahamas': { lat: 24.3, lon: -76.0 },
    'northwestern bahamas': { lat: 26.5, lon: -78.0 },
    'cabo verde': { lat: 16.0, lon: -24.0 },
    'cape verde': { lat: 16.0, lon: -24.0 },
    'yucatan': { lat: 20.0, lon: -88.5 },
    'yucatan peninsula': { lat: 20.0, lon: -88.5 },
    'bay of campeche': { lat: 19.5, lon: -94.5 },
    'jamaica': { lat: 18.1, lon: -77.3 },
    'cuba': { lat: 21.7, lon: -79.5 },
    'the bahamas': { lat: 24.3, lon: -76.0 },
    'nicaragua': { lat: 12.8, lon: -84.0 },
    'honduras': { lat: 15.0, lon: -86.5 },
    'florida': { lat: 27.8, lon: -81.5 },
    'gulf of america': { lat: 25.0, lon: -90.0 },
    'gulf of mexico': { lat: 25.0, lon: -90.0 },
    'caribbean': { lat: 15.0, lon: -75.0 },
  };

  function gazResolve(phrase) {
    const p = phrase.toLowerCase();
    // "between A and B" -> midpoint of the two anchors
    const btw = p.match(/between (.+?) and (?:the )?(.+?)(?:[.,]|$)/);
    if (btw) {
      const a = anchor(btw[1]);
      const b = anchor(btw[2]);
      if (a && b) return { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 };
    }
    return anchor(p);
  }
  function anchor(name) {
    const key = name.trim().replace(/^the\s+/, '').replace(/[.,]$/, '');
    if (GAZ[key]) return GAZ[key];
    for (const k of Object.keys(GAZ)) if (key.includes(k)) return GAZ[k];
    return null;
  }

  // --- motion (pass 3) -------------------------------------------------------
  const DIR = {
    n: 0, north: 0, nne: 22.5, ne: 45, ene: 67.5,
    e: 90, east: 90, ese: 112.5, se: 135, sse: 157.5,
    s: 180, south: 180, ssw: 202.5, sw: 225, wsw: 247.5,
    w: 270, west: 270, wnw: 292.5, nw: 315, nnw: 337.5,
  };

  // returns { bearing, slowKt, fastKt } or null
  function parseMotion(text) {
    const t = text.toLowerCase();
    const dm = t.match(/moving (?:toward the |to the )?([a-z]{1,3}|north|south|east|west)\b/);
    if (!dm || !(dm[1] in DIR)) return null;
    const sm = t.match(/(\d{1,2})\s*(?:to\s*(\d{1,2}))?\s*(?:kt|knots)/);
    if (!sm) return null;
    const slow = parseInt(sm[1], 10);
    const fast = sm[2] ? parseInt(sm[2], 10) : slow;
    return { bearing: DIR[dm[1]], slowKt: slow, fastKt: fast };
  }

  // great-circle-ish projection over 24h (nm -> deg); fine at basin scale.
  function project(pt, bearingDeg, kt) {
    const nm = kt * 24;
    const dLat = (nm * Math.cos((bearingDeg * Math.PI) / 180)) / 60;
    const dLon =
      (nm * Math.sin((bearingDeg * Math.PI) / 180)) /
      (60 * Math.cos((pt.lat * Math.PI) / 180));
    return { lat: pt.lat + dLat, lon: pt.lon + dLon };
  }

  // --- feature extractors (pass 1) -------------------------------------------

  function extractWaves(secText, srcName) {
    const feats = [];
    // Sentences within the section; TWDAT separates waves by blank lines or ".".
    const chunks = secText.split(/\n\s*\n/).filter((c) => /wave/i.test(c));
    chunks.forEach((chunk, i) => {
      const flat = chunk.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
      const axis = [];

      // "along 46W south of 17N" / "axis along 22W from 05N to 17N"
      let m = flat.match(/along\s+(\d{1,3}(?:\.\d)?)\s*([EW])/i);
      if (m) {
        const lo = lon(m[1], m[2]);
        const south = flat.match(/south of\s+(\d{1,2}(?:\.\d)?)\s*([NS])/i);
        const range = flat.match(/from\s+(\d{1,2}(?:\.\d)?)\s*([NS])\s+to\s+(\d{1,2}(?:\.\d)?)\s*([NS])/i);
        if (range) {
          axis.push({ lat: lat(range[1], range[2]), lon: lo });
          axis.push({ lat: lat(range[3], range[4]), lon: lo });
        } else if (south) {
          const top = lat(south[1], south[2]);
          axis.push({ lat: top, lon: lo });
          axis.push({ lat: Math.max(2, top - 12), lon: lo }); // extend toward ITCZ
        }
      }
      // fall back to any explicit pairs on the line
      if (!axis.length) pairsIn(flat).forEach((p) => axis.push(p));
      if (!axis.length) return;

      const motion = parseMotion(flat);
      feats.push({
        kind: 'wave',
        id: 'W' + (i + 1),
        axis,
        motion,
        inferred: false,
        source: flat.slice(0, 220),
        srcSection: srcName,
      });
    });
    return feats;
  }

  function extractConvection(secText) {
    const feats = [];
    const flat = secText.replace(/\n/g, ' ');
    // "from 07N to 11N between 40W and 50W"
    const re =
      /from\s+(\d{1,2}(?:\.\d)?)\s*([NS])\s+to\s+(\d{1,2}(?:\.\d)?)\s*([NS])\s+between\s+(\d{1,3}(?:\.\d)?)\s*([EW])\s+and\s+(\d{1,3}(?:\.\d)?)\s*([EW])/gi;
    let m;
    while ((m = re.exec(flat)) !== null) {
      const s = lat(m[1], m[2]), n = lat(m[3], m[4]);
      const w = lon(m[5], m[6]), e = lon(m[7], m[8]);
      const strong = /isolated strong|strong convection/i.test(
        flat.slice(Math.max(0, m.index - 60), m.index + m[0].length + 40)
      );
      feats.push({
        kind: 'convection',
        bbox: { s: Math.min(s, n), n: Math.max(s, n), w: Math.min(w, e), e: Math.max(w, e) },
        strong,
        inferred: false,
        source: m[0],
      });
    }
    return feats;
  }

  function extractTroughs(secText, srcName) {
    const feats = [];
    const flat = secText.replace(/\n/g, ' ');
    // polylines: "from 08N27W to 08N44W to 09N57W"
    const re = /from\s+((?:\d{1,2}(?:\.\d)?[NS]\d{1,3}(?:\.\d)?[EW]\s*(?:to\s*)?){2,})/gi;
    let m;
    while ((m = re.exec(flat)) !== null) {
      const pts = pairsIn(m[1]);
      if (pts.length >= 2) {
        feats.push({
          kind: 'trough',
          line: pts,
          inferred: false,
          source: ('from ' + m[1]).slice(0, 160).trim(),
          srcSection: srcName,
        });
      }
    }
    return feats;
  }

  function extractFixes(secText) {
    const feats = [];
    const flat = secText.replace(/\n/g, ' ');
    // "near 14N76W", "centered near 27N85W", buoy/ship "at 20N60W"
    const re = /(?:near|centered near|centered at|at)\s+(\d{1,2}(?:\.\d)?)\s*([NS])\s*(\d{1,3}(?:\.\d)?)\s*([EW])/gi;
    let m;
    while ((m = re.exec(flat)) !== null) {
      feats.push({
        kind: 'fix',
        lat: lat(m[1], m[2]),
        lon: lon(m[3], m[4]),
        inferred: false,
        source: m[0],
      });
    }
    return feats;
  }

  // gazetteer pass over any sentence that names a place but has no coords
  function extractInferred(secText) {
    const feats = [];
    secText.split(/(?<=[.])\s+/).forEach((sent) => {
      if (RE_PAIR.test(sent)) { RE_PAIR.lastIndex = 0; return; }
      RE_PAIR.lastIndex = 0;
      const g = gazResolve(sent);
      if (g) {
        feats.push({
          kind: 'inferred',
          lat: g.lat, lon: g.lon,
          inferred: true,
          source: sent.trim().slice(0, 200),
        });
      }
    });
    return feats;
  }

  // --- orchestration ---------------------------------------------------------

  function parse(raw) {
    const text = dehyphenate(String(raw || ''));
    const secs = sections(text);
    const result = {
      issued: (text.match(/\b(\d{3,4})\s+(?:AM|PM|UTC)?\s*[A-Z]{3,4}\b.*\d{4}/) || [null])[0],
      waves: [], convection: [], troughs: [], fixes: [], inferred: [],
      projections: [], sections: secs.map((s) => s.name),
    };

    for (const s of secs) {
      const isWave = /WAVE/i.test(s.name);
      const isITCZ = /ITCZ|MONSOON|TROUGH/i.test(s.name);
      if (isWave) result.waves.push(...extractWaves(s.text, s.name));
      result.convection.push(...extractConvection(s.text));
      if (isITCZ || /TROUGH/i.test(s.text)) result.troughs.push(...extractTroughs(s.text, s.name));
      result.fixes.push(...extractFixes(s.text));
      // The preamble is product boilerplate ("...to the African coast...");
      // running the gazetteer over it only manufactures phantom positions.
      if (s.name !== 'PREAMBLE') result.inferred.push(...extractInferred(s.text));
    }

    // Pass 3: dead-reckon +24h for every wave that stated motion.
    for (const w of result.waves) {
      if (!w.motion || !w.axis.length) continue;
      const head = w.axis[0];
      const slow = project(head, w.motion.bearing, w.motion.slowKt);
      const fast = project(head, w.motion.bearing, w.motion.fastKt);
      result.projections.push({
        waveId: w.id,
        from: head,
        slow, fast,
        band: w.motion.slowKt !== w.motion.fastKt,
        inferred: true,
        source: w.source,
      });
    }

    return result;
  }

  root.BasinParser = { parse, pairsIn, sections, dehyphenate, parseMotion, project };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.BasinParser;
})(typeof window !== 'undefined' ? window : globalThis);
