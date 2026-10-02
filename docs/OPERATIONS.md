# Operations Runbook

## Data and migration policy

Version 2 starts with a fresh `commerceflow` PostgreSQL volume. The uploaded v1 schema is not automatically imported. Keep the original database and source backup. Never delete volumes to solve a password mismatch.

SQL files in `backend/migrations` are authoritative. Applied files are checksum-verified with normalized LF line endings; do not edit them after deployment. Add a new migration for schema changes and keep Prisma catalog models aligned. Prisma `generate` builds the client; it does not create database tables.

## Worker health

The worker writes a heartbeat during its five-second dispatch tick. It expires up to 50 overdue orders per pass and recovers unprocessed outbox rows. Payment reconciliation runs separately every minute with bounded provider calls.

Inspect logs and the admin dashboard if notifications or simulated refunds remain pending. The queue retries exponentially; repeatedly failed jobs can be retried through the ADMIN endpoint. PostgreSQL effects remain idempotent.

## External payment uncertainty

Known remote IDs are polled for seven days. Unknown creation without an ID cannot be reconciled automatically. Stale INITIATING rows become UNKNOWN. Stripe recreation uses the same idempotency key; bKash UNKNOWN creation remains blocked. Investigate merchant records rather than issuing another charge.

The supplied bKash tokenized sandbox contract must be confirmed against your merchant agreement. Stripe is test mode only. Public HTTPS callbacks and consistent APP_ORIGIN are required. Never trust redirect success parameters as payment evidence.

## Refunds

Complete external refunds in the merchant portal, then record the provider reference through the admin UI. This is an auditable operator assertion, not an independent provider check. An external refund outbox job being processed does not mean money was refunded.

## Public deployment checklist

Replace local secrets; enable secure cookies and HTTPS; configure a trusted proxy rather than arbitrary forwarded headers. Protect PostgreSQL/Redis networking. Monitor pool saturation, outbox age, refund backlog and reconciliation failures. Establish database backups and test restoration. Replace seeded demo credentials/accounts before public access. Benchmark native PostgreSQL contention and real workload distributions.

No production hosting, backup scheduler, external tracing or payment acceptance certification is included.

## GitHub

Keep `.env`, generated outputs and node_modules excluded. Commit both lockfiles, SQL migrations, Prisma schema, tests and documentation. Replace old repository files rather than deleting the repository if preserving the URL/history matters. After push, check GitHub Actions; do not claim CI success before its actual result.
