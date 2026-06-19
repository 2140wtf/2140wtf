/**
 * Ditto Group Chat Service
 *
 * End-to-end encrypted group chat using NIP-104 event kinds with a
 * Group Ratchet fallback (no Rust MLS backend required).
 */

import { nip19, verifyEvent, getPublicKey } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';

import {
  generateRootSecret,
  deriveEpochSecret,
} from './groupRatchet';
import {
  KIND_GROUP,
  createWelcomeEvent,
  wrapWelcomeEvent,
  unwrapWelcomeEvent,
  createApplicationMessage,
  parseApplicationMessage,
  createGroupEvent,
  decryptGroupEvent,
  parseNostrGroupDataExtension,
  createNostrGroupDataExtension,
  isValidGroupId,
  type NostrGroupData,
} from './nip104Protocol';
import {
  loadGroups,
  loadMessages,
  saveGroup,
  saveGroupSecrets,
  loadGroupSecrets,
  saveMessages,
  deleteGroup,
  deleteGroupSecrets,
  migrateLegacyGroupStorage,
  extractLegacyGroupSecrets,
  type StoredGroup,
  type StoredMessage,
  type StoredGroupSecrets,
} from './groupChatStorage';
import { isNostrId } from './nostrId';

const MAX_GROUP_NAME_LENGTH = 64;
const MAX_GROUP_DESCRIPTION_LENGTH = 256;
const MAX_MESSAGE_LENGTH = 4000;
const MAX_MEMBERS = 500;
const MAX_GROUP_EVENT_CONTENT_LENGTH = 64 * 1024;
const MAX_CLOCK_SKEW_SECONDS = 300;

export interface GroupChatGroup {
  nostrGroupId: string;
  name: string;
  description?: string;
  adminPubkeys: string[];
  members: string[];
  relays: string[];
  epoch: number;
  createdAt: number;
  lastActivity: number;
}

export interface GroupChatMessage {
  id: string;
  nostrGroupId: string;
  senderPubkey: string;
  content: string;
  timestamp: number;
  isOwn: boolean;
  epoch: number;
}

export interface GroupChatMember {
  pubkey: string;
  role: 'admin' | 'member';
}

export interface GroupOperationResult<T = void> {
  success: boolean;
  data?: T;
  events?: NostrEvent[];
  error?: string;
}

function normalizePubkeyInput(key: string): string | null {
  const trimmed = key.trim();
  if (!trimmed) return null;
  try {
    if (trimmed.startsWith('npub1')) {
      const decoded = nip19.decode(trimmed);
      if (decoded.type === 'npub') {
        return (decoded.data as string).toLowerCase();
      }
      return null;
    }
    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
      return trimmed.toLowerCase();
    }
    return null;
  } catch {
    return null;
  }
}

function normalizeMember(key: string): string | null {
  const hex = normalizePubkeyInput(key);
  return hex && isNostrId(hex) ? hex : null;
}

function isStringArrayArray(value: unknown): value is string[][] {
  return (
    Array.isArray(value) && value.every((item) => Array.isArray(item) && item.every((x) => typeof x === 'string'))
  );
}

function getTag(tags: string[][], name: string): string | undefined {
  if (!isStringArrayArray(tags)) return undefined;
  return tags.find(([n]) => n === name)?.[1];
}

function hasValidEventShape(event: NostrEvent): boolean {
  return (
    typeof event.id === 'string' &&
    typeof event.pubkey === 'string' &&
    typeof event.sig === 'string' &&
    typeof event.kind === 'number' &&
    typeof event.created_at === 'number' &&
    isStringArrayArray(event.tags)
  );
}

function secureRandomHex(length: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(length)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}

function generateGroupId(): string {
  return `ditto-grp-${secureRandomHex(8)}-${Date.now().toString(36)}-${secureRandomHex(4)}`;
}

function validateGroupId(id: unknown): string | null {
  return isValidGroupId(id) ? id : null;
}

function toGroupChatGroup(stored: StoredGroup): GroupChatGroup {
  return {
    nostrGroupId: stored.nostrGroupId,
    name: stored.name,
    description: stored.description,
    adminPubkeys: stored.adminPubkeys,
    members: stored.members,
    relays: stored.relays,
    epoch: stored.epoch,
    createdAt: stored.createdAt,
    lastActivity: stored.lastActivity,
  };
}

