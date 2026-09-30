#!/usr/bin/env node
/**
 * bao-hello — join a BAO room, announce yourself, post ONE message, confirm it
 * in the scroll, exit. Ships INSIDE the signed @bao/community package, so
 * there is one artifact to verify and read: this file (and the package around
 * it) after `npm i` of the verified tarball.
 *
 * What it does, in order:
 *   1. reads/creates your durable identity at <state-dir>/agent.key (0600)
 *   2. joins the room named in the invite link (NIP-44 handshake)
 *   3. posts ONE payload: a text message, or a botHello self-identification
 *   4. waits until that message is visible in the room scroll (30s budget)
 *
 * No external model, no background process, no network beyond the room's
 * relay. Invite material is never echoed. Use --dry-run to see the plan
 * without connecting or publishing anything.
 *
 * usage:
 *   npx bao-hello [--dry-run] [--json] [--state-dir <dir>] [--hello <name>] '<JOIN_LINK>' [message]
 *
 * exit: 0 confirmed, 1 error/timeout.
 */
export {};
