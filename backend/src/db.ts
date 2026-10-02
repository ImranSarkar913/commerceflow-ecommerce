import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Pool, PoolClient, QueryResultRow } from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "./config";
@Injectable()
export class Database implements OnModuleDestroy {
  readonly pool = new Pool({
    ...config.db,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
  });
  readonly prisma = new PrismaClient({
    adapter: new PrismaPg(this.pool, { disposeExternalPool: false }),
  });
  constructor() {
    this.pool.on("error", () =>
      console.error(JSON.stringify({ event: "database_pool_error" })),
    );
  }
  query<T extends QueryResultRow = any>(sql: string, args: unknown[] = []) {
    return this.pool.query<T>(sql, args);
  }
  async tx<T>(fn: (c: PoolClient) => Promise<T>, client?: PoolClient) {
    const c = client ?? (await this.pool.connect());
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL lock_timeout='5s'");
      await c.query("SET LOCAL statement_timeout='12s'");
      const result = await fn(c);
      await c.query("COMMIT");
      return result;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      if (!client) c.release();
    }
  }
  async onModuleDestroy() {
    await this.prisma.$disconnect();
    await this.pool.end();
  }
}
