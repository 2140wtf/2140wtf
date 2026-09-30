import { expect, it } from 'vitest';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex } from '@noble/curves/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { generateSecretKey } from 'nostr-tools/pure';
import {
  buildSigAllMessage,
  parseEscrowSwapForCompletion,
  signEscrowSwapForParty,
  signSigAllDigest,
  verifySigAllSignature,
  witnessSignatures,
  type EscrowSwapExpectation,
  type EscrowSwapInputWire,
  type EscrowSwapOutputWire,
} from './escrowSwapComplete';

const PROJECT = generateSecretKey();
const DONOR = generateSecretKey();
const ORACLE = generateSecretKey();
const STRANGER = generateSecretKey();

const PROJECT_X = bytesToHex(schnorr.getPublicKey(PROJECT));
const DONOR_X = bytesToHex(schnorr.getPublicKey(DONOR));
const ORACLE_X = bytesToHex(schnorr.getPublicKey(ORACLE));
const STRANGER_X = bytesToHex(schnorr.getPublicKey(STRANGER));

const comp = (x: string): string => '02' + x;
const KEYSET = '00deadbeef00';

/** A 2-of-3 SIG_ALL escrow lock secret in the API's exact shape. */
function escrowSecret(opts: { donor: string; oracle: string; sigFlag?: string; nSigs?: number } = { donor: DONOR_X, oracle: ORACLE_X }): string {
  return JSON.stringify(['P2PK', {
    nonce: '00',
    data: comp(PROJECT_X),
    tags: [
      ['pubkeys', ...[comp(opts.oracle), comp(opts.donor)].sort()],
      ['n_sigs', String(opts.nSigs ?? 2)],
      ['locktime', '1800000000'],
      ['refund', comp(opts.donor)],
      ...(opts.sigFlag === 'none' ? [] : [['sigflag', opts.sigFlag ?? 'SIG_ALL']]),
    ],
  }]);
}

/** A 1-of-1 P2PK payout output. */
function payoutOutput(amount: number, pubkey: string, bHex = 'ab'): EscrowSwapOutputWire {
  const secret = JSON.stringify(['P2PK', { nonce: '00', data: comp(pubkey) }]);
  return {
    blindedMessage: { amount, B_: '02' + bHex.repeat(64), id: KEYSET },
    blindingFactor: '11'.repeat(32),
    secret: bytesToHex(new TextEncoder().encode(secret)),
  };
}

function escrowInput(amount: number, opts?: { sigFlag?: string; nSigs?: number; donor?: string; oracle?: string; c?: string }): EscrowSwapInputWire {
  return {
    id: KEYSET,
    amount,
    secret: escrowSecret({ donor: opts?.donor ?? DONOR_X, oracle: opts?.oracle ?? ORACLE_X, sigFlag: opts?.sigFlag, nSigs: opts?.nSigs }),
    C: '02' + (opts?.c ?? 'cd').repeat(32),
  };
}

/** Attach a valid SIG_ALL signature from `priv` to every input. */
function signAs(inputs: EscrowSwapInputWire[], outputs: EscrowSwapOutputWire[], priv: Uint8Array): EscrowSwapInputWire[] {
  const message = buildSigAllMessage(inputs, outputs);
  const sig = signSigAllDigest(bytesToHex(priv), message);
  return inputs.map((i) => ({ ...i, witness: { signatures: [...witnessSignatures(i.witness), sig] } }));
}

const RELEASE_EXPECTATION: EscrowSwapExpectation = {
  mint: null,
  payoutPubkey: PROJECT_X,
  payoutSats: 150,
  feePubkey: ORACLE_X,
  feeSats: 40,
  mintFeeSats: 10,
  partyPubkey: PROJECT_X,
  oraclePubkey: ORACLE_X,
};

it('parses and completes a release-shaped swap (oracle-signed, project party)', () => {
  const outputs = [payoutOutput(128, PROJECT_X, 'ab'), payoutOutput(22, PROJECT_X, 'cd'), payoutOutput(40, ORACLE_X, 'ef')];
  const inputs = signAs([escrowInput(128, { c: '1a' }), escrowInput(72, { c: '2b' })], outputs, ORACLE);
  const wire = { mint: 'https://mint.example.com', inputs, outputs };

  const parsed = parseEscrowSwapForCompletion(wire, RELEASE_EXPECTATION);
  expect(parsed.message).toBe(buildSigAllMessage(inputs, outputs));
  expect(parsed.inputTotalSats).toBe(200);
  expect(parsed.outputTotalSats).toBe(190);

  const signed = signEscrowSwapForParty(parsed, bytesToHex(PROJECT));
  expect(signed.outputs).toEqual(outputs);
  const message = buildSigAllMessage(signed.inputs, signed.outputs);
  for (const input of signed.inputs) {
    const sigs = witnessSignatures(input.witness);
    expect(sigs).toHaveLength(2);
    expect(sigs.some((s) => verifySigAllSignature(ORACLE_X, message, s))).toBe(true);
    expect(sigs.some((s) => verifySigAllSignature(PROJECT_X, message, s))).toBe(true);
  }
});

