/*
 * tools/parser-audit.js — run parser.js over real archived NHC products.
 *
 * Usage:  node tools/parser-audit.js
 *
 * Dev-only and NETWORK-DEPENDENT: fetches the most recent TWD/TWO/TCM products
 * from api.weather.gov, filters to the Atlantic office by WMO collective id
 * (AXNT for discussions, ABNT for outlooks; TCM is filtered by AL storm id),
 * runs the parser, and flags products that look like likely misses. It saves the
 * fetched corpus and a JSON report under a temp dir and prints where.
 *
 * The flags are a TRIAGE AID, not a pass/fail gate — they surface products worth
 * eyeballing, and a flag is not proof of a parser bug. This is NOT part of
 * `node test.js` (which must stay offline and deterministic); run it by hand.
 *
 * Zero dependencies; never runs in the browser.
 */
'use strict';
const P = require('../parser.js');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Saved corpus + report go under an OS temp dir so nothing machine-specific is
// hardcoded; override with AUDIT_OUT if you want them somewhere else.
const OUT = process.env.AUDIT_OUT || path.join(os.tmpdir(), 'hurricane-console-audit');
fs.mkdirSync(OUT, { recursive: true });

const UA = { headers: { Accept: 'application/ld+json', 'User-Agent': 'hurricane-console-parser-audit (opt08400@gmail.com)' } };

// api.weather.gov product types are the 3-letter AWIPS categories, which mix
// basins/offices — filter by WMO collective id to keep the Atlantic ones.
async function list(type, wmoPrefix, cap) {
  const j = await (await fetch(`https://api.weather.gov/products/types/${type}`, UA)).json();
  let items = j['@graph'] || [];
  if (wmoPrefix) items = items.filter((it) => (it.wmoCollectiveId || '').startsWith(wmoPrefix));
  return items.slice(0, cap);
}
async function text(item) {
  const p = await (await fetch(item['@id'] || item.id, UA)).json();
  return p.productText || '';
}
async function mapLimit(arr, n, fn) {
  const out = []; let i = 0;
  async function w() { while (i < arr.length) { const k = i++; out[k] = await fn(arr[k], k); } }
  await Promise.all(Array.from({ length: n }, w));
  return out;
}

// Atlantic TWDAT basin sanity box (Equator-ish to well N, Africa to the Americas).
const SANE = (p) => p.lat >= -8 && p.lat <= 45 && p.lon >= -105 && p.lon <= 5;
function coordsOf(r) {
  const cs = [];
  (r.fixes || []).forEach((f) => cs.push({ ...f, k: 'fix' }));
  (r.inferred || []).forEach((f) => cs.push({ ...f, k: 'inferred' }));
  (r.cyclones || []).forEach((c) => cs.push({ lat: c.lat, lon: c.lon, k: 'cyclone' }));
  (r.waves || []).forEach((w) => (w.axis || []).forEach((p) => cs.push({ ...p, k: 'wave' })));
  (r.troughs || []).forEach((t) => (t.line || []).forEach((p) => cs.push({ ...p, k: 'trough' })));
  return cs;
}

