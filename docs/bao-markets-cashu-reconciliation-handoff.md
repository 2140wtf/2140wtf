# BAO Markets Cashu Reconciliation Handoff

Use this task in a dedicated `bao.markets` session.

## Working agreement

Work in `/home/bob/Documents/bao.markets`.

Run non-interactively. Inspect the current repository and production state before editing. Use a new isolated branch/worktree because other sessions may share the repository. Never push directly to `main`. Create a pull request as the BAO GitHub user after all validation passes.

## Objective

Restore safe production Cashu claims from `POST /v1/wallet/claim` without risking duplicate payouts. Do not merely remove the containment return.

## Confirmed production failure

File:

`packages/api/src/services/CashuPayoutService.ts`

`creditCashuReal()` currently always returns:

> Cashu payouts are temporarily disabled pending durable Lightning payment reconciliation

The retained implementation below that return is unreachable. Production claims receive HTTP 202 and remain pending forever. No token reaches `cashu_pending_tokens` or the client's NIP-60 wallet.

## Production evidence

- `bao-api` runs from `/root/bao.markets-main/packages/api`.
- The Cashu mint is available at `http://127.0.0.1:3338`.
- LNbits is available at `http://127.0.0.1:5002`.
- Both were healthy during the latest diagnostic run.
- The authenticated LNbits wallet check returned HTTP 200.
- Direct Cashu mint quote creation returned HTTP 200.
- Historical API logs contain `could not fetch bolt11 payment request from backend`.
- `payout-retry` reports approximately 338 ambiguous Cashu payouts.
- It correctly refuses to replay ambiguous payouts automatically.
- The PM2 retry process showing `stopped` is normal for its cron-triggered one-shot execution.

## Required implementation

### 1. Audit the payout lifecycle

Audit `CashuPayoutService` completely, including:

- `executePayout`
- quote creation
- Lightning payment dispatch
- quote-state polling
- proof minting
- `cashu_payout_state`
- `payout_attempts` and outbox records
- `cashu_pending_tokens`
- crash and restart recovery

### 2. Make transitions durable

- Persist the operation identity and request fingerprint before creating a quote.
- Persist the quote ID before attempting Lightning payment.
- Persist a payment-attempt/reconciliation record before dispatch.
- Never create another quote while an existing operation has a quote whose payment outcome is unknown.
- Never retry an ambiguous Lightning POST as though it definitely failed.
- Query LNbits payment state and Cashu mint quote state to reconcile.
- Mint proofs exactly once after the quote is `PAID`.
- If the mint reports `ISSUED`, recover the existing result; never issue again.
- Store the resulting token in `cashu_pending_tokens` for the authenticated owner.
- Mark the claim and payout completed only after the token is durably stored.
- Keep unknown outcomes quarantined for operator reconciliation.

### 3. Fix claim status behavior

- Definitive pre-dispatch failures must become failed with a useful machine code and message.
- Ambiguous post-dispatch outcomes must remain pending/reconciliation-required.
- Do not leave a claim permanently pending for a definitive containment or validation failure.
- Ensure `/v1/wallet/claim-status/:key` correctly reflects completed, failed, or genuinely pending state.

### 4. Build safe reconciliation

- Reconcile existing records using persisted quote and payment identifiers.
- Categorize each operation as pre-dispatch and retryable, unpaid, paid but not minted, issued/completed, or genuinely ambiguous.
- Automatically resume only states proven safe.
- Never bulk-replay all ambiguous payouts.
- Produce counts and sanitized operator logs without tokens, proofs, keys, invoices, or complete pubkeys.

### 5. Protect proof custody

- Tokens and proofs must never appear in normal logs.
- Pending tokens must be owner-scoped.
- Collection must be authenticated and atomic.
- Never discard newly minted proofs after only crediting a database balance.
- Cross-user idempotency keys must not collide or expose another user's result.

### 6. Add focused tests

Cover all of the following:

- crash after quote creation
- crash immediately before payment dispatch
- timeout during payment dispatch
- successful payment whose HTTP response was lost
- quote `PAID` before minting
- quote `ISSUED` recovery
- crash after minting but before pending-token storage
- crash after token storage but before claim completion
- repeated request with the same authenticated user, key, and body
- same key with changed parameters
- same key used by another user
- definitive failures becoming failed
- ambiguous outcomes remaining quarantined
- no duplicate quote, payment, mint, or token
- owner-scoped pending-token retrieval and deletion
- no secrets or proofs in logs

### 7. Validate before opening the PR

Run:

- focused Cashu and API tests
- full lint
- TypeScript validation
- complete test suite
- production build
- existing security checks

## Deployment and live verification

After the pull request is reviewed and merged:

1. Deploy through the established `bao.markets` deployment process.
2. Confirm migrations are applied.
3. Restart only the required API and worker services.
4. Do not manually change historical ambiguous records without reconciliation evidence.
5. Create one fresh test npub and claim a small Cashu amount.
6. Confirm the claim completes, exactly one payout-state record exists, exactly one pending token is stored, `/cashu-pending` returns it only to that npub, and no token or proof appears in logs.
7. Create a second fresh npub and repeat.
8. Report the PR URL, merge commit, deployment commit, test results, and sanitized production evidence.

## Critical safety rule

Do not solve this by deleting the unconditional return and enabling the retained implementation unchanged. It was contained because ambiguous Lightning retries could double-pay. Production issuance should only be re-enabled after durable idempotency and reconciliation tests prove it safe.

Once the safe deployment is live, return to the 2140.wtf session and run `tests-manual/bao-nip60-two-account.mjs` to verify fresh claims, NIP-60 restore, A-to-B and B-to-A transfers, and Pets Store spending with BAO signet sats.