it('infers the oracle for a refund-shaped swap (donor party, no declared oracle)', () => {
  const outputs = [payoutOutput(98, DONOR_X, 'aa')];
  const inputs = signAs([escrowInput(98, { c: '3c' })], outputs, ORACLE);
  const wire = { mint: 'https://mint.example.com', inputs, outputs };

  const parsed = parseEscrowSwapForCompletion(wire, {
    mint: null,
    payoutPubkey: DONOR_X,
    payoutSats: 98,
    partyPubkey: DONOR_X,
  });
  const signed = signEscrowSwapForParty(parsed, bytesToHex(DONOR));
  const message = buildSigAllMessage(signed.inputs, signed.outputs);
  const sigs = witnessSignatures(signed.inputs[0].witness);
  expect(sigs.some((s) => verifySigAllSignature(ORACLE_X, message, s))).toBe(true);
  expect(sigs.some((s) => verifySigAllSignature(DONOR_X, message, s))).toBe(true);
});

it('refuses an output paid to an unexpected key', () => {
  const outputs = [payoutOutput(150, STRANGER_X, 'ab'), payoutOutput(40, ORACLE_X, 'ef')];
  const inputs = signAs([escrowInput(200)], outputs, ORACLE);
  expect(() => parseEscrowSwapForCompletion({ mint: 'https://mint.example.com', inputs, outputs }, RELEASE_EXPECTATION))
    .toThrow(/unexpected key/);
});

it('refuses a payout amount that does not match the expected sats', () => {
  const outputs = [payoutOutput(140, PROJECT_X, 'ab'), payoutOutput(40, ORACLE_X, 'ef')];
  const inputs = signAs([escrowInput(190)], outputs, ORACLE);
  expect(() => parseEscrowSwapForCompletion({ mint: 'https://mint.example.com', inputs, outputs }, RELEASE_EXPECTATION))
    .toThrow(/pays 140 sats/);
});

it('refuses inputs that are not SIG_ALL-locked', () => {
  const outputs = [payoutOutput(150, PROJECT_X, 'ab'), payoutOutput(40, ORACLE_X, 'ef')];
  const inputs = signAs([escrowInput(200, { sigFlag: 'none' })], outputs, ORACLE);
  expect(() => parseEscrowSwapForCompletion({ mint: 'https://mint.example.com', inputs, outputs }, RELEASE_EXPECTATION))
    .toThrow(/not SIG_ALL-locked/);
});

it('refuses inputs whose escrow is not multisig', () => {
  const outputs = [payoutOutput(150, PROJECT_X, 'ab'), payoutOutput(40, ORACLE_X, 'ef')];
  const inputs = signAs([escrowInput(200, { nSigs: 1 })], outputs, ORACLE);
  expect(() => parseEscrowSwapForCompletion({ mint: 'https://mint.example.com', inputs, outputs }, RELEASE_EXPECTATION))
    .toThrow(/not a multisig escrow lock/);
});

it('refuses a swap missing the oracle signature', () => {
  const outputs = [payoutOutput(150, PROJECT_X, 'ab'), payoutOutput(40, ORACLE_X, 'ef')];
  const inputs = [escrowInput(200)];
  expect(() => parseEscrowSwapForCompletion({ mint: 'https://mint.example.com', inputs, outputs }, RELEASE_EXPECTATION))
    .toThrow(/missing the oracle signature/);
  // Inference path (no declared oracle) fails closed too.
  expect(() => parseEscrowSwapForCompletion({ mint: 'https://mint.example.com', inputs, outputs }, {
    mint: null, payoutPubkey: PROJECT_X, payoutSats: 150, feePubkey: ORACLE_X, feeSats: 40, partyPubkey: PROJECT_X,
  })).toThrow(/missing the oracle signature/);
});

