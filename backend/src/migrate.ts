import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Database } from "./db";
export async function migrate(db: Database) {
  await db.tx(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(88271022)");
    await c.query(
      "CREATE TABLE IF NOT EXISTS migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const name of readdirSync(join(process.cwd(), "migrations"))
      .filter((x) => x.endsWith(".sql"))
      .sort()) {
      const sql = readFileSync(
        join(process.cwd(), "migrations", name),
        "utf8",
      ).replace(/\r\n/g, "\n");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const existing = (
        await c.query("SELECT checksum FROM migrations WHERE name=$1", [name])
      ).rows[0];
      if (existing) {
        if (existing.checksum !== checksum)
          throw new Error("Migration checksum mismatch: " + name);
        continue;
      }
      await c.query(sql);
      await c.query("INSERT INTO migrations(name,checksum) VALUES($1,$2)", [
        name,
        checksum,
      ]);
      console.log("Applied " + name);
    }
  });
}
if (require.main === module) {
  const db = new Database();
  migrate(db)
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    })
    .finally(() => db.onModuleDestroy());
}
