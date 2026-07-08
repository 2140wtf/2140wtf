/**
 * Local persistence for 2140.wtf group chat state.
 *
 * Group metadata is stored in localStorage. Secrets (rootSecret / exporterSecret)
 * are routed through the platform-aware secureStorage adapter, which on native
 * uses the iOS Keychain / Android Keystore and falls back to localStorage on web.
 *
 * All storage is scoped by the current user's pubkey so multiple accounts on
 * the same device do not share group state.
 */

import { secureStorage } from './secureStorage';

const STORAGE_PREFIX = 'app:groups:';
const SECRETS_KEY_PREFIX = `${STORAGE_PREFIX}secrets:`;
const MAX_MESSAGES_PER_GROUP = 500;

export interface StoredMessage {
  id: string;
  nostrGroupId: string;
  senderPubkey: string;
  content: string;
  timestamp: number;
  isOwn: boolean;
  epoch: number;
  eventId: string;
}

export interface StoredGroup {
  nostrGroupId: string;
  name: string;
  description?: string;
  adminPubkeys: string[];
  members: string[];
  relays: string[];
  epoch: number;
  bannedPubkeys: string[];
  createdAt: number;
  lastActivity: number;
}

export interface StoredGroupSecrets {
  exporterSecret: string;
  rootSecret?: string;
  /** Map of epoch -> rootSecret for epochs the member has received via Welcome. */
  epochRootSecrets?: Record<number, string>;
}

function key(userPubkey: string, ...parts: string[]): string {
  return `${STORAGE_PREFIX}${userPubkey}:${parts.join(':')}`;
}

function secretsKey(userPubkey: string, nostrGroupId: string): string {
  return `${SECRETS_KEY_PREFIX}${userPubkey}:${nostrGroupId}`;
}

function safeParse<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function isHex64(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

export function validateStoredGroup(g: unknown): StoredGroup | null {
  if (typeof g !== 'object' || g === null) return null;
  const group = g as Partial<StoredGroup> & Partial<StoredGroupSecrets>;
  if (
    typeof group.nostrGroupId !== 'string' ||
    typeof group.name !== 'string' ||
    typeof group.epoch !== 'number' ||
    typeof group.createdAt !== 'number' ||
    typeof group.lastActivity !== 'number'
  ) {
    return null;
  }
  const adminPubkeys = Array.isArray(group.adminPubkeys)
    ? group.adminPubkeys.filter((k): k is string => typeof k === 'string' && /^[0-9a-f]{64}$/.test(k))
    : [];
  const members = Array.isArray(group.members)
    ? group.members.filter((k): k is string => typeof k === 'string' && /^[0-9a-f]{64}$/.test(k))
    : [];
  const relays = Array.isArray(group.relays)
    ? group.relays.filter((r): r is string => typeof r === 'string' && /^wss?:\/\//.test(r))
    : [];
  const bannedPubkeys = Array.isArray(group.bannedPubkeys)
    ? group.bannedPubkeys.filter((k): k is string => typeof k === 'string' && /^[0-9a-f]{64}$/.test(k))
    : [];
  if (adminPubkeys.length === 0 || members.length === 0 || relays.length === 0) return null;
  return {
    nostrGroupId: group.nostrGroupId,
    name: group.name,
    description: typeof group.description === 'string' ? group.description : undefined,
    adminPubkeys,
    members,
    relays,
    epoch: group.epoch,
    bannedPubkeys,
    createdAt: group.createdAt,
    lastActivity: group.lastActivity,
  };
}

function validateStoredGroupSecrets(s: unknown): StoredGroupSecrets | null {
  if (typeof s !== 'object' || s === null) return null;
  const secrets = s as Partial<StoredGroupSecrets>;
  if (!isHex64(secrets.exporterSecret)) return null;
  if (secrets.rootSecret !== undefined && !isHex64(secrets.rootSecret)) return null;
  const epochRootSecrets: Record<number, string> = {};
  if (secrets.epochRootSecrets && typeof secrets.epochRootSecrets === 'object') {
    for (const [epoch, root] of Object.entries(secrets.epochRootSecrets)) {
      const epochNum = Number(epoch);
      if (Number.isFinite(epochNum) && isHex64(root)) {
        epochRootSecrets[epochNum] = root;
      }
    }
  }
  return {
    exporterSecret: secrets.exporterSecret,
    rootSecret: secrets.rootSecret,
    ...(Object.keys(epochRootSecrets).length > 0 ? { epochRootSecrets } : {}),
  };
}

export function migrateLegacyGroupStorage(userPubkey: string): void {
  const scopedPrefix = key(userPubkey, '');
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(STORAGE_PREFIX) && !k.startsWith(scopedPrefix) && !k.startsWith(SECRETS_KEY_PREFIX)) {
      keysToRemove.push(k);
    }
  }
  for (const k of keysToRemove) {
    localStorage.removeItem(k);
  }
}

