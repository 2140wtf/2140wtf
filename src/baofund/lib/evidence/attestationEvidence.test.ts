// src/lib/evidence/attestationEvidence.test.ts
import { describe, expect, it } from 'vitest';

import { baoSlice } from 'blake3-bao';

import {
  EVIDENCE_ENCODING,
  EVIDENCE_TAG,
  buildEvidenceTag,
  encodeMilestoneEvidence,
  parseEvidenceTag,
  verifyMilestoneEvidenceArtifact,
  type BaoEvidenceFields,
} from './attestationEvidence';
import { workObjectHash, validateMilestoneEvidenceV1, type MilestoneEvidenceV1, type WorkContractV1 } from '../baoWorkContract';

const h = (digit: string) => digit.repeat(64);

/** Deterministic pseudo-random artifact (50 KB - multi-slice). */
function artifactBytes(n = 50_000): Uint8Array {
  const out = new Uint8Array(n);
  let state = 0x9e3779b9;
  for (let i = 0; i < n; i += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    out[i] = state & 0xff;
  }
  return out;
}

/** Mock host speaking the slice-endpoint contract (or serving the full encoding). */
function makeHost(encoded: Uint8Array, opts: { tamper?: (bytes: Uint8Array) => void } = {}) {
  const bytes = encoded.slice();
  opts.tamper?.(bytes);
  const fetchImpl = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.includes('/slice?')) {
      const params = new URL(url).searchParams;
      const start = Number(params.get('start'));
      const len = Number(params.get('len'));
      const slice = baoSlice(bytes, start, len);
      return new Response(slice as unknown as BodyInit, { status: 200 });
    }
    return new Response(bytes as unknown as BodyInit, { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, bytes };
}

describe('encodeMilestoneEvidence (owner side)', () => {
  it('derives fields, tag, and the archive sha256 of the encoding', () => {
    const content = artifactBytes();
    const enc = encodeMilestoneEvidence(content);
    expect(enc.fields).toEqual({
      evidence_encoding: EVIDENCE_ENCODING,
      evidence_root_hash: enc.rootHashHex,
      evidence_bytes: content.length,
    });
    expect(enc.rootHashHex).toMatch(/^[0-9a-f]{64}$/);
    expect(enc.archiveSha256Hex).toMatch(/^[0-9a-f]{64}$/);
    // The encoding is bigger than the content (hash tree overhead) and differs from it.
    expect(enc.encoded.length).toBeGreaterThan(content.length);
  });

  it('refuses empty artifacts', () => {
    expect(() => encodeMilestoneEvidence(new Uint8Array(0))).toThrow(/empty/);
  });
});

describe('evidence tag (kind-37107 commitment)', () => {
  const fields: BaoEvidenceFields = {
    evidence_encoding: EVIDENCE_ENCODING,
    evidence_root_hash: h('a'),
    evidence_bytes: 50_000,
  };

  it('round-trips through build → parse', () => {
    const tag = buildEvidenceTag(fields);
    expect(tag[0]).toBe(EVIDENCE_TAG);
    expect(parseEvidenceTag([['d', 'market'], tag])).toEqual(fields);
  });

  it('returns null without a tag but throws on malformed ones', () => {
    expect(parseEvidenceTag([['d', 'market']])).toBeNull();
    expect(() => parseEvidenceTag([['evidence', h('a'), EVIDENCE_ENCODING]])).toThrow(/4 elements/);
    expect(() => parseEvidenceTag([['evidence', 'XYZ', EVIDENCE_ENCODING, '10']])).toThrow(/hex/);
    expect(() => parseEvidenceTag([['evidence', h('a'), 'bao/v0', '10']])).toThrow(/Unsupported evidence_encoding/);
    expect(() => parseEvidenceTag([['evidence', h('a'), EVIDENCE_ENCODING, 'zero']])).toThrow(/positive integer/);
  });
});

