/*
 * test.js — parser smoke test. Run: node test.js
 * No framework; exits non-zero if any assertion fails so it works in CI.
 */
const fs = require('fs');
const P = require('./parser.js');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name); }
}

const twd = fs.readFileSync(__dirname + '/sample.txt', 'utf8');
const r = P.parse(twd);

ok('4 sections detected', r.sections.length === 4);
ok('3 tropical waves', r.waves.length === 3);
ok('waves carry motion vectors', r.waves.every(w => w.motion));
ok('3 convection boxes', r.convection.length === 3);
ok('one convection box flagged strong', r.convection.filter(c => c.strong).length === 1);
ok('trough is a 3-point polyline', r.troughs.length === 1 && r.troughs[0].line.length === 3);
ok('3 explicit fixes', r.fixes.length === 3);
ok('inferred position tagged, not a fix', r.inferred.length === 1 && r.inferred[0].inferred === true);
ok('+24h projections for every wave', r.projections.length === 3);
ok('speed-range wave yields an uncertainty band', r.projections.some(p => p.band));

// teletype line-wrap rejoin keeps hyphenated compounds intact
ok('hyphen rejoin preserves "upper-level"',
  /upper-level low/.test(P.dehyphenate('A weak upper-\nlevel low')));

// coordinate parsing: W and S are negative
const pr = P.pairsIn('08N27W to 09S57E');
ok('W longitude parsed negative', pr[0].lon === -27);
ok('S latitude parsed negative', pr[1].lat === -9);
ok('E longitude parsed positive', pr[1].lon === 57);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
