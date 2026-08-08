/**
 * Repository edge of the ₿AO project workspace graph.
 *
 * A repository is a *control-vs-data split*: its **state** (issues, PRs,
 * patches, statuses, maintainers) lives on the relay as NIP-34 events keyed by
 * an addressable coordinate `30617:<pubkey>:<identifier>`; its **data plane**
 * (`clone`/`source` host fetches) is reached over HTTP only for verification.
 *
 * This module normalizes any repo reference a campaign/user/evidence tag may
 * cite — a bech32 `naddr`, a `nostr://` ngit link, or a GitHub/GitLab URL —
 * into a single, security-screened `RepoRef`. It is **fail-closed**: anything
 * we cannot map to a safe coordinate is rejected, so a host URL is never trusted
 * over what the relay asserts. Host URLs are the *data plane* and must be
 * fetched server-side (CORS is not available to the browser client for
 * arbitrary git hosts); see `dataPlaneFetchAllowed`.
 */
import { nip19 } from 'nostr-tools';

import { NIP34_REPOSITORY_KIND, parseRepoNaddr, type Nip34RepoPointer } from '@/lib/nip34Project';
import { isNostrId } from '@/lib/nostrId';
import { sanitizeUrl } from '@/lib/sanitizeUrl';

/** Mirrors NIP-34's repo-identifier byte cap so ngit identifiers can't outgrow a real coordinate. */
const MAX_REPO_IDENTIFIER_BYTES = 256;

export type RepoHost = 'github' | 'gitlab' | 'naddr' | 'ngit';

/**
 * Normalized, security-screened repository reference.
 *
 * - `identifier` is always an **opaque, slash-tolerant** repo id (for gh/gl this
 *   is `owner/repo`; for Nostr-native refs it is the NIP-34 identifier).
 * - Only Nostr-native refs carry `authorHex` / `coordinate`.
 * - `url` is a sanitized display URL for host refs; never a trusted state
 *   source — the relay remains authoritative for NIP-34 state.
 */
export interface RepoRef {
  /** Discriminant host tag. */
  host: RepoHost;
  /** Opaque repo identifier (may contain a slash for host refs). */
  identifier: string;
  /** Author pubkey — only for Nostr-native refs (`naddr` / `ngit`). */
  authorHex?: string;
  /** Canonical `30617:<pubkey>:<identifier>` coordinate for Nostr-native refs. */
  coordinate?: string;
  /** Sanitized HTTPS source URL (host refs only). */
  url?: string;
  /** Relays the Nostr-native coordinate advertises. */
  relays?: string[];
  /**
   * Host refs are the *data plane*: followed only for verification (clone /
   * source fetch), never for state. Must be fetched **server-side** — the
   * browser cannot CORS-fetch arbitrary git hosts. `false` here marks
   * Nostr-native refs whose data lives on the relay.
   */
  dataPlaneFetchAllowed: boolean;
  /** Original raw input, kept for diagnostics only. */
  raw: string;
}

const HOSTS = new Set(['github.com', 'www.github.com', 'gitlab.com', 'www.gitlab.com']);

const GITHUB_SLASH_SEGMENT = /^[A-Za-z0-9._-]+$/;

/**
 * Decode a `nostr://` author token (`npub1…` or bare 64-hex) to a validated
 * pubkey hex. NIP-05 and other resolvable-by-DNS forms are rejected — they
 * carry no offline proof of authorship, so they are fail-closed.
 */