describe('verifyMilestoneEvidenceArtifact (attestor side)', () => {
  const content = artifactBytes();
  const enc = encodeMilestoneEvidence(content);
  const archiveUrl = 'https://host.example/evidence.bao';
  const sliceUrl = 'https://host.example/slice?start={start}&len={len}';

  it('verifies via the slice endpoint with KBs of transfer', async () => {
    const host = makeHost(enc.encoded);
    const result = await verifyMilestoneEvidenceArtifact({
      archiveUrl,
      archiveSha256Hex: enc.archiveSha256Hex,
      rootHashHex: enc.rootHashHex,
      contentLength: enc.contentLength,
      sliceUrl,
      probes: 8,
      // Root-only slice verification: the archive sha256 pins the whole
      // encoding and is checked by the full strategy (or by slice mode's
      // default full-archive fetch, covered below).
      verifyArchiveHash: false,
      fetchImpl: host.fetchImpl,
    });
    expect(result).toEqual({
      verified: true,
      strategy: 'slice',
      slicesChecked: 8,
      contentLength: enc.contentLength,
      rootHashHex: enc.rootHashHex,
      archiveSha256Hex: enc.archiveSha256Hex,
      archiveHashVerified: false,
    });
  });

  it('rejects a published evidence_bytes that disagrees with the hosted artifact (slice strategy)', async () => {
    // The Bao slice header carries the artifact's true total length. A slice
    // probe alone would otherwise "verify" even when the published
    // evidence_bytes is inflated (probes clamp to an empty range) or
    // understated (all probes still land inside the real artifact).
    const inflated = makeHost(enc.encoded);
    await expect(
      verifyMilestoneEvidenceArtifact({
        archiveUrl,
        archiveSha256Hex: enc.archiveSha256Hex,
        rootHashHex: enc.rootHashHex,
        contentLength: enc.contentLength * 10,
        sliceUrl,
        probes: 8,
        fetchImpl: inflated.fetchImpl,
      }),
    ).rejects.toThrow(/evidence_bytes|content length|length/i);

    const understated = makeHost(enc.encoded);
    await expect(
      verifyMilestoneEvidenceArtifact({
        archiveUrl,
        archiveSha256Hex: enc.archiveSha256Hex,
        rootHashHex: enc.rootHashHex,
        contentLength: 4096,
        sliceUrl,
        probes: 8,
        fetchImpl: understated.fetchImpl,
      }),
    ).rejects.toThrow(/evidence_bytes|content length|length/i);
  });

  it('rejects a host that tampers with a served slice', async () => {
    const host = makeHost(enc.encoded, { tamper: (bytes) => { bytes[20_000] ^= 0x01; } });
    await expect(
      verifyMilestoneEvidenceArtifact({
        archiveUrl,
        archiveSha256Hex: enc.archiveSha256Hex,
        rootHashHex: enc.rootHashHex,
        contentLength: enc.contentLength,
        sliceUrl,
        probes: 8,
        // Keep this test on the slice-proof lane: the archive bytes are
        // tampered, so the (default) archive-hash gate would fail first.
        verifyArchiveHash: false,
        fetchImpl: host.fetchImpl,
      }),
    ).rejects.toThrow();
  });

  it('verifies via the full-fetch fallback when no slice endpoint exists', async () => {
    const host = makeHost(enc.encoded);
    const result = await verifyMilestoneEvidenceArtifact({
      archiveUrl,
      archiveSha256Hex: enc.archiveSha256Hex,
      rootHashHex: enc.rootHashHex,
      contentLength: enc.contentLength,
      fetchImpl: host.fetchImpl,
    });
    expect(result.strategy).toBe('full');
    expect(result.verified).toBe(true);
  });

  it('rejects a tampered full encoding and honors the size cap', async () => {
    const host = makeHost(enc.encoded, { tamper: (bytes) => { bytes[bytes.length - 1] ^= 0x80; } });
    await expect(
      verifyMilestoneEvidenceArtifact({
        archiveUrl,
        archiveSha256Hex: enc.archiveSha256Hex,
        rootHashHex: enc.rootHashHex,
        contentLength: enc.contentLength,
        fetchImpl: host.fetchImpl,
      }),
    ).rejects.toThrow();

    const okHost = makeHost(enc.encoded);
    await expect(
      verifyMilestoneEvidenceArtifact({
        archiveUrl,
        archiveSha256Hex: enc.archiveSha256Hex,
        rootHashHex: enc.rootHashHex,
        contentLength: enc.contentLength,
        maxFullBytes: 1024,
        fetchImpl: okHost.fetchImpl,
      }),
    ).rejects.toThrow(/cap/);
  });

  it('cuts off an oversized slice response mid-stream (cap enforced during read, not after)', async () => {
    // Hostile host: ignores {len} and streams 1 MiB for every probe.
    const huge = new Uint8Array(1024 * 1024).fill(0x41);
    let cancelled = false;
    const hostileFetch = (async (): Promise<Response> => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          // Two 512 KiB chunks - the 256 KiB slice cap must trip mid-way.
          controller.enqueue(huge.subarray(0, 512 * 1024));
          controller.enqueue(huge.subarray(512 * 1024));
          controller.close();
        },
        cancel() {
          cancelled = true;
        },
      });
      return new Response(stream, { status: 200 });
    }) as typeof fetch;
    await expect(
      verifyMilestoneEvidenceArtifact({
        archiveUrl,
        archiveSha256Hex: enc.archiveSha256Hex,
        rootHashHex: enc.rootHashHex,
        contentLength: enc.contentLength,
        sliceUrl,
        probes: 1,
        verifyArchiveHash: false,
        fetchImpl: hostileFetch,
      }),
    ).rejects.toThrow(/cap/);
    expect(cancelled).toBe(true); // the reader cancelled the hostile stream
  });

  it('rejects an oversized slice via content-length before reading the body', async () => {
    const preCapFetch = (async (): Promise<Response> =>
      new Response('x'.repeat(1024), {
        status: 200,
        headers: { 'content-length': String(10 * 1024 * 1024) },
      })) as typeof fetch;
    await expect(
      verifyMilestoneEvidenceArtifact({
        archiveUrl,
        archiveSha256Hex: enc.archiveSha256Hex,
        rootHashHex: enc.rootHashHex,
        contentLength: enc.contentLength,
        sliceUrl,
        probes: 1,
        verifyArchiveHash: false,
        fetchImpl: preCapFetch,
      }),
    ).rejects.toThrow(/cap/);
  });

  it('fails closed on bad commitments, URLs, and HTTP errors', async () => {
    const host = makeHost(enc.encoded);
    const base = {
      archiveUrl,
      archiveSha256Hex: enc.archiveSha256Hex,
      contentLength: enc.contentLength,
      fetchImpl: host.fetchImpl,
    };
    await expect(verifyMilestoneEvidenceArtifact({ ...base, rootHashHex: 'nothex' })).rejects.toThrow(/hex/);
    await expect(
      verifyMilestoneEvidenceArtifact({ ...base, rootHashHex: enc.rootHashHex, contentLength: 0 }),
    ).rejects.toThrow(/evidence_bytes/);
    await expect(
      verifyMilestoneEvidenceArtifact({ ...base, rootHashHex: enc.rootHashHex, archiveUrl: 'http://host.example/x' }),
    ).rejects.toThrow(/HTTPS/);
    await expect(
      verifyMilestoneEvidenceArtifact({ ...base, rootHashHex: enc.rootHashHex, archiveUrl: 'not a url' }),
    ).rejects.toThrow(/invalid/);
    const failing = (async () => new Response(null, { status: 404 })) as typeof fetch;
    await expect(
      verifyMilestoneEvidenceArtifact({ ...base, rootHashHex: enc.rootHashHex, sliceUrl, fetchImpl: failing }),
    ).rejects.toThrow(/404/);
  });
});

