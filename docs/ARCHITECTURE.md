# Architecture and Decisions

## Boundaries

Nest modules separate infrastructure, authentication, commerce and payments. Controllers validate request DTOs and role/session access. CommerceService owns inventory and order transitions; PaymentsService orchestrates external network calls; the worker runs as a separate process.

Prisma reads the typed product catalog. Parameterized node-postgres transactions own order hot paths. Both share one bounded pool. Avoid opening a second pool or inserting remote HTTP calls inside SQL transactions.

## Inventory model

`on_hand` is physical/sellable stock, including units currently reserved. `reserved` is unpaid inventory allocation. Availability is `on_hand - reserved`.

| Action                              | On-hand delta | Reserved delta |
| ----------------------------------- | ------------: | -------------: |
| Opening stock / receiving           |     +quantity |              0 |
| Checkout reservation                |             0 |      +quantity |
| Successful payment                  |     -quantity |      -quantity |
| Unpaid cancellation / expiry        |             0 |      -quantity |
| Paid cancellation / approved return |     +quantity |              0 |

Every mutation records a uniquely referenced inventory ledger movement in the same transaction. Return approval represents an administrator's confirmation that the full order was physically received and can be restocked.

## Lock order

New checkout takes a per-customer advisory lock, protecting the unpaid-order limit and request idempotency. It then locks any coupon, then product rows in ascending UUID order. Existing-order operations lock the order first and its product rows in ascending UUID order. New order rows are inserted only after product eligibility is established.

A bounded expiry sweep uses `FOR UPDATE SKIP LOCKED`; PostgreSQL deadlocks/lock timeouts are surfaced as retryable busy errors, never partial inventory updates.

## Payment boundary

Payments are unique per order. Checkout amounts are stored snapshots, not browser values. A conditional status update uses `clock_timestamp()` to claim a payable order before its deadline; stock consumption, event deduplication and audit/outbox writes commit atomically.

Late payment succeeds financially but cannot revive a cancelled/expired order. A unique full-amount refund obligation records the compensation.

External creation commits INITIATING before HTTP. Responses can only change INITIATING/UNKNOWN to READY. Errors only change INITIATING to UNKNOWN. SETTLED/SUCCEEDED state cannot be regressed. Stale initiation becomes UNKNOWN during reconciliation. Stripe retries use its stable provider idempotency key; unknown bKash creation is deliberately blocked pending investigation.

Verification uses a PostgreSQL session advisory mutex across provider calls, outside a SQL transaction. Settlement reuses that connection for its transaction, avoiding pool starvation from a second checkout connection. Provider requests are bounded and gateway messages exclude credentials.

## Outbox

Notifications/refund obligations enter PostgreSQL in the domain transaction. Workers publish deterministic BullMQ job IDs and periodically recover undispatched/unprocessed rows. Delivery is at least once. PostgreSQL deduplicates notification inserts and refund effects.

A worker crash after queue publication can cause redelivery. It cannot create a second notification or complete a refund twice. External refund jobs deliver an obligation notification; merchant action remains separate.

## Security

Opaque session credentials are hashed before storage. Cookies are HTTP-only and SameSite Strict. Session mutations require both a configured Origin and session-bound CSRF token. Roles come from the database, not request headers.

Redis rate keys use hashed session identifiers plus a source-IP cap. Forwarded IP headers are not blindly trusted. The local proxy can therefore impose shared caps; production deployments must explicitly define trusted proxies.

## Tradeoffs

A single inventory location and full-order lifecycle keep the invariants reviewable. Partial shipments, line-level returns, warehouse transfers and a tax engine would require richer reservation/refund allocation models. This is a portfolio implementation, not a certified production commerce system.