function decodeNostrAuthor(author: string): string | undefined {
  const v = author.toLowerCase();
  if (v.startsWith('npub1')) {
    try {
      const decoded = nip19.decode(author);
      if (decoded.type === 'npub') {
        // `data` is a 64-char hex pubkey for npub; trust Nostrify's bech32 decode
        // rather than re-validating here — the consumer gates queries with authors.
        return decoded.data;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }
  if (isNostrId(v)) return v;
  return undefined;
}

/**
 * Normalize a GitHub/GitLab `owner/repo[/…]` URL into an identifier + safe URL.
 * Ownership is established by the remote host (HTTPS + path), so reachability
 * is host-verified; the relay remains authoritative for NIP-34 state.
 */
function parseHostRef(raw: string, url: string): RepoRef | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const host = parsed.hostname.toLowerCase();
  if (!HOSTS.has(host)) return undefined;

  const parts = parsed.pathname.split('/').filter((s) => s.length > 0);
  // Only owner/repo is needed; extra path segments are ignored, not trusted.
  if (parts.length < 2) return undefined;
  const [owner, repo] = parts;
  if (!GITHUB_SLASH_SEGMENT.test(owner) || !GITHUB_SLASH_SEGMENT.test(repo)) return undefined;

  const hostTag: RepoHost = host.startsWith('gitlab') ? 'gitlab' : 'github';
  return {
    host: hostTag,
    identifier: `${owner}/${repo}`,
    url,
    dataPlaneFetchAllowed: true,
    raw,
  };
}

/**
 * Validate a NIP-34 repository `d`-tag value (the opaque, slash-tolerant part
 * after `30617:<pubkey>:<identifier>`).
 *
 * ngit identifiers survive URL splitting intact, so they may contain slashes and
 * percent-decoded characters — but once decoded they must still be safe to
 * interpolate into a NIP-34 coordinate that is used as `authors`/`#d` filter
 * values. We reject:
 *  - empty values or values over NIP-34's 256-byte cap,
 *  - control / non-printable characters,
 *  - shell/HTML metacharacters and URL-encoding leftovers (`%`, `;`, `` ` ``,
 *    `<`, `>`, `|`, `&`, newlines, `..` traversal sequences).
 *
 * This is a *character-level* guard, not a semantic allowlist — legitimate
 * ngit identifiers are alphanumeric + `/`, `-`, `_`, `.`, `+`.
 */
const REPO_DTAG_RE = /^[A-Za-z0-9._+/ -]+$/;

export function isValidNip34DTag(value: string): boolean {
  if (!value || new TextEncoder().encode(value).length > MAX_REPO_IDENTIFIER_BYTES) return false;
  if (!REPO_DTAG_RE.test(value)) return false;
  // Reject traversal sequences even though `.` is otherwise allowed.
  if (value.includes('..')) return false;
  // Reject percent-encoding leftovers (e.g. decoded `%2f` → `/` is fine, but a
  // literal stray `%` means the value wasn't fully/safely decoded).
  if (value.includes('%')) return false;
  return true;
}

/** Decode a URI component, returning undefined on malformed sequences (%zz) so
 * the caller stays fail-closed instead of throwing a URIError. */
function safeDecodeURIComponent(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

/**
 * Parse and security-screen any repo reference cited by a campaign/user/evidence
 * tag: an `naddr1…` pointer, a `nostr://<author>/<identifier>` ngit link, or a
 * GitHub/GitLab URL. Unreachable/non-Nostr refs are **fail-closed** (undefined).
 */
export function parseRepoRef(input: unknown): RepoRef | undefined {
  if (typeof input !== 'string') return undefined;
  const raw = input.trim();
  if (!raw || new TextEncoder().encode(raw).length > 2048) return undefined;

  // 1) Nostr-native `naddr1…` pointer (bech32, kind 30617).
  if (raw.toLowerCase().startsWith('naddr1')) {
    const ptr: Nip34RepoPointer | undefined = parseRepoNaddr(raw);
    if (!ptr) return undefined;
    return {
      host: 'naddr',
      identifier: ptr.identifier,
      authorHex: ptr.owner,
      coordinate: ptr.coordinate,
      relays: ptr.relays,
      dataPlaneFetchAllowed: false,
      raw,
    };
  }

  // 2) `nostr://<author>/<opaque identifier>` ngit link.
  if (raw.toLowerCase().startsWith('nostr://')) {
    const after = raw.slice('nostr://'.length);
    const slash = after.indexOf('/');
    if (slash < 0) return undefined;
    const authorRaw = after.slice(0, slash);
    let identifier = after.slice(slash + 1);
    // Opaque identifier; strip a single trailing slash so `.../foo/` == `.../foo`.
    if (identifier.endsWith('/')) identifier = identifier.slice(0, -1);
    const authorHex = decodeNostrAuthor(authorRaw);
    if (!authorHex) return undefined;
    // ngit identifiers are opaque and slash-tolerant, but they are interpolated
    // into a NIP-34 coordinate (`authors`/`#d` filters) and must not carry shell
    // metacharacters, traversal sequences, URL-encoding artifacts, or anything
    // that is not a valid NIP-34 `d`-tag value. Sanitize, then validate.
    const decoded = safeDecodeURIComponent(identifier);
    if (!decoded || new TextEncoder().encode(decoded).length > MAX_REPO_IDENTIFIER_BYTES) return undefined;
    identifier = decoded;
    if (!isValidNip34DTag(identifier)) return undefined;
    return {
      host: 'ngit',
      identifier,
      authorHex,
      coordinate: `${NIP34_REPOSITORY_KIND}:${authorHex}:${identifier}`,
      relays: [],
      dataPlaneFetchAllowed: false,
      raw,
    };
  }

  // 3) GitHub / GitLab URL — data-plane only; fail-closed via sanitizeUrl.
  const url = sanitizeUrl(raw);
  if (!url) return undefined;
  return parseHostRef(raw, url);
}
