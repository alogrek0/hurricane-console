/*
 * parser.js — Hurricane Console
 * NHC Tropical Weather Discussion / Outlook text -> geo features.
 * Per-basin: Atlantic (TWDAT/TWOAT) and East Pacific (TWDEP/TWOEP). The basin
 * is auto-detected from the product header (detectBasin) and can be overridden
 * with opts.basin; it selects the gazetteer, the left-basin rule, and the
 * climatology guards. Coordinate extraction is basin-blind.
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

  // A single explicit coordinate token like "61W", "18N", "5.5S" — used to
  // detect sentences the gazetteer must NOT touch. Unlike RE_PAIR this fires on
  // a lone lat OR lon, so "along 61W-62W, south of 18N" is recognised as coord-
  // positioned even though its lat and lon never appear adjacently as a pair.
  const RE_COORD_TOKEN = /\b\d{1,3}(?:\.\d)?\s*[NSEW]\b/;

  // Feature nouns that mean a sentence is actually introducing/locating a
  // system, not just mentioning a place in passing. Bare "area"/"disturbed"
  // (NOT the two-word "area of") so CLAUDE.md's canonical case "a disturbed
  // area between Hispaniola and the southeastern Bahamas bears watching" still
  // infers, while pure narrative ("trades over the Gulf of Honduras") does not.
  const RE_FEATURE_NOUN = /\b(?:wave|low|disturbance|disturbed|trough|area|system|gyre)\b/i;

  // Future modality: everything after these words describes where a feature is
  // GOING, not where it is. A gazetteer dot at a future position labeled as
  // current is actively wrong, so gazResolve only sees the pre-modal prefix.
  const RE_FUTURE = /\b(?:will|should|is expected|are expected|forecast)\b/i;

  // Climatological/boilerplate phrases whose nouns ("low", "area") are NOT
  // transient tropical features: the semi-permanent pressure centers, the
  // product's own forecast-area edge ("north of the area"), and warning areas.
  // Stripped before the feature-noun gate so "the pressure gradient between the
  // Atlantic ridge and the Colombian low is supporting strong winds" no longer
  // earns a dot from the "low" inside a climo name. Per-basin: the EP list adds
  // the gap-wind vocabulary (Tehuantepec/Papagayo), whose "area"/"event" nouns
  // would otherwise pass the gate.
  const CLIMO_COMMON = [
    '(?:colombian|panama)\\s+low',
    '(?:bermuda-azores|bermuda|azores)\\s+high',
    '(?:subtropical|atlantic)\\s+ridge',
    '\\w+\\s+warning\\s+area',
    '(?:north|south|east|west)\\s+of\\s+the\\s+(?:forecast\\s+)?area',
    'this\\s+area',
  ];
  const CLIMO_EP_EXTRA = [
    '(?:tehuantepec|papagayo)\\s+(?:gap\\s+)?winds?(?:\\s+(?:event|area))?',
    'gap\\s+wind\\s+(?:event|area)',
  ];
  const RE_CLIMO = {
    AT: new RegExp(CLIMO_COMMON.join('|'), 'gi'),
    EP: new RegExp(CLIMO_COMMON.concat(CLIMO_EP_EXTRA).join('|'), 'gi'),
  };

  // A feature that has left the basin is off the chart; a dot at its old
  // anchor would map a feature that is no longer there. CRITICAL asymmetry:
  // in a TWDEP, "moved into the eastern Pacific" is an ARRIVAL (waves enter
  // from the Caribbean), so the Atlantic rule must never run on EP text.
  // EP phrasings confirmed against archived TWDEPs: "accelerating ... into the
  // Central Pacific basin", "move W of 140W by the end of the week"; in-basin
  // dissipation ("will dissipate over southern Mexico") is left to the future-
  // modal guard, but a past-tense "moved inland" is a real departure.
  const RE_LEFT_BASIN = {
    AT: /\bmoved\s+(?:in)?to\s+the\s+(?:eastern\s+)?pacific\b/i,
    EP: /\b(?:in)?to\s+the\s+central\s+pacific\b|\bw(?:est)?\s+of\s+140w\b|\bcrossed\s+140w\b|\bmoved\s+inland\b/i,
  };

  // Cross-references ("Refer to the Tropical Waves section above...") point at
  // a feature described elsewhere; model attributions ("The GFS model shows a
  // 700 mb inverted trough...") describe model fields, not analyzed features.
  const RE_XREF_OR_MODEL = /\brefer to\b|\b(?:gfs|ecmwf|nam|model)\b/i;

  // Definite reference ("the wave", "this trough", "the tropical wave") to a
  // feature kind the product has already positioned with real coordinates.
  const RE_ANA_WAVE = /\b(?:the|this|that)\s+(?:[a-z-]+\s+)?wave\b/i;
  const RE_ANA_TROUGH = /\b(?:the|this|that)\s+(?:[a-z-]+\s+)?trough\b/i;

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

  // --- basin detection ---------------------------------------------------------
  // 'AT' | 'EP' from the product header region ONLY (WMO id + AWIPS id + title
  // lines) — never the body, where "eastern Pacific" appears in Atlantic
  // departure prose ("the wave moved into the eastern Pacific").
  function detectBasin(text) {
    const head = String(text || '').slice(0, 400);
    if (/\b(?:TWDEP|TWOEP|AXPZ20|ABPZ20)\b/.test(head)) return 'EP';
    // area line: "...for the eastern Pacific Ocean from..." (TWDEP) or
    // "For the eastern and central North Pacific east of 180 longitude:" (TWOEP)
    if (/\bfor\s+the\s+east(?:ern)?(?:\s+and\s+central)?(?:\s+north)?\s+pacific\b/i.test(head)) return 'EP';
    return 'AT'; // Atlantic default preserves every pre-basin caller
  }

  // --- gazetteer (pass 2) ----------------------------------------------------
  // Coarse anchor points for prose-only positions. ~0.5deg is plenty at the
  // resolution the discussions themselves work to; every hit is flagged
  // inferred. Per-basin tables: GAZ_AT is byte-for-byte the pre-basin table
  // (fixture snapshots pin its behavior); GAZ_EP is self-contained, with its
  // own Pacific-side anchors for the Central American coast (a shared table
  // would compromise between an Atlantic-side and Pacific-side anchor).
  const GAZ_AT = {
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

  // East Pacific anchors: water-body centers, island groups, and points ON or
  // just OFFSHORE the coast (never inland centroids — TWDEP describes waves
  // along the coast). specific-before-generic: "baja california sur" above
  // "baja california". DELIBERATELY no Hawaii entry: the basin frame ends at
  // 140W and TWOEP's Central Pacific systems stay honestly unmapped.
  const GAZ_EP = {
    'gulf of tehuantepec': { lat: 16.0, lon: -95.0 },
    'gulf of california': { lat: 28.0, lon: -112.0 },
    'baja california sur': { lat: 25.6, lon: -111.9 },
    'baja california': { lat: 29.0, lon: -114.0 },
    'revillagigedo islands': { lat: 18.8, lon: -112.8 },
    'revillagigedo': { lat: 18.8, lon: -112.8 },
    'socorro island': { lat: 18.8, lon: -111.0 },
    'clipperton island': { lat: 10.3, lon: -109.2 },
    'clipperton': { lat: 10.3, lon: -109.2 },
    'cabo corrientes': { lat: 20.4, lon: -105.7 },
    'gulf of papagayo': { lat: 10.7, lon: -85.8 },
    'gulf of fonseca': { lat: 13.3, lon: -87.8 },
    'gulf of panama': { lat: 8.1, lon: -79.3 },
    'azuero peninsula': { lat: 7.7, lon: -80.6 },
    'galapagos': { lat: 0.0, lon: -90.5 },
    'acapulco': { lat: 16.9, lon: -99.9 },
    'manzanillo': { lat: 19.1, lon: -104.3 },
    'salina cruz': { lat: 16.2, lon: -95.2 },
    'puerto vallarta': { lat: 20.7, lon: -105.3 },
    'zihuatanejo': { lat: 17.6, lon: -101.6 },
    // offshore-waters anchor, not an inland centroid
    'southwestern mexico': { lat: 17.0, lon: -102.0 },
    // coastal-state anchors: on/just offshore each state's coastline
    'jalisco': { lat: 20.5, lon: -105.6 },
    'colima': { lat: 19.0, lon: -104.6 },
    'michoacan': { lat: 17.8, lon: -102.3 },
    'guerrero': { lat: 17.0, lon: -100.9 },
    'oaxaca': { lat: 15.7, lon: -97.3 },
    'chiapas': { lat: 14.5, lon: -92.6 },
    // Central America: landmass anchors (TWDEP waves cross the isthmus), so
    // honduras/nicaragua use country centers; yucatan matches the Atlantic
    // table so the same landmass never maps to two different dots.
    'yucatan peninsula': { lat: 20.0, lon: -88.5 },
    'yucatan': { lat: 20.0, lon: -88.5 },
    'guatemala': { lat: 14.0, lon: -92.2 },
    'el salvador': { lat: 13.3, lon: -89.4 },
    'honduras': { lat: 15.0, lon: -86.5 },
    'nicaragua': { lat: 12.9, lon: -85.1 },
    'costa rica': { lat: 9.8, lon: -85.0 },
    'panama': { lat: 8.8, lon: -80.0 },
  };

  const GAZ = { AT: GAZ_AT, EP: GAZ_EP };

  function gazResolve(phrase, gaz) {
    const p = phrase.toLowerCase();
    // "between A and B" -> midpoint of the two anchors
    const btw = p.match(/between (.+?) and (?:the )?(.+?)(?:[.,]|$)/);
    if (btw) {
      const a = anchor(btw[1], gaz);
      const b = anchor(btw[2], gaz);
      if (a && b) return { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 };
    }
    return anchor(p, gaz);
  }
  function anchor(name, gaz) {
    const key = name.trim().replace(/^the\s+/, '').replace(/[.,]$/, '');
    if (gaz[key]) return gaz[key];
    for (const k of Object.keys(gaz)) if (key.includes(k)) return gaz[k];
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

  // --- popup context ---------------------------------------------------------
  // Each feature carries `context`: the paragraph its `source` came from, built
  // in the SAME normalization as that extractor's source so the popup can
  // locate the source span inside it by plain indexOf. Capped so popups stay
  // popup-sized; the cap window always keeps the [at, at+len) span visible.
  const CONTEXT_MAX = 600;
  function capContext(text, at, len) {
    if (text.length <= CONTEXT_MAX) return text;
    let start = Math.max(0, Math.min(at - ((CONTEXT_MAX - len) >> 1), text.length - CONTEXT_MAX));
    let end = start + CONTEXT_MAX;
    // never cut mid-word, never cut into the span itself
    if (start > 0) { const sp = text.indexOf(' ', start); if (sp !== -1 && sp < at) start = sp + 1; }
    if (end < text.length) { const sp = text.lastIndexOf(' ', end); if (sp > at + len) end = sp; }
    return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
  }

  // Sentence(s) around a regex match in a newline-flattened section — for the
  // extractors whose source is a verbatim match (convection/trough/fix).
  function sentenceAround(flat, at, len) {
    const s0 = flat.lastIndexOf('.', at - 1) + 1;
    let s1 = flat.indexOf('.', at + len);
    s1 = s1 === -1 ? flat.length : s1 + 1;
    let ctx = flat.slice(s0, s1);
    const lead = ctx.match(/^\s*/)[0].length;
    ctx = ctx.slice(lead).replace(/\s+$/, '');
    return capContext(ctx, at - s0 - lead, len);
  }

  function extractWaves(secText, srcName) {
    const feats = [];
    // Sentences within the section; TWDAT separates waves by blank lines or ".".
    const chunks = secText.split(/\n\s*\n/).filter((c) => /wave/i.test(c));
    chunks.forEach((chunk, i) => {
      const flat = chunk.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
      const axis = [];

      // Axis longitude. Real TWDATs vary the phrasing widely — "axis along 22W",
      // "is along 33W", "is near 39W", "has its axis near 46W" — and sometimes give
      // a span "along 61W-62W". Anchor on the first along/near longitude in the
      // chunk (the axis is stated before any convection), averaging a span.
      let m = flat.match(
        /\b(?:along|near)\s+(\d{1,3}(?:\.\d)?)\s*([EW])(?:\s*(?:-|to|\/)\s*(\d{1,3}(?:\.\d)?)\s*([EW]))?/i
      );
      if (m) {
        const lo = m[3] ? (lon(m[1], m[2]) + lon(m[3], m[4])) / 2 : lon(m[1], m[2]);
        // Southern extent: "south of 17N", the abbreviated "S of 17N", and the
        // open-ended "from 18N southward" (2023-era archive phrasing), which may
        // carry a short place interjection: "from 19N in Haiti southward".
        const south = flat.match(/\b(?:south|s)\s+of\s+(\d{1,2}(?:\.\d)?)\s*([NS])/i) ||
          flat.match(/\bfrom\s+(\d{1,2}(?:\.\d)?)\s*([NS])(?:\s+(?:in|near|over)\s+[A-Za-z .-]{1,25}?)?\s+southward/i);
        // Northern extent — the TWDEP mirror: waves run from a low latitude up
        // to the Central American/Mexican coast ("north of 01N to across
        // portions of El Salvador", "from 03N northward to the coast").
        const north = flat.match(/\b(?:north|n)\s+of\s+(\d{1,2}(?:\.\d)?)\s*([NS])/i) ||
          flat.match(/\bfrom\s+(\d{1,2}(?:\.\d)?)\s*([NS])(?:\s+(?:in|near|over)\s+[A-Za-z .-]{1,25}?)?\s+northward/i);
        // Latitude span: "from 05N to 17N", or the hyphenated "from 12-19N". The
        // negative lookahead skips a "from A to B between C and D" phrase — that's
        // a convection box (longitude-bounded by "between"), not the wave axis.
        const range = flat.match(/from\s+(\d{1,2}(?:\.\d)?)\s*([NS])\s+to\s+(\d{1,2}(?:\.\d)?)\s*([NS])(?!\s*,?\s*between)/i);
        const hrange = flat.match(/from\s+(\d{1,2}(?:\.\d)?)\s*-\s*(\d{1,2}(?:\.\d)?)\s*([NS])(?!\s*,?\s*between)/i);
        // The axis extent is stated immediately after the along/near anchor;
        // convection latitudes come later in the chunk ("Precipitation: ...
        // from 07N to 12N"), so when several forms match, the earliest
        // occurrence wins — not a fixed precedence.
        const kind = [[range, 'range'], [hrange, 'hrange'], [south, 'south'], [north, 'north']]
          .filter((c) => c[0])
          .sort((a, b) => a[0].index - b[0].index)
          .map((c) => c[1])[0];
        if (kind === 'range') {
          // North end first, matching the "south of" branch, so axis[0] is a
          // consistent projection origin regardless of phrasing.
          const p1 = { lat: lat(range[1], range[2]), lon: lo };
          const p2 = { lat: lat(range[3], range[4]), lon: lo };
          axis.push(p1.lat >= p2.lat ? p1 : p2);
          axis.push(p1.lat >= p2.lat ? p2 : p1);
        } else if (kind === 'hrange') {
          const a = lat(hrange[1], hrange[3]), b = lat(hrange[2], hrange[3]);
          axis.push({ lat: Math.max(a, b), lon: lo });
          axis.push({ lat: Math.min(a, b), lon: lo });
        } else if (kind === 'south') {
          const top = lat(south[1], south[2]);
          axis.push({ lat: top, lon: lo });
          axis.push({ lat: Math.max(2, top - 12), lon: lo }); // extend toward ITCZ
        } else if (kind === 'north') {
          // mirror of 'south': stated bottom, extend toward the coast
          const bottom = lat(north[1], north[2]);
          axis.push({ lat: bottom + 12, lon: lo });
          axis.push({ lat: bottom, lon: lo });
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
        context: capContext(flat, 0, Math.min(flat.length, 220)),
        srcSection: srcName,
      });
    });
    return feats;
  }

  // SPECIAL FEATURES: active tropical cyclones. Case-insensitive because
  // archived TWDATs are ALL CAPS; the captured name is title-cased. GLOBAL so
  // extractCyclones can walk past a genesis mention to a real storm in the same
  // paragraph (reset .lastIndex per chunk — a global regex carries state).
  const RE_CYCLONE =
    /\b(Hurricane|Tropical Storm|Tropical Depression|Subtropical Storm|Subtropical Depression|Potential Tropical Cyclone|Post-Tropical Cyclone|Remnants of)\s+([A-Za-z][A-Za-z]*(?:-[A-Za-z]+)?)/gi;

  // A CYCLONE MUST BE REAL. NHC discusses storms that do not exist yet — "a
  // tropical depression OR tropical storm IS expected to form later today" —
  // and the classification match happily swallows the next word as the storm's
  // name, fabricating "Tropical Depression Or" and plotting it at whatever
  // coordinate is nearby. A named cyclone that does not exist is the worst lie
  // this map can tell, so a match must clear three gates:
  //   (a) the word after the classification is never a storm name (function
  //       words, modals, and the genesis vocabulary). Checked case-insensitively
  //       because archived products are ALL CAPS; verified against the Atlantic/
  //       EP/CP name lists and the spelled-number TD names (One..Twenty-two) —
  //       no real name collides.
  const NOT_A_NAME = /^(?:or|is|are|was|were|will|would|could|can|may|might|should|has|have|had|and|but|to|of|the|an?|that|this|it|its|near|over|along|with|from|in|on|by|as|at|expected|forecast|likely|possible|probable|forms?|forming|formation|develops?|developing|development|conditions|activity|force|watch|warnings?|center|intensity|strength|remnants|status|category)$/i;
  //   (b) in mixed-case text a real name is ALWAYS capitalized, so a lowercase
  //       token is prose, not a name. (ALL-CAPS archives carry no case signal —
  //       there (a) is the backstop.)
  //   (c) an indefinite article before the classification means a generic,
  //       usually forecast, storm: "a tropical depression is expected to form".
  //       NHC never writes "a Tropical Storm Otis".
  const RE_INDEFINITE = /\b(?:a|an)\s+$/i;

  function validCycloneName(raw, allCaps) {
    if (NOT_A_NAME.test(raw)) return false;
    return allCaps || raw[0] === raw[0].toUpperCase();
  }

  function titleCase(s) {
    // \b\w capitalizes after hyphens too — NHC style is "Post-Tropical Cyclone".
    return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function extractCyclones(secText, srcName) {
    const feats = [];
    secText.split(/\n\s*\n/).forEach((chunk) => {
      const flat = chunk.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
      // First VALID match, not the first match: a paragraph can mention a
      // storm-to-be before naming the storm that already exists.
      const allCaps = flat === flat.toUpperCase();
      let cm = null;
      RE_CYCLONE.lastIndex = 0;
      let m;
      while ((m = RE_CYCLONE.exec(flat)) !== null) {
        if (RE_INDEFINITE.test(flat.slice(0, m.index))) continue; // "a tropical depression ..."
        if (!validCycloneName(m[2], allCaps)) continue;
        cm = m;
        break;
      }
      if (!cm) return; // genesis prose, Gale Warnings etc. also live under SPECIAL FEATURES

      // center: stated fix, falling back to the first coordinate pair
      const ctr = flat.match(
        /(?:centered|located)\s+(?:near|at)\s+(\d{1,2}(?:\.\d)?)\s*([NS])\s*(\d{1,3}(?:\.\d)?)\s*([EW])/i
      );
      let pos = null;
      if (ctr) pos = { lat: lat(ctr[1], ctr[2].toUpperCase()), lon: lon(ctr[3], ctr[4].toUpperCase()) };
      else pos = pairsIn(flat)[0] || null;
      if (!pos) return;

      // "winds are 90 kt" / "wind speed is 120 kt" / "wind speeds are 30 knots"
      // all occur in real TWDATs (the last is Subtropical Depression Don, Jul 2023)
      const wm = flat.match(/max(?:imum)? sustained winds?(?:\s+speeds?)?(?:\s+(?:is|are|of))?\s*(?:near\s+)?(\d{1,3})\s*k(?:t|nots?)\b/i);
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
        context: capContext(flat, 0, Math.min(flat.length, 240)),
        srcSection: srcName,
      });
    });
    return feats;
  }

  function extractConvection(secText, srcName) {
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
        context: sentenceAround(flat, m.index, m[0].length),
        srcSection: srcName,
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
          context: sentenceAround(flat, m.index, m[0].length),
          srcSection: srcName,
        });
      }
    }
    return feats;
  }

  function extractFixes(secText, srcName) {
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
        context: sentenceAround(flat, m.index, m[0].length),
        srcSection: srcName,
      });
    }
    return feats;
  }

  // gazetteer pass over any sentence that names a place but has no coords
  function extractInferred(secText, srcName, basin) {
    const feats = [];
    secText.split(/(?<=[.])\s+/).forEach((sent) => {
      if (RE_PAIR.test(sent)) { RE_PAIR.lastIndex = 0; return; }
      RE_PAIR.lastIndex = 0;
      // (a) A sentence positioned by an explicit coordinate token (even a lone
      // "61W" or "18N" with no paired mate) is not the gazetteer's job. Emitting
      // no dot is more honest than force-fitting it to a coarse place centroid.
      if (RE_COORD_TOKEN.test(sent)) return;
      // (c) A feature that departed the basin is off the chart; a
      // cross-reference or model-field sentence is not an analyzed position.
      if (RE_LEFT_BASIN[basin].test(sent) || RE_XREF_OR_MODEL.test(sent)) return;
      // (d) Positions after a future modal are forecasts, not fixes: resolve
      // only the pre-modal prefix. "For the forecast, ..." dies here too
      // (prefix "For the " carries no feature noun).
      const present = sent.split(RE_FUTURE)[0];
      // (e) Climo names must not satisfy the noun gate ("Colombian low").
      const gated = present.replace(RE_CLIMO[basin], ' ');
      // (b) Only infer when the sentence actually introduces/locates a feature.
      // Otherwise a place merely named in narrative ("trades over the Gulf of
      // Honduras will pulse") gets a spurious dot.
      if (!RE_FEATURE_NOUN.test(gated)) return;
      const g = gazResolve(present, GAZ[basin]);
      if (g) {
        feats.push({
          kind: 'inferred',
          lat: g.lat, lon: g.lon,
          inferred: true,
          source: sent.trim().slice(0, 200),
          // same basis as source (trimmed, internal newlines kept) so the
          // source stays a literal prefix; HTML collapses the newlines anyway
          context: capContext(sent.trim(), 0, Math.min(sent.trim().length, 200)),
          srcSection: srcName,
        });
      }
    });
    return feats;
  }

  // Planar point-to-segment distance in degrees (lon scaled by cos lat) —
  // deliberately coarse, matching the gazetteer's own precision.
  function ptSegDeg(p, a, b) {
    const k = Math.cos((p.lat * Math.PI) / 180);
    const ax = a.lon * k, ay = a.lat, bx = b.lon * k, by = b.lat;
    const px = p.lon * k, py = p.lat;
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2)) : 0;
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  // Drop inferred dots that duplicate a feature the product already positions
  // with real coordinates: a definite re-mention ("the tropical wave entering
  // the Caribbean" — the wave is drawn from its own section) or a same-kind dot
  // within DEDUP_DEG of the parsed geometry ("A tropical wave is just west of
  // the Cabo Verde Islands" sitting on a parsed axis). Kind-matched on purpose:
  // an unrelated disturbance that merely borders a convection box must survive.
  const DEDUP_DEG = 2;
  function dedupeInferred(result) {
    result.inferred = result.inferred.filter((dot) => {
      const s = dot.source;
      if (RE_ANA_WAVE.test(s) && result.waves.length) return false;
      if (RE_ANA_TROUGH.test(s) && result.troughs.length) return false;
      let d = Infinity;
      if (/\bwave\b/i.test(s)) for (const w of result.waves)
        for (let i = 0; i < w.axis.length; i++)
          d = Math.min(d, ptSegDeg(dot, w.axis[i], w.axis[Math.min(i + 1, w.axis.length - 1)]));
      if (/\btrough\b/i.test(s)) for (const t of result.troughs)
        for (let i = 0; i + 1 < t.line.length; i++)
          d = Math.min(d, ptSegDeg(dot, t.line[i], t.line[i + 1]));
      if (/\b(?:low|disturbance|disturbed|system|gyre|area)\b/i.test(s)) {
        for (const c of result.cyclones) d = Math.min(d, ptSegDeg(dot, c, c));
        for (const f of result.fixes) d = Math.min(d, ptSegDeg(dot, f, f));
      }
      return d >= DEDUP_DEG;
    });
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

  function parseTWO(raw, opts) {
    const text = dehyphenate(String(raw || ''));
    const basin = (opts && opts.basin) || detectBasin(text);
    const gaz = GAZ[basin];
    const out = {
      issued: (text.match(/\b(\d{3,4})\s+(?:AM|PM|UTC)?\s*[A-Z]{3,4}\b.*\d{4}/) || [null])[0],
      basin,
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
        // Atlantic numbers its titled entries ("1. Central Tropical Atlantic
        // (AL92):"); EP does not ("Offshore of Southwestern Mexico (EP96):").
        // The no-period guard keeps a leading prose sentence containing a
        // colon from masquerading as a title.
        const title = prose.match(/^\s*(?:\d+\.\s*)?([^:.]{1,80}):/);
        if (title) pos = gazResolve(title[1], gaz);
        if (!pos) {
          for (const sent of prose.split(/(?<=[.])\s+/)) {
            pos = gazResolve(sent, gaz);
            if (pos) break;
          }
        }

        out.disturbances.push({
          kind: 'disturbance',
          id: 'D' + (out.disturbances.length + 1),
          // invest tag from the title line ("1. Central Tropical Atlantic (AL92):",
          // "Offshore of Southwestern Mexico (EP96):", "(CP91)" near Hawaii —
          // CP tags are captured even though their locations stay unmapped)
          invest: title ? (((title[1].match(/\(((?:AL|EP|CP)\d{2})\)/i) || [])[1] || '').toUpperCase() || null) : null,
          lat: pos ? pos.lat : null,   // null = honest "not mappable", never invented
          lon: pos ? pos.lon : null,
          inferred: true,              // ALWAYS — prose location
          chance48: twoChance(flat, '48 hours'),
          chance7: twoChance(flat, '7 days'),
          source: flat.slice(0, 300),
          context: capContext(flat, 0, Math.min(flat.length, 300)),
        });
      }
      prev = chunk;
    }
    return out;
  }

  // --- TCM (Tropical Cyclone Forecast/Advisory) --------------------------------
  // The most rigid NHC text product: FORECAST/OUTLOOK VALID lines carry the
  // official track. Times are DD/HHMMZ with no month, so hour offsets resolve
  // month rollover by picking the month length that lands the delta in 0..6 days.

  function tcmHours(d0, h0, d1, h1) {
    var days = d1 - d0;
    if (days < 0) {
      var lens = [31, 30, 29, 28];
      for (var i = 0; i < lens.length; i++) {
        var cand = d1 - d0 + lens[i];
        if (cand >= 0 && cand <= 6) { days = cand; break; }
      }
      if (days < 0) return null;
    }
    var hrs = days * 24 + (h1 - h0);
    return hrs < 0 ? null : hrs;
  }

  function parseTCM(raw) {
    const text = dehyphenate(String(raw || ''));
    const head = text.match(
      /\b(HURRICANE|TROPICAL STORM|TROPICAL DEPRESSION|SUBTROPICAL STORM|SUBTROPICAL DEPRESSION|POTENTIAL TROPICAL CYCLONE|POST-TROPICAL CYCLONE|REMNANTS OF)\s+([A-Z][A-Za-z-]+)\s+(?:SPECIAL\s+)?FORECAST\/ADVISORY\s+NUMBER\s+(\d+)/i
    );
    const ctr = text.match(
      /CENTER LOCATED NEAR\s+(\d{1,2}(?:\.\d)?)\s*([NS])\s+(\d{1,3}(?:\.\d)?)\s*([EW])\s+AT\s+(\d{2})\/(\d{2})(\d{2})Z/i
    );
    if (!head || !ctr) return null;
    const idm = text.match(/\b(AL|EP|CP)(\d{6})\b/);
    const d0 = parseInt(ctr[5], 10), h0 = parseInt(ctr[6], 10);
    const wm = text.match(/MAX SUSTAINED WINDS\s+(\d{1,3})\s*KT(?:\s+WITH\s+GUSTS\s+TO\s+(\d{1,3})\s*KT)?/i);
    const pm = text.match(/MINIMUM CENTRAL PRESSURE\s+(\d{3,4})\s*MB/i);

    // Current-position wind radii: "64 KT....... 65NE  40SE  40SW  55NW." lines
    // between the intensity block and the first FORECAST VALID. These are
    // official advisory data (nm, largest radius anywhere in the quadrant) —
    // unlike the computed cone. Forecast-point radii exist too but are not
    // captured (v1 draws the current wind field only).
    const fcstAt = text.search(/FORECAST VALID/i);
    const preFcst = fcstAt === -1 ? text : text.slice(0, fcstAt);
    let windRadiiNm = null;
    const rre = /(\d{2})\s*KT\.+\s*(\d{1,3})NE\s+(\d{1,3})SE\s+(\d{1,3})SW\s+(\d{1,3})NW/gi;
    let rm;
    while ((rm = rre.exec(preFcst)) !== null) {
      const q = { ne: +rm[2], se: +rm[3], sw: +rm[4], nw: +rm[5] };
      if (q.ne || q.se || q.sw || q.nw) {
        windRadiiNm = windRadiiNm || {};
        windRadiiNm[parseInt(rm[1], 10)] = q;
      }
    }

    const track = [];
    for (const chunk of text.split(/\n\s*\n/)) {
      const v = chunk.match(
        /^\s*(FORECAST|OUTLOOK)\s+VALID\s+(\d{2})\/(\d{2})(\d{2})Z\s+(\d{1,2}(?:\.\d)?)\s*([NS])\s+(\d{1,3}(?:\.\d)?)\s*([EW])/i
      );
      if (!v) continue; // dissipated blocks carry no position; skip from geometry
      const mw = chunk.match(/MAX WIND\s+(\d{1,3})\s*KT/i);
      const hours = tcmHours(d0, h0, parseInt(v[2], 10), parseInt(v[3], 10));
      if (hours == null) continue;
      const entry = {
        kind: v[1].toUpperCase(),
        hours: hours,
        validZ: v[2] + '/' + v[3] + v[4] + 'Z',
        lat: lat(v[5], v[6].toUpperCase()),
        lon: lon(v[7], v[8].toUpperCase()),
        windKt: mw ? parseInt(mw[1], 10) : null,
      };
      if (/POST-TROP/i.test(chunk)) entry.state = 'post-tropical';
      if (/DISSIPAT/i.test(chunk)) entry.state = 'dissipated';
      track.push(entry);
    }

    return {
      stormId: idm ? (idm[1] + idm[2]) : null,
      name: titleCase(head[2]),
      classification: titleCase(head[1]),
      advisory: parseInt(head[3], 10),
      center: { lat: lat(ctr[1], ctr[2].toUpperCase()), lon: lon(ctr[3], ctr[4].toUpperCase()) },
      issued: ctr[5] + '/' + ctr[6] + ctr[7] + 'Z',
      // Full issuance header ("2100 UTC SUN SEP 15 2024") — unlike the DD/HHMMZ
      // stamp above, this is a line parseIssued can turn into a Date.
      issuedHeader: (text.match(/\b\d{3,4}\s+UTC\s+[A-Za-z]{3}\s+[A-Za-z]{3}\s+\d{1,2}\s+\d{4}\b/) || [null])[0],
      windKt: wm ? parseInt(wm[1], 10) : null,
      gustKt: wm && wm[2] ? parseInt(wm[2], 10) : null,
      pressureMb: pm ? parseInt(pm[1], 10) : null,
      windRadiiNm: windRadiiNm,
      motion: parseMotion(text),
      track: track,
    };
  }

  // --- cone geometry ---------------------------------------------------------
  // NHC published cone circle radii (nm) by forecast hour, PER BASIN.
  // Source: https://www.nhc.noaa.gov/aboutcone.shtml (current season; update
  // annually — the page publishes Atlantic and a combined "Eastern/Central
  // N. Pacific" column, so CP deliberately aliases EP). CONE_SEASON is the
  // season the radii were taken from — bump ALL tables together; a test fails
  // when the season falls behind the calendar year.
  // Hour 0 uses a small fixed radius so the cone starts at the center (NHC's
  // table starts at 12h).
  const CONE_SEASON = 2026;
  const CONE_RADII_NM = {
    AL: [[0, 10], [12, 25], [24, 39], [36, 49], [48, 62], [60, 77], [72, 95], [96, 134], [120, 200]],
    EP: [[0, 10], [12, 25], [24, 37], [36, 48], [48, 56], [60, 66], [72, 78], [96, 106], [120, 138]],
  };
  CONE_RADII_NM.CP = CONE_RADII_NM.EP; // NHC publishes one Eastern/Central column

  function coneRadiusNm(hours, basin) {
    const t = CONE_RADII_NM[basin] || CONE_RADII_NM.AL;
    if (hours <= t[0][0]) return t[0][1];
    for (let i = 1; i < t.length; i++) {
      if (hours <= t[i][0]) {
        const [h0, r0] = t[i - 1], [h1, r1] = t[i];
        return r0 + (r1 - r0) * (hours - h0) / (h1 - h0);
      }
    }
    return t[t.length - 1][1];
  }

  // Move nm from pt along bearingDeg (planar, lat-scaled lon — same approx as project()).
  function offsetNm(pt, bearingDeg, nm) {
    const dLat = (nm * Math.cos((bearingDeg * Math.PI) / 180)) / 60;
    const dLon = (nm * Math.sin((bearingDeg * Math.PI) / 180)) /
      (60 * Math.cos((pt.lat * Math.PI) / 180));
    return { lat: pt.lat + dLat, lon: pt.lon + dLon };
  }

  // Quadrant wind radii -> polygon ring: four quarter-circle arcs (NE/SE/SW/NW,
  // bearings 0-90/90-180/180-270/270-360) each at its own radius, joined by
  // radial steps at the compass axes. Deliberately NOT smoothed — the advisory
  // states per-quadrant extents and interpolating between them invents data.
  function quadRing(center, q) {
    const ring = [];
    const radii = [q.ne, q.se, q.sw, q.nw];
    for (let quad = 0; quad < 4; quad++) {
      const r = radii[quad];
      // both endpoints of each arc are emitted, so the boundary bearing appears
      // twice (once per adjacent quadrant) and renders as a crisp radial step
      for (let d = 0; d <= 90; d += 6) ring.push(offsetNm(center, quad * 90 + d, r));
    }
    return ring;
  }

  // TCM -> nested wind-field polygons for the CURRENT position, ascending kt
  // (34 outermost) so callers can paint bottom-up. Null when the advisory
  // carries no radii (e.g. remnants). Data is official, unlike the cone.
  function windFieldFromTCM(t) {
    if (!t || !t.center || !t.windRadiiNm) return null;
    const out = Object.keys(t.windRadiiNm)
      .map(Number).sort((a, b) => a - b)
      .map((kt) => ({ kt: kt, ring: quadRing(t.center, t.windRadiiNm[kt]) }));
    return out.length ? out : null;
  }

  function headingDeg(a, b) {
    const dLat = b.lat - a.lat;
    const dLon = (b.lon - a.lon) * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
    return (Math.atan2(dLon, dLat) * 180 / Math.PI + 360) % 360;
  }

  // circular mean: averaging 357deg and 8deg must give ~2.5deg, not 182.5deg
  function meanHeading(a, b) {
    const ar = a * Math.PI / 180, br = b * Math.PI / 180;
    return (Math.atan2(Math.sin(ar) + Math.sin(br), Math.cos(ar) + Math.cos(br)) * 180 / Math.PI + 360) % 360;
  }

  // Track points (with .hours) -> cone polygon ring. The standard construction:
  // perpendicular left/right offsets at each point's radius, semicircular caps.
  // basin ('AL'|'EP'|'CP') selects the radii table; omitted -> Atlantic, so
  // every pre-basin caller is unchanged.
  function coneFromTrack(points, basin) {
    if (!points || points.length < 2) return null;
    const left = [], right = [];
    const hdgs = [];
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const hdg = i === 0 ? headingDeg(points[0], points[1])
        : i === points.length - 1 ? headingDeg(points[i - 1], points[i])
        : meanHeading(headingDeg(points[i - 1], p), headingDeg(p, points[i + 1]));
      const r = coneRadiusNm(p.hours || 0, basin);
      hdgs.push(hdg);
      left.push(offsetNm(p, hdg - 90, r));
      right.push(offsetNm(p, hdg + 90, r));
    }
    function arc(center, fromDeg, toDeg, r) {
      const out = [];
      for (let k = 1; k < 8; k++) out.push(offsetNm(center, fromDeg + (toDeg - fromDeg) * k / 8, r));
      return out;
    }
    const last = points[points.length - 1], first = points[0];
    const lastHdg = hdgs[hdgs.length - 1], firstHdg = hdgs[0];
    const ring = left
      .concat(arc(last, lastHdg - 90, lastHdg + 90, coneRadiusNm(last.hours || 0, basin)))
      .concat(right.slice().reverse())
      .concat(arc(first, firstHdg + 90, firstHdg + 270, coneRadiusNm(first.hours || 0, basin)));
    return ring;
  }

  // --- issuance time ---------------------------------------------------------
  // Turn an NHC product issuance line into a UTC Date. Two shapes occur:
  //   "805 AM EDT Mon Jul 7 2026"   (TWDAT/TWOAT: 12-hour clock + AM/PM)
  //   "0300 UTC MON SEP 11 2023"    (TCM: 24-hour, zero-padded)
  // The 3-4 digit clump is HMM/HHMM; the zone abbreviation carries the offset.
  // Returns null (never a guess) when the line doesn't match or names a zone we
  // don't know, so the caller can fall back to showing the raw header text.
  const TZ_UTC_OFFSET_MIN = {
    UTC: 0, GMT: 0, Z: 0,
    AST: 240, ADT: 180,   // Atlantic
    EST: 300, EDT: 240,   // Eastern
    CST: 360, CDT: 300,   // Central
    MST: 420, MDT: 360,   // Mountain
    PST: 480, PDT: 420,   // Pacific
    HST: 600,
  };
  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
                   jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

  function parseIssued(str) {
    const m = String(str || '').match(
      /(\d{3,4})\s*(AM|PM)?\s*([A-Z]{1,4})\s+[A-Za-z]{3,}\s+([A-Za-z]{3})[A-Za-z]*\s+(\d{1,2})\s+(\d{4})/i
    );
    if (!m) return null;
    const offMin = TZ_UTC_OFFSET_MIN[m[3].toUpperCase()];
    const mon = MONTHS[m[4].toLowerCase()];
    if (offMin == null || mon == null) return null; // unknown zone/month -> no guess

    const clump = m[1];
    let hh = parseInt(clump.slice(0, clump.length - 2), 10);
    const mm = parseInt(clump.slice(-2), 10);
    const ap = m[2] && m[2].toUpperCase();
    if (ap === 'PM' && hh < 12) hh += 12;
    if (ap === 'AM' && hh === 12) hh = 0;

    const day = parseInt(m[5], 10), year = parseInt(m[6], 10);
    // stated wall-clock time is local to the zone; add its offset to reach UTC
    return new Date(Date.UTC(year, mon, day, hh, mm) + offMin * 60000);
  }

  // --- orchestration ---------------------------------------------------------

  // Dead-reckon +24h from a point with stated motion; shared by waves and
  // cyclones. `waveId` is kept as an alias of `id` for older consumers.
  function addProjection(result, id, from, motion, parent) {
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
      source: parent.source,
      context: parent.context,
      srcSection: parent.srcSection,
    });
  }

  function parse(raw, opts) {
    const text = dehyphenate(String(raw || ''));
    const basin = (opts && opts.basin) || detectBasin(text);
    const secs = sections(text);
    const result = {
      issued: (text.match(/\b(\d{3,4})\s+(?:AM|PM|UTC)?\s*[A-Z]{3,4}\b.*\d{4}/) || [null])[0],
      basin,
      cyclones: [], waves: [], convection: [], troughs: [], fixes: [], inferred: [],
      projections: [], sections: secs.map((s) => s.name),
    };

    for (const s of secs) {
      const isWave = /WAVE/i.test(s.name);
      const isITCZ = /ITCZ|MONSOON|TROUGH/i.test(s.name);
      // SPECIAL FEATURES paragraphs become typed cyclones; suppress the generic
      // fix/gazetteer passes there so a named center doesn't double-register.
      // Some real TWDATs carry no SPECIAL FEATURES section at all and describe
      // active cyclones in the preamble instead (e.g. Franklin + Idalia,
      // TWDAT 29 Aug 2023), so the cyclone pass covers the preamble too.
      const isSpecial = /SPECIAL FEATURE/i.test(s.name);
      const isPreamble = s.name === 'PREAMBLE';
      let cycs = [];
      if (isSpecial || isPreamble) {
        cycs = extractCyclones(s.text, s.name);
        result.cyclones.push(...cycs);
      }
      if (isWave) result.waves.push(...extractWaves(s.text, s.name));
      result.convection.push(...extractConvection(s.text, s.name));
      if (isITCZ || /TROUGH/i.test(s.text)) result.troughs.push(...extractTroughs(s.text, s.name));
      // `!cycs.length` is what actually prevents a named center from
      // double-registering as a bare fix — so SPECIAL FEATURES with no cyclone
      // (a genesis paragraph: "a 1007 mb low has developed near 14.5N 106W, a
      // tropical depression is expected to form") still earns an honest fix at
      // the stated center, instead of rendering nothing at all.
      if (!cycs.length) result.fixes.push(...extractFixes(s.text, s.name));
      // The preamble is product boilerplate ("...to the African coast...");
      // running the gazetteer over it only manufactures phantom positions.
      if (!isPreamble && !isSpecial) result.inferred.push(...extractInferred(s.text, s.name, basin));
    }

    // Gazetteer dots must represent features with no coordinate representation;
    // drop the ones that duplicate parsed geometry.
    dedupeInferred(result);

    // Pass 3: dead-reckon +24h for every wave and cyclone that stated motion.
    for (const w of result.waves) {
      if (!w.axis.length) continue;
      addProjection(result, w.id, w.axis[0], w.motion, w);
    }
    for (const c of result.cyclones) {
      addProjection(result, c.name || c.id, { lat: c.lat, lon: c.lon }, c.motion, c);
    }

    return result;
  }

  root.BasinParser = { parse, parseTWO, parseTCM, parseIssued, coneFromTrack, windFieldFromTCM, detectBasin, CONE_SEASON, CONE_RADII_NM, pairsIn, sections, dehyphenate, parseMotion, project };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.BasinParser;
})(typeof window !== 'undefined' ? window : globalThis);
