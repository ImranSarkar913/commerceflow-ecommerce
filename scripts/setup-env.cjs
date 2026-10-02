const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const target = path.join(root, ".env");
if (fs.existsSync(target)) {
  console.log("Existing .env preserved.");
  process.exit(0);
}
let text = fs.readFileSync(path.join(root, ".env.example"), "utf8");
for (const [key, size] of [
  ["POSTGRES_PASSWORD", 24],
  ["DEMO_PASSWORD", 18],
  ["WEBHOOK_SECRET", 32],
])
  text = text.replace(
    new RegExp("^" + key + "=.*$", "m"),
    key + "=" + crypto.randomBytes(size).toString("hex"),
  );
fs.writeFileSync(target, text, { mode: 0o600 });
console.log(
  "Local .env created. Open it locally to view DEMO_PASSWORD. Providers are disabled.",
);
