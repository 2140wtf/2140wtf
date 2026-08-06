import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({ port: 7777 });
const events = new Map();
const subscriptions = new Map();

console.log('Local Nostr relay running on ws://localhost:7777');

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (!Array.isArray(msg)) return;
      const [type, ...rest] = msg;

      switch (type) {
        case 'REQ': {
          const [subId, filter] = rest;
          if (!subscriptions.has(ws)) subscriptions.set(ws, new Map());
          subscriptions.get(ws).set(subId, filter);
          for (const [id, event] of events) {
            if (matchesFilter(event, filter)) {
              ws.send(JSON.stringify(['EVENT', subId, event]));
            }
          }
          ws.send(JSON.stringify(['EOSE', subId]));
          break;
        }
        case 'EVENT': {
          const [event] = rest;
          if (!event || !event.id || !event.pubkey || !event.created_at) {
            ws.send(JSON.stringify(['NOTICE', 'invalid event']));
            return;
          }
          events.set(event.id, event);
          for (const [clientWs, subs] of subscriptions) {
            if (clientWs.readyState !== 1) continue;
            for (const [subId, filter] of subs) {
              if (matchesFilter(event, filter)) {
                clientWs.send(JSON.stringify(['EVENT', subId, event]));
              }
            }
          }
          ws.send(JSON.stringify(['OK', event.id, true, '']));
          break;
        }
        case 'CLOSE': {
          const [subId] = rest;
          if (subscriptions.has(ws)) subscriptions.get(ws).delete(subId);
          break;
        }
        case 'AUTH': {
          const [challenge] = rest;
          ws.send(JSON.stringify(['AUTH', challenge]));
          break;
        }
        default:
          break;
      }
    } catch (e) {
      // ignore
    }
  });

  ws.on('close', () => {
    subscriptions.delete(ws);
  });
});

function matchesFilter(event, filter) {
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
  if (filter.authors && !filter.authors.includes(event.pubkey)) return false;
  if (filter.ids && !filter.ids.includes(event.id)) return false;
  if (filter['#d']) {
    const dTags = event.tags.filter(t => t[0] === 'd').map(t => t[1]);
    if (!filter['#d'].some(d => dTags.includes(d))) return false;
  }
  if (filter['#p']) {
    const pTags = event.tags.filter(t => t[0] === 'p').map(t => t[1]);
    if (!filter['#p'].some(p => pTags.includes(p))) return false;
  }
  return true;
}

setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);
