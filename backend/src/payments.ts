import {
  Injectable,
  BadRequestException,
  ConflictException,
} from "@nestjs/common";
import { Database } from "./db";
import { CommerceService } from "./commerce";
import { User } from "./auth";
import { config } from "./config";
import { hash } from "./crypto";
import { ExternalProvider, initiate, lookup } from "./providers";
@Injectable()
export class PaymentsService {
  constructor(
    private readonly db: Database,
    private readonly commerce: CommerceService,
  ) {}
  methods() {
    return {
      sandbox: config.sandbox,
      stripe: config.stripe,
      bkash: config.bkash,
    };
  }
  async create(orderId: string, u: User, provider: ExternalProvider) {
    if (!config[provider]) throw new BadRequestException("Provider disabled");
    await this.commerce.detail(orderId, u);
    const claim = await this.db.tx(async (c) => {
      const o = await this.commerce.locked(c, orderId, u);
      if (o.status !== "PENDING" || !o.eligible)
        throw new ConflictException("Order is not payable");
      const p = (
        await c.query("SELECT * FROM payments WHERE order_id=$1 FOR UPDATE", [
          orderId,
        ])
      ).rows[0];
      if (p.provider !== "sandbox" && p.provider !== provider)
        throw new ConflictException("This order already uses another provider");
      if (p.state === "READY") return { p, reuse: true };
      if (p.state === "SUCCEEDED")
        throw new ConflictException("Payment already settled");
      if (
        p.state === "INITIATING" ||
        (p.state === "UNKNOWN" && provider === "bkash")
      )
        throw new ConflictException(
          "Checkout initiation is uncertain. Do not create a second payment; check My orders or contact support.",
        );
      await c.query(
        "UPDATE payments SET provider=$2,state='INITIATING',last_checked_at=now() WHERE id=$1",
        [p.id, provider],
      );
      return { p: { ...p, provider }, reuse: false };
    });
    if (claim.reuse) return { url: claim.p.checkout_url };
    try {
      const r = await initiate(provider, claim.p);
      const saved = await this.db.query(
        "UPDATE payments SET state='READY',remote_id=$2,checkout_url=$3 WHERE id=$1 AND state IN ('INITIATING','UNKNOWN') RETURNING id",
        [claim.p.id, r.id, r.url],
      );
      if (!saved.rowCount)
        throw new ConflictException(
          "Payment status changed; open My orders and do not pay again.",
        );
      return { url: r.url };
    } catch (e) {
      if (!(e instanceof ConflictException))
        await this.db.query(
          "UPDATE payments SET state='UNKNOWN' WHERE id=$1 AND state='INITIATING'",
          [claim.p.id],
        );
      throw e;
    }
  }
  async verifyPayment(paymentId: string, u?: User, execute = false) {
    const row = (
      await this.db.query(
        "SELECT p.*,o.user_id FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.id=$1",
        [paymentId],
      )
    ).rows[0];
    if (!row || (u && u.role === "CUSTOMER" && row.user_id !== u.id))
      throw new BadRequestException("Payment unavailable");
    if (row.provider === "sandbox" || !row.remote_id) return { pending: true };
    // A dedicated connection holds the provider verification mutex, outside any SQL transaction.
    const c = await this.db.pool.connect();
    let locked = false;
    try {
      locked = (
        await c.query(
          "SELECT pg_try_advisory_lock(hashtextextended($1,7)) AS ok",
          [paymentId],
        )
      ).rows[0].ok;
      if (!locked) return { pending: true };
      const p = (
        await c.query("SELECT * FROM payments WHERE id=$1", [paymentId])
      ).rows[0];
      if (p.state === "SUCCEEDED") return { settled: true };
      const reference = await lookup(p, execute);
      await c.query("UPDATE payments SET last_checked_at=now() WHERE id=$1", [
        p.id,
      ]);
      if (!reference) return { pending: true };
      return await this.commerce.settle(
        p.id,
        "verified_" + hash(p.provider + ":" + reference),
        "success",
        p.amount,
        p.currency,
        p.provider,
        reference,
        c,
      );
    } finally {
      if (locked) {
        try {
          await c.query("SELECT pg_advisory_unlock(hashtextextended($1,7))", [
            paymentId,
          ]);
          c.release();
        } catch {
          c.release(true);
        }
      } else c.release();
    }
  }
  async stripeNotification(session: any) {
    if (typeof session?.metadata?.paymentId !== "string")
      return { ignored: true };
    return this.verifyPayment(session.metadata.paymentId);
  }
  async bkashReturn(remoteId: string) {
    const p = (
      await this.db.query(
        "SELECT id FROM payments WHERE provider='bkash' AND remote_id=$1",
        [remoteId],
      )
    ).rows[0];
    if (!p) throw new BadRequestException("Unknown bKash checkout");
    return this.verifyPayment(p.id, undefined, true);
  }
  async reconcile() {
    await this.db.query(
      "UPDATE payments SET state='UNKNOWN' WHERE state='INITIATING' AND last_checked_at<now()-interval '1 minute'",
    );
    const rows = (
      await this.db.query(
        "SELECT id FROM payments WHERE provider<>'sandbox' AND remote_id IS NOT NULL AND state<>'SUCCEEDED' AND created_at>now()-interval '7 days' AND (last_checked_at IS NULL OR last_checked_at<now()-interval '1 minute') ORDER BY last_checked_at NULLS FIRST LIMIT 3",
      )
    ).rows;
    for (const p of rows) {
      try {
        await this.verifyPayment(p.id);
      } catch {
        await this.db.query(
          "UPDATE payments SET last_checked_at=now() WHERE id=$1",
          [p.id],
        );
        console.warn(
          JSON.stringify({
            event: "payment_reconciliation_deferred",
            paymentId: p.id,
          }),
        );
      }
    }
  }
}
