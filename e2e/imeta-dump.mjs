// Dump imeta tags from the Timechain Art Magazine's recent kind-1 notes so we
// can see how broken images (#1 #6 #13) differ from working ones.
const NPUB = 'npub1zrclffvv67nlda0ds8kw755lzm8yy9eavxta54qn4g8wegxzzv3q8amvxc';

import('nostr-tools').then(({ nip19 }) => {
  const d = nip19.decode(NPUB);
  const pubkey = d.data.pubkey ?? d.data;
  main(pubkey);
});

function main(pubkey) {
console.log('pubkey:', pubkey);

const relays = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://nostr.wine', 'wss://relay.nostr.band'];
const ws = new WebSocket(relays[0]);
const events = new Map();
ws.onopen = () => {
  ws.send(JSON.stringify(['REQ', 'art', { kinds: [1], authors: [pubkey], limit: 60 }]));
};
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg[0] === 'EVENT') {
    const ev = msg[2];
    if (!events.has(ev.id)) events.set(ev.id, ev);
  }
  if (msg[0] === 'EOSE') {
    ws.close();
    report();
  }
};
ws.onerror = (e) => { console.error('WS error', e.message ?? e); process.exit(1); };
setTimeout(() => { ws.close(); report(); }, 15000);

function report() {
  const evs = [...events.values()].sort((a, b) => b.created_at - a.created_at);
  console.log(`got ${evs.length} events\n`);
  let i = 0;
  for (const ev of evs) {
    for (const tag of ev.tags) {
      if (tag[0] !== 'imeta') continue;
      i++;
      const fields = {};
      for (let k = 1; k < tag.length; k++) {
        const sp = tag[k].indexOf(' ');
        if (sp > 0) fields[tag[k].slice(0, sp)] = tag[k].slice(sp + 1);
      }
      const url = fields.url ?? '';
      const hash = url.split('/').pop() ?? '';
      const marker = /^[a-f0-9]{64}$/.test(hash) ? 'FULL ' : `TRUNC(${hash.length})`;
      console.log(`#${i} ${marker} dim=${fields.dim ?? '-'} m=${fields.m ?? '-'}`);
      console.log(`    url: ${url}`);
      const extra = Object.keys(fields).filter((k) => !['url', 'dim', 'm', 'blurhash', 'name', 'image'].includes(k));
      if (extra.length) console.log(`    extra fields: ${extra.map((k) => `${k}=${fields[k].slice(0, 80)}`).join(' ')}`);
    }
  }
  process.exit(0);
}
}
