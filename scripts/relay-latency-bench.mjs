// One-shot benchmark: connect + subscribe + first-EOSE latency for the app's
// default READ relays. Ground truth for the feed-latency fix (round 27c).
// Usage: node scripts/relay-latency-bench.mjs
const RELAYS = [
  'wss://relay.ditto.pub/',
  'wss://relay.dreamith.to/',
  'wss://nos.lol/',
  'wss://offchain.pub/',
  'wss://relay.snort.social/',
  'wss://bitcoiner.social/',
  'wss://nostr.bitcoiner.social/',
  'wss://nostr.jcloud.es/',
  'wss://purplepag.es/',
  'wss://relay.mostr.pub/',
  'wss://nostr-relay.psfoundation.info/',
].map((u) => (u.endsWith('/') ? u : `${u}/`));

const FILTER = { kinds: [1], limit: 5 };
const SUB = 'bench';

let WS;
try {
  WS = (await import('ws')).default;
} catch {
  WS = globalThis.WebSocket;
}

function bench(relayUrl) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let ws;
    try {
      ws = new WS(relayUrl);
    } catch (e) {
      resolve({ relay: relayUrl, error: `ctor: ${e.message}` });
      return;
    }
    const done = (result) => {
      try { ws.close(); } catch { /* already closed */ }
      resolve(result);
    };
    const timer = setTimeout(() => done({ relay: relayUrl, error: 'timeout>8s' }), 8000);
    ws.on('open', () => {
      const tOpen = Date.now();
      ws.send(JSON.stringify(['REQ', SUB, FILTER]));
      ws.on('message', (data) => {
        let msg;
        try { msg = JSON.parse(data.toString()); } catch { return; }
        if (msg[0] === 'EOSE' && msg[1] === SUB) {
          clearTimeout(timer);
          done({ relay: relayUrl, connectMs: tOpen - t0, firstEoseMs: Date.now() - t0, events: 0 });
        } else if (msg[0] === 'EVENT' && msg[1] === SUB) {
          // count events lazily
        } else if (msg[0] === 'CLOSED' || msg[0] === 'NOTICE') {
          clearTimeout(timer);
          done({ relay: relayUrl, error: `closed: ${String(msg[1]).slice(0, 60)}` });
        }
      });
    });
    ws.on('error', (e) => {
      clearTimeout(timer);
      done({ relay: relayUrl, error: `ws error: ${String(e.message || e).slice(0, 60)}` });
    });
  });
}

const results = await Promise.all(RELAYS.map(bench));
const ok = results.filter((r) => r.firstEoseMs !== undefined).sort((a, b) => a.firstEoseMs - b.firstEoseMs);
const fail = results.filter((r) => r.firstEoseMs === undefined);

console.log('=== FIRST-EOSE LATENCY (feed query resolves at slowest×grace) ===');
for (const r of ok) console.log(`${String(r.firstEoseMs).padStart(5)}ms  (open ${String(r.connectMs).padStart(5)}ms)  ${r.relay}`);
for (const r of fail) console.log(`FAIL   ${r.relay} — ${r.error}`);
if (ok.length > 0) {
  const times = ok.map((r) => r.firstEoseMs);
  const max = Math.max(...times);
  const min = Math.min(...times);
  console.log(`\nmin=${min}ms max=${max}ms spread=${max - min}ms · ok=${ok.length}/${RELAYS.length}`);
  console.log(`NPool.query resolves at ~max + eoseTimeout(1000ms default) ≈ ${max + 1000}ms worst case`);
}
