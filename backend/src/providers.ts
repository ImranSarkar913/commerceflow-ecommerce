import Stripe from "stripe";
import { BadGatewayException, BadRequestException } from "@nestjs/common";
import { config } from "./config";
export type ExternalProvider = "stripe" | "bkash";
export function paisa(v: unknown) {
  if (typeof v !== "string" || !/^\d{1,9}(?:\.\d{1,2})?$/.test(v))
    throw new BadRequestException("Invalid provider amount");
  const [a, b = ""] = v.split(".");
  return Number(a) * 100 + Number(b.padEnd(2, "0"));
}
export function checkoutUrl(v: unknown, provider: ExternalProvider) {
  if (typeof v !== "string" || v.length > 8192)
    throw new BadGatewayException("Invalid checkout URL");
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    throw new BadGatewayException("Invalid checkout URL");
  }
  const allowed =
    provider === "stripe"
      ? ["checkout.stripe.com"]
      : ["sandbox.payment.bkash.com", "tokenized.sandbox.bka.sh"];
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    (u.port && u.port !== "443") ||
    !allowed.includes(u.hostname)
  )
    throw new BadGatewayException("Untrusted checkout URL");
  return u.href;
}
export const stripe = () =>
  new Stripe(config.stripeKey, { maxNetworkRetries: 1, timeout: 15000 });
async function request(
  path: string,
  body: object,
  headers: Record<string, string> = {},
) {
  try {
    const r = await fetch(
      "https://tokenized.sandbox.bka.sh/v1.2.0-beta/tokenized/checkout/" + path,
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...headers,
        },
        body: JSON.stringify(body),
      },
    );
    if (!r.ok) throw new Error();
    const text = await r.text();
    if (text.length > 131072) throw new Error();
    const data = JSON.parse(text);
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new Error();
    return data;
  } catch {
    throw new BadGatewayException(
      "Provider unavailable. Payment status may be uncertain; do not pay again.",
    );
  }
}
let cached: { value: string; expires: number } | undefined;
let granting: Promise<string> | undefined;
async function bkashToken() {
  if (cached && cached.expires > Date.now()) return cached.value;
  if (granting) return granting;
  granting = (async () => {
    const r = await request(
      "token/grant",
      {
        app_key: process.env.BKASH_APP_KEY,
        app_secret: process.env.BKASH_APP_SECRET,
      },
      {
        username: process.env.BKASH_USERNAME ?? "",
        password: process.env.BKASH_PASSWORD ?? "",
      },
    );
    if (r.statusCode !== "0000" || typeof r.id_token !== "string")
      throw new BadGatewayException("bKash authentication failed");
    const ttl = Number(r.expires_in);
    cached = {
      value: r.id_token,
      expires:
        Date.now() +
        Math.max(30, Math.min(Number.isFinite(ttl) ? ttl : 300, 3600) - 60) *
          1000,
    };
    return r.id_token;
  })();
  try {
    return await granting;
  } finally {
    granting = undefined;
  }
}
export async function bkash(path: string, body: object) {
  return request(path, body, {
    authorization: await bkashToken(),
    "x-app-key": process.env.BKASH_APP_KEY ?? "",
  });
}
async function safeStripeCreate(
  params: Stripe.Checkout.SessionCreateParams,
  options: Stripe.RequestOptions,
) {
  try {
    return await stripe().checkout.sessions.create(params, options);
  } catch {
    throw new BadGatewayException(
      "Stripe checkout initiation is uncertain; retry uses the same provider idempotency key.",
    );
  }
}
async function safeStripeRetrieve(id: string) {
  try {
    return await stripe().checkout.sessions.retrieve(id);
  } catch {
    throw new BadGatewayException(
      "Stripe verification temporarily unavailable; do not pay again.",
    );
  }
}
export async function initiate(provider: ExternalProvider, p: any) {
  if (provider === "stripe") {
    const session = await safeStripeCreate(
      {
        mode: "payment",
        client_reference_id: p.order_id,
        metadata: { paymentId: p.id },
        line_items: [
          {
            price_data: {
              currency: "bdt",
              unit_amount: p.amount,
              product_data: {
                name: "CommerceFlow order " + p.order_id.slice(0, 8),
              },
            },
            quantity: 1,
          },
        ],
        success_url: config.callback + "/?payment=return",
        cancel_url: config.callback + "/?payment=cancelled",
      },
      { idempotencyKey: "commerceflow_checkout_" + p.id },
    );
    return { id: session.id, url: checkoutUrl(session.url, provider) };
  }
  const r = await bkash("create", {
    mode: "0011",
    payerReference: p.order_id,
    callbackURL: config.callback + "/api/payments/bkash/return",
    amount: (p.amount / 100).toFixed(2),
    currency: "BDT",
    intent: "sale",
    merchantInvoiceNumber: p.invoice,
  });
  if (r.statusCode !== "0000" || typeof r.paymentID !== "string")
    throw new BadGatewayException("bKash checkout initialization failed");
  return { id: r.paymentID, url: checkoutUrl(r.bkashURL, provider) };
}
export function verifyStripe(s: any, p: any) {
  if (s.payment_status !== "paid") return null;
  if (
    s.livemode !== false ||
    s.id !== p.remote_id ||
    s.client_reference_id !== p.order_id ||
    s.metadata?.paymentId !== p.id ||
    s.amount_total !== p.amount ||
    s.currency !== "bdt" ||
    typeof s.payment_intent !== "string"
  )
    throw new BadRequestException(
      "Stripe settlement identity or amount mismatch",
    );
  return s.payment_intent;
}
export function verifyBkash(s: any, p: any) {
  if (s.transactionStatus !== "Completed") return null;
  if (
    s.paymentID !== p.remote_id ||
    s.intent !== "sale" ||
    (s.merchantInvoiceNumber ?? s.merchantInvoice) !== p.invoice ||
    paisa(s.amount) !== p.amount ||
    s.currency !== "BDT" ||
    typeof s.trxID !== "string" ||
    !s.trxID ||
    s.trxID.length > 120
  )
    throw new BadRequestException(
      "bKash settlement identity or amount mismatch",
    );
  return s.trxID;
}
export async function lookup(p: any, execute = false) {
  if (p.provider === "stripe") {
    const r = await safeStripeRetrieve(p.remote_id);
    return verifyStripe(r, p);
  }
  let r = await bkash("payment/status", { paymentID: p.remote_id });
  if (r.transactionStatus === "Completed") return verifyBkash(r, p);
  if (execute && ["Initiated", "Pending"].includes(r.transactionStatus)) {
    try {
      r = await bkash("execute", { paymentID: p.remote_id });
    } catch {
      r = await bkash("payment/status", { paymentID: p.remote_id });
    }
    return verifyBkash(r, p);
  }
  return null;
}
