/*
 * tools/derive-summary.js — the derived-record shape for the season archive
 * (archive/derived/{year}-{basin}.json).
 *
 * Mirrors the tools/corpus-summary.js discipline: required by BOTH the WRITER
 * (tools/archive-sync.js --derive) and the CHECKER (node test.js), so the two
 * can't drift. Each record is built with a stable literal key order, so a
 * JSON.stringify comparison is a valid deep-equal — keep the key order stable
 * if you add fields, and re-derive.
 *
 * Pure functions: no fs, no network. The lone require is parser.js's
 * parseIssued (pure logic) to resolve the product's issued line to an ISO
 * stamp — null when unparseable, never guessed.
 *
 * Field policy (from the M1 plan): raw .txt is ground truth and committed, so
 * this projection can grow in M2 without refetching. TWD keeps the lineage-
 * relevant geometry (cyclones, wave axes) verbatim and reduces convection/
 * troughs/fixes to counts (diff.js treats them as lineage noise); TWO keeps
 * each disturbance's invest tag, position (null stays null — a formation area
 * is often unmappable), and both formation-chance objects.
 */
'use strict';
const P = require('../parser.js');

// A parse()/parseTWO() result's raw issued line -> ISO string, or null.
function issuedISO(result) {
  const d = P.parseIssued(result && result.issued);
  return d ? d.toISOString() : null;
}

// parse() (TWD) result + record meta {file, kind, stamp} -> derived record.
function summarizeTWD(r, meta) {
  return {
    file: meta.file,
    kind: meta.kind,
    stamp: meta.stamp,
    issuedISO: issuedISO(r),
    cyclones: r.cyclones.map(function (c) {
      return { name: c.name, classification: c.classification, lat: c.lat, lon: c.lon, windKt: c.windKt };
    }),
    // full axis geometry as parsed + the inferred flag + motion when stated
    // (null when the prose gave none) — the fields M2 chains waves across issuances.
    waves: r.waves.map(function (w) {
      return {
        id: w.id,
        axis: w.axis.map(function (p) { return { lat: p.lat, lon: p.lon }; }),
        inferred: w.inferred,
        motion: w.motion || null,
      };
    }),
    convection: r.convection.length,
    troughs: r.troughs.length,
    fixes: r.fixes.length,
    inferred: r.inferred.length,
    projections: r.projections.length,
  };
}

// parseTWO() result + record meta {file, kind, stamp} -> derived record.
function summarizeTWO(r, meta) {
  return {
    file: meta.file,
    kind: meta.kind,
    stamp: meta.stamp,
    issuedISO: issuedISO(r),
    disturbances: r.disturbances.map(function (d) {
      return { invest: d.invest || null, lat: d.lat, lon: d.lon, chance48: d.chance48, chance7: d.chance7 };
    }),
  };
}

module.exports = { summarizeTWD, summarizeTWO };
