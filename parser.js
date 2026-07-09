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
    // specific-before-generic: these contain "honduras"/"florida" below
    'gulf of honduras': { lat: 16.5, lon: -87.5 },
    'straits of florida': { lat: 24.0, lon: -81.0 },
    'honduras': { lat: 15.0, lon: -86.5 },
    'florida': { lat: 27.8, lon: -81.5 },
    'gulf of america': { lat: 25.0, lon: -90.0 },
    'gulf of mexico': { lat: 25.0, lon: -90.0 },
    // NOTE anchor() is first-key-wins over insertion order, so specific
    // multi-word entries must stay ABOVE the generic ones they contain
    // ("central caribbean" before "caribbean").
    'central tropical atlantic': { lat: 11.0, lon: -40.0 },
    'eastern tropical atlantic': { lat: 12.0, lon: -28.0 },
    'western tropical atlantic': { lat: 20.0, lon: -65.0 },
    'central subtropical atlantic': { lat: 28.0, lon: -50.0 },
    'northwestern caribbean': { lat: 18.0, lon: -85.0 },
    'western caribbean': { lat: 16.0, lon: -82.0 },
    'central caribbean': { lat: 15.0, lon: -75.0 },
    'eastern caribbean': { lat: 15.0, lon: -64.0 },
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

  // "west-northwestward" -> "wnw" -> DIR key, or null. Compound spelled-out
  // directions must resolve whole: the old regex let "west" match inside
  // "west-northwest" and silently returned 270 instead of 292.5.
  function dirKey(raw) {
    const word = raw.trim().replace(/ward$/, '');
    if (word in DIR) return word;
    const LETTER = { north: 'n', south: 's', east: 'e', west: 'w',
                     northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw' };
    const parts = word.split(/[- ]/).map((w) => LETTER[w]);
    if (parts.some((p) => !p)) return null;
    const key = parts.join('');
    return key in DIR ? key : null;
  }

  // returns { bearing, slowKt, fastKt } (+ stationary:true / unit:'mph') or null
  function parseMotion(text) {
    const t = text.toLowerCase();

    // "nearly stationary" / "little movement" — truthy but unprojectable.
    if (/\b(?:nearly\s+)?stationary\b|\blittle (?:overall )?movement\b/.test(t)) {
      return { bearing: null, slowKt: 0, fastKt: 0, stationary: true };
    }

    // speed: "10 to 15 kt" / "12 mph"; mph converted so downstream stays in kt
    const sm = t.match(/(\d{1,2})\s*(?:to\s*(\d{1,2}))?\s*(kt|knots|mph)\b/);
    let slow = sm ? parseInt(sm[1], 10) : null;
    let fast = sm ? (sm[2] ? parseInt(sm[2], 10) : slow) : null;
    const mph = sm && sm[3] === 'mph';
    if (mph) {
      slow = Math.round(slow * 0.868976);
      fast = Math.round(fast * 0.868976);
    }

    // "moving northwestward, or 320 degrees, at 9 kt" — trust the number
    const deg = t.match(/(\d{1,3})\s*degrees[,\s]*at\s*\d/);
    if (deg && sm) {
      const out = { bearing: parseInt(deg[1], 10) % 360, slowKt: slow, fastKt: fast };
      if (mph) out.unit = 'mph';
      return out;
    }

    // "moving west-northwest at ..." / "movement toward the north ..." / "drifting w"
    const dm = t.match(
      /(?:moving|movement(?:\s+is)?|drifting)\s+(?:toward(?:s)?(?: the)?\s+|to the\s+)?((?:north|south|east|west)(?:[- ]?(?:north|south|east|west))*(?:ward)?|[nsew]{1,3})\b/
    );
    const key = dm && dirKey(dm[1]);
    if (!key) return null;
    if (!sm) {
      // "drifting" with no stated speed: slow drift, not zero
      if (/\bdrifting\b/.test(t)) return { bearing: DIR[key], slowKt: 0, fastKt: 2 };
      return null;
    }
    const out = { bearing: DIR[key], slowKt: slow, fastKt: fast };
    if (mph) out.unit = 'mph';
    return out;
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
          // North end first, matching the "south of" branch, so axis[0] is a
          // consistent projection origin regardless of phrasing.
          const p1 = { lat: lat(range[1], range[2]), lon: lo };
          const p2 = { lat: lat(range[3], range[4]), lon: lo };
          axis.push(p1.lat >= p2.lat ? p1 : p2);
          axis.push(p1.lat >= p2.lat ? p2 : p1);
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

  // SPECIAL FEATURES: active tropical cyclones. Case-insensitive because
  // archived TWDATs are ALL CAPS; the captured name is title-cased.
  const RE_CYCLONE =
    /\b(Hurricane|Tropical Storm|Tropical Depression|Subtropical Storm|Subtropical Depression|Post-Tropical Cyclone|Remnants of)\s+([A-Z][A-Za-z]+(?:-[A-Za-z]+)?)/i;

  function titleCase(s) {
    return s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
  }

  function extractCyclones(secText, srcName) {
    const feats = [];
    secText.split(/\n\s*\n/).forEach((chunk) => {
      const flat = chunk.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
      const cm = flat.match(RE_CYCLONE);
      if (!cm) return; // Gale Warnings etc. also live under SPECIAL FEATURES

      // center: stated fix, falling back to the first coordinate pair
      const ctr = flat.match(
        /(?:centered|located)\s+(?:near|at)\s+(\d{1,2}(?:\.\d)?)\s*([NS])\s*(\d{1,3}(?:\.\d)?)\s*([EW])/i
      );
      let pos = null;
      if (ctr) pos = { lat: lat(ctr[1], ctr[2].toUpperCase()), lon: lon(ctr[3], ctr[4].toUpperCase()) };
      else pos = pairsIn(flat)[0] || null;
      if (!pos) return;

      const wm = flat.match(/max(?:imum)? sustained winds?(?:\s+speed)?(?:\s+(?:is|are|of))?\s*(?:near\s+)?(\d{1,3})\s*kt/i);
      const pm = flat.match(/(?:minimum central\s+)?pressure(?:\s+is)?(?:\s+estimated(?:\s+to be)?)?\D{0,15}(\d{3,4})\s*mb/i)
        || flat.match(/(\d{3,4})\s*mb/);

      feats.push({
        kind: 'cyclone',
        id: 'C' + (feats.length + 1),
        name: titleCase(cm[2]),
        classification: titleCase(cm[1]),
        lat: pos.lat,
        lon: pos.lon,
        windKt: wm ? parseInt(wm[1], 10) : null,
        pressureMb: pm ? parseInt(pm[1], 10) : null,
        motion: parseMotion(flat),
        inferred: false,
        source: flat.slice(0, 240),
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

  // --- TWO (Tropical Weather Outlook) -----------------------------------------
  // Disturbance areas are prose-only, so locations come from the gazetteer and
  // every feature is inferred:true — a formation area is never a fix.

  function twoChance(flat, horizon) {
    const re = new RegExp(
      'formation chance through ' + horizon + '[.\\s]*([a-z]+)[.\\s]*(?:near\\s+)?(\\d{1,3})\\s*percent', 'i'
    );
    const m = flat.match(re);
    return m ? { cat: m[1].toLowerCase(), pct: parseInt(m[2], 10) } : null;
  }

  function parseTWO(raw) {
    const text = dehyphenate(String(raw || ''));
    const out = {
      issued: (text.match(/\b(\d{3,4})\s+(?:AM|PM|UTC)?\s*[A-Z]{3,4}\b.*\d{4}/) || [null])[0],
      disturbances: [],
      text,
    };

    const chunks = text.split(/\n\s*\n/);
    let prev = '';
    for (const chunk of chunks) {
      if (/\*\s*formation chance/i.test(chunk)) {
        // Star lines terminate a disturbance. Older products keep prose and
        // stars in one block; the current titled format blank-line-separates
        // them, in which case the preceding chunk is the prose body.
        const body = /^\s*\*/.test(chunk) ? prev + '\n' + chunk : chunk;
        const flat = body.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();

        // location: title line first ("1. Central Tropical Atlantic (AL92):"),
        // then prose sentences, skipping the star lines themselves. Flattened,
        // because "between A and\nB" must not hide the phrase from gazResolve.
        const prose = body.split('\n').filter((ln) => !/^\s*\*/.test(ln)).join(' ')
          .replace(/\s+/g, ' ').trim();
        let pos = null;
        const title = prose.match(/^\s*\d+\.\s*(.+?):/);
        if (title) pos = gazResolve(title[1]);
        if (!pos) {
          for (const sent of prose.split(/(?<=[.])\s+/)) {
            pos = gazResolve(sent);
            if (pos) break;
          }
        }

        out.disturbances.push({
          kind: 'disturbance',
          id: 'D' + (out.disturbances.length + 1),
          lat: pos ? pos.lat : null,   // null = honest "not mappable", never invented
          lon: pos ? pos.lon : null,
          inferred: true,              // ALWAYS — prose location
          chance48: twoChance(flat, '48 hours'),
          chance7: twoChance(flat, '7 days'),
          source: flat.slice(0, 300),
        });
      }
      prev = chunk;
    }
    return out;
  }

  // --- orchestration ---------------------------------------------------------

  // Dead-reckon +24h from a point with stated motion; shared by waves and
  // cyclones. `waveId` is kept as an alias of `id` for older consumers.
  function addProjection(result, id, from, motion, source) {
    if (!motion || motion.bearing == null || !from) return;
    const slow = project(from, motion.bearing, motion.slowKt);
    const fast = project(from, motion.bearing, motion.fastKt);
    result.projections.push({
      id,
      waveId: id,
      from,
      slow, fast,
      band: motion.slowKt !== motion.fastKt,
      inferred: true,
      source,
    });
  }

  function parse(raw) {
    const text = dehyphenate(String(raw || ''));
    const secs = sections(text);
    const result = {
      issued: (text.match(/\b(\d{3,4})\s+(?:AM|PM|UTC)?\s*[A-Z]{3,4}\b.*\d{4}/) || [null])[0],
      cyclones: [], waves: [], convection: [], troughs: [], fixes: [], inferred: [],
      projections: [], sections: secs.map((s) => s.name),
    };

    for (const s of secs) {
      const isWave = /WAVE/i.test(s.name);
      const isITCZ = /ITCZ|MONSOON|TROUGH/i.test(s.name);
      // SPECIAL FEATURES paragraphs become typed cyclones; suppress the generic
      // fix/gazetteer passes there so a named center doesn't double-register.
      const isSpecial = /SPECIAL FEATURE/i.test(s.name);
      if (isSpecial) result.cyclones.push(...extractCyclones(s.text, s.name));
      if (isWave) result.waves.push(...extractWaves(s.text, s.name));
      result.convection.push(...extractConvection(s.text));
      if (isITCZ || /TROUGH/i.test(s.text)) result.troughs.push(...extractTroughs(s.text, s.name));
      if (!isSpecial) result.fixes.push(...extractFixes(s.text));
      // The preamble is product boilerplate ("...to the African coast...");
      // running the gazetteer over it only manufactures phantom positions.
      if (s.name !== 'PREAMBLE' && !isSpecial) result.inferred.push(...extractInferred(s.text));
    }

    // Pass 3: dead-reckon +24h for every wave and cyclone that stated motion.
    for (const w of result.waves) {
      if (!w.axis.length) continue;
      addProjection(result, w.id, w.axis[0], w.motion, w.source);
    }
    for (const c of result.cyclones) {
      addProjection(result, c.name || c.id, { lat: c.lat, lon: c.lon }, c.motion, c.source);
    }

    return result;
  }

  root.BasinParser = { parse, parseTWO, pairsIn, sections, dehyphenate, parseMotion, project };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.BasinParser;
})(typeof window !== 'undefined' ? window : globalThis);