function toGroupChatMessage(stored: StoredMessage): GroupChatMessage {
  return {
    id: stored.id,
    nostrGroupId: stored.nostrGroupId,
    senderPubkey: stored.senderPubkey,
    content: stored.content,
    timestamp: stored.timestamp,
    isOwn: stored.isOwn,
    epoch: stored.epoch,
  };
}

function metadataFromWelcome(wd: Record<string, unknown>): NostrGroupData | null {
  const metadataJson = typeof wd.metadata === 'string' ? wd.metadata : undefined;
  return metadataJson ? parseNostrGroupDataExtension(metadataJson) : null;
}

export class GroupChatService {
  private userPubkey: string;
  private userPrivkey: Uint8Array;
  private defaultRelays: string[];

  private groups: Map<string, StoredGroup> = new Map();
  private messages: Map<string, StoredMessage[]> = new Map();
  private groupStates: Map<string, StoredGroupSecrets> = new Map();
  private mutationLocks: Map<string, Promise<unknown>> = new Map();
  private pendingWelcomes: Map<string, Map<number, { welcomeEvent: NostrEvent; wd: Record<string, unknown> }>> = new Map();
  private pendingGroupEvents: Map<string, NostrEvent[]> = new Map();
  private epochSecretCache: Map<string, Map<number, string>> = new Map();
  private loadStatePromise: Promise<void>;

