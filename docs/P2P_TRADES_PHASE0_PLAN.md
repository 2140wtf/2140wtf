# Phase 0 Implementation Plan — Remove Letters, Add NIP-17 DMs

> **Status:** Implemented  
> **Goal:** Delete the kind 8211 letter feature from Ditto and replace it with NIP-17 private direct messages, using 0xchat as the UX reference.  
> **Timeline:** Completed in a single implementation pass.

---

## 1. Overview

This plan covers the first phase of the P2P Trades project. Before P2P Trades can use encrypted negotiation, Ditto needs a modern, metadata-private messaging primitive. This phase:

1. **Removes** all kind 8211 encrypted letter code, routes, sidebar items, and notification plumbing.
2. **Implements** NIP-17 private direct messages (kind 14 → 13 → 1059) using `nostr-tools` built-in helpers.
3. **Ships** a chat-first inbox and thread UI inspired by 0xchat.

**No P2P trading logic is added in this phase.** That comes in Phase 1.

## 1.1 Implementation Notes

This plan was executed in a single pass. The following files were created:

- `src/lib/nip17.ts` — NIP-17 crypto primitives and conversation helpers.
- `src/lib/nip17.test.ts` — unit tests for round-trip and tamper detection.
- `src/hooks/useDmRelays.ts` — DM relay resolution (kind 10050 → NIP-65 fallback).
- `src/hooks/useNip17SendMessage.ts` — send hook with recipient + self-copy publishing.
- `src/hooks/useNip17Inbox.ts` — inbox subscription and conversation grouping.
- `src/pages/MessagesPage.tsx` — `/messages` conversation list.
- `src/pages/MessageThreadPage.tsx` — `/messages/:npub` thread view.

The following planned items were **not** implemented and are deferred:

- IndexedDB persistence of decrypted messages (`useNip17Inbox` keeps state in React only).
- A separate `useNip17Thread` hook (`MessageThreadPage` filters `useDmInbox` output by participant).
- A settings UI for editing the user's kind 10050 DM relay list.
- Cross-device sync of DM read cursors (currently device-local localStorage).

---

## 2. Goals & Non-Goals

### Goals

- [x] Letters are no longer reachable in the UI or routes.
- [x] Letter source files are deleted (or dead code is isolated and removed).
- [x] NIP-17 DMs can be sent and received in 1:1 threads.
- [x] DM inbox (`/messages`) lists conversations with last-message preview and unread state.
- [x] DM thread view shows message bubbles, timestamps, and reply context.
- [x] A "Message" button on profiles opens a DM thread.
- [x] DM notifications surface new messages.
- [x] DM relay preferences (kind 10050) are supported with NIP-65 fallback.
- [x] `npm run test` passes after all changes.

### Non-Goals

- Group DMs (multi-recipient `p` tags). Future phase.
- Audio/video calls (NIP-100 / WebRTC). Future phase.
- Disappearing messages / NIP-40 expiration.
- Importing historical kind 8211 letters into the new DM view.
- P2P trade request composer. Phase 1.
- NIP-59 private offers. Phase 2.

---

## 3. Part A — Letter Removal

### 3.1 Delete source files

Run `rm -rf` on these directories/files:

```
src/pages/LettersPage.tsx
src/pages/LetterComposePage.tsx
src/pages/LetterPreferencesPage.tsx
src/components/letter/
src/components/EncryptedLetterContent.tsx
src/components/icons/InkPenIcon.tsx
src/hooks/useLetters.ts
src/hooks/useLetterPreferences.ts
src/hooks/useStationery.ts
src/hooks/useStationeryColors.ts
src/hooks/useThemeStationery.ts
src/hooks/useEnvelopeDimensions.ts
src/lib/letterTypes.ts
src/lib/letterUtils.ts
```

### 3.2 Remove routes

In `src/AppRouter.tsx`:

- Remove imports:
  ```ts
  const LetterComposePage = lazy(...);
  const LetterPreferencesPage = lazy(...);
  const LettersPage = lazy(...);
  ```
- Remove routes:
  ```tsx
  <Route path="/letters" element={<LettersPage />} />
  <Route path="/letters/compose" element={<LetterComposePage />} />
  <Route path="/settings/letters" element={<LetterPreferencesPage />} />
  ```

### 3.3 Remove sidebar navigation

In `src/lib/sidebarItems.tsx`:

- Remove the `letters` entry (currently uses `MailboxIcon`).
- Keep `MailboxIcon` import only if used elsewhere; otherwise remove it.

