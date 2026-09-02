import { base64url } from '@scure/base';
import { describe, expect, it } from 'vitest';

import { absorbLink, parseJoinLink } from '@/lib/baosocial/join';

const K = 'a'.repeat(64); // invite secret: 64 hex chars
const ROOM = 'test-room';

/** Build a structurally-valid join link: base URL + '#' + base64url(JSON). */
function makeLink(extra: Record<string, string> = {}): string {
  const payload = { k: K, room: ROOM, ...extra };
  const frag = base64url.encode(new TextEncoder().encode(JSON.stringify(payload)));
  return `https://2140.wtf/chat/join#${frag}`;
}

const VALID_LINK = makeLink({ w: 'b'.repeat(64), r: 'c'.repeat(64) });

describe('absorbLink', () => {
  it('returns a clean link unchanged', () => {
    expect(absorbLink(VALID_LINK)).toBe(VALID_LINK);
  });

  it('trims surrounding whitespace', () => {
    expect(absorbLink(`  ${VALID_LINK}  `)).toBe(VALID_LINK);
  });

  it('keeps a link without a fragment base intact', () => {
    expect(absorbLink(VALID_LINK)).not.toContain('#r.old');
  });

  it('strips wrapping quotes (chat layer auto-quoting)', () => {
    expect(absorbLink(`"${VALID_LINK}"`)).toBe(VALID_LINK);
    expect(absorbLink(`'${VALID_LINK}'`)).toBe(VALID_LINK);
    expect(absorbLink(`\`${VALID_LINK}\``)).toBe(VALID_LINK);
    expect(absorbLink(`<${VALID_LINK}>`)).toBe(VALID_LINK);
  });

  it('strips trailing punctuation glued on by prose', () => {
    expect(absorbLink(`${VALID_LINK}.`)).toBe(VALID_LINK);
    expect(absorbLink(`${VALID_LINK},`)).toBe(VALID_LINK);
    expect(absorbLink(`${VALID_LINK}?!;:`)).toBe(VALID_LINK);
  });

  it('removes markdown escapes before # and inside the fragment', () => {
    expect(absorbLink('https://2140.wtf/chat/join\\#r.abc')).toBe('https://2140.wtf/chat/join#r.abc');
    expect(absorbLink('https://2140.wtf/chat/join#r.\\_abc')).toBe('https://2140.wtf/chat/join#r._abc');
  });

  it('keeps only the last #-segment when a paste merged two URLs', () => {
    const other = makeLink({ room: 'other-room' });
    const merged = `${other}#${VALID_LINK.split('#')[1]}`;
    expect(absorbLink(merged)).toBe(VALID_LINK);
  });

  it('removes all whitespace inside the fragment (line-wrap damage)', () => {
    const [head, frag] = VALID_LINK.split('#');
    const wrapped = `${head}#${frag.slice(0, 12)} ${frag.slice(12, -6)}\t${frag.slice(-6)}`;
    expect(absorbLink(wrapped)).toBe(VALID_LINK);
  });

  it('repairs a hard line-wrapped link (newline inside fragment)', () => {
    const [head, frag] = VALID_LINK.split('#');
    const broken = `${head}#\n  ${frag.slice(0, 10)}\n${frag.slice(10)}`;
    expect(absorbLink(broken)).toBe(VALID_LINK);
  });

  it('leaves a link without a fragment untouched (after cleanup)', () => {
    expect(absorbLink('https://2140.wtf/chat/join.')).toBe('https://2140.wtf/chat/join');
  });

  it('throws on non-string input', () => {
    // @ts-expect-error runtime guard test
    expect(() => absorbLink(null)).toThrow('join link must be a string');
    // @ts-expect-error runtime guard test
    expect(() => absorbLink(123)).toThrow('join link must be a string');
  });
});

describe('parseJoinLink (absorbLink integration)', () => {
  it('parses a clean link end-to-end', () => {
    const parsed = parseJoinLink(VALID_LINK);
    expect(parsed.inviteSecret).toBe(K);
    expect(parsed.roomId).toBe(ROOM);
  });

  it('parses a mangled link after transport repair', () => {
    // Quoted, line-wrapped and trailing-punctured — all absorbed before the
    // strict parse sees it. The wrap loses no characters (wrapping damage is
    // insertion, not deletion — deleted data is unrepairable by design).
    const [head, frag] = VALID_LINK.split('#');
    const mangled = `"${head}#\n${frag.slice(0, 20)}\n${frag.slice(20)}, "`;
    const parsed = parseJoinLink(mangled);
    expect(parsed.roomId).toBe(ROOM);
  });

  it('still fails closed on structurally invalid links', () => {
    expect(() => parseJoinLink('https://2140.wtf/chat/join')).toThrow();
    expect(() => parseJoinLink('not a join link at all')).toThrow();
    // Fragment present but not valid base64url JSON → fail closed.
    expect(() => parseJoinLink('https://2140.wtf/chat/join#!!!notbase64!!!')).toThrow();
  });
});
