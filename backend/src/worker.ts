import "reflect-metadata";
import Redis from "ioredis";
import { Queue, Worker } from "bullmq";
import { Database } from "./db";
import { CommerceService } from "./commerce";
import { PaymentsService } from "./payments";
import { config } from "./config";
export async function processOutbox(db: Database, id: string) {
  return db.tx(async (c) => {
    const record = (
      await c.query("SELECT * FROM outbox WHERE id=$1 FOR UPDATE", [id])
    ).rows[0];
    if (!record || record.processed_at) return;
    const o = (
      await c.query("SELECT * FROM orders WHERE id=$1", [record.order_id])
    ).rows[0];
    if (record.kind === "REFUND") {
      const r = (
        await c.query(
          "SELECT r.*,p.provider FROM refunds r JOIN payments p ON p.id=r.payment_id WHERE r.order_id=$1 FOR UPDATE OF r",
          [o.id],
        )
      ).rows[0];
      if (r?.status === "PENDING") {
        if (r.provider === "sandbox") {
          await c.query(
            "UPDATE refunds SET status='COMPLETED',completed_at=now(),reference=$2 WHERE id=$1",
            [r.id, "simulated_" + r.id],
          );
          await c.query(
            "INSERT INTO audit(order_id,action,details) VALUES($1,'SIMULATED_REFUND_COMPLETED',$2)",
            [o.id, JSON.stringify({ refundId: r.id })],
          );
        }
        // An external refund job delivers an obligation notification; merchant action remains manual.
      }
    }
    await c.query(
      "INSERT INTO notifications(id,user_id,order_id,message) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING",
      [id, o.user_id, o.id, record.payload.message],
    );
    await c.query(
      "UPDATE outbox SET processed_at=now(),last_error=NULL WHERE id=$1",
      [id],
    );
  });
}
export async function startWorker() {
  const db = new Database();
  const commerce = new CommerceService(db);
  const payments = new PaymentsService(db, commerce);
  const connection = new Redis(config.redis, { maxRetriesPerRequest: null });
  const queue = new Queue("commerceflow-jobs", { connection });
  const worker = new Worker(
    "commerceflow-jobs",
    async (job) => processOutbox(db, job.data.id),
    { connection, concurrency: 4 },
  );
  worker.on("error", () =>
    console.error(JSON.stringify({ event: "queue_error" })),
  );
  worker.on("failed", async (job) => {
    if (job)
      try {
        await db.query(
          "UPDATE outbox SET attempts=attempts+1,last_error=$2,published_at=NULL WHERE id=$1 AND processed_at IS NULL",
          [job.data.id, "Background processing failed; retry scheduled"],
        );
      } catch {
        console.error(
          JSON.stringify({ event: "outbox_error_recording_failed" }),
        );
      }
  });
  let busy = false,
    closing = false;
  async function tick() {
    if (busy || closing) return;
    busy = true;
    try {
      await commerce.sweep();
      await db.query(
        "INSERT INTO worker_heartbeat(name,seen_at) VALUES('commerceflow-worker',now()) ON CONFLICT(name) DO UPDATE SET seen_at=now()",
      );
      const rows = (
        await db.query(
          "SELECT id FROM outbox WHERE processed_at IS NULL AND (published_at IS NULL OR published_at<now()-interval '1 minute') AND attempts<10 ORDER BY created_at LIMIT 50",
        )
      ).rows;
      for (const row of rows) {
        const existing = await queue.getJob(row.id);
        if (existing) {
          const state = await existing.getState();
          if (state === "failed" || state === "completed")
            await existing.remove();
        }
        await queue.add(
          "dispatch",
          { id: row.id },
          {
            jobId: row.id,
            attempts: 3,
            backoff: { type: "exponential", delay: 1000 },
            removeOnComplete: 1000,
            removeOnFail: 1000,
          },
        );
        await db.query("UPDATE outbox SET published_at=now() WHERE id=$1", [
          row.id,
        ]);
      }
    } catch {
      console.error(JSON.stringify({ event: "worker_tick_deferred" }));
    } finally {
      busy = false;
    }
  }
  let verifying = false;
  const reconciliation = setInterval(async () => {
    if (verifying || closing) return;
    verifying = true;
    try {
      await payments.reconcile();
    } catch {
      console.warn(JSON.stringify({ event: "reconciliation_tick_deferred" }));
    } finally {
      verifying = false;
    }
  }, 60000);
  const interval = setInterval(tick, 5000);
  await tick();
  return {
    queue,
    worker,
    async close() {
      closing = true;
      clearInterval(interval);
      clearInterval(reconciliation);
      while (busy || verifying) await new Promise((r) => setTimeout(r, 100));
      await worker.close();
      await queue.close();
      connection.disconnect();
      await db.onModuleDestroy();
    },
  };
}
if (require.main === module)
  startWorker()
    .then((handle) => {
      for (const signal of ["SIGINT", "SIGTERM"])
        process.on(signal, () => handle.close().then(() => process.exit(0)));
    })
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    });
