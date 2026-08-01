# ₿AO Agent Orchestration — Protocol & Residual Risk Register

The task-claim protocol for agent chat: verbs (`CLAIM` / `PROGRESS` / `DONE` /
`BLOCKED` / `HANDOFF` / `ACK`) in tag-`orch-task` channel messages, resolved by
`resolveClaims` in `src/concord-v2/lib/orchestration.ts` — THE shared
tie-break, consumed identically by the CLI (`scripts/bao-agent.ts`) and the
MCP server (`scripts/bao-chat-mcp.ts`) via `scripts/chat-core.ts`.

## Safety mechanisms (shipped)

| Mechanism | Where | Guarantees |
|---|---|---|
| Fencing epochs | `resolveClaims` CLAIM case | A CLAIM is valid only at exactly current-epoch+1; stale-view claims are ignored, never half-honored. |
| Idempotent claim keys | `deriveClaimKey` | A retry republishes the SAME claim; epoch salts the key so a re-claim after takeover is new. |
| Duplicate-delivery idempotence | `resolveClaims` rumor-id dedup | At-least-once relay delivery is a no-op (fuzz seed 101). |
| Executor-side fence | `mayPostVerb` + `orchVerbPost` | A zombie's PROGRESS/DONE/BLOCKED/HANDOFF is refused pre-post with exit 2 — the agent is TOLD it lost. |
| HANDOFF release | `resolveClaims` HANDOFF case | The claimant's HANDOFF releases the claim; the receiver claims immediately, no TTL wait. |
| Fail-closed resolution | `assertRelayReachable` | Relay unreachability is an error (exit 1), never an empty claim map. |
| Settle pass | `CLAIM_SETTLE_MS` (default 1500) | Re-resolve after publishing before declaring held — defeats partial-view double-held under propagation asymmetry. |
| Protocol version guard | `PROTOCOL_VERSION` in chat-core | State stamped by a newer binary is refused outright. |
| Atomic state writes | `saveState` (tmp+rename) | A crash mid-write never orphans the identity's private key. |
| State lockfile | `withStateLock` | Concurrent CLI processes can't lose each other's invite/registry writes. |

## Residual risk register (round-5 classification)

**Won't-fix (inherent to the relay model):**

- **Partial-history resolution.** `resolveClaims` is only as complete as the
  history the relays served. A late-joining agent with a truncated view can
  resolve a different holder than the room. Mitigated, not eliminated: the
  epoch fence ignores stale-view CLAIMs, and the settle pass catches
  propagation asymmetry at claim time. Eliminating it entirely would require
  a consensus layer the protocol deliberately does not have.
- **Single-use ghost member.** Two joiners racing one single-use link both
  pass the spend check (check-then-act, no atomic claim over relays). The
  loser SELF-EJECTS after its Join lands (re-folds the guestbook, yields to an
  earlier Join citing the same commitment, exit 2, no state saved) — but its
  Join stays on the guestbook as a ghost membership until the owner's sweep
  tombstones the link, and only a rekey truly excludes the key. The fold is
  per-npub and can't dedupe a commitment: it can't tell single-use links from
  multi-use (registry knowledge the Chat/Guestbook planes deliberately lack).
  Residual window: a rival whose Join lands >1.5s (the settle beat) after the
  loser's second re-fold is not seen — both stay members until the sweep.


**Fail-safe by design (tested, no action):**

- **`epoch=` parse degradation.** `epoch=1e3`, `epoch=2.5`, `epoch=-3` don't
  match the `(\d+)` anchor → the CLAIM is treated as LEGACY (fence skipped,
  still single-processed after dedup). Degrades to pre-fencing behavior, never
  crashes, never double-claims. Covered by the fuzz block.
- **PROGRESS double-post.** Re-processing a PROGRESS only re-sets
  `lastProgressMs` — idempotent effect even without the rumor-id dedup.
- **Legacy epoch-less CLAIMs in a mixed fleet.** They claim and bump the epoch
  like a fenced claim; the fence only hardens epoch-bearing claims. Once the
  fleet is fully upgraded, legacy claims can be rejected at resolve (spec
  decision, not code debt).

**Spec decisions for Bob (code currently does the conservative thing):**

- **BLOCKED refreshes the lease.** A claimant's BLOCKED updates
  `lastProgressMs`, so a repeatedly-reported-blocked task never goes stale and
  stays unreclaimable. This is "the owner is alive and reporting" semantics —
  the same as PROGRESS. The alternative (BLOCKED implies release, like
  HANDOFF) is a protocol-spec change: HANDOFF already exists as the explicit
  release mechanism, so the conservative reading holds unless the spec says
  otherwise.
- **Durable outbox.** A crash between "relay accepted" and "state saved" can
  lose the record of WHAT was sent (mosaico multi-writer lesson). Not built:
  no unattended loops or money-moving verbs consume orch state yet. The
  trigger to build it is documented at `sendChannelMessage` in chat-core —
  revisit the moment an agent acts on claims unattended.
- **Presence / rel-cwd.** Agents don't publish presence or working directory;
  mosaico's relative-cwd collision doesn't apply. Revisit if presence is added.

## Bug-hunt history (2026-07-31 → 2026-08-01)

Five professional rounds, each with a live repro proving the bug before the
fix: (1) logic lens — HANDOFF could never complete (receiver lost to the
handoff-er's own live claim); (2) race lens — double-held under propagation
asymmetry, fixed with the settle pass; (3) persistence lens — 6 concurrent
invites lost 5 writes pre-fix, plus non-atomic state writes; (4) fuzz lens —
seeded property tests caught duplicate-delivery un-fencing at seed 101;
(5) this register. Harnesses live in `.tmp/` (gitignored): mini-relay with
`EVIL_SINCE`/`DELAY_OTHERS_MS` knobs, live-claim-race, partial-view-race,
concurrent-invite, adversarial-relays, mcp-test.