describe('archive sha256 commitment (MilestoneEvidenceV1.archive.sha256)', () => {
  const content = artifactBytes();
  const enc = encodeMilestoneEvidence(content);
  const archiveUrl = 'https://host.example/evidence.bao';
  const sliceUrl = 'https://host.example/slice?start={start}&len={len}';

  it('verifies the published archive hash on the full-fetch path', async () => {
    const host = makeHost(enc.encoded);
    const result = await verifyMilestoneEvidenceArtifact({
      archiveUrl,
      archiveSha256Hex: enc.archiveSha256Hex,
      rootHashHex: enc.rootHashHex,
      contentLength: enc.contentLength,
      fetchImpl: host.fetchImpl,
    });
    expect(result.verified).toBe(true);
    expect(result.archiveHashVerified).toBe(true);
    expect(result.archiveSha256Hex).toBe(enc.archiveSha256Hex);
  });

  it('rejects a mismatched archive hash with a typed error (full path)', async () => {
    // Honest bytes, honest root, LIE in the published archive commitment.
    const host = makeHost(enc.encoded);
    await expect(
      verifyMilestoneEvidenceArtifact({
        archiveUrl,
        archiveSha256Hex: h('0'),
        rootHashHex: enc.rootHashHex,
        contentLength: enc.contentLength,
        fetchImpl: host.fetchImpl,
      }),
    ).rejects.toMatchObject({ name: 'EvidenceArchiveHashError', code: 'archive_hash_mismatch' });
  });

  it('verifies the archive hash in the slice strategy by default (no silent skip)', async () => {
    const host = makeHost(enc.encoded);
    const result = await verifyMilestoneEvidenceArtifact({
      archiveUrl,
      archiveSha256Hex: enc.archiveSha256Hex,
      rootHashHex: enc.rootHashHex,
      contentLength: enc.contentLength,
      sliceUrl,
      probes: 4,
      fetchImpl: host.fetchImpl,
    });
    expect(result.strategy).toBe('slice');
    expect(result.archiveHashVerified).toBe(true);
  });

  it('rejects a mismatched archive hash before any slice probe runs', async () => {
    const host = makeHost(enc.encoded);
    let sliceCalls = 0;
    const countingFetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (String(input).includes('/slice?')) sliceCalls += 1;
      return host.fetchImpl(input, init);
    }) as typeof fetch;
    await expect(
      verifyMilestoneEvidenceArtifact({
        archiveUrl,
        archiveSha256Hex: h('f'),
        rootHashHex: enc.rootHashHex,
        contentLength: enc.contentLength,
        sliceUrl,
        probes: 4,
        fetchImpl: countingFetch,
      }),
    ).rejects.toMatchObject({ code: 'archive_hash_mismatch' });
    expect(sliceCalls).toBe(0);
  });

  it('allows an explicit root-only slice verification and reports the skip', async () => {
    const host = makeHost(enc.encoded);
    const result = await verifyMilestoneEvidenceArtifact({
      archiveUrl,
      archiveSha256Hex: h('0'), // deliberately not the served encoding's hash
      rootHashHex: enc.rootHashHex,
      contentLength: enc.contentLength,
      sliceUrl,
      probes: 4,
      verifyArchiveHash: false,
      fetchImpl: host.fetchImpl,
    });
    expect(result.strategy).toBe('slice');
    expect(result.archiveHashVerified).toBe(false);
  });

  it('fails closed on missing, empty and wrong-length archive hashes', async () => {
    const host = makeHost(enc.encoded);
    const base = {
      archiveUrl,
      rootHashHex: enc.rootHashHex,
      contentLength: enc.contentLength,
      fetchImpl: host.fetchImpl,
    };
    for (const bad of ['', 'abc', 'a'.repeat(63), 'a'.repeat(65), 'ZZ'.repeat(32)]) {
      await expect(
        verifyMilestoneEvidenceArtifact({ ...base, archiveSha256Hex: bad }),
      ).rejects.toMatchObject({ name: 'EvidenceArchiveHashError' });
    }
    await expect(
      verifyMilestoneEvidenceArtifact({ ...base, archiveSha256Hex: undefined as unknown as string }),
    ).rejects.toMatchObject({ name: 'EvidenceArchiveHashError', code: 'archive_hash_missing' });
  });

  it('treats uppercase hex as malformed (lowercase contract)', async () => {
    const host = makeHost(enc.encoded);
    await expect(
      verifyMilestoneEvidenceArtifact({
        archiveUrl,
        archiveSha256Hex: enc.archiveSha256Hex.toUpperCase(),
        rootHashHex: enc.rootHashHex,
        contentLength: enc.contentLength,
        fetchImpl: host.fetchImpl,
      }),
    ).rejects.toMatchObject({ code: 'archive_hash_malformed' });
  });
});