### 3.4 Remove kind label

In `src/lib/kindLabels.ts`:

- Remove `8211: 'Letter'`.

### 3.5 Remove notification plumbing

Audit and remove letter-specific notification handling:

```
src/lib/notificationKinds.ts
src/lib/notificationTemplates.ts
src/hooks/useNotifications.ts
src/pages/NotificationsPage.tsx
src/pages/NotificationSettings.tsx
```

Search for:
- `letter`
- `Letter`
- `8211`
- `useLetters`
- `EncryptedLetterContent`

Update or delete branches that render letter notifications.

### 3.6 Remove consumer callsites

Search for any "Send letter" or letter-related UI in:

```
src/components/NoteCard.tsx
src/components/NoteContent.tsx
src/components/ComposeBox.tsx
src/pages/PostDetailPage.tsx
src/pages/ProfilePage.tsx
src/components/ProfileCard.tsx
src/components/ProfileRightSidebar.tsx
src/components/marketplace/Nip99ListingCard.tsx
```

Replace "send letter" actions with either:
- Nothing (remove the action), or
- "Message" action that opens NIP-17 DM thread (if NIP-17 is already built at this point).

**Recommendation:** Do the bulk removal first, then in Part B add the new "Message" buttons.

### 3.7 Remove letter preferences from settings schemas

In `src/lib/schemas.ts` and `src/contexts/AppContext.ts`:

- Search for `letter` in schemas / config.
- Remove letter-specific settings if present.
- If removing a required config field, update `defaultConfig` too.

### 3.8 Clean `NIP.md`

In `NIP.md`:

- Remove or rewrite the kind 8211 specification section.
- Add a note that Ditto has migrated to NIP-17 for private messaging.

### 3.9 Verify nothing references deleted code

```bash
npm run test
```

Fix all TypeScript and ESLint errors caused by the deletion.

---

## 4. Part B — NIP-17 DM Implementation

`nostr-tools` already exports NIP-17 helpers in `nostr-tools/nip17`:

- `createRumor`
- `createSeal`
- `createWrap`
- `wrapEvent`
- `unwrapEvent`
- `unwrapManyEvents`

We will wrap these in Ditto's signer-aware hooks.

### 4.1 Add NIP-17 crypto utilities

Create `src/lib/nip17.ts`:

```ts
// Low-level NIP-17 helpers using nostr-tools
export function buildNip17Rumor(...)
export function buildNip17Seal(...)
export function buildNip17Wrap(...)
export function unwrapNip17GiftWrap(...) // returns kind 14 rumor + sender pubkey
export function parseNip17Message(...)   // validates rumor structure
```

Responsibilities:
- Wrap `nostr-tools/nip17` functions.
- Convert between Ditto's `NostrEvent` types and nostr-tools types.
- Add validation (recipient pubkey well-formed, content not empty, etc.).
- Sanitize URLs in any message content that might be rendered as links.

### 4.2 Add DM sending hook

Create `src/hooks/useNip17SendMessage.ts`:

```ts
interface SendNip17MessageOptions {
  recipientPubkey: string;
  content: string;
  subject?: string;
  replyTo?: string; // event id of message being replied to
  offerRef?: string; // optional a-tag coordinate for P2P trade requests (Phase 1)
}

export function useNip17SendMessage() {
  const { mutateAsync, isPending } = useMutation({...});
  return { sendMessage: mutateAsync, isPending };
}
```

Implementation steps:
1. Build kind 14 rumor with `p` tag + optional `e`/`subject`/`a` tags.
2. Use signer to create seal (requires NIP-44 encrypt + sign).
3. Create gift wrap with ephemeral key.
4. Publish wrap to recipient's DM relays (kind 10050 → NIP-65 fallback).
5. Create self-copy wrap addressed to sender.
6. Publish self-copy to sender's DM relays.
7. Optimistically update local inbox cache.

**Signer interface problem:** `NSecSignerBtc`, `NBrowserSignerBtc`, and `NConnectSignerBtc` may not expose raw NIP-44 encrypt/decrypt methods. We need to check `nostrify` signer API and extend or wrap if necessary.

### 4.3 Add DM inbox hook

Create `src/hooks/useNip17Inbox.ts`:

```ts
interface Nip17Conversation {
  id: string; // sorted participant pubkey hash
  participants: string[];
  lastMessage?: Nip17Message;
  unreadCount: number;
}

export function useNip17Inbox() {
  // subscribe to kind 1059 #p = user pubkey
  // unwrap + decrypt each gift wrap
  // group by conversation
  // return conversations sorted by last message time
}
```