function auditTWD(txt) {
  const r = P.parse(txt);
  const flags = [];
  if (/tropical wave/i.test(txt) && r.waves.length === 0) flags.push('waves-in-text/none-parsed');
  // Scope the storm-keyword check to the SPECIAL FEATURES sections themselves:
  // every product mentions "Hurricane" in the NHC office header, and quiet-day
  // sections holding only a Gale Warning correctly yield zero cyclones. Require
  // a classification followed by a name-like word (not "Center"/"Warning").
  const sfStorm = P.sections(txt)
    .filter((s) => /SPECIAL FEATURE/i.test(s.name))
    .some((s) => /\b(hurricane|tropical storm|tropical depression|subtropical (?:storm|depression)|potential tropical cyclone)\s+(?!center\b|warning\b)[a-z-]+/i.test(s.text));
  if (sfStorm && (r.cyclones || []).length === 0) flags.push('special-features/no-cyclone');
  if (r.sections.length <= 1) flags.push('sections-not-split');
  const bad = coordsOf(r).filter((p) => !SANE(p) && isFinite(p.lat) && isFinite(p.lon));
  if (bad.length) flags.push('coords-out-of-basin:' + bad.slice(0, 3).map((p) => p.k + '(' + p.lat + ',' + p.lon + ')').join(','));
  if (coordsOf(r).some((p) => !isFinite(p.lat) || !isFinite(p.lon) || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180)) flags.push('coords-NaN/impossible');
  const n = (r.cyclones || []).length + r.waves.length + r.troughs.length + r.convection.length + r.fixes.length + r.inferred.length;
  return { flags, stats: { sec: r.sections.length, wav: r.waves.length, cyc: (r.cyclones || []).length, tro: r.troughs.length, con: r.convection.length, fix: r.fixes.length, inf: r.inferred.length, proj: r.projections.length, total: n } };
}
function auditTWO(txt) {
  const r = P.parseTWO(txt);
  const flags = [];
  const starCount = (txt.match(/\*\s*formation chance/gi) || []).length;
  const disturbBlocks = Math.round(starCount / 2); // two star-lines per disturbance
  if (disturbBlocks > 0 && r.disturbances.length === 0) flags.push('chances-in-text/none-parsed');
  const unmapped = r.disturbances.filter((d) => d.lat == null).length;
  if (unmapped) flags.push('unmapped-disturbances:' + unmapped);
  const missingChance = r.disturbances.filter((d) => !d.chance48 && !d.chance7).length;
  if (missingChance) flags.push('disturbance-no-chances:' + missingChance);
  return { flags, stats: { dist: r.disturbances.length, starPairs: disturbBlocks, unmapped } };
}
function auditTCM(txt) {
  const r = P.parseTCM(txt);
  const flags = [];
  if (!r) { flags.push('parse-null'); return { flags, stats: {}, stormId: null }; }
  if (r.stormId && r.stormId.slice(0, 2) !== 'AL') return { skip: true, stormId: r.stormId };
  if (!r.track.length) flags.push('no-track-points');
  if (r.center && !SANE(r.center)) flags.push('center-out-of-basin(' + r.center.lat + ',' + r.center.lon + ')');
  if (r.windKt == null) flags.push('no-wind');
  return { flags, stats: { adv: r.advisory, track: r.track.length, wind: r.windKt, name: r.name }, stormId: r.stormId };
}

(async () => {
  const report = { TWD: [], TWO: [], TCM: [] };
  const save = (tag, i, txt) => fs.writeFileSync(path.join(OUT, `${tag}-${String(i).padStart(2, '0')}.txt`), txt);

  const twd = await list('TWD', 'AXNT', 60);
  const twdTexts = await mapLimit(twd, 6, text);
  twdTexts.forEach((t, i) => { if (!t) return; save('TWD', i, t); const a = auditTWD(t); report.TWD.push({ i, id: twd[i].id, when: twd[i].issuanceTime, ...a }); });

  const two = await list('TWO', 'ABNT', 40);
  const twoTexts = await mapLimit(two, 6, text);
  twoTexts.forEach((t, i) => { if (!t) return; save('TWO', i, t); const a = auditTWO(t); report.TWO.push({ i, id: two[i].id, when: two[i].issuanceTime, ...a }); });

  const tcm = await list('TCM', null, 60);
  const tcmTexts = await mapLimit(tcm, 6, text);
  tcmTexts.forEach((t, i) => { if (!t) return; const a = auditTCM(t); if (a.skip) return; save('TCM', i, t); report.TCM.push({ i, id: tcm[i].id, when: tcm[i].issuanceTime, ...a }); });

  for (const type of ['TWD', 'TWO', 'TCM']) {
    const rows = report[type];
    const flagged = rows.filter((r) => r.flags && r.flags.length);
    console.log(`\n===== ${type}: ${rows.length} products, ${flagged.length} flagged =====`);
    flagged.forEach((r) => console.log(`  [${type}-${String(r.i).padStart(2, '0')}] ${r.when}  ${r.flags.join(' | ')}`));
    if (type === 'TWD') {
      const sum = rows.reduce((a, r) => { for (const k in r.stats) a[k] = (a[k] || 0) + r.stats[k]; return a; }, {});
      console.log('  totals:', JSON.stringify(sum));
    }
  }
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  console.log('\nFlags are a triage aid, not a pass/fail gate.');
  console.log('corpus + report saved to', OUT);
})();
