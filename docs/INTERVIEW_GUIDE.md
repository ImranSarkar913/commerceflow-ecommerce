# Interview Guide

## Project introduction

“CommerceFlow is a full-stack e-commerce ordering and fulfillment application built with NestJS, TypeScript, React, PostgreSQL and Prisma. I replaced read-then-update stock handling with transactional reservations and an inventory movement ledger. Orders snapshot server-calculated prices, discounts and delivery charges. Payments are idempotent, late settlement creates refund obligations, and a PostgreSQL outbox drives BullMQ notifications and simulated refunds. Staff manage shipment stages; administrators receive stock and approve returns. Provider adapters are test/sandbox integrations; merchant acceptance remains pending.”

Explain the code in your own words and discuss AI assistance honestly when asked. Seniority is demonstrated through understanding and debugging, not project labels.

## Questions to prepare

- Why reserve stock at checkout instead of deducting it later? Concurrent unpaid orders cannot all promise the same remaining unit.
- Why separate on-hand and reserved quantities? It distinguishes physical inventory from temporary allocation.
- Why sorted product locks? A consistent lock order reduces deadlocks in overlapping multi-product operations.
- Why immutable price snapshots? Catalog edits cannot change the amount a customer already reserved.
- What makes idempotency safe? User/key uniqueness plus a canonical request fingerprint; a changed payload is rejected.
- What happens if payment arrives late? The expired order remains expired and receives a refund obligation; inventory is not revived.
- Why Prisma plus SQL? Typed catalog reads are convenient; the transaction hot paths need explicit row locks, deadlines and conditional updates. Both share one pool.
- How do returns affect inventory? Only an approved physically received full-order return restocks inventory and creates a refund obligation, once.
- Is the queue exactly once? No. At-least-once delivery with deduplicated database effects.
- Do external refund records prove a bank transfer? No. They record an administrator's merchant-portal assertion.
- What remains unverified? Native concurrency in the delivery environment, merchant payment acceptance, Docker image execution, production hosting and real workload capacity.

## CV bullets

- Built a full-stack commerce application using NestJS, TypeScript, React, Prisma and PostgreSQL, with transactional stock reservations, server-calculated pricing and role-based fulfillment.
- Implemented idempotent checkout and payment settlement, an inventory movement ledger, expiring orders, late-payment refund obligations and audited return approval.
- Added Redis/BullMQ workers with a PostgreSQL outbox, Stripe test/bKash sandbox adapters, Docker Compose and automated lifecycle/security tests.

Only add a native concurrency result after running the supplied Docker suite. Do not claim live payment processing, production customers or measured capacity without evidence.
