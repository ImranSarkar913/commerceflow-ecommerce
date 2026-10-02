import "dotenv/config";
function integer(k: string, d: number, min = 1, max = 100000) {
  const n = Number(process.env[k] ?? d);
  if (!Number.isSafeInteger(n) || n < min || n > max)
    throw new Error(`Invalid ${k}`);
  return n;
}
function required(k: string) {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is required`);
  return v;
}
export const config = {
  port: integer("PORT", 5002),
  db: {
    host: process.env.PGHOST ?? "localhost",
    port: integer("PGPORT", 5432),
    database: process.env.PGDATABASE ?? "commerceflow",
    user: process.env.PGUSER ?? "commerceflow",
    password: required("PGPASSWORD"),
    max: integer("DB_POOL_MAX", 20, 1, 100),
  },
  redis: process.env.REDIS_URL ?? "redis://localhost:6379",
  origin: process.env.APP_ORIGIN ?? "http://localhost:3002",
  secure: process.env.COOKIE_SECURE === "true",
  holdSeconds: integer("HOLD_SECONDS", 600, 10, 1800),
  webhookSecret: required("WEBHOOK_SECRET"),
  sandbox: process.env.ENABLE_SANDBOX !== "false",
  stripe: process.env.STRIPE_ENABLED === "true",
  stripeKey: process.env.STRIPE_SECRET_KEY ?? "",
  stripeWebhook: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  bkash: process.env.BKASH_ENABLED === "true",
  callback: process.env.PAYMENT_CALLBACK_ORIGIN ?? "http://localhost:3002",
};
if (config.webhookSecret.length < 32)
  throw new Error("WEBHOOK_SECRET must be at least 32 characters");
if (
  config.stripe &&
  (!config.stripeKey.startsWith("sk_test_") ||
    !config.stripeWebhook.startsWith("whsec_"))
)
  throw new Error("Stripe requires test-mode credentials and a webhook secret");
if (
  (config.stripe || config.bkash) &&
  new URL(config.callback).protocol !== "https:"
)
  throw new Error("External providers require a public HTTPS callback origin");
if (process.env.NODE_ENV === "production" && !config.secure)
  throw new Error("Production requires secure cookies");

if (
  config.bkash &&
  [
    "BKASH_USERNAME",
    "BKASH_PASSWORD",
    "BKASH_APP_KEY",
    "BKASH_APP_SECRET",
  ].some((k) => !process.env[k])
)
  throw new Error("bKash requires complete sandbox credentials");