export function loadGroups(userPubkey: string): StoredGroup[] {
  const index = safeParse<string[]>(localStorage.getItem(key(userPubkey, 'index')));
  if (!Array.isArray(index)) return [];

  const groups: StoredGroup[] = [];
  for (const id of index) {
    const g = safeParse<unknown>(localStorage.getItem(key(userPubkey, 'group', id)));
    const validated = g ? validateStoredGroup(g) : null;
    if (validated) {
      groups.push(validated);
    }
  }
  return groups;
}

export async function loadGroupSecrets(
  userPubkey: string,
  nostrGroupId: string,
): Promise<StoredGroupSecrets | null> {
  const raw = await secureStorage.getItem(secretsKey(userPubkey, nostrGroupId));
  if (!raw) return null;
  return validateStoredGroupSecrets(safeParse<unknown>(raw));
}

export async function saveGroupSecrets(
  userPubkey: string,
  nostrGroupId: string,
  secrets: StoredGroupSecrets,
): Promise<void> {
  await secureStorage.setItem(secretsKey(userPubkey, nostrGroupId), JSON.stringify(secrets));
}

export async function deleteGroupSecrets(userPubkey: string, nostrGroupId: string): Promise<void> {
  await secureStorage.removeItem(secretsKey(userPubkey, nostrGroupId));
}

/**
 * Migrate legacy secrets that were previously embedded in the StoredGroup object.
 * Returns the extracted secrets and updates localStorage to remove them.
 */
export function extractLegacyGroupSecrets(group: StoredGroup & Partial<StoredGroupSecrets>): StoredGroupSecrets | null {
  const legacy = group as unknown as Record<string, unknown>;
  if (isHex64(legacy.exporterSecret)) {
    return {
      exporterSecret: legacy.exporterSecret,
      rootSecret: isHex64(legacy.rootSecret) ? legacy.rootSecret : undefined,
    };
  }
  return null;
}

export function saveGroup(userPubkey: string, group: StoredGroup): void {
  const index = new Set(safeParse<string[]>(localStorage.getItem(key(userPubkey, 'index'))) ?? []);
  index.add(group.nostrGroupId);
  localStorage.setItem(key(userPubkey, 'index'), JSON.stringify([...index]));
  localStorage.setItem(key(userPubkey, 'group', group.nostrGroupId), JSON.stringify(group));
}

export function deleteGroup(userPubkey: string, nostrGroupId: string): void {
  const index = new Set(safeParse<string[]>(localStorage.getItem(key(userPubkey, 'index'))) ?? []);
  index.delete(nostrGroupId);
  localStorage.setItem(key(userPubkey, 'index'), JSON.stringify([...index]));
  localStorage.removeItem(key(userPubkey, 'group', nostrGroupId));
  localStorage.removeItem(key(userPubkey, 'messages', nostrGroupId));
}

export function loadMessages(userPubkey: string, nostrGroupId: string): StoredMessage[] {
  return safeParse<StoredMessage[]>(localStorage.getItem(key(userPubkey, 'messages', nostrGroupId))) ?? [];
}

export function saveMessages(userPubkey: string, nostrGroupId: string, messages: StoredMessage[]): void {
  const trimmed = messages.slice(-MAX_MESSAGES_PER_GROUP);
  localStorage.setItem(key(userPubkey, 'messages', nostrGroupId), JSON.stringify(trimmed));
}

export function appendMessage(userPubkey: string, nostrGroupId: string, message: StoredMessage): void {
  const messages = loadMessages(userPubkey, nostrGroupId);
  messages.push(message);
  saveMessages(userPubkey, nostrGroupId, messages);
}

export async function clearAllGroupStorage(userPubkey: string): Promise<void> {
  const prefix = key(userPubkey, '');
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(prefix) || k?.startsWith(SECRETS_KEY_PREFIX + userPubkey + ':')) keys.push(k);
  }
  for (const k of keys) {
    localStorage.removeItem(k);
  }
}
