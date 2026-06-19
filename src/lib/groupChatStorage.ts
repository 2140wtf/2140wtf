/**
 * Local persistence for Ditto group chat state.
 *
 * SECURITY NOTE: group root secrets are stored in localStorage plaintext.
 * This is consistent with Ditto's existing threat model where the user's nsec
 * is also stored in localStorage. A future hardening step can encrypt storage
 * with a PIN-derived AES-GCM key (see Bao's secureGroupKeyStorage.ts).
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

function key(...parts: string[]): string {
  return `${STORAGE_PREFIX}${parts.join(':')}`;
}

function safeParse<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function loadGroups(): StoredGroup[] {
  const index = safeParse<string[]>(localStorage.getItem(key('index')));
  if (!Array.isArray(index)) return [];

  const groups: StoredGroup[] = [];
  for (const id of index) {
    const g = safeParse<StoredGroup>(localStorage.getItem(key('group', id)));
    if (g) groups.push(g);
  }
  return groups;
}

export function saveGroup(group: StoredGroup): void {
  const index = new Set(safeParse<string[]>(localStorage.getItem(key('index'))) ?? []);
  index.add(group.nostrGroupId);
  localStorage.setItem(key('index'), JSON.stringify([...index]));
  localStorage.setItem(key('group', group.nostrGroupId), JSON.stringify(group));
}

export function deleteGroup(nostrGroupId: string): void {
  const index = new Set(safeParse<string[]>(localStorage.getItem(key('index'))) ?? []);
  index.delete(nostrGroupId);
  localStorage.setItem(key('index'), JSON.stringify([...index]));
  localStorage.removeItem(key('group', nostrGroupId));
  localStorage.removeItem(key('messages', nostrGroupId));
}

export function loadMessages(nostrGroupId: string): StoredMessage[] {
  return safeParse<StoredMessage[]>(localStorage.getItem(key('messages', nostrGroupId))) ?? [];
}

export function saveMessages(nostrGroupId: string, messages: StoredMessage[]): void {
  const trimmed = messages.slice(-MAX_MESSAGES_PER_GROUP);
  localStorage.setItem(key('messages', nostrGroupId), JSON.stringify(trimmed));
}

export function appendMessage(nostrGroupId: string, message: StoredMessage): void {
  const messages = loadMessages(nostrGroupId);
  messages.push(message);
  saveMessages(nostrGroupId, messages);
}

export function clearAllGroupStorage(): void {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(STORAGE_PREFIX)) keys.push(k);
  }
  for (const k of keys) {
    localStorage.removeItem(k);
  }
}
