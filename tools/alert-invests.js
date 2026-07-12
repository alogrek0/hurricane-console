/*
 * tools/alert-invests.js — Atlantic invest / formation-chance alerter.
 *
 * Runs from .github/workflows/alerts.yml on a twice-hourly cron: fetches the
 * latest Atlantic Tropical Weather Outlook (TWOAT), parses it with the app's
 * own parser.js, diffs against the previous run's state, and pushes alerts to
 * an ntfy.sh topic. Alert conditions:
 *   1. a new invest designation appears (AL90-AL99 tag in a disturbance title)
 *   2. a NEW disturbance area shows up in the outlook
 *   3. a disturbance's 7-day formation chance crosses 40% or 60% upward
 *
 * Usage:  node tools/alert-invests.js [--test]
 *   NTFY_TOPIC   ntfy.sh topic to POST to; unset = dry-run (print, don't send)
 *   ALERT_STATE  path of the state JSON (default: alert-state.json in cwd)
 *   --test       send one synthetic alert (confirms the phone subscription)
 *
 * State losses are safe: an unknown/corrupt state file re-primes silently
 * (record current state, alert nothing) — never spam on a cold start. The
 * same product id seen twice never re-alerts.
 *
 * The pure pieces (stateFromTWO, diffAlerts, formatAlert) are exported for
 * test.js, which must stay offline; only the runner below touches the network.
 * Zero dependencies; never runs in the browser. The PWA itself stays static —
 * this is a repo sidecar.
 */
'use strict';
const P = require('../parser.js');
const fs = require('fs');

const THRESHOLDS = [40, 60];

// parsed TWO + product id -> compact state for diffing between runs.
// key: invest tag if present, else the gazetteer position on a 5-degree grid,
// else the head of the prose — stable enough to match areas across issuances.
function stateFromTWO(parsed, productId) {
  return {
    productId: productId || null,
    disturbances: (parsed.disturbances || []).map((d) => ({
      key: d.invest ? d.invest
        : d.lat != null ? 'G' + (Math.round(d.lat / 5) * 5) + ',' + (Math.round(d.lon / 5) * 5)
          : 'S' + String(d.source || '').slice(0, 40),
      invest: d.invest || null,
      pct7: d.chance7 ? d.chance7.pct : null,
      where: (String(d.source || '').match(/^\s*\d+\.\s*(.+?)[:(]/) || [])[1] || null,
    })),
  };
}

function diffAlerts(prev, cur) {
  if (!prev || !prev.productId) return [];            // cold start: prime silently
  if (prev.productId === cur.productId) return [];    // same issuance re-fetched
  const alerts = [];
  const prevByKey = {};
  const prevInvests = {};
  for (const d of prev.disturbances) {
    prevByKey[d.key] = d;
    if (d.invest) prevInvests[d.invest] = d;
  }
  for (const d of cur.disturbances) {
    // (1) fresh invest designation — the headline event
    if (d.invest && /^AL9\d$/.test(d.invest) && !prevInvests[d.invest]) {
      alerts.push({ type: 'new-invest', d });
      continue; // don't also fire new-area/threshold for the same event
    }
    const was = prevByKey[d.key];
    if (!was) {
      // (2) new area being watched (pre-invest heads-up)
      alerts.push({ type: 'new-area', d });
      continue;
    }
    // (3) 7-day chance crossing a threshold upward
    if (d.pct7 != null && was.pct7 != null) {
      for (const t of THRESHOLDS) {
        if (was.pct7 < t && d.pct7 >= t) { alerts.push({ type: 'threshold', d, t, from: was.pct7 }); break; }
      }
    }
  }
  return alerts;
}

function formatAlert(a) {
  const where = a.d.where ? a.d.where.trim() : 'Atlantic';
  const pct = a.d.pct7 != null ? a.d.pct7 + '%' : 'n/a';
  if (a.type === 'new-invest') return {
    title: 'Invest ' + a.d.invest + ' designated',
    body: where + ' — 7-day formation chance ' + pct + '.',
    tags: 'cyclone', priority: '4',
  };
  if (a.type === 'new-area') return {
    title: 'New Atlantic disturbance',
    body: where + ' — 7-day formation chance ' + pct + '.',
    tags: 'eyes', priority: '3',
  };
  return {
    title: '7-day chance now ' + pct + ' (' + where + ')',
    body: 'Crossed ' + a.t + '% (was ' + a.from + '%).' + (a.d.invest ? ' ' + a.d.invest + '.' : ''),
    tags: 'chart_with_upwards_trend', priority: '4',
  };
}

// --- network + state runner (not exercised by test.js) --------------------------
const UA = { headers: { 'User-Agent': 'hurricane-console-alerts (opt08400@gmail.com)' } };
const LIST = 'https://api.weather.gov/products/types/TWO';

async function latestTWOAT() {
  const res = await fetch(LIST, { headers: { ...UA.headers, Accept: 'application/ld+json' } });
  if (!res.ok) throw new Error('list HTTP ' + res.status);
  const items = ((await res.json())['@graph'] || []).slice(0, 8);
  for (const it of items) {
    const r = await fetch(it['@id'], UA);
    if (!r.ok) continue;
    const j = await r.json();
    const txt = j.productText || '';
    if (/^TWOAT\b/m.test(txt)) return { id: j.id || it.id, text: txt };
  }
  throw new Error('no TWOAT among the newest ' + items.length + ' TWO products');
}

async function send(topic, msg) {
  const res = await fetch('https://ntfy.sh/' + topic, {
    method: 'POST', body: msg.body,
    headers: { ...UA.headers, Title: msg.title, Tags: msg.tags, Priority: msg.priority },
  });
  if (!res.ok) throw new Error('ntfy HTTP ' + res.status);
}

async function main() {
  const topic = process.env.NTFY_TOPIC || '';
  const statePath = process.env.ALERT_STATE || 'alert-state.json';

  if (process.argv.includes('--test')) {
    const msg = { title: 'Hurricane Console test ping', body: 'Alerts are wired up. This is the only test message.', tags: 'white_check_mark', priority: '3' };
    if (topic) { await send(topic, msg); console.log('test ping sent'); }
    else console.log('dry-run (no NTFY_TOPIC): would send', msg);
    return;
  }

  const prod = await latestTWOAT();
  const cur = stateFromTWO(P.parseTWO(prod.text), prod.id);

  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch (e) { /* first run */ }

  const alerts = diffAlerts(prev, cur);
  console.log('product', cur.productId, '·', cur.disturbances.length, 'disturbance(s) ·', alerts.length, 'alert(s)');
  for (const a of alerts) {
    const msg = formatAlert(a);
    console.log(' ', msg.title, '—', msg.body);
    if (topic) await send(topic, msg);
  }
  if (!topic && alerts.length) console.log('dry-run (no NTFY_TOPIC): nothing sent');

  fs.writeFileSync(statePath, JSON.stringify(cur, null, 1));
}

module.exports = { stateFromTWO, diffAlerts, formatAlert, THRESHOLDS };
if (require.main === module) {
  main().catch((e) => { console.error(e.message || e); process.exit(1); });
}
