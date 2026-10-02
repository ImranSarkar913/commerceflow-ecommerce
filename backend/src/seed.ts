import { Database } from "./db";
import { CommerceService } from "./commerce";
import { passwordHash } from "./crypto";
export async function seed(db: Database) {
  const password = process.env.DEMO_PASSWORD;
  if (
    process.env.ALLOW_DEMO_SEED !== "true" ||
    !password ||
    password.length < 12 ||
    password.length > 128
  )
    throw new Error(
      "Seed requires ALLOW_DEMO_SEED=true and DEMO_PASSWORD (12-128 characters)",
    );
  const c = new CommerceService(db);
  await db.tx(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(88271023)");
    if ((await tx.query("SELECT 1 FROM users LIMIT 1")).rowCount)
      throw new Error("Seed refused: user database is not empty");
    let admin: string = "";
    for (const role of ["CUSTOMER", "STAFF", "ADMIN"]) {
      const u = (
        await tx.query(
          "INSERT INTO users(email,name,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id",
          [
            role.toLowerCase() + "@commerceflow.example",
            role === "CUSTOMER"
              ? "Alex Morgan"
              : role === "STAFF"
                ? "Jordan Lee"
                : "Morgan Chen",
            await passwordHash(password),
            role,
          ],
        )
      ).rows[0];
      if (role === "ADMIN") admin = u.id;
    }
    const products = [
      [
        "CF-KB-001",
        "Studio Mechanical Keyboard",
        "Quiet tactile switches, a durable aluminum frame and a comfortable typing angle.",
        "Workspace",
        849900,
        25,
      ],
      [
        "CF-HD-002",
        "Arc Wireless Headphones",
        "Balanced audio, soft ear cushions and reliable all-day battery life.",
        "Audio",
        699000,
        18,
      ],
      [
        "CF-LP-003",
        "Orbit Desk Light",
        "Adjustable warm lighting with a weighted base and minimal silhouette.",
        "Workspace",
        329000,
        30,
      ],
      [
        "CF-BG-004",
        "Everyday Carry Backpack",
        "Water-resistant fabric, padded laptop storage and thoughtful internal pockets.",
        "Travel",
        459000,
        20,
      ],
      [
        "CF-BT-005",
        "Insulated Steel Bottle",
        "A reusable stainless steel bottle that keeps drinks at the right temperature.",
        "Essentials",
        129050,
        40,
      ],
      [
        "CF-MS-006",
        "Precision Wireless Mouse",
        "A compact ergonomic mouse with smooth tracking and multi-device support.",
        "Workspace",
        279000,
        24,
      ],
      [
        "CF-NB-007",
        "Canvas Notebook Set",
        "Three durable notebooks with smooth pages for notes, sketches and daily planning.",
        "Essentials",
        89500,
        50,
      ],
      [
        "CF-SP-008",
        "Pocket Bluetooth Speaker",
        "Portable sound in a compact enclosure with simple tactile controls.",
        "Audio",
        249000,
        15,
      ],
    ];
    for (const [sku, name, description, category, price, stock] of products) {
      const p = (
        await tx.query(
          "INSERT INTO products(sku,name,description,category,price,on_hand) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
          [sku, name, description, category, price, stock],
        )
      ).rows[0];
      await c.ledger(
        tx,
        p.id,
        null,
        admin,
        "OPENING",
        Number(stock),
        0,
        "OPENING:" + p.id,
      );
    }
    await tx.query(
      "INSERT INTO coupons(code,percent,minimum,max_uses,expires_at) VALUES('WELCOME10',10,100000,1000,now()+interval '90 days')",
    );
  });
  console.log(
    "Demo ready: customer / staff / admin @commerceflow.example. Password is your DEMO_PASSWORD.",
  );
}
if (require.main === module) {
  const db = new Database();
  seed(db)
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    })
    .finally(() => db.onModuleDestroy());
}
