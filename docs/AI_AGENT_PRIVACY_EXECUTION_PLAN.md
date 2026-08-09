# AI-agent privacy and payment execution plan

This plan covers the agent-first, privacy-first improvements for 2140.wtf
compute-credit requests. Each item is an isolated change: implement it,
validate it, commit it, rebase on the current `main`, and merge it before
starting the next item.

## Delivery rules

- Never publish Cashu tokens, proofs, wallet keys, or private receipts to
  relays.
- Keep NIP-17 delivery and local encrypted recovery as the default.
- Use NIP-98 or signed Nostr events for service authentication; do not add
  bearer API keys as agent identity.
- Every completed item must pass `npm run test`, receive its own commit, and
  merge cleanly into the latest `main`.
- Update `public/AGENTS.md` and the machine-readable manifest whenever the
  wire protocol or command surface changes.

## Ordered work items

### 1. Mainnet mint safety — completed

Block obvious signet, testnet, demo, staging, development, insecure, and local
Cashu mint URLs in agent funding. Keep the selected mint visible before send.

### 2. Private funding inbox — completed

Add headless `work inbox` support for decrypting NIP-17 funding messages and
locally detecting the request ID and Cashu token. Tokens remain local and are
never republished.

### 3. Wallet-key privacy — completed

Prefer the agent's NIP-61 wallet key for P2PK locking. Require explicit donor
consent before falling back to the agent's long-term identity key or an
unlocked bearer token.

### 4. Multi-shot naming and compatibility — completed (testing mode)

Use **Single-shot** and **Multi-shot** in the UI. Keep the current two-payout
wire format (`shots=2`, `amount2`) while it is being tested.

### 5. Machine-readable agent capability manifest — next

Add a production `/.well-known/agent.json` (or equivalent static manifest)
listing commands, Nostr kinds, relay bootstrap, payment rails, mint safety
rules, current Multi-shot limit, and links to examples. Generate shared command
metadata from the command registry so CLI help, the manifest, and `AGENTS.md`
cannot drift.

### 6. Aggregated skills and schemas

Expose one machine-readable capability/schema document for compute credits,
wallet operations, receipts, and redemption. Include valid ranges, state
transitions, error codes, and JSON examples. Keep the human-readable guide as
the companion explanation.

### 7. Idempotent status and recovery model

Make request, tranche, token delivery, redemption, and receipt states explicit:
`requested → token_sent → agent_confirmed → redeemed → receipt_published`.
Use stable IDs for retries and expose safe recovery instructions when a DM or
relay publish fails.

### 8. Portable agent history

Add local export/import for request history, confirmations, and receipt
references. Export metadata only; never export raw proofs or private keys by
default.

### 9. Privacy-preserving agent memory

If semantic search or durable memory is added, keep it local or encrypted under
the agent's key. Do not introduce centralized tables, SQL access, bearer API
keys, or plaintext server-side wallet state.

### 10. Direct Lightning/BOLT12 payment to an offer

Design and implement an optional invoice/offer field for compute-credit
requests. The settlement service must bind the payment to the request and
tranche, verify the preimage/payment status, prevent replay, and publish only a
minimal confirmation event. Cashu remains the privacy-preserving default.

### 11. Generalized Multi-shot tranches (maximum five)

Replace the current `amount + amount2` representation with a versioned tranche
array supporting one to five payouts. Preserve the current two-payout format
as a read-only compatibility path, migrate old requests safely, and require
agent confirmation for every tranche.

### 12. Final interoperability and privacy audit

Test a browser donor, a headless agent, NIP-61 wallet locking, identity fallback,
NIP-17 delivery, Cashu redemption, Lightning/BOLT12 settlement, retries, and
partial Multi-shot completion. Confirm that no token, proof, key, or sensitive
donor metadata appears in relay events or logs.

## Current branch status

Items 1–4 are implemented on the onboarding feature branch. The branch must be
rebased on the latest `main` before each merge; local `main` and the remote
branch currently have divergent history, so no destructive reset is allowed.
