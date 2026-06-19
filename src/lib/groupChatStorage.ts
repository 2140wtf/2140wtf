/**
 * Local persistence for Ditto group chat state.
 *
 * SECURITY NOTE: group root secrets are stored in localStorage plaintext.
 * This is consistent with Ditto's existing threat model where the user's nsec
 * is also stored in localStorage. A future hardening step can encrypt storage
 * with a PIN-derived AES-GCM key (see Bao's secureGroupKeyStorage.ts).
 *
 * All storage is scoped by the current user's pubkey so multiple accounts on
 * the same device do not share group state.
 */

const STORAGE_PREFIX = 'ditto:groups:';
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
  exporterSecret: string;
  rootSecret?: string;
  bannedPubkeys: string[];
  createdAt: number;
  lastActivity: number;
}

function key(userPubkey: string, ...parts: string[]): string {
  return `${STORAGE_PREFIX}${userPubkey}:${parts.join(':')}`;
}

function safeParse<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function loadGroups(userPubkey: string): StoredGroup[] {
  const index = safeParse<string[]>(localStorage.getItem(key(userPubkey, 'index')));
  if (!Array.isArray(index)) return [];

  const groups: StoredGroup[] = [];
  for (const id of index) {
    const g = safeParse<StoredGroup>(localStorage.getItem(key(userPubkey, 'group', id)));
    if (g) {
      g.adminPubkeys ??= [];
      g.members ??= [];
      g.relays ??= [];
      g.bannedPubkeys ??= [];
      groups.push(g);
    }
  }
  return groups;
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

export function clearAllGroupStorage(userPubkey: string): void {
  const prefix = key(userPubkey, '');
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(prefix)) keys.push(k);
  }
  for (const k of keys) {
    localStorage.removeItem(k);
  }
}
