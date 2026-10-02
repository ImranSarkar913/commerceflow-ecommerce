# API Reference

Base path: `/api`. Interactive documentation: `/api/docs`.

Authentication uses a cookie session. Login and `/auth/me` return a CSRF token. Authenticated mutations require `X-CSRF-Token` and the configured `Origin`. Checkout/restock mutations also require `Idempotency-Key` (8–100 letters, digits, underscores or hyphens).

| Method | Path                                 | Access / purpose                                  |
| ------ | ------------------------------------ | ------------------------------------------------- |
| POST   | /auth/register                       | Public; creates CUSTOMER only                     |
| POST   | /auth/login                          | Public; establishes session                       |
| GET    | /auth/me                             | Session user and CSRF token                       |
| POST   | /auth/logout                         | Revoke session                                    |
| GET    | /catalog/products                    | Public; page, limit, search, category             |
| GET    | /catalog/categories                  | Public categories                                 |
| POST   | /orders                              | CUSTOMER; idempotent reservation                  |
| GET    | /orders                              | Own orders; staff/admin order queue               |
| GET    | /orders/:id                          | Owner or operations role                          |
| POST   | /orders/:id/cancel                   | Owner/ADMIN; before shipment                      |
| POST   | /orders/:id/simulate                 | CUSTOMER; local provider only                     |
| POST   | /orders/:id/checkout                 | CUSTOMER; configured stripe/bkash                 |
| POST   | /orders/:id/fulfill                  | STAFF/ADMIN; ordered stages                       |
| POST   | /orders/:id/return                   | CUSTOMER; delivered full order                    |
| GET    | /payments/methods                    | Public enablement flags                           |
| POST   | /payments/:id/verify                 | Owner/ADMIN; independent provider verification    |
| POST   | /payments/sandbox/webhook            | Signed local webhook; timestamp/HMAC              |
| POST   | /payments/stripe/webhook             | Stripe raw-body signature                         |
| GET    | /payments/bkash/return               | Public callback followed by provider verification |
| GET    | /notifications                       | Own in-app notifications                          |
| GET    | /admin/overview                      | ADMIN operational snapshot                        |
| POST   | /admin/products                      | ADMIN catalog creation/opening inventory          |
| PATCH  | /admin/products/:id                  | ADMIN; price, active, expected version            |
| POST   | /admin/products/:id/restock          | ADMIN; idempotent receiving                       |
| POST   | /admin/coupons                       | ADMIN percentage coupon                           |
| POST   | /admin/orders/:id/return-decision    | ADMIN APPROVED/REJECTED                           |
| POST   | /admin/refunds/:id/record-completion | ADMIN; externally processed refund reference      |
| POST   | /admin/jobs/:id/retry                | ADMIN unprocessed job retry                       |
| GET    | /health                              | Liveness                                          |
| GET    | /ready                               | PostgreSQL/Redis readiness                        |

## Reservation example

```json
{
  "items": [
    { "productId": "00000000-0000-4000-8000-000000000001", "quantity": 1 }
  ],
  "address": {
    "name": "Alex Morgan",
    "phone": "01712345678",
    "street": "House 3 Road 12",
    "city": "Dhaka"
  },
  "coupon": "WELCOME10"
}
```

Use a real product UUID from the catalog. The server rejects unknown fields, duplicate product lines, invalid quantities and missing address data. Client-supplied totals are not accepted.

## Monetary fields

Prices, subtotal, discount, shipping, payment amount and refund amount are integer BDT paisa. Ledger IDs can be strings because PostgreSQL uses `bigserial`.

## Error behavior

Errors include `message` and `requestId`. Unauthorized access returns 401; forbidden operations return 403; inaccessible customer orders return 404. Inventory/idempotency/version/state conflicts return 409. Validation returns 400. Rate limits return 429. Unavailable infrastructure/lock timeouts can return 503. Retry mutations with their original idempotency key where applicable.

## Local webhook signing

Headers: `X-Webhook-Timestamp` (Unix seconds), `X-Webhook-Signature` (lowercase SHA-256 HMAC hex). Sign `timestamp + '.' + exact raw request bytes` with `WEBHOOK_SECRET`. Timestamp tolerance is five minutes. Body fields: paymentId, eventId, outcome (success/failed), amount, currency (BDT).

Do not expose the signing secret to browsers. Use the simulation UI for local demonstrations.