describe('MilestoneEvidenceV1 integration', () => {
  const criteria = 'All tests pass for the exact committed source tree.';
  const contract = (): WorkContractV1 => ({
    version: 1,
    campaign_id: 'fr_1',
    creation_event_id: h('1'),
    owner_pubkey: h('2'),
    runner_pubkey: h('3'),
    payout_pubkey: h('4'),
    repository_coordinate: `30617:${h('2')}:bao`,
    repository_event_id: h('5'),
    repository_maintainers: [h('2')],
    settlement_policy: { id: 'test-attestation', version: '1', hash: h('6') },
    verifier_pubkeys: [h('7')],
    objection_window_seconds: 3600,
    appeal_window_seconds: 7200,
    amendment_rule: 'owner+runner+donor-majority',
    refund_rule: 'refund on timeout',
    milestones: [
      {
        id: 'm1',
        title: 'Ship',
        amount_sats: 21000,
        criteria,
        criteria_hash: workObjectHash(criteria),
        deadline: 2_000_000_000,
        base_commit: h('8'),
        max_verification_attempts: 2,
        max_verification_fee_msats: 21000,
      },
    ],
  });

  const evidence = (enc: ReturnType<typeof encodeMilestoneEvidence>): MilestoneEvidenceV1 => {
    const c = contract();
    return {
      version: 1,
      contract_hash: workObjectHash(c),
      campaign_id: c.campaign_id,
      milestone_id: 'm1',
      repository_coordinate: c.repository_coordinate,
      base_commit: h('8'),
      delivered_commit: h('9'),
      delivered_tree: h('a'),
      artifact_event_ids: [h('b')],
      criteria_hash: c.milestones[0].criteria_hash,
      archive: { url: 'https://example.com/evidence.bao', sha256: enc.archiveSha256Hex },
      test_command: 'npm test',
      workflow_hash: h('d'),
      toolchain_hash: h('e'),
      ...enc.fields,
    };
  };

  it('validates evidence carrying the Bao fields', () => {
    const enc = encodeMilestoneEvidence(artifactBytes(1024));
    const c = contract();
    expect(validateMilestoneEvidenceV1(evidence(enc), c)).toBeTruthy();
  });

  it('still validates legacy evidence without the optional fields', () => {
    const enc = encodeMilestoneEvidence(artifactBytes(1024));
    const c = contract();
    const legacy = evidence(enc);
    delete legacy.evidence_encoding;
    delete legacy.evidence_root_hash;
    delete legacy.evidence_bytes;
    expect(validateMilestoneEvidenceV1(legacy, c)).toBeTruthy();
  });

  it('rejects inconsistent Bao fields', () => {
    const enc = encodeMilestoneEvidence(artifactBytes(1024));
    const c = contract();
    expect(() =>
      validateMilestoneEvidenceV1({ ...evidence(enc), evidence_encoding: 'bao/v0' }, c),
    ).toThrow(/evidence_encoding/);
    expect(() =>
      validateMilestoneEvidenceV1({ ...evidence(enc), evidence_root_hash: h('z') }, c),
    ).toThrow(/evidence_root_hash/);
    expect(() =>
      validateMilestoneEvidenceV1({ ...evidence(enc), evidence_bytes: -1 }, c),
    ).toThrow(/evidence_bytes/);
  });
});
