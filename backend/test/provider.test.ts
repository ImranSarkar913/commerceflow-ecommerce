import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
process.env.PGPASSWORD ??= "test-only";
process.env.WEBHOOK_SECRET ??=
  "test-only-signing-secret-at-least-32-characters";
const {
  paisa,
  checkoutUrl,
  verifyStripe,
  verifyBkash,
} = require("../dist/providers");
const p = {
  id: "pay",
  order_id: "order",
  remote_id: "cs_test",
  amount: 129050,
  invoice: "invoice",
};
test("provider amount parsing is decimal exact and rejects malformed values", () => {
  assert.equal(paisa("1290.50"), 129050);
  for (const v of ["1e3", "-1", "1.001", " 10", "NaN"])
    assert.throws(() => paisa(v));
});
test("checkout redirect allowlist rejects lookalikes and embedded credentials", () => {
  assert.equal(
    checkoutUrl("https://checkout.stripe.com/c/pay/test", "stripe"),
    "https://checkout.stripe.com/c/pay/test",
  );
  for (const v of [
    "http://checkout.stripe.com/x",
    "https://checkout.stripe.com.evil.test",
    "https://user:pass@checkout.stripe.com",
    "https://checkout.stripe.com:444/x",
  ])
    assert.throws(() => checkoutUrl(v, "stripe"));
});
test("Stripe settlement binds test mode, amount, currency, order and local payment", () => {
  const s = {
    payment_status: "paid",
    livemode: false,
    id: p.remote_id,
    client_reference_id: p.order_id,
    metadata: { paymentId: p.id },
    amount_total: p.amount,
    currency: "bdt",
    payment_intent: "pi_test",
  };
  assert.equal(verifyStripe(s, p), "pi_test");
  for (const patch of [
    { livemode: true },
    { amount_total: 1 },
    { currency: "usd" },
    { client_reference_id: "other" },
    { metadata: { paymentId: "other" } },
  ])
    assert.throws(() => verifyStripe({ ...s, ...patch }, p));
  assert.equal(verifyStripe({ ...s, payment_status: "unpaid" }, p), null);
});
test("bKash completion binds invoice, remote payment, amount and settlement reference", () => {
  const s = {
    transactionStatus: "Completed",
    paymentID: p.remote_id,
    intent: "sale",
    merchantInvoiceNumber: p.invoice,
    amount: "1290.50",
    currency: "BDT",
    trxID: "TRX123",
  };
  assert.equal(verifyBkash(s, p), "TRX123");
  for (const patch of [
    { amount: "1.00" },
    { paymentID: "other" },
    { merchantInvoiceNumber: "other" },
    { intent: "authorization" },
    { currency: "USD" },
    { trxID: "" },
  ])
    assert.throws(() => verifyBkash({ ...s, ...patch }, p));
});

test("Stripe webhook signature validation rejects changed raw bytes", () => {
  const Stripe = require("stripe");
  const client = new Stripe("sk_test_mock_only");
  const raw = JSON.stringify({
      id: "evt_test",
      type: "checkout.session.completed",
    }),
    secret = "whsec_mock_only";
  const header = client.webhooks.generateTestHeaderString({
    payload: raw,
    secret,
  });
  assert.equal(
    client.webhooks.constructEvent(raw, header, secret).id,
    "evt_test",
  );
  assert.throws(() =>
    client.webhooks.constructEvent(raw + " ", header, secret),
  );
});

test("bKash initialization uses the stored amount and a timed-out execute is queried", async () => {
  const original = globalThis.fetch;
  const calls: any[] = [];
  let queries = 0;
  globalThis.fetch = async (url: any, options: any) => {
    const body = JSON.parse(options.body);
    calls.push({ url: String(url), body });
    let response: any;
    if (String(url).endsWith("/token/grant"))
      response = {
        statusCode: "0000",
        id_token: "mock-token",
        expires_in: 300,
      };
    else if (String(url).endsWith("/create"))
      response = {
        statusCode: "0000",
        paymentID: "REMOTE",
        bkashURL: "https://tokenized.sandbox.bka.sh/checkout",
      };
    else if (String(url).endsWith("/execute"))
      throw new Error("network timeout");
    else
      response =
        ++queries === 1
          ? { transactionStatus: "Initiated" }
          : {
              transactionStatus: "Completed",
              paymentID: "REMOTE",
              intent: "sale",
              merchantInvoiceNumber: p.invoice,
              amount: "1290.50",
              currency: "BDT",
              trxID: "TRX_RECOVERED",
            };
    return { ok: true, text: async () => JSON.stringify(response) } as Response;
  };
  try {
    const providers = require("../dist/providers");
    const r = await providers.initiate("bkash", p);
    assert.equal(r.id, "REMOTE");
    assert.equal(
      calls.find((c) => c.url.endsWith("/create")).body.amount,
      "1290.50",
    );
    assert.equal(
      await providers.lookup(
        { ...p, provider: "bkash", remote_id: "REMOTE" },
        true,
      ),
      "TRX_RECOVERED",
    );
    assert.equal(queries, 2);
  } finally {
    globalThis.fetch = original;
  }
});
