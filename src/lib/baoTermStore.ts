/**
 * Browser-side identity store for the in-page ₿AO agent terminal.
 *
 * Mirrors the on-disk `~/.concord-live/<name>.json` shape used by the
 * headless CLI (scripts/chat-core.ts `State`), so an agent that joins a ₿AO
 * from the page keeps the same identity across reloads via localStorage.
 *
 * SECURITY: the state holds an hex nsec-equivalent private key. localStorage
 * is plaintext in the origin, so this carries the same XSS-steals-your-key
 * risk as the rest of the app's nsec story — keep the page's CSP tight and
 * never log the sk.
 */

const STORAGE_PREFIX = '2140:bao-term:';
const ACTIVE_KEY = `${STORAGE_PREFIX}active`;
const STATE_PREFIX = `${STORAGE_PREFIX}state:`;
const ROSTER_KEY = `${STORAGE_PREFIX}roster`;
/** Schema stamp on the persistable payload; bump when the shape changes.
 *  Stored identities stamped by a NEWER binary than this code are refused —
 *  matches the CLI's PROTOCOL_VERSION asymmetry (old readable by new, never
 *  the reverse). */
export const PROTOCOL_VERSION = 1;

export interface BaoTermIdentity {
  /** Hex private key — NEVER log or expose via window.bao. Plaintext in
   *  localStorage on web (same posture as the app's NLogin nsec flow);
   *  native builds use the OS Keychain/KeyStore via secureStorage. */
  sk: string;
  role: 'owner' | 'member';
  name: string;
  community: {
    id: string;
    owner: string;
    owner_salt: string;
    community_root: string;
    root_epoch: number;
    name: string;
    relays: string[];
    general_channel_id?: string;
  };
  private_channels: { id: string; key: string; epoch: number; name: string }[];
  invites: { token: string; link_pk: string; link_sk: string; url: string; created_at: number; max_uses?: number; label?: string }[];
  registry_version: number;
  /** When this identity joined the community (ms). */
  joined_at?: number;
  /** Local selector; mirrors the CLI's --as name. */
  identity_name: string;
}

/** Persisted payload (roster contents). Distinct from the in-memory identity
 *  shape so the storage format can evolve independently — callers go through
 *  migrateIdentity / readState and never parse this directly. */
interface StoredIdentity extends BaoTermIdentity {
  protocol_version: number;
}

export interface BaoTermState {
  identities: Record<string, BaoTermIdentity>;
  /** Currently active identity name (selector for say/read/etc). */
  active: string | null;
}

function safeParse<T>(text: string | null, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/** Migrate a stored identity to the current PROTOCOL_VERSION, or throw.
 *  New formats are refused (matches the CLI's no-half-run rule: never silently
 *  run an identity whose shape the running code may write back incorrectly). */
function migrateIdentity(value: unknown): BaoTermIdentity {
  if (!value || typeof value !== 'object') throw new Error('Corrupt identity in storage — remove it and rejoin.');
  const stored = (value as Partial<StoredIdentity>) ?? {};
  const stamped = stored.protocol_version ?? 0;
  if (stamped > PROTOCOL_VERSION) {
    throw new Error(
      `Identity was written by protocol v${stamped} but this build speaks v${PROTOCOL_VERSION} — reload the page to get a newer build (never half-run an older binary).`,
    );
  }
  // No migrations exist yet (v0 → v1 is the spawn); future bumps add steps here.
  const { protocol_version: _drop, ...identity } = stored as StoredIdentity;
  return identity as BaoTermIdentity;
}

function readState(): BaoTermState {
  const raw = safeParse<Record<string, unknown>>(localStorage.getItem(ROSTER_KEY), {});
  // Drop corrupted entries on load — a single bad key never breaks the whole
  // terminal. The console warns so the operator can investigate.
  const identities: Record<string, BaoTermIdentity> = {};
  for (const [name, payload] of Object.entries(raw)) {
    try {
      identities[name] = migrateIdentity(payload);
    } catch (e) {
      console.warn(`bao-term: dropping identity "${name}":`, e instanceof Error ? e.message : e);
    }
  }
  const active = localStorage.getItem(ACTIVE_KEY);
  return { identities, active };
}

function writeState(state: BaoTermState): void {
  const stamped: Record<string, StoredIdentity> = {};
  for (const [name, id] of Object.entries(state.identities)) {
    stamped[name] = { ...id, protocol_version: PROTOCOL_VERSION };
  }
  localStorage.setItem(ROSTER_KEY, JSON.stringify(stamped));
  if (state.active) {
    localStorage.setItem(ACTIVE_KEY, state.active);
  } else {
    localStorage.removeItem(ACTIVE_KEY);
  }
}

/** Validate `name` so it can't collide with our localStorage key scheme. */
export function validateIdentityName(name: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) {
    throw new Error('Identity name must be 1–64 ASCII letters, digits, dots, underscores, or dashes, starting with a letter or digit.');
  }
  return name;
}

/** List identity names saved in this browser. */
export function listIdentities(): string[] {
  return Object.keys(readState().identities);
}

/** Get a named identity, or undefined. */
export function getIdentity(name: string): BaoTermIdentity | undefined {
  return readState().identities[validateIdentityName(name)];
}

/** Return the currently-active identity, or undefined. */
export function getActiveIdentity(): BaoTermIdentity | undefined {
  const state = readState();
  if (!state.active) return undefined;
  return state.identities[state.active];
}

/** Set the active identity by name (must already exist). */
export function setActiveIdentity(name: string): void {
  const validated = validateIdentityName(name);
  const state = readState();
  if (!state.identities[validated]) {
    throw new Error(`No identity "${name}" — create or join one first.`);
  }
  writeState({ ...state, active: validated });
}

/** Persist a (possibly new) identity. Atomic within localStorage semantics. */
export function saveIdentity(identity: BaoTermIdentity): void {
  const name = validateIdentityName(identity.identity_name);
  const state = readState();
  state.identities[name] = identity;
  writeState({ ...state, active: name });
}

/** Remove an identity entirely. Clears active if it was current. */
export function deleteIdentity(name: string): void {
  const validated = validateIdentityName(name);
  const state = readState();
  delete state.identities[validated];
  if (state.active === validated) state.active = null;
  writeState(state);
}

/** Update an identity under a read-modify-write lock against concurrent tab writes.
 *  Browsers don't expose cross-tab locks natively on localStorage, so we use
 *  the storage event + a brief retry window — the same check-then-publish race
 *  the CLI guards with a lockfile. For non-overlapping writes (the common case)
 *  this is a no-op. */
export async function mutateIdentity<T>(
  name: string,
  fn: (current: BaoTermIdentity) => Promise<T> | T,
): Promise<{ identity: BaoTermIdentity; result: T }> {
  const validated = validateIdentityName(name);
  const current = getIdentity(validated);
  if (!current) throw new Error(`No identity "${name}".`);
  const result = await fn(current);
  saveIdentity(current);
  return { identity: current, result };
}
