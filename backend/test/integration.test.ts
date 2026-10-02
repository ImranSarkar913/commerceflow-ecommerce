import "reflect-metadata";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID } from "node:crypto";
process.env.NODE_ENV = "test";
process.env.ALLOW_DEMO_SEED = "true";
process.env.DEMO_PASSWORD = "integration-demo-password";
process.env.ENABLE_SANDBOX = "true";
process.env.STRIPE_ENABLED = "false";
process.env.BKASH_ENABLED = "false";
const { Database } = require("../dist/db");
const { migrate } = require("../dist/migrate");
const { seed } = require("../dist/seed");
const { CommerceService } = require("../dist/commerce");
const { createApp } = require("../dist/main");
const { signature } = require("../dist/crypto");
const { processOutbox, startWorker } = require("../dist/worker");
const functional = process.env.WASM_FUNCTIONAL_TEST === "true";
let app: any,
  db: any,
  commerce: any,
  customer: any,
  admin: any,
  staff: any,
  products: any[],
  second: any;
let customerCookie: string,
  adminCookie: string,
  staffCookie: string,
  csrf: string,
  adminCsrf: string,
  staffCsrf: string;
const origin = process.env.APP_ORIGIN ?? "http://localhost:3002";
const address = {
  name: "Alex Morgan",
  phone: "01712345678",
  street: "House 3 Road 12",
  city: "Dhaka",
};
function body(p: any, q = 1) {
  return { items: [{ productId: p.id, quantity: q }], address };
}
function mutation(
  url: string,
  data: object,
  cookie = customerCookie,
  token = csrf,
) {
  return request(app.getHttpServer())
    .post("/api" + url)
    .set("Origin", origin)
    .set("Cookie", cookie)
    .set("X-CSRF-Token", token)
    .send(data);
}
async function place(p: any = products[0], q = 1) {
  return commerce.place(customer, body(p, q), randomUUID());
}
async function current(id: string) {
  return (await db.query("SELECT * FROM products WHERE id=$1", [id])).rows[0];
}
async function baselineStock(p: any, n: number) {
  await db.query("UPDATE products SET on_hand=$2,reserved=0 WHERE id=$1", [
    p.id,
    n,
  ]);
}
before(async () => {
  if (!process.env.PGDATABASE?.endsWith("_test"))
    throw new Error(
      "Refusing integration reset: PGDATABASE must end with _test",
    );
  db = new Database();
  await migrate(db);
  await db.query("TRUNCATE users,products,coupons,worker_heartbeat CASCADE");
  await seed(db);
  commerce = new CommerceService(db);
  products = (await db.query("SELECT * FROM products ORDER BY sku")).rows;
  customer = (await db.query("SELECT * FROM users WHERE role='CUSTOMER'"))
    .rows[0];
  admin = (await db.query("SELECT * FROM users WHERE role='ADMIN'")).rows[0];
  staff = (await db.query("SELECT * FROM users WHERE role='STAFF'")).rows[0];
  app = await createApp();
  await app.init();
  for (const [email, assign] of [
    [
      "customer@commerceflow.example",
      (r: any) => {
        customerCookie = r.headers["set-cookie"][0].split(";")[0];
        csrf = r.body.csrf;
      },
    ],
    [
      "admin@commerceflow.example",
      (r: any) => {
        adminCookie = r.headers["set-cookie"][0].split(";")[0];
        adminCsrf = r.body.csrf;
      },
    ],
    [
      "staff@commerceflow.example",
      (r: any) => {
        staffCookie = r.headers["set-cookie"][0].split(";")[0];
        staffCsrf = r.body.csrf;
      },
    ],
  ] as any) {
    const r = await request(app.getHttpServer())
      .post("/api/auth/login")
      .set("Origin", origin)
      .send({ email, password: process.env.DEMO_PASSWORD })
      .expect(200);
    assign(r);
  }
  await request(app.getHttpServer())
    .post("/api/auth/register")
    .set("Origin", origin)
    .send({
      email: "other@commerceflow.example",
      name: "Other Customer",
      password: "other-customer-password",
    })
    .expect(201);
  second = (
    await db.query(
      "SELECT * FROM users WHERE email='other@commerceflow.example'",
    )
  ).rows[0];
});
after(async () => {
  if (app) await app.close();
  if (db) await db.onModuleDestroy();
});
test("Prisma catalog returns accurate prices, categories and bounded pagination", async () => {
  const r = await request(app.getHttpServer())
    .get("/api/catalog/products?limit=2")
    .expect(200);
  assert.equal(r.body.items.length, 2);
  assert.equal(r.body.total, 8);
  assert.equal(
    r.body.items[0].available,
    r.body.items[0].onHand - r.body.items[0].reserved,
  );
  await request(app.getHttpServer())
    .get("/api/catalog/products?limit=1000")
    .expect(400);
  const c = await request(app.getHttpServer())
    .get("/api/catalog/categories")
    .expect(200);
  assert.equal(c.body.length, 4);
});
test("authorization blocks unauthenticated, forged-role and customer admin requests", async () => {
  await request(app.getHttpServer()).get("/api/orders").expect(401);
  await request(app.getHttpServer())
    .get("/api/admin/overview")
    .set("Cookie", customerCookie)
    .set("X-Role", "ADMIN")
    .expect(403);
  await request(app.getHttpServer())
    .get("/api/admin/overview")
    .set("Cookie", staffCookie)
    .expect(403);
});
test("CSRF, origin, duplicate lines and client supplied totals are rejected", async () => {
  await request(app.getHttpServer())
    .post("/api/orders")
    .set("Cookie", customerCookie)
    .send(body(products[0]))
    .expect(403);
  await mutation("/orders", body(products[0]))
    .set("Origin", "https://evil.example")
    .expect(403);
  await mutation("/orders", { ...body(products[0]), total: 1 })
    .set("Idempotency-Key", randomUUID())
    .expect(400);
  await mutation("/orders", {
    ...body(products[0]),
    items: [...body(products[0]).items, ...body(products[0]).items],
  })
    .set("Idempotency-Key", randomUUID())
    .expect(400);
});
test("checkout reserves stock, snapshots prices and repeated requests reuse one order", async () => {
  const p = products[0],
    before = await current(p.id),
    key = randomUUID();
  const a = await mutation("/orders", body(p))
    .set("Idempotency-Key", key)
    .expect(201);
  const b = await mutation("/orders", body(p))
    .set("Idempotency-Key", key)
    .expect(201);
  assert.equal(a.body.id, b.body.id);
  assert.equal((await current(p.id)).reserved, before.reserved + 1);
  await mutation("/orders", body(p, 2)).set("Idempotency-Key", key).expect(409);
  await db.query("UPDATE products SET price=price+100 WHERE id=$1", [p.id]);
  const detail = await commerce.detail(a.body.id, customer);
  assert.equal(detail.items[0].price, before.price);
  await commerce.cancel(a.body.id, customer);
  await db.query("UPDATE products SET price=$2 WHERE id=$1", [
    p.id,
    before.price,
  ]);
});
test(
  "same-SKU native contention cannot oversell the final unit",
  { skip: functional },
  async () => {
    const p = products[1];
    await baselineStock(p, 1);
    const users = Array.from({ length: 30 }, (_, i) => ({
      ...customer,
      id: i % 2 ? customer.id : second.id,
    }));
    const results = await Promise.allSettled(
      users.map((u) => commerce.place(u, body(p), randomUUID())),
    );
    const wins = results.filter(
      (r) => r.status === "fulfilled",
    ) as PromiseFulfilledResult<any>[];
    assert.equal(wins.length, 1);
    assert.equal(
      results.filter(
        (r) => r.status === "rejected" && (r.reason as any).getStatus() === 409,
      ).length,
      29,
    );
    assert.equal((await current(p.id)).reserved, 1);
    console.log(
      JSON.stringify({
        scenario: "30-concurrent-last-unit",
        successfulOrders: 1,
        conflicts: 29,
      }),
    );
    await commerce.cancel(
      wins[0].value.id,
      users[users.findIndex((_, i) => results[i].status === "fulfilled")],
    );
    await baselineStock(p, 18);
  },
);
test(
  "concurrent idempotent checkout retries reserve inventory once",
  { skip: functional },
  async () => {
    const p = products[2],
      k = randomUUID(),
      before = await current(p.id);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => commerce.place(customer, body(p), k)),
    );
    assert.equal(new Set(results.map((o) => o.id)).size, 1);
    assert.equal((await current(p.id)).reserved, before.reserved + 1);
    await commerce.cancel(results[0].id, customer);
  },
);
test("multi-product shortage rolls back every reservation", async () => {
  const good = products[0],
    bad = products[3],
    before = await current(good.id),
    b = await current(bad.id);
  await baselineStock(bad, 0);
  await assert.rejects(() =>
    commerce.place(
      customer,
      {
        items: [
          { productId: good.id, quantity: 1 },
          { productId: bad.id, quantity: 1 },
        ],
        address,
      },
      randomUUID(),
    ),
  );
  assert.equal((await current(good.id)).reserved, before.reserved);
  await baselineStock(bad, b.on_hand);
});
test("coupon pricing is server calculated and invalid/minimum coupons fail", async () => {
  const p = products[0];
  const o = await commerce.place(
    customer,
    { ...body(p), coupon: "WELCOME10" },
    randomUUID(),
  );
  assert.equal(o.discount, Math.floor(p.price * 0.1));
  await commerce.cancel(o.id, customer);
  await assert.rejects(() =>
    commerce.place(customer, { ...body(p), coupon: "INVALID" }, randomUUID()),
  );
});
test("ownership hides orders and prevents payment or cancellation by other customers", async () => {
  const o = await place();
  await assert.rejects(() => commerce.detail(o.id, second));
  await assert.rejects(() => commerce.cancel(o.id, second));
  await assert.rejects(() => commerce.simulate(o.id, second, "success"));
  await commerce.cancel(o.id, customer);
});
test("decline permits retry and duplicate success consumes stock only once", async () => {
  const p = products[0],
    before = await current(p.id),
    o = await place(p);
  await commerce.simulate(o.id, customer, "failed");
  const success = await commerce.simulate(o.id, customer, "success");
  assert.equal(success.status, "PAID");
  await commerce.simulate(o.id, customer, "success");
  await commerce.settle(
    o.payment.id,
    "another_" + randomUUID(),
    "success",
    o.total,
    "BDT",
    "sandbox",
  );
  const stock = await current(p.id);
  assert.equal(stock.on_hand, before.on_hand - 1);
  assert.equal(stock.reserved, before.reserved);
  await commerce.cancel(o.id, customer);
});
test("expiry releases stock without worker and late settlement creates one refund", async () => {
  const p = products[0],
    before = await current(p.id),
    o = await place(p);
  await db.query(
    "UPDATE orders SET expires_at=now()-interval '1 second' WHERE id=$1",
    [o.id],
  );
  assert.equal((await commerce.detail(o.id, customer)).status, "EXPIRED");
  assert.equal((await current(p.id)).reserved, before.reserved);
  const newer = await place(p);
  await commerce.settle(
    o.payment.id,
    "late_" + randomUUID(),
    "success",
    o.total,
    "BDT",
    "sandbox",
  );
  await commerce.settle(
    o.payment.id,
    "late_retry_" + randomUUID(),
    "success",
    o.total,
    "BDT",
    "sandbox",
  );
  assert.equal((await current(p.id)).reserved, before.reserved + 1);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM refunds WHERE order_id=$1",
        [o.id],
      )
    ).rows[0].n,
    1,
  );
  await commerce.cancel(newer.id, customer);
});
test("signed webhook rejects forged signatures, amount mismatch and changed event IDs", async () => {
  const o = await place(),
    eventId = randomUUID();
  function send(amount: number, signed = true) {
    const data = {
        paymentId: o.payment.id,
        eventId,
        outcome: "success",
        amount,
        currency: "BDT",
      },
      raw = JSON.stringify(data),
      t = String(Math.floor(Date.now() / 1000));
    return request(app.getHttpServer())
      .post("/api/payments/sandbox/webhook")
      .set("Content-Type", "application/json")
      .set("X-Webhook-Timestamp", t)
      .set(
        "X-Webhook-Signature",
        signed
          ? signature(process.env.WEBHOOK_SECRET, t, Buffer.from(raw))
          : "00".repeat(32),
      )
      .send(raw);
  }
  await send(o.total, false).expect(401);
  await send(1).expect(400);
  await send(o.total).expect(200);
  await send(o.total).expect(200);
  const changed = {
      paymentId: o.payment.id,
      eventId,
      outcome: "failed",
      amount: o.total,
      currency: "BDT",
    },
    raw = JSON.stringify(changed),
    t = String(Math.floor(Date.now() / 1000));
  await request(app.getHttpServer())
    .post("/api/payments/sandbox/webhook")
    .set("Content-Type", "application/json")
    .set("X-Webhook-Timestamp", t)
    .set(
      "X-Webhook-Signature",
      signature(process.env.WEBHOOK_SECRET, t, Buffer.from(raw)),
    )
    .send(raw)
    .expect(409);
  await commerce.cancel(o.id, customer);
});
test("cancellation restores inventory once and creates one refund", async () => {
  const p = products[0],
    before = await current(p.id),
    o = await place(p);
  await commerce.simulate(o.id, customer, "success");
  await commerce.cancel(o.id, customer);
  await commerce.cancel(o.id, customer);
  assert.equal((await current(p.id)).on_hand, before.on_hand);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM refunds WHERE order_id=$1",
        [o.id],
      )
    ).rows[0].n,
    1,
  );
});
test("fulfillment enforces ordered stages, requires tracking and blocks shipped cancellation", async () => {
  const o = await place();
  await commerce.simulate(o.id, customer, "success");
  await mutation(
    "/orders/" + o.id + "/fulfill",
    { status: "SHIPPED" },
    staffCookie,
    staffCsrf,
  ).expect(409);
  await mutation(
    "/orders/" + o.id + "/fulfill",
    { status: "PACKED" },
    customerCookie,
    csrf,
  ).expect(403);
  await mutation(
    "/orders/" + o.id + "/fulfill",
    { status: "PACKED" },
    staffCookie,
    staffCsrf,
  ).expect(201);
  await mutation(
    "/orders/" + o.id + "/fulfill",
    { status: "SHIPPED" },
    staffCookie,
    staffCsrf,
  ).expect(400);
  await mutation(
    "/orders/" + o.id + "/fulfill",
    { status: "SHIPPED", tracking: "TRACK123" },
    staffCookie,
    staffCsrf,
  ).expect(201);
  await assert.rejects(() => commerce.cancel(o.id, customer));
  await commerce.fulfill(o.id, staff, "DELIVERED");
});
test("return approval requires delivery and restocks only once", async () => {
  const p = products[0],
    before = await current(p.id),
    o = await place(p);
  await assert.rejects(() =>
    commerce.requestReturn(o.id, customer, "Not suitable"),
  );
  await commerce.simulate(o.id, customer, "success");
  await commerce.fulfill(o.id, staff, "PACKED");
  await commerce.fulfill(o.id, staff, "SHIPPED", "TRACK-RETURN");
  await commerce.fulfill(o.id, staff, "DELIVERED");
  await commerce.requestReturn(o.id, customer, "Not suitable for my needs");
  await commerce.decideReturn(o.id, admin, "APPROVED");
  await commerce.decideReturn(o.id, admin, "APPROVED");
  assert.equal((await current(p.id)).on_hand, before.on_hand);
  assert.equal((await commerce.detail(o.id, customer)).status, "RETURNED");
});
test("stock receiving is idempotent and product version prevents stale edits", async () => {
  const p = products[0],
    before = await current(p.id),
    k = randomUUID();
  await commerce.stock(p.id, admin, 5, k);
  await commerce.stock(p.id, admin, 5, k);
  await assert.rejects(() => commerce.stock(p.id, admin, 6, k));
  assert.equal((await current(p.id)).on_hand, before.on_hand + 5);
  await assert.rejects(() =>
    commerce.editProduct(p.id, admin, {
      price: p.price,
      active: true,
      version: before.version,
    }),
  );
});
test("outbox processing deduplicates notification and local refund effects", async () => {
  const o = await place();
  await commerce.simulate(o.id, customer, "success");
  await commerce.cancel(o.id, customer);
  const jobs = (
    await db.query("SELECT * FROM outbox WHERE order_id=$1", [o.id])
  ).rows;
  for (const j of jobs) {
    await processOutbox(db, j.id);
    await processOutbox(db, j.id);
  }
  const n = (
    await db.query(
      "SELECT count(*)::int AS n FROM notifications WHERE order_id=$1",
      [o.id],
    )
  ).rows[0].n;
  assert.equal(n, jobs.length);
  assert.equal(
    (await commerce.detail(o.id, customer)).refund.status,
    "COMPLETED",
  );
});
test("external provider payments cannot be simulated and refunds remain pending", async () => {
  const o = await place();
  await db.query("UPDATE payments SET provider='stripe' WHERE id=$1", [
    o.payment.id,
  ]);
  await assert.rejects(() => commerce.simulate(o.id, customer, "success"));
  await commerce.settle(
    o.payment.id,
    "external_" + randomUUID(),
    "success",
    o.total,
    "BDT",
    "stripe",
    "pi_mock",
  );
  await commerce.cancel(o.id, customer);
  const job = (
    await db.query(
      "SELECT id FROM outbox WHERE order_id=$1 AND kind='REFUND'",
      [o.id],
    )
  ).rows[0];
  await processOutbox(db, job.id);
  assert.equal(
    (await commerce.detail(o.id, customer)).refund.status,
    "PENDING",
  );
});
test("Redis/BullMQ drains outbox through a real worker", async () => {
  const o = await place();
  const handle = await startWorker();
  try {
    for (let n = 0; n < 30; n++) {
      if (
        (
          await db.query("SELECT 1 FROM notifications WHERE order_id=$1", [
            o.id,
          ])
        ).rowCount
      )
        break;
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.ok(
      (await db.query("SELECT 1 FROM notifications WHERE order_id=$1", [o.id]))
        .rowCount,
    );
  } finally {
    await handle.close();
  }
  await commerce.cancel(o.id, customer);
});

test("inventory ledger reconciles across reserve, sale, cancellation and restock", async () => {
  const p = await commerce.createProduct(admin, {
    sku: "QA-LEDGER",
    name: "Ledger Test Product",
    description: "A product for lifecycle reconciliation.",
    category: "Test",
    price: 100000,
    onHand: 10,
  });
  const o = await place(p, 2);
  await commerce.simulate(o.id, customer, "success");
  await commerce.cancel(o.id, customer);
  await commerce.stock(p.id, admin, 3, randomUUID());
  const row = await current(p.id);
  const sums = (
    await db.query(
      "SELECT COALESCE(sum(on_hand_delta),0)::int AS hand,COALESCE(sum(reserved_delta),0)::int AS reserved FROM inventory_ledger WHERE product_id=$1",
      [p.id],
    )
  ).rows[0];
  assert.equal(sums.hand, row.on_hand);
  assert.equal(sums.reserved, row.reserved);
});
test("missing address is rejected and returns close after fourteen days", async () => {
  await mutation("/orders", {
    items: [{ productId: products[0].id, quantity: 1 }],
  })
    .set("Idempotency-Key", randomUUID())
    .expect(400);
  const o = await place();
  await commerce.simulate(o.id, customer, "success");
  await commerce.fulfill(o.id, staff, "PACKED");
  await commerce.fulfill(o.id, staff, "SHIPPED", "TRACK-WINDOW");
  await commerce.fulfill(o.id, staff, "DELIVERED");
  await db.query(
    "UPDATE orders SET delivered_at=now()-interval '15 days' WHERE id=$1",
    [o.id],
  );
  await assert.rejects(() =>
    commerce.requestReturn(o.id, customer, "Outside the return window"),
  );
});
test("logout revokes sessions immediately", async () => {
  await mutation("/auth/logout", {}).expect(200);
  await request(app.getHttpServer())
    .get("/api/orders")
    .set("Cookie", customerCookie)
    .expect(401);
});