it('refuses a swap the signing party is not a lock key of', () => {
  const outputs = [payoutOutput(150, STRANGER_X, 'ab'), payoutOutput(40, ORACLE_X, 'ef')];
  const inputs = signAs([escrowInput(200)], outputs, ORACLE);
  expect(() => parseEscrowSwapForCompletion({ mint: 'https://mint.example.com', inputs, outputs }, {
    ...RELEASE_EXPECTATION,
    payoutPubkey: STRANGER_X,
    partyPubkey: STRANGER_X,
  })).toThrow(/not an escrow lock key/);
});

it('refuses ambiguous oracle signatures when no oracle key is declared', () => {
  const outputs = [payoutOutput(98, DONOR_X, 'aa')];
  let inputs = signAs([escrowInput(98, { c: '3c' })], outputs, ORACLE);
  inputs = signAs(inputs, outputs, PROJECT);
  expect(() => parseEscrowSwapForCompletion({ mint: 'https://mint.example.com', inputs, outputs }, {
    mint: null, payoutPubkey: DONOR_X, payoutSats: 98, partyPubkey: DONOR_X,
  })).toThrow(/ambiguous oracle signatures/);
});

it('refuses malformed wire shapes and mismatched mints', () => {
  const outputs = [payoutOutput(150, PROJECT_X, 'ab'), payoutOutput(40, ORACLE_X, 'ef')];
  const inputs = signAs([escrowInput(200)], outputs, ORACLE);
  const good = { mint: 'https://mint.example.com', inputs, outputs };

  expect(() => parseEscrowSwapForCompletion(good, { ...RELEASE_EXPECTATION, mint: 'https://other.example.com' }))
    .toThrow(/does not match the expected escrow mint/);
  expect(() => parseEscrowSwapForCompletion({ ...good, mint: 'http://mint.example.com' }, RELEASE_EXPECTATION))
    .toThrow(/not https/);
  expect(() => parseEscrowSwapForCompletion({ ...good, inputs: [] }, RELEASE_EXPECTATION))
    .toThrow(/inputs are malformed/);
  expect(() => parseEscrowSwapForCompletion({ ...good, outputs: [{ ...outputs[0], secret: 'zz' }] }, RELEASE_EXPECTATION))
    .toThrow(/outputs are malformed/);
  expect(() => parseEscrowSwapForCompletion({ mint: 'https://mint.example.com', inputs: [inputs[0], { ...inputs[0], id: '01other' }], outputs }, RELEASE_EXPECTATION))
    .toThrow(/inputs mix keysets/);
});

it('SIG_ALL digest matches the cashu-ts 4.x SigAll builder byte-for-byte', async () => {
  // cashu-ts 4.x removed the runtime-only `buildP2PKSigAllMessage` export and
  // now ships a PUBLIC (typed, @experimental) `SigAll.computeDigests()` that
  // returns the hex SHA-256 of the exact same SIG_ALL transcript. This parity
  // check keeps the local money-path mirror honest - and unlike the 3.x check
  // it is fully typed, so no untyped call sits anywhere near the signing path.
  const { Amount, SigAll } = await import('@cashu/cashu-ts');
  const outputs = [payoutOutput(128, PROJECT_X, 'ab'), payoutOutput(40, ORACLE_X, 'ef')];
  const inputs = [escrowInput(168, { c: '1a' })];
  const digests = SigAll.computeDigests(
    inputs.map((i) => ({ secret: i.secret, C: i.C })),
    outputs.map((o) => ({
      amount: Amount.from(o.blindedMessage.amount),
      B_: o.blindedMessage.B_,
      id: o.blindedMessage.id,
    })),
  );
  expect(digests.v0).toBe(bytesToHex(sha256(new TextEncoder().encode(buildSigAllMessage(inputs, outputs)))));
});

it('refuses a malformed signing key and never replaces existing witnesses', () => {
  const outputs = [payoutOutput(150, PROJECT_X, 'ab'), payoutOutput(40, ORACLE_X, 'ef')];
  const inputs = signAs([escrowInput(200)], outputs, ORACLE);
  const parsed = parseEscrowSwapForCompletion({ mint: 'https://mint.example.com', inputs, outputs }, RELEASE_EXPECTATION);
  expect(() => signEscrowSwapForParty(parsed, 'not-hex')).toThrow(/malformed/);
  const signed = signEscrowSwapForParty(parsed, bytesToHex(PROJECT));
  expect(witnessSignatures(signed.inputs[0].witness)).toHaveLength(2);
  // Re-signing with the same key appends a duplicate signature (mint-side
  // dedupe is the API's job); it must never drop the oracle's.
  const twice = signEscrowSwapForParty(parsed, bytesToHex(PROJECT));
  expect(twice.inputs[0].witness).not.toBe(signed.inputs[0].witness);
});