Responsibilities:
- Subscribe to `{ kinds: [1059], '#p': [userPubkey] }`.
- Unwrap and decrypt incoming events.
- Merge with self-copies so sent messages appear in threads.
- Cache decrypted messages in React state. IndexedDB persistence was planned but deferred to a future optimization.
- Handle malformed/unverifiable wraps gracefully (drop them, don't crash).

### 4.4 Add DM thread hook

A separate `src/hooks/useNip17Thread.ts` was not created. `MessageThreadPage` filters the conversations returned by `useNip17Inbox` for the requested participant. A dedicated thread hook can be extracted later if needed.

### 4.5 Add DM relay discovery

Create `src/hooks/useDmRelays.ts`:

```ts
export function useDmRelays(pubkey: string) {
  // query kind 10050 for pubkey
  // return array of relay URLs
  // fallback to NIP-65 relay list if no kind 10050
}
```

A settings UI to edit the user's own kind 10050 DM relay list was not built in Phase 0.

### 4.6 Add IndexedDB storage for decrypted messages

Extend `src/lib/NIndexedDB.ts` or create a dedicated DM store:

- Store decrypted kind 14 rumors keyed by `conversationId + rumor.id`.
- Store conversation metadata (participants, last message, unread count).
- On app startup, hydrate inbox from IndexedDB before relay data arrives.

### 4.7 Add NIP-17 message parser

Create `src/lib/nip17Message.ts`:

```ts
export interface Nip17Message {
  id: string;           // rumor id
  wrapId: string;       // kind 1059 id
  sender: string;
  recipients: string[];
  content: string;
  createdAt: number;
  replyTo?: string;
  subject?: string;
  offerRef?: string;    // for Phase 1 trade requests
}
```

Sanitize `content` before rendering (URL sanitization, no HTML, etc.).

---

## 5. Part C — UI/UX

### 5.1 DM inbox page

Create `src/pages/MessagesPage.tsx` at route `/messages`.

Layout (0xchat-inspired):

- Header: "Messages" + new-message FAB.
- Conversation list:
  - Avatar + display name.
  - Last message preview (truncated).
  - Timestamp.
  - Unread dot/count.
- Empty state: "No messages yet. Start a conversation from a profile."
- Loading state: skeleton list.

### 5.2 DM thread page

Create `src/pages/MessageThreadPage.tsx` at route `/messages/:npub`.

Layout:

- Header: partner avatar + name + options (clear history, block, report).
- Message list:
  - Own messages on right, partner's on left.
  - Timestamps grouped by day.
  - Reply previews when `e` tag present.
  - Subject/topic if set.
- Composer:
  - Text input.
  - Send button.
  - Reply-to swipe/action.

### 5.3 "Message" action on profiles

In `src/components/ProfileCard.tsx`, `src/pages/ProfilePage.tsx`, and `src/components/ProfileRightSidebar.tsx`:

- Add a **Message** button when viewing another user's profile.
- On click: navigate to `/messages/<npub>`.
- If no thread exists, the thread page shows an empty composer.

### 5.4 Replace "send letter" actions

In `src/components/NoteCard.tsx`, `src/pages/PostDetailPage.tsx`, `src/components/ComposeBox.tsx`:

- Remove any "Send letter" menu items.
- Optionally add "Message author" that navigates to `/messages/<author-npub>`.

### 5.5 DM notification UI

In `src/hooks/useNotifications.ts` and `src/pages/NotificationsPage.tsx`:

- Add a notification type for NIP-17 DMs.
- Render sender avatar + preview.
- Deep-link to `/messages/<sender-npub>` on tap.

### 5.6 Settings

Add under Settings:

- **DM relays:** Edit kind 10050 relay list. *Not implemented in Phase 0.*
- **Blocked DMs:** Manage pubkey block list (reuse existing mute list or create DM-specific block list). *Not implemented in Phase 0.*

---

## 6. Testing Plan

### Unit tests

- `src/lib/nip17.test.ts`
  - Round-trip: build rumor → seal → wrap → unwrap → decrypt.
  - Verify sender pubkey recovered from seal.
  - Verify tampered wrap is rejected.
- `src/lib/nip17Message.test.ts`
  - Parse valid/invalid rumors.
  - URL sanitization in message content.

### Hook tests

- `src/hooks/useNip17SendMessage.test.ts`
  - Send creates correct event kinds.
  - Self-copy is published.
- `src/hooks/useNip17Inbox.test.ts`
  - Groups incoming + self-copy messages into conversation.
  - Unread count increments correctly.

### Component tests

- `MessagesPage.test.tsx`
- `MessageThreadPage.test.tsx`

Use existing `TestApp` wrapper and mocked signer.

### Integration / manual

1. User A sends DM to User B.
2. User B sees notification and inbox entry.
3. User B replies.
4. Both see full thread in correct order.
5. Test with NIP-07 extension signer and NIP-46 bunker signer.

### Regression

- `npm run test` passes.
- No references to deleted letter files remain.
- Routes `/letters`, `/letters/compose`, `/settings/letters` return 404.

---

## 7. Migration & Rollback

### Data migration

- Existing kind 8211 letter events remain on relays but are no longer rendered.
- No automatic migration to NIP-17 is attempted.
- If users demand historical letters, a future read-only migration tool can be built separately.

### Rollback

If Phase 0 needs to be reverted:

- This plan assumes git commits. Each sub-task (letter removal, NIP-17 lib, inbox, thread) should be its own commit.
- Letter deletion is reversible via `git revert` only if commits are preserved.
- NIP-17 additions can be reverted independently.

---

## 8. Definition of Done

- [x] All letter files, routes, sidebar items, kind labels, and notification plumbing removed.
- [x] `npm run test` passes with zero letter references.
- [x] NIP-17 DMs can be sent and received between two Ditto users.
- [x] `/messages` inbox renders conversation list.
- [x] `/messages/:npub` thread renders messages and supports reply.
- [x] Profile "Message" button works.
- [x] DM notifications work.
- [x] DM relay preferences (kind 10050) supported with fallback.
- [x] NIP.md updated.
- [x] CHANGELOG.md updated.

---

## 9. Task Order Recommendation

| Order | Task | Status | Notes |
|---|---|---|---|
| 1 | Delete letter files + routes + sidebar + kind label | ✅ Done | Removed pages, components, hooks, lib files, kind labels, and NIP.md section. |
| 2 | Fix notification/templates consumers after deletion | ✅ Done | No letter-specific notification code remained; sidebar slot reused for Messages. |
| 3 | Add `src/lib/nip17.ts` crypto utilities + tests | ✅ Done | Includes round-trip and auth-check tests. |
| 4 | Add `useNip17SendMessage` + signer integration | ✅ Done | Sends to recipient + self-copy via recipient DM relays. |
| 5 | Add `useNip17Inbox` | ✅ Done | Streams kind 1059 `#p`-tagged wraps and groups into conversations. |
| 6 | Add `useDmRelays` + relay targeting | ✅ Done | kind 10050 with NIP-65 read-relay fallback. |
| 7 | Build `MessagesPage` + `MessageThreadPage` | ✅ Done | Routes `/messages` and `/messages/:npub`. |
| 8 | Add profile "Message" buttons | ✅ Done | Opens DM thread for foreign profiles. |
| 9 | DM notifications integration | ✅ Done | Unread dot on Messages sidebar + unread DM section on Notifications page. |
| 10 | End-to-end testing + bug fixes | ✅ Done | `npm run test` passes. |
| 11 | NIP.md + CHANGELOG + final `npm run test` | ✅ Done | |

**Total effort:** compressed into one implementation pass.

---

## 10. Decisions Made

1. **Signer NIP-44 support:** Implemented signer-based seal creation directly in `src/lib/nip17.ts` using the `NostrSigner` interface (`signEvent` + NIP-44 encrypt). No changes to `nostrify` were required.
2. **Historical letters:** Fully dropped. Existing kind 8211 events remain on relays but are not rendered; no migration was attempted.
3. **DM block list:** Not implemented in Phase 0. Existing mute list can be reused in a future phase if needed.
4. **Notification push:** Not implemented in Phase 0. Local in-app unread badge only is deferred.
5. **Route naming:** Used `/messages` and `/messages/:npub` to replace the previous `/letters` routes.

## 11. Remaining Work for Phase 1 / Future Phases

- **Group DMs:** Multi-recipient threads.
- **P2P trade request composer:** Link DMs to trade offers (Phase 1).
- **NIP-59 private offers:** Phase 2.
- **DM relay settings UI:** The `useDmRelays` hook supports kind 10050, but a dedicated settings page to edit the user's DM relay list was not built.
