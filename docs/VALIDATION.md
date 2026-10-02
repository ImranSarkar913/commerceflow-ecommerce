# Validation and Evidence

## Delivery checks

| Check                                   | Result                     | Scope                                                                                                      |
| --------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Backend TypeScript build                | Passed                     | Strict compilation with no emit on errors                                                                  |
| Prisma generation and catalog execution | Passed                     | Prisma 7 PostgreSQL adapter, shared pool                                                                   |
| Unit/provider security tests            | 12 passed                  | Pricing, validation, cryptography, mocked Stripe/bKash contracts                                           |
| Functional integration suite            | 20 passed; 2 skipped       | PostgreSQL-compatible PGlite adapter, native Redis 7.4.2 and BullMQ                                        |
| Frontend tests                          | 4 passed                   | Catalog, bag, account form and integer money display                                                       |
| Frontend production build               | Passed                     | TypeScript and Vite                                                                                        |
| Browser workflow                        | Passed                     | Customer coupon checkout/payment; staff packing/shipping/delivery; customer return; administrator approval |
| Browser layout                          | Passed                     | Desktop 1440px and mobile 390px; no horizontal mobile overflow or page exceptions in the exercised flow    |
| Dependency audit                        | 0 reported vulnerabilities | Both lockfiles, audit at delivery; this is a point-in-time check                                           |
| ZIP integrity and source checks         | Passed                     | English-only authored files, no local secrets, dependency directories or generated builds                  |

The functional test environment used PGlite through a socket adapter and **one shared database connection**. It exercised SQL, constraints, rollbacks and workflows but does not prove native PostgreSQL multi-connection contention. PGlite and the private test adapter are not application dependencies or included in the package.

The browser run used the same functional database environment and a real Redis/BullMQ worker. Screenshots in `docs/screenshots/` come from that run.

## Required native acceptance check

Run this from the project root on Docker Desktop:

```bash
docker.exe compose -f docker-compose.test.yml up --abort-on-container-exit --exit-code-from tests
docker.exe compose -f docker-compose.test.yml down
```

Expected backend total: **34 tests** across two commands: 12 unit/provider tests and 22 integration tests, with no skipped integration tests on native PostgreSQL. The test Compose project has its own PostgreSQL/Redis services; it does not connect to the demo database.

Native-only tests include:

1. Thirty concurrent attempts to reserve the last unit: one successful order and 29 conflicts.
2. Ten concurrent requests with the same customer/idempotency key: one order and one inventory reservation.

These are correctness scenarios, not throughput measurements. Do not claim these native results before running Docker or observing a successful CI run on this revision.

## Not verified in the delivery environment

- Docker image build/startup and the native PostgreSQL concurrency suite.
- GitHub Actions execution after repository upload.
- Actual Stripe merchant test checkout and bKash merchant sandbox acceptance.
- Provider-side automatic refunds; external refunds are manual merchant actions.
- Public deployment, TLS configuration, backup restoration and production load capacity.
- The packaged optional Playwright runner on the user's machine; the delivery browser walkthrough was driven separately.

## How to assess a test run

Look at the test runner summary and its exit status, not only database shutdown messages. PostgreSQL/Redis shutdown logs can be normal after `--abort-on-container-exit`.

If the suite fails, retain the test output and inspect the first failing test before changing application code. Never delete demo volumes to fix a test failure. After upload, confirm the Actions checks pass before describing native concurrency as verified in your CV or interview.
