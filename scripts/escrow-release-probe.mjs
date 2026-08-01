// E2E probe: live escrow.bao.network /release contract against the BAO signet mint.
// Scratch — NOT committed. Run: node escrow-release-probe.mjs
import { CashuMint, CashuWallet, getEncodedToken, getDecodedToken } from '@cashu/cashu-ts';
import { generateSecretKey, getPublicKey, finalizeEvent, nip44, nip19 } from 'nostr-tools';

const MINT_URL = 'https://relay.bao.network/cashu';
const FAUCET_URL = 'https://relay.bao.network/faucet/';
const OPERATOR_URL = 'https://escrow.bao.network';
const STAKE = 21; // sats per depositor
const CLAIM_PAD = 16; // faucet claims cover the stake + mint input fees
const REFUND_PERIOD_S = 24 * 60 * 60;

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const randomHex = (n) => hex(globalThis.crypto.getRandomValues(new Uint8Array(n)));
const nowS = () => Math.floor(Date.now() / 1000);

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  PASS ${name}`);
  else { failures++; console.error(`  FAIL ${name} ${detail}`); }
}

function makeAttestation(nostrPriv, escrowPriv, battleId, winner, operatorPub) {
  const nostrPub = getPublicKey(nostrPriv);
  const binding = finalizeEvent({
    kind: 21125,
    created_at: nowS(),
    tags: [['e', battleId], ['t', 'battle-attestation']],
    content: JSON.stringify({ battleId, winner, nostrPubkey: nostrPub }),
  }, escrowPriv);
  const payload = { type: 'battle-result-attestation', battleId, winner, escrowBinding: binding };
  const convKey = nip44.v2.utils.getConversationKey(nostrPriv, operatorPub);
  return finalizeEvent({
    kind: 11124,
    created_at: nowS(),
    tags: [['e', battleId], ['t', 'battle-attestation']],
    content: nip44.v2.encrypt(JSON.stringify(payload), convKey),
  }, nostrPriv);
}

async function postRelease(body) {
  const res = await fetch(`${OPERATOR_URL}/release`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON error page */ }
  return { status: res.status, json, text: text.slice(0, 300) };
}

async function faucetProofsFor(wallet, privkey, amount) {
  const npub = nip19.npubEncode(getPublicKey(privkey));
  const res = await fetch(FAUCET_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ npub, amount }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.token) {
    throw new Error(`faucet ${res.status}: ${JSON.stringify(json).slice(0, 200)}`);
  }
  return wallet.receive(json.token);
}

// ── 0. Health ────────────────────────────────────────────────────────────────
console.log('0. GET /health');
const health = await (await fetch(`${OPERATOR_URL}/health`)).json();
const OP_PUB = health.escrowPubkey;
check('health ok', health.status === 'ok' && /^[0-9a-f]{64}$/.test(OP_PUB ?? ''));
console.log(`   operator pubkey ${OP_PUB}`);

// ── Keypairs (nostr key != escrow key, like the real clients) ───────────────
const hostNostr = generateSecretKey(), hostEscrow = generateSecretKey();
const guestNostr = generateSecretKey(), guestEscrow = generateSecretKey();
const hostEscrowPub = getPublicKey(hostEscrow);
const guestEscrowPub = getPublicKey(guestEscrow);

// ── 1. Negative probe: attestations disagree → operator must refuse ─────────
console.log('1. Negative: disagreeing attestations must be rejected');
{
  const battleId = randomHex(32);
  const body = {
    battleId,
    winnerPubkey: hostEscrowPub,
    hostEscrowPubkey: hostEscrowPub,
    guestEscrowPubkey: guestEscrowPub,
    hostDepositToken: 'cashuA-garbage',
    guestDepositToken: 'cashuA-garbage',
    hostAttestation: makeAttestation(hostNostr, hostEscrow, battleId, 0, OP_PUB),
    guestAttestation: makeAttestation(guestNostr, guestEscrow, battleId, 1, OP_PUB), // lies
  };
  const r = await postRelease(body);
  check('disagreement rejected 400', r.status === 400, `got ${r.status}: ${r.text}`);
  check('reason names disagreement', /disagree/i.test(r.text), r.text);
}

// ── 2. Happy path: real deposits, mutual attestation, co-sign, winner sweep ──
console.log('2. Happy path: mint → 2-of-3 deposits → attest → /release → winner sweeps');
{
  const battleId = randomHex(32);
  const locktime = nowS() + REFUND_PERIOD_S;
  const mint = new CashuMint(MINT_URL);
  const hostWallet = new CashuWallet(mint);
  const guestWallet = new CashuWallet(mint);
  await hostWallet.loadMint();
  await guestWallet.loadMint();

  const lockOpts = (depositorPub) => ({
    pubkey: [hostEscrowPub, guestEscrowPub, OP_PUB].sort().map((k) => '02' + k),
    requiredSignatures: 2,
    locktime,
    refundKeys: ['02' + depositorPub],
  });

  console.log('   claiming host stake from faucet…');
  const hostIn = await faucetProofsFor(hostWallet, hostNostr, STAKE + CLAIM_PAD);
  console.log('   locking host deposit 2-of-3…');
  const hostSwap = await hostWallet.swap(STAKE, hostIn, { proofsWeHave: hostIn, p2pk: lockOpts(hostEscrowPub) });
  const hostDepositToken = getEncodedToken({ mint: MINT_URL, proofs: hostSwap.send, unit: 'sat' });

  console.log('   claiming guest stake from faucet…');
  const guestIn = await faucetProofsFor(guestWallet, guestNostr, STAKE + CLAIM_PAD);
  console.log('   locking guest deposit 2-of-3…');
  const guestSwap = await guestWallet.swap(STAKE, guestIn, { proofsWeHave: guestIn, p2pk: lockOpts(guestEscrowPub) });
  const guestDepositToken = getEncodedToken({ mint: MINT_URL, proofs: guestSwap.send, unit: 'sat' });

  console.log('   both players attest: host wins');
  const body = {
    battleId,
    winnerPubkey: hostEscrowPub,
    hostEscrowPubkey: hostEscrowPub,
    guestEscrowPubkey: guestEscrowPub,
    hostDepositToken,
    guestDepositToken,
    hostAttestation: makeAttestation(hostNostr, hostEscrow, battleId, 0, OP_PUB),
    guestAttestation: makeAttestation(guestNostr, guestEscrow, battleId, 0, OP_PUB),
  };
  const r = await postRelease(body);
  check('release accepted 200', r.status === 200, `got ${r.status}: ${r.text}`);
  const releasedToken = r.json?.token;
  check('response carries a token', typeof releasedToken === 'string' && releasedToken.length > 0);

  if (releasedToken) {
    const decoded = getDecodedToken(releasedToken);
    const proofs = decoded.proofs ?? [];
    const total = proofs.reduce((s, p) => s + p.amount, 0);
    check(`pot is ${2 * STAKE} sats`, total === 2 * STAKE, `got ${total}`);
    const witnessed = proofs.every((p) => {
      try { return (JSON.parse(p.witness).signatures ?? []).length >= 1; } catch { return false; }
    });
    check('every proof carries the operator witness signature', witnessed);

    console.log('   winner (host) receives with own escrow key — second signature…');
    const fees = hostWallet.getFeesForProofs(proofs);
    const received = await hostWallet.receive(releasedToken, { privkey: hex(hostEscrow) });
    const swept = received.reduce((s, p) => s + p.amount, 0);
    check(`winner swept the pot (${2 * STAKE} sats minus ${fees} mint fee)`, swept === 2 * STAKE - fees, `got ${swept}`);
    check('mint fee is sane (≤2 sats)', fees >= 0 && fees <= 2, `fees=${fees}`);
  }
}

console.log(failures === 0 ? '\nPROBE PASSED — live /release contract verified end to end.' : `\nPROBE FAILED: ${failures} check(s).`);
process.exit(failures === 0 ? 0 : 1);