  constructor(userPubkey: string, userPrivkey: Uint8Array, defaultRelays: string[] = []) {
    this.userPubkey = userPubkey.toLowerCase();

    const derivedPubkey = getPublicKey(userPrivkey).toLowerCase();
    if (derivedPubkey !== this.userPubkey) {
      throw new Error('Provided private key does not match the user pubkey');
    }

    this.userPrivkey = userPrivkey;
    this.defaultRelays = defaultRelays.filter((r) => /^wss?:\/\//.test(r));

    this.loadStateMetadata();
    this.loadStatePromise = this.loadSecretsAsync();
  }

  private loadStateMetadata(): void {
    migrateLegacyGroupStorage(this.userPubkey);
    const groups = loadGroups(this.userPubkey);
    for (const g of groups) {
      this.groups.set(g.nostrGroupId, g);
      this.messages.set(g.nostrGroupId, loadMessages(this.userPubkey, g.nostrGroupId));
    }
  }

  private async ensureLoaded(): Promise<void> {
    return this.loadStatePromise;
  }

  private async loadSecretsAsync(): Promise<void> {
    for (const [groupId, group] of this.groups) {
      const legacySecrets = extractLegacyGroupSecrets(group as StoredGroup & Partial<StoredGroupSecrets>);
      const secrets = (await loadGroupSecrets(this.userPubkey, groupId)) ?? legacySecrets;
      if (secrets) {
        this.groupStates.set(groupId, secrets);
        if (legacySecrets) {
          // Migrate legacy inline secrets to secure storage and strip from metadata.
          await saveGroupSecrets(this.userPubkey, groupId, legacySecrets);
          saveGroup(this.userPubkey, group);
        }
      }
    }
  }

  private withGroupLock<T>(groupId: string, fn: () => Promise<T>): Promise<T> {
    const next = (this.mutationLocks.get(groupId) ?? Promise.resolve()).then(
      () => fn(),
      () => fn(),
    );
    this.mutationLocks.set(groupId, next);
    return next;
  }

  private async persistGroup(group: StoredGroup): Promise<void> {
    this.groups.set(group.nostrGroupId, group);
    saveGroup(this.userPubkey, group);
    const secrets = this.groupStates.get(group.nostrGroupId);
    if (secrets) {
      await saveGroupSecrets(this.userPubkey, group.nostrGroupId, secrets);
    }
  }

  private persistMessages(groupId: string): void {
    const msgs = this.messages.get(groupId) ?? [];
    saveMessages(this.userPubkey, groupId, msgs);
  }

  private getExporterSecret(groupId: string): string | undefined {
    return this.groupStates.get(groupId)?.exporterSecret;
  }

  private getRootSecret(groupId: string): string | undefined {
    return this.groupStates.get(groupId)?.rootSecret;
  }

  private async getExporterSecretForEpoch(groupId: string, epoch: number): Promise<string | undefined> {
    const group = this.groups.get(groupId);
    const secrets = this.groupStates.get(groupId);
    if (!group || !secrets) return undefined;

    if (epoch === group.epoch) {
      return secrets.exporterSecret;
    }

    const cached = this.epochSecretCache.get(groupId)?.get(epoch);
    if (cached) return cached;

    if (secrets.rootSecret) {
      try {
        const derived = await deriveEpochSecret(secrets.rootSecret, epoch, groupId);
        let groupCache = this.epochSecretCache.get(groupId);
        if (!groupCache) {
          groupCache = new Map();
          this.epochSecretCache.set(groupId, groupCache);
        }
        groupCache.set(epoch, derived);
        return derived;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  private async setSecrets(groupId: string, exporterSecret: string, rootSecret?: string): Promise<void> {
    const secrets: StoredGroupSecrets = { exporterSecret, rootSecret };
    this.groupStates.set(groupId, secrets);
    await saveGroupSecrets(this.userPubkey, groupId, secrets);
  }

  private isAdmin(group: StoredGroup): boolean {
    return group.adminPubkeys.some((a) => a === this.userPubkey);
  }

  private isMember(group: StoredGroup): boolean {
    return group.members.some((m) => m === this.userPubkey);
  }

  private isBanned(group: StoredGroup, pubkey: string): boolean {
    return group.bannedPubkeys.some((b) => b === pubkey);
  }

  getGroups(): GroupChatGroup[] {
    return Array.from(this.groups.values())
      .map(toGroupChatGroup)
      .sort((a, b) => b.lastActivity - a.lastActivity);
  }

  getGroup(groupId: string): GroupChatGroup | undefined {
    const group = this.groups.get(groupId);
    return group ? toGroupChatGroup(group) : undefined;
  }

  getMessages(groupId: string): GroupChatMessage[] {
    return (this.messages.get(groupId) ?? [])
      .map(toGroupChatMessage)
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  getMembers(groupId: string): GroupChatMember[] {
    const group = this.groups.get(groupId);
    if (!group) return [];
    return group.members.map((pubkey) => ({
      pubkey,
      role: group.adminPubkeys.some((a) => a === pubkey) ? 'admin' : 'member',
    }));
  }

  async createGroup(
    name: string,
    description?: string,
    relays?: string[],
  ): Promise<GroupOperationResult<GroupChatGroup>> {
    await this.ensureLoaded();
    const trimmedName = name.trim().slice(0, MAX_GROUP_NAME_LENGTH);
    if (!trimmedName) {
      return { success: false, error: 'Group name is required' };
    }

    const nostrGroupId = generateGroupId();
    const rootSecret = generateRootSecret();
    const exporterSecret = await deriveEpochSecret(rootSecret, 0, nostrGroupId);

    const providedRelays = relays?.filter((r) => typeof r === 'string' && /^wss?:\/\//.test(r));
    const groupRelays = providedRelays && providedRelays.length > 0 ? providedRelays : this.defaultRelays;
    if (groupRelays.length === 0) {
      return { success: false, error: 'No relays configured for the group' };
    }

    const metadata: NostrGroupData = {
      nostrGroupId,
      name: trimmedName,
      description: description?.trim().slice(0, MAX_GROUP_DESCRIPTION_LENGTH),
      adminPubkeys: [this.userPubkey],
      relays: groupRelays,
    };

    const stored: StoredGroup = {
      nostrGroupId,
      name: trimmedName,
      description: metadata.description,
      adminPubkeys: [this.userPubkey],
      members: [this.userPubkey],
      relays: groupRelays,
      epoch: 0,
      bannedPubkeys: [],
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };

    await this.setSecrets(nostrGroupId, exporterSecret, rootSecret);
    await this.persistGroup(stored);
    this.messages.set(nostrGroupId, []);

    return { success: true, data: toGroupChatGroup(stored) };
  }

  async sendMessage(
    groupId: string,
    content: string,
  ): Promise<GroupOperationResult<GroupChatMessage>> {
    await this.ensureLoaded();
    const group = this.groups.get(groupId);
    if (!group) {
      return { success: false, error: 'Group not found' };
    }
    if (!this.isMember(group)) {
      return { success: false, error: 'You are not a member of this group' };
    }

    const trimmed = content.trim();
    if (!trimmed) {
      return { success: false, error: 'Message is empty' };
    }
    if (trimmed.length > MAX_MESSAGE_LENGTH) {
      return { success: false, error: `Message too long (max ${MAX_MESSAGE_LENGTH} chars)` };
    }

    const exporterSecret = this.getExporterSecret(groupId);
    if (!exporterSecret) {
      return { success: false, error: 'Group encryption state missing' };
    }

    const appMessage = createApplicationMessage(this.userPubkey, this.userPrivkey, trimmed, groupId, group.epoch);
    const groupEvent = await createGroupEvent(groupId, appMessage, exporterSecret, group.epoch);

    let appTimestampMs: number;
    try {
      const parsed = JSON.parse(appMessage) as { created_at?: number };
      appTimestampMs = (parsed.created_at ?? Math.floor(Date.now() / 1000)) * 1000;
    } catch {
      appTimestampMs = Date.now();
    }

    const message: StoredMessage = {
      id: groupEvent.id ?? secureRandomHex(16),
      nostrGroupId: groupId,
      senderPubkey: this.userPubkey,
      content: trimmed,
      timestamp: appTimestampMs,
      isOwn: true,
      epoch: group.epoch,
      eventId: groupEvent.id ?? '',
    };

    const groupMessages = this.messages.get(groupId) ?? [];
    groupMessages.push(message);
    this.messages.set(groupId, groupMessages);
    this.persistMessages(groupId);

    group.lastActivity = Date.now();
    this.persistGroup(group);

    return { success: true, data: toGroupChatMessage(message), events: [groupEvent] };
  }

  async processGroupEvent(event: NostrEvent): Promise<GroupOperationResult<GroupChatMessage>> {
    await this.ensureLoaded();
    if (event.kind !== KIND_GROUP) {
      return { success: false, error: 'Not a group event' };
    }

    if (!hasValidEventShape(event)) {
      return { success: false, error: 'Malformed event shape' };
    }

    if (typeof event.content === 'string' && event.content.length > MAX_GROUP_EVENT_CONTENT_LENGTH) {
      return { success: false, error: 'Group event content too large' };
    }

    let sigValid = false;
    try {
      sigValid = verifyEvent(event as Parameters<typeof verifyEvent>[0]);
    } catch {
      sigValid = false;
    }
    if (!sigValid) {
      return { success: false, error: 'Invalid event signature' };
    }

    const hTag = getTag(event.tags, 'h');
    const groupId = validateGroupId(hTag);
    if (!groupId) {
      return { success: false, error: 'Missing or invalid group id' };
    }

    const group = this.groups.get(groupId);
    if (!group) {
      return { success: false, error: 'Group not found' };
    }
    if (!this.isMember(group)) {
      return { success: false, error: 'Not a member' };
    }

    const eventEpochRaw = getTag(event.tags, 'epoch');
    const eventEpoch = typeof eventEpochRaw === 'string' ? Number.parseInt(eventEpochRaw, 10) : group.epoch;
    if (!Number.isFinite(eventEpoch) || eventEpoch < 0) {
      return { success: false, error: 'Invalid epoch tag' };
    }

    if (eventEpoch > group.epoch) {
      // We don't have the secret for this epoch yet; buffer for later.
      const pending = this.pendingGroupEvents.get(groupId) ?? [];
      if (!pending.some((e) => e.id === event.id)) {
        pending.push(event);
        this.pendingGroupEvents.set(groupId, pending);
      }
      return { success: false, error: 'Future epoch message buffered' };
    }

    const exporterSecret = await this.getExporterSecretForEpoch(groupId, eventEpoch);
    if (!exporterSecret) {
      return { success: false, error: 'Missing group encryption state for epoch' };
    }

    const decryptedJson = await decryptGroupEvent(event, exporterSecret);
    if (!decryptedJson) {
      return { success: false, error: 'Failed to decrypt message' };
    }

    const appMessage = parseApplicationMessage(decryptedJson);
    if (!appMessage) {
      return { success: false, error: 'Invalid application message' };
    }

    if (appMessage.content.length > MAX_MESSAGE_LENGTH) {
      return { success: false, error: 'Application message too long' };
    }

    if (!group.members.some((m) => m === appMessage.senderPubkey)) {
      return { success: false, error: 'Sender is not a group member' };
    }
    if (this.isBanned(group, appMessage.senderPubkey)) {
      return { success: false, error: 'Sender is banned from this group' };
    }

    const appGroupId = getTag(appMessage.tags ?? [], 'h');
    if (appGroupId !== groupId) {
      return { success: false, error: 'Application message is for a different group' };
    }

    const appEpochRaw = getTag(appMessage.tags ?? [], 'epoch');
    if (appEpochRaw !== undefined) {
      const appEpoch = Number.parseInt(appEpochRaw, 10);
      if (Number.isFinite(appEpoch) && appEpoch !== eventEpoch) {
        return { success: false, error: 'Application message epoch mismatch' };
      }
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (
      appMessage.createdAt > nowSeconds + MAX_CLOCK_SKEW_SECONDS ||
      event.created_at > nowSeconds + MAX_CLOCK_SKEW_SECONDS
    ) {
      return { success: false, error: 'Event timestamp is too far in the future' };
    }

    const message: StoredMessage = {
      id: appMessage.id,
      nostrGroupId: groupId,
      senderPubkey: appMessage.senderPubkey,
      content: appMessage.content,
      timestamp: appMessage.createdAt * 1000,
      isOwn: appMessage.senderPubkey === this.userPubkey,
      epoch: eventEpoch,
      eventId: event.id,
    };

    const groupMessages = this.messages.get(groupId) ?? [];
    if (!groupMessages.some((m) => m.id === message.id || m.eventId === message.eventId)) {
      groupMessages.push(message);
      this.messages.set(groupId, groupMessages);
      this.persistMessages(groupId);

      group.lastActivity = Date.now();
      await this.persistGroup(group);
    }

    return { success: true, data: toGroupChatMessage(message) };
  }

  private async processPendingGroupEvents(groupId: string): Promise<void> {
    const pending = this.pendingGroupEvents.get(groupId) ?? [];
    if (pending.length === 0) return;

    const group = this.groups.get(groupId);
    if (!group) return;

    const remaining: NostrEvent[] = [];
    for (const event of pending) {
      const eventEpochRaw = getTag(event.tags, 'epoch');
      const eventEpoch = typeof eventEpochRaw === 'string' ? Number.parseInt(eventEpochRaw, 10) : group.epoch;
      if (Number.isFinite(eventEpoch) && eventEpoch <= group.epoch) {
        await this.processGroupEvent(event);
      } else {
        remaining.push(event);
      }
    }
    this.pendingGroupEvents.set(groupId, remaining);
  }

  async addMember(groupId: string, pubkeyInput: string): Promise<GroupOperationResult> {
    return this.withGroupLock(groupId, () => this.addMemberLocked(groupId, pubkeyInput));
  }

  private async addMemberLocked(groupId: string, pubkeyInput: string): Promise<GroupOperationResult> {
    await this.ensureLoaded();
    const group = this.groups.get(groupId);
    if (!group) {
      return { success: false, error: 'Group not found' };
    }
    if (!this.isAdmin(group)) {
      return { success: false, error: 'Only admins can invite members' };
    }

    const memberPubkey = normalizeMember(pubkeyInput);
    if (!memberPubkey) {
      return { success: false, error: 'Invalid pubkey' };
    }
    if (memberPubkey === this.userPubkey) {
      return { success: false, error: 'You are already a member' };
    }
    if (this.isBanned(group, memberPubkey)) {
      return { success: false, error: 'This user is banned from the group' };
    }
    if (group.members.some((m) => m === memberPubkey)) {
      return { success: false, error: 'Member already in group' };
    }
    if (group.members.length >= MAX_MEMBERS) {
      return { success: false, error: `Group has reached the maximum member limit (${MAX_MEMBERS})` };
    }

    const oldRootSecret = this.getRootSecret(groupId);
    const oldExporterSecret = this.getExporterSecret(groupId);
    if (!oldRootSecret || !oldExporterSecret) {
      return { success: false, error: 'Missing group encryption state' };
    }

    const newEpoch = group.epoch + 1;
    const newRootSecret = generateRootSecret();
    const newExporterSecret = await deriveEpochSecret(newRootSecret, newEpoch, groupId);

    group.members.push(memberPubkey);
    group.epoch = newEpoch;
    group.lastActivity = Date.now();
    await this.setSecrets(groupId, newExporterSecret, newRootSecret);

    const metadata = createNostrGroupDataExtension({
      nostrGroupId: groupId,
      name: group.name,
      description: group.description,
      adminPubkeys: group.adminPubkeys,
      relays: group.relays,
    });

    const events: NostrEvent[] = [];
    let failedCount = 0;
    for (const target of group.members) {
      if (target === this.userPubkey) continue;
      try {
        const welcomePayload = JSON.stringify({
          groupId,
          epoch: newEpoch,
          type: 'member_add',
          rootSecret: newRootSecret,
          exporterSecret: newExporterSecret,
          members: group.members,
          metadata,
        });
        const welcomeEvent = createWelcomeEvent(
          this.userPrivkey,
          welcomePayload,
          'placeholder',
          group.relays,
          newEpoch,
        );
        const giftWrap = await wrapWelcomeEvent(welcomeEvent, target);
        events.push(giftWrap);
      } catch (err) {
        failedCount++;
        console.error(`Failed to wrap add-member Welcome for ${target.slice(0, 8)}...`, err);
      }
    }

    await this.persistGroup(group);

    return { success: true, events, ...(failedCount > 0 ? { error: `${failedCount} welcome(s) failed to wrap` } : {}) };
  }

  async removeMember(groupId: string, pubkeyInput: string): Promise<GroupOperationResult> {
    return this.withGroupLock(groupId, () => this.removeOrBanMemberLocked(groupId, pubkeyInput, false));
  }

  async banMember(groupId: string, pubkeyInput: string): Promise<GroupOperationResult> {
    return this.withGroupLock(groupId, () => this.removeOrBanMemberLocked(groupId, pubkeyInput, true));
  }

  private async removeOrBanMemberLocked(
    groupId: string,
    pubkeyInput: string,
    ban: boolean,
  ): Promise<GroupOperationResult> {
    await this.ensureLoaded();
    const group = this.groups.get(groupId);
    if (!group) {
      return { success: false, error: 'Group not found' };
    }
    if (!this.isAdmin(group)) {
      return { success: false, error: 'Only admins can remove members' };
    }

    const memberPubkey = normalizeMember(pubkeyInput);
    if (!memberPubkey) {
      return { success: false, error: 'Invalid pubkey' };
    }
    if (memberPubkey === this.userPubkey) {
      return { success: false, error: 'Use leave group to remove yourself' };
    }
    if (!group.members.some((m) => m === memberPubkey)) {
      return { success: false, error: 'Member not in group' };
    }

    const oldRootSecret = this.getRootSecret(groupId);
    if (!oldRootSecret) {
      return { success: false, error: 'Missing group root secret' };
    }

    const newRootSecret = generateRootSecret();
    const newEpoch = group.epoch + 1;
    const newExporterSecret = await deriveEpochSecret(newRootSecret, newEpoch, groupId);

    group.members = group.members.filter((m) => m !== memberPubkey);
    group.adminPubkeys = group.adminPubkeys.filter((a) => a !== memberPubkey);
    if (ban && !group.bannedPubkeys.includes(memberPubkey)) {
      group.bannedPubkeys.push(memberPubkey);
    }
    group.epoch = newEpoch;
    group.lastActivity = Date.now();

    await this.setSecrets(groupId, newExporterSecret, newRootSecret);

    const events: NostrEvent[] = [];
    let failedCount = 0;
    for (const remainingMember of group.members) {
      if (remainingMember === this.userPubkey) continue;
      try {
        const welcomePayload = JSON.stringify({
          groupId,
          epoch: newEpoch,
          type: 'key_rotation',
          rootSecret: newRootSecret,
          exporterSecret: newExporterSecret,
          members: group.members,
          metadata: createNostrGroupDataExtension({
            nostrGroupId: groupId,
            name: group.name,
            description: group.description,
            adminPubkeys: group.adminPubkeys,
            relays: group.relays,
          }),
        });
        const welcomeEvent = createWelcomeEvent(
          this.userPrivkey,
          welcomePayload,
          'placeholder',
          group.relays,
          newEpoch,
        );
        const giftWrap = await wrapWelcomeEvent(welcomeEvent, remainingMember);
        events.push(giftWrap);
      } catch (err) {
        failedCount++;
        console.error(`Failed to wrap rotation Welcome for ${remainingMember.slice(0, 8)}...`, err);
      }
    }

    await this.persistGroup(group);

    return { success: true, events, ...(failedCount > 0 ? { error: `${failedCount} welcome(s) failed to wrap` } : {}) };
  }

  async promoteAdmin(groupId: string, pubkeyInput: string): Promise<GroupOperationResult> {
    return this.withGroupLock(groupId, () => this.promoteAdminLocked(groupId, pubkeyInput));
  }

  private async promoteAdminLocked(groupId: string, pubkeyInput: string): Promise<GroupOperationResult> {
    await this.ensureLoaded();
    const group = this.groups.get(groupId);
    if (!group) {
      return { success: false, error: 'Group not found' };
    }
    if (!this.isAdmin(group)) {
      return { success: false, error: 'Only admins can promote members' };
    }

    const memberPubkey = normalizeMember(pubkeyInput);
    if (!memberPubkey) {
      return { success: false, error: 'Invalid pubkey' };
    }
    if (!group.members.some((m) => m === memberPubkey)) {
      return { success: false, error: 'User is not a member of this group' };
    }
    if (group.adminPubkeys.some((a) => a === memberPubkey)) {
      return { success: false, error: 'User is already an admin' };
    }

    const oldRootSecret = this.getRootSecret(groupId);
    if (!oldRootSecret) {
      return { success: false, error: 'Missing group root secret' };
    }

    const newEpoch = group.epoch + 1;
    const newRootSecret = generateRootSecret();
    const newExporterSecret = await deriveEpochSecret(newRootSecret, newEpoch, groupId);

    group.adminPubkeys.push(memberPubkey);
    group.epoch = newEpoch;
    group.lastActivity = Date.now();
    await this.setSecrets(groupId, newExporterSecret, newRootSecret);

    const metadata = createNostrGroupDataExtension({
      nostrGroupId: groupId,
      name: group.name,
      description: group.description,
      adminPubkeys: group.adminPubkeys,
      relays: group.relays,
    });

    const events: NostrEvent[] = [];
    let failedCount = 0;
    for (const target of group.members) {
      if (target === this.userPubkey) continue;
      try {
        const welcomePayload = JSON.stringify({
          groupId,
          epoch: newEpoch,
          type: 'admin_promotion',
          rootSecret: newRootSecret,
          exporterSecret: newExporterSecret,
          members: group.members,
          metadata,
        });
        const welcomeEvent = createWelcomeEvent(
          this.userPrivkey,
          welcomePayload,
          'placeholder',
          group.relays,
          newEpoch,
        );
        const giftWrap = await wrapWelcomeEvent(welcomeEvent, target);
        events.push(giftWrap);
      } catch (err) {
        failedCount++;
        console.error(`Failed to wrap promotion Welcome for ${target.slice(0, 8)}...`, err);
      }
    }

    await this.persistGroup(group);

    return { success: true, events, ...(failedCount > 0 ? { error: `${failedCount} welcome(s) failed to wrap` } : {}) };
  }

  async joinFromWelcome(giftWrapEvent: NostrEvent): Promise<GroupOperationResult<GroupChatGroup>> {
    const welcomeEvent = await unwrapWelcomeEvent(giftWrapEvent, this.userPrivkey);
    if (!welcomeEvent) {
      return { success: false, error: 'Failed to unwrap Welcome event' };
    }

    if (typeof welcomeEvent.content !== 'string' || welcomeEvent.content.length > 256 * 1024) {
      return { success: false, error: 'Invalid welcome event content' };
    }

    let welcomeData: unknown;
    try {
      welcomeData = JSON.parse(welcomeEvent.content) as unknown;
    } catch {
      return { success: false, error: 'Invalid welcome event JSON' };
    }
    if (typeof welcomeData !== 'object' || welcomeData === null) {
      return { success: false, error: 'Invalid welcome data' };
    }
    const wd = welcomeData as Record<string, unknown>;

    const groupId = validateGroupId(wd.groupId);
    if (!groupId) {
      return { success: false, error: 'Invalid group id in Welcome' };
    }

    return this.withGroupLock(groupId, () => this.joinFromWelcomeLocked(groupId, welcomeEvent, wd));
  }

  private async joinFromWelcomeLocked(
    groupId: string,
    welcomeEvent: NostrEvent,
    wd: Record<string, unknown>,
  ): Promise<GroupOperationResult<GroupChatGroup>> {
    await this.ensureLoaded();
    const welcomeEpoch = typeof wd.epoch === 'number' ? wd.epoch : 0;

    const existing = this.groups.get(groupId);
    if (existing && existing.bannedPubkeys.some((b) => b === this.userPubkey)) {
      return { success: false, error: 'You are banned from this group' };
    }
    if (existing && welcomeEpoch <= existing.epoch) {
      return { success: false, error: 'Welcome event is outdated' };
    }
    if (existing && !existing.adminPubkeys.some((a) => a === welcomeEvent.pubkey)) {
      return { success: false, error: 'Welcome not from a group admin' };
    }

    const welcomeEpochTag = getTag(welcomeEvent.tags, 'epoch');
    if (welcomeEpochTag !== undefined && Number.parseInt(welcomeEpochTag, 10) !== welcomeEpoch) {
      return { success: false, error: 'Welcome epoch tag mismatch' };
    }

    const metadataJson = typeof wd.metadata === 'string' ? wd.metadata : undefined;
    const metadata = metadataJson ? parseNostrGroupDataExtension(metadataJson) : null;
    if (!metadata) {
      return { success: false, error: 'Invalid group metadata in Welcome' };
    }
    if (!metadata.adminPubkeys.some((a) => a === welcomeEvent.pubkey)) {
      return { success: false, error: 'Welcome sender is not a group admin' };
    }

    // Buffer the Welcome and apply all contiguous epochs we now have.
    let pending = this.pendingWelcomes.get(groupId);
    if (!pending) {
      pending = new Map();
      this.pendingWelcomes.set(groupId, pending);
    }
    pending.set(welcomeEpoch, { welcomeEvent, wd });

    return this.applyPendingWelcomes(groupId);
  }

  private async applyPendingWelcomes(groupId: string): Promise<GroupOperationResult<GroupChatGroup>> {
    const pending = this.pendingWelcomes.get(groupId);
    if (!pending || pending.size === 0) {
      return { success: false, error: 'No pending Welcome events' };
    }

    let existing = this.groups.get(groupId);
    let lastResult: GroupOperationResult<GroupChatGroup> = { success: false, error: 'No Welcome applied' };

    while (true) {
      let nextEpoch: number;
      if (existing) {
        nextEpoch = existing.epoch + 1;
      } else {
        // For a brand-new member, start from the earliest Welcome we have.
        nextEpoch = Math.min(...pending.keys());
      }
      const entry = pending.get(nextEpoch);
      if (!entry) break;

      const { wd } = entry;
      pending.delete(nextEpoch);

      const epoch = nextEpoch;
      let rootSecret: string | undefined;
      let exporterSecret: string;
      const isValidHex64 = (s: unknown): s is string =>
        typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);

      if (isValidHex64(wd.rootSecret)) {
        rootSecret = wd.rootSecret;
        exporterSecret = await deriveEpochSecret(wd.rootSecret, epoch, groupId);
      } else if (isValidHex64(wd.exporterSecret)) {
        exporterSecret = wd.exporterSecret;
      } else {
        return { success: false, error: 'Missing group secrets in Welcome' };
      }

      let welcomeMembers = Array.isArray(wd.members)
        ? wd.members.filter((m): m is string => typeof m === 'string' && isNostrId(m))
        : [];
      if (!welcomeMembers.includes(this.userPubkey)) {
        welcomeMembers = [...welcomeMembers, this.userPubkey];
      }

      const metadata = metadataFromWelcome(wd);
      const stored: StoredGroup = {
        nostrGroupId: groupId,
        name: metadata?.name ?? existing?.name ?? '',
        description: metadata?.description ?? existing?.description,
        adminPubkeys: metadata?.adminPubkeys ?? existing?.adminPubkeys ?? [this.userPubkey],
        members: welcomeMembers.length > 0 ? welcomeMembers : (existing?.members ?? [this.userPubkey]),
        relays: metadata?.relays ?? existing?.relays ?? [],
        epoch,
        bannedPubkeys: existing?.bannedPubkeys ?? [],
        createdAt: existing?.createdAt ?? Date.now(),
        lastActivity: Date.now(),
      };

      await this.setSecrets(groupId, exporterSecret, rootSecret);
      await this.persistGroup(stored);
      if (!this.messages.has(groupId)) {
        this.messages.set(groupId, []);
      }

      existing = stored;
      lastResult = { success: true, data: toGroupChatGroup(stored) };

      await this.processPendingGroupEvents(groupId);
    }

    return lastResult;
  }

  leaveGroup(groupId: string): GroupOperationResult {
    const group = this.groups.get(groupId);
    if (!group) {
      return { success: false, error: 'Group not found' };
    }

    if (this.isAdmin(group) && group.adminPubkeys.length === 1) {
      return {
        success: false,
        error: 'Transfer admin role before leaving the group',
      };
    }

    deleteGroup(this.userPubkey, groupId);
    void deleteGroupSecrets(this.userPubkey, groupId);
    this.groups.delete(groupId);
    this.messages.delete(groupId);
    this.groupStates.delete(groupId);
    this.pendingWelcomes.delete(groupId);
    this.pendingGroupEvents.delete(groupId);
    this.epochSecretCache.delete(groupId);

    return { success: true };
  }
}
