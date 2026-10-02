import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { Database } from "./db";
import { User } from "./auth";
import { config } from "./config";
import { canonical, key, money, nextStage, pricing } from "./domain";
import { hash } from "./crypto";
import { OrderDto, PageDto, ProductDto, PriceDto, CouponDto } from "./dto";
export type Query = Pick<PoolClient, "query">;
@Injectable()
export class CommerceService {
  constructor(private readonly db: Database) {}
  async catalog(q: PageDto) {
    const where = {
      active: true,
      ...(q.category ? { category: q.category } : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: "insensitive" as const } },
              { sku: { contains: q.search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.db.prisma.product.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      }),
      this.db.prisma.product.count({ where }),
    ]);
    return {
      items: items.map((p) => ({ ...p, available: p.onHand - p.reserved })),
      total,
      page: q.page,
      limit: q.limit,
    };
  }
  async categories() {
    return (
      await this.db.prisma.product.findMany({
        where: { active: true },
        distinct: ["category"],
        select: { category: true },
        orderBy: { category: "asc" },
      })
    ).map((p) => p.category);
  }
  async audit(
    c: Query,
    orderId: string | null,
    actor: string | null,
    action: string,
    details: object = {},
  ) {
    await c.query(
      "INSERT INTO audit(order_id,actor_id,action,details) VALUES($1,$2,$3,$4)",
      [orderId, actor, action, JSON.stringify(details)],
    );
  }
  async emit(c: Query, orderId: string, message: string, kind = "NOTIFY") {
    await c.query(
      "INSERT INTO outbox(order_id,kind,payload) VALUES($1,$2,$3)",
      [orderId, kind, JSON.stringify({ message })],
    );
  }
  async ledger(
    c: Query,
    p: string,
    o: string | null,
    actor: string | null,
    kind: string,
    onHand: number,
    reserved: number,
    reference: string,
  ) {
    await c.query(
      "INSERT INTO inventory_ledger(product_id,order_id,actor_id,kind,on_hand_delta,reserved_delta,reference) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [p, o, actor, kind, onHand, reserved, reference],
    );
  }
  async locked(c: Query, id: string, u?: User) {
    const o = (
      await c.query(
        "SELECT *,expires_at>clock_timestamp() AS eligible FROM orders WHERE id=$1 FOR UPDATE",
        [id],
      )
    ).rows[0];
    if (!o || (u && u.role === "CUSTOMER" && o.user_id !== u.id))
      throw new NotFoundException("Order not found");
    return o;
  }
  async items(c: Query, id: string) {
    return (
      await c.query(
        "SELECT * FROM order_items WHERE order_id=$1 ORDER BY product_id",
        [id],
      )
    ).rows;
  }
  async changeStock(
    c: Query,
    o: any,
    kind: "RELEASE" | "SALE" | "RESTORE",
    actor: string | null = null,
  ) {
    const items = await this.items(c, o.id);
    for (const i of items) {
      await c.query("SELECT id FROM products WHERE id=$1 FOR UPDATE", [
        i.product_id,
      ]);
      const on =
        kind === "SALE" ? -i.quantity : kind === "RESTORE" ? i.quantity : 0;
      const reserve = kind === "RESTORE" ? 0 : -i.quantity;
      await c.query(
        "UPDATE products SET on_hand=on_hand+$2,reserved=reserved+$3,version=version+1 WHERE id=$1",
        [i.product_id, on, reserve],
      );
      await this.ledger(
        c,
        i.product_id,
        o.id,
        actor,
        kind,
        on,
        reserve,
        `${kind}:${o.id}:${i.product_id}`,
      );
    }
  }
  async expireOne(c: Query, o: any) {
    if (o.status !== "PENDING" || o.eligible) return false;
    await this.changeStock(c, o, "RELEASE");
    await c.query(
      "UPDATE orders SET status='EXPIRED',updated_at=now() WHERE id=$1",
      [o.id],
    );
    await this.audit(c, o.id, null, "HOLD_EXPIRED");
    await this.emit(
      c,
      o.id,
      "Your unpaid order expired; reserved stock was released.",
    );
    o.status = "EXPIRED";
    return true;
  }
  async sweep() {
    return this.db.tx(async (c) => {
      const rows = (
        await c.query(
          "SELECT *,false AS eligible FROM orders WHERE status='PENDING' AND expires_at<=clock_timestamp() ORDER BY id LIMIT 50 FOR UPDATE SKIP LOCKED",
        )
      ).rows;
      for (const o of rows) await this.expireOne(c, o);
      return rows.length;
    });
  }
  async place(u: User, d: OrderDto, idempotency: string) {
    if (u.role !== "CUSTOMER")
      throw new ForbiddenException("Customer account required");
    const idem = key(idempotency),
      fingerprint = canonical(d.items, d.address, d.coupon);
    // Lazy cleanup is independent of worker availability and happens before acquiring new product locks.
    await this.sweep();
    return this.db.tx(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        u.id,
      ]);
      const existing = (
        await c.query("SELECT * FROM idempotency WHERE user_id=$1 AND key=$2", [
          u.id,
          idem,
        ])
      ).rows[0];
      if (existing) {
        if (existing.fingerprint !== fingerprint)
          throw new ConflictException(
            "Idempotency key belongs to another request",
          );
        return this.detailWith(c, existing.order_id, u);
      }
      const pending = (
        await c.query(
          "SELECT count(*)::integer AS n FROM orders WHERE user_id=$1 AND status='PENDING'",
          [u.id],
        )
      ).rows[0].n;
      if (pending >= 5)
        throw new ConflictException(
          "Complete or cancel an existing unpaid order first",
        );
      let coupon: any;
      if (d.coupon) {
        coupon = (
          await c.query(
            "SELECT *,expires_at>clock_timestamp() AS eligible FROM coupons WHERE code=$1 FOR UPDATE",
            [d.coupon.toUpperCase()],
          )
        ).rows[0];
        if (
          !coupon ||
          !coupon.active ||
          !coupon.eligible ||
          coupon.used >= coupon.max_uses
        )
          throw new BadRequestException("Coupon is unavailable");
      }
      const lines: any[] = [];
      let subtotal = 0;
      for (const item of [...d.items].sort((a, b) =>
        a.productId.localeCompare(b.productId),
      )) {
        const p = (
          await c.query("SELECT * FROM products WHERE id=$1 FOR UPDATE", [
            item.productId,
          ])
        ).rows[0];
        if (!p || !p.active) throw new NotFoundException("Product unavailable");
        if (p.on_hand - p.reserved < item.quantity)
          throw new ConflictException("Insufficient stock for " + p.name);
        subtotal = money(subtotal + p.price * item.quantity);
        lines.push({ ...item, product: p });
      }
      if (coupon && subtotal < coupon.minimum)
        throw new BadRequestException("Coupon minimum subtotal not met");
      const price = pricing(subtotal, coupon?.percent ?? 0);
      const o = (
        await c.query(
          "INSERT INTO orders(user_id,subtotal,discount,shipping,total,coupon_code,address,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp()+($8::integer*interval '1 second')) RETURNING *",
          [
            u.id,
            price.subtotal,
            price.discount,
            price.shipping,
            price.total,
            coupon?.code ?? null,
            JSON.stringify(d.address),
            config.holdSeconds,
          ],
        )
      ).rows[0];
      for (const i of lines) {
        await c.query(
          "INSERT INTO order_items(order_id,product_id,sku,name,quantity,price) VALUES($1,$2,$3,$4,$5,$6)",
          [
            o.id,
            i.productId,
            i.product.sku,
            i.product.name,
            i.quantity,
            i.product.price,
          ],
        );
        await c.query(
          "UPDATE products SET reserved=reserved+$2,version=version+1 WHERE id=$1",
          [i.productId, i.quantity],
        );
        await this.ledger(
          c,
          i.productId,
          o.id,
          u.id,
          "RESERVE",
          0,
          i.quantity,
          `RESERVE:${o.id}:${i.productId}`,
        );
      }
      if (coupon)
        await c.query("UPDATE coupons SET used=used+1 WHERE code=$1", [
          coupon.code,
        ]);
      const paymentId = randomUUID();
      await c.query(
        "INSERT INTO payments(id,order_id,amount,invoice) VALUES($1,$2,$3,$4)",
        [paymentId, o.id, o.total, "CF" + paymentId.replaceAll("-", "")],
      );
      await c.query(
        "INSERT INTO idempotency(user_id,key,fingerprint,order_id) VALUES($1,$2,$3,$4)",
        [u.id, idem, fingerprint, o.id],
      );
      await this.audit(c, o.id, u.id, "ORDER_RESERVED", {
        total: o.total,
        coupon: coupon?.code ?? null,
      });
      await this.emit(
        c,
        o.id,
        "Your order is reserved. Complete payment before the hold expires.",
      );
      return this.detailWith(c, o.id, u);
    });
  }
  async detailWith(c: Query, id: string, u: User) {
    const o = (
      await c.query(
        "SELECT o.*,u.name AS customer_name FROM orders o JOIN users u ON u.id=o.user_id WHERE o.id=$1",
        [id],
      )
    ).rows[0];
    if (!o || (u.role === "CUSTOMER" && o.user_id !== u.id))
      throw new NotFoundException("Order not found");
    return {
      ...o,
      items: await this.items(c, id),
      payment: (
        await c.query(
          "SELECT id,provider,state,amount,currency,checkout_url,settlement_reference FROM payments WHERE order_id=$1",
          [id],
        )
      ).rows[0],
      refund:
        (await c.query("SELECT * FROM refunds WHERE order_id=$1", [id]))
          .rows[0] ?? null,
      return:
        (await c.query("SELECT * FROM returns WHERE order_id=$1", [id]))
          .rows[0] ?? null,
      timeline: (
        await c.query(
          "SELECT action,details,created_at FROM audit WHERE order_id=$1 ORDER BY id",
          [id],
        )
      ).rows,
    };
  }
  async detail(id: string, u: User) {
    await this.db.tx(async (c) => {
      const o = await this.locked(c, id, u);
      await this.expireOne(c, o);
    });
    return this.detailWith(this.db.pool, id, u);
  }
  async list(u: User, q: PageDto) {
    await this.sweep();
    const rows = (
      await this.db.query(
        "SELECT id FROM orders WHERE ($1::uuid IS NULL OR user_id=$1) ORDER BY created_at DESC,id LIMIT $2 OFFSET $3",
        [u.role === "CUSTOMER" ? u.id : null, q.limit, (q.page - 1) * q.limit],
      )
    ).rows;
    const total = (
      await this.db.query(
        "SELECT count(*)::integer AS n FROM orders WHERE ($1::uuid IS NULL OR user_id=$1)",
        [u.role === "CUSTOMER" ? u.id : null],
      )
    ).rows[0].n;
    return {
      items: await Promise.all(
        rows.map((o) => this.detailWith(this.db.pool, o.id, u)),
      ),
      total,
      page: q.page,
      limit: q.limit,
    };
  }
  async refund(c: Query, o: any, p: any, reason: string) {
    const r = (
      await c.query(
        "INSERT INTO refunds(order_id,payment_id,amount,reason) VALUES($1,$2,$3,$4) ON CONFLICT(order_id) DO NOTHING RETURNING id",
        [o.id, p.id, p.amount, reason],
      )
    ).rows[0];
    if (r) {
      await this.audit(c, o.id, null, "REFUND_REQUESTED", {
        reason,
        provider: p.provider,
      });
      await this.emit(c, o.id, "A refund obligation was created.", "REFUND");
    }
  }
  async cancel(id: string, u: User) {
    return this.db.tx(async (c) => {
      const o = await this.locked(c, id, u);
      await this.expireOne(c, o);
      if (["CANCELLED", "EXPIRED"].includes(o.status))
        return this.detailWith(c, id, u);
      if (!["PENDING", "PAID", "PACKED"].includes(o.status))
        throw new ConflictException("This order can no longer be cancelled");
      await this.changeStock(
        c,
        o,
        o.status === "PENDING" ? "RELEASE" : "RESTORE",
        u.id,
      );
      const p = (
        await c.query("SELECT * FROM payments WHERE order_id=$1", [id])
      ).rows[0];
      if (p.state === "SUCCEEDED")
        await this.refund(c, o, p, "ORDER_CANCELLED");
      await c.query(
        "UPDATE orders SET status='CANCELLED',updated_at=now() WHERE id=$1",
        [id],
      );
      await this.audit(c, id, u.id, "ORDER_CANCELLED");
      await this.emit(c, id, "Your order was cancelled.");
      return this.detailWith(c, id, u);
    });
  }
  async settle(
    paymentId: string,
    eventId: string,
    outcome: string,
    amount: number,
    currency: string,
    provider: string,
    reference?: string,
    client?: PoolClient,
  ) {
    const fingerprint = hash(
      JSON.stringify({
        paymentId,
        eventId,
        outcome,
        amount,
        currency,
        reference: reference ?? null,
      }),
    );
    return this.db.tx(async (c) => {
      const found = (
        await c.query("SELECT order_id FROM payments WHERE id=$1", [paymentId])
      ).rows[0];
      if (!found) throw new NotFoundException("Payment not found");
      const o = await this.locked(c, found.order_id);
      const p = (
        await c.query("SELECT * FROM payments WHERE id=$1 FOR UPDATE", [
          paymentId,
        ])
      ).rows[0];
      if (p.provider !== provider)
        throw new BadRequestException("Payment provider mismatch");
      if (p.amount !== amount || p.currency !== currency)
        throw new BadRequestException("Payment amount or currency mismatch");
      const previous = (
        await c.query(
          "SELECT fingerprint FROM payment_events WHERE provider=$1 AND event_id=$2",
          [provider, eventId],
        )
      ).rows[0];
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw new ConflictException("Payment event changed");
        return { duplicate: true, orderId: o.id };
      }
      await c.query(
        "INSERT INTO payment_events(provider,event_id,fingerprint,payment_id) VALUES($1,$2,$3,$4)",
        [provider, eventId, fingerprint, p.id],
      );
      if (p.state === "SUCCEEDED") return { duplicate: true, orderId: o.id };
      await this.expireOne(c, o);
      if (outcome === "failed") {
        await c.query("UPDATE payments SET state='FAILED' WHERE id=$1", [p.id]);
        await this.audit(c, o.id, null, "PAYMENT_DECLINED");
        return { orderId: o.id, status: o.status };
      }
      await c.query(
        "UPDATE payments SET state='SUCCEEDED',settlement_reference=$2 WHERE id=$1",
        [p.id, reference ?? eventId],
      );
      const accepted =
        o.status === "PENDING"
          ? (
              await c.query(
                "UPDATE orders SET status='PAID',updated_at=now() WHERE id=$1 AND status='PENDING' AND expires_at>clock_timestamp() RETURNING id",
                [o.id],
              )
            ).rowCount
          : 0;
      if (accepted) {
        await this.changeStock(c, o, "SALE");
        await this.audit(c, o.id, null, "PAYMENT_CONFIRMED", {
          provider,
          reference: reference ?? eventId,
        });
        await this.emit(
          c,
          o.id,
          "Payment confirmed. Your order is ready for fulfillment.",
        );
        return { orderId: o.id, status: "PAID" };
      }
      if (o.status === "PENDING") {
        o.eligible = false;
        await this.expireOne(c, o);
      }
      await this.refund(c, o, p, "LATE_SETTLEMENT");
      return { orderId: o.id, status: o.status, refundRequired: true };
    }, client);
  }
  async simulate(id: string, u: User, outcome: string) {
    if (!config.sandbox)
      throw new ForbiddenException("Local simulation disabled");
    const order = await this.detail(id, u);
    const p = (
      await this.db.query("SELECT * FROM payments WHERE order_id=$1", [id])
    ).rows[0];
    if (p.provider !== "sandbox")
      throw new BadRequestException(
        "Cannot simulate an external provider payment",
      );
    await this.settle(
      p.id,
      "sim_" + p.id + "_" + outcome,
      outcome,
      p.amount,
      p.currency,
      "sandbox",
    );
    return this.detail(order.id, u);
  }
  async fulfill(id: string, u: User, status: string, tracking?: string) {
    return this.db.tx(async (c) => {
      const o = await this.locked(c, id, u);
      if (o.status === status) {
        if (status === "SHIPPED" && o.tracking !== tracking)
          throw new ConflictException("Shipment tracking already set");
        return this.detailWith(c, id, u);
      }
      if (nextStage[o.status] !== status)
        throw new ConflictException("Invalid fulfillment transition");
      if (status === "SHIPPED" && !tracking)
        throw new BadRequestException("Tracking reference required");
      await c.query(
        "UPDATE orders SET status=$2,tracking=COALESCE($3,tracking),delivered_at=CASE WHEN $2='DELIVERED' THEN now() ELSE delivered_at END,updated_at=now() WHERE id=$1",
        [id, status, tracking ?? null],
      );
      await this.audit(c, id, u.id, "ORDER_" + status, {
        tracking: tracking ?? null,
      });
      await this.emit(c, id, "Order status updated: " + status);
      return this.detailWith(c, id, u);
    });
  }
  async requestReturn(id: string, u: User, reason: string) {
    return this.db.tx(async (c) => {
      const o = await this.locked(c, id, u);
      const existing = (
        await c.query("SELECT * FROM returns WHERE order_id=$1", [id])
      ).rows[0];
      if (existing) return existing;
      if (o.status !== "DELIVERED")
        throw new ConflictException("Only delivered orders can be returned");
      const window = (
        await c.query(
          "SELECT delivered_at>now()-interval '14 days' AS eligible FROM orders WHERE id=$1",
          [id],
        )
      ).rows[0];
      if (!window.eligible)
        throw new ConflictException("The 14-day return window has closed");
      const r = (
        await c.query(
          "INSERT INTO returns(order_id,reason) VALUES($1,$2) RETURNING *",
          [id, reason],
        )
      ).rows[0];
      await this.audit(c, id, u.id, "RETURN_REQUESTED", { reason });
      return r;
    });
  }
  async decideReturn(id: string, u: User, status: string) {
    return this.db.tx(async (c) => {
      const o = await this.locked(c, id, u);
      const r = (
        await c.query("SELECT * FROM returns WHERE order_id=$1 FOR UPDATE", [
          id,
        ])
      ).rows[0];
      if (!r) throw new NotFoundException("Return not found");
      if (r.status === status) return this.detailWith(c, id, u);
      if (r.status !== "REQUESTED" || o.status !== "DELIVERED")
        throw new ConflictException("Return already decided");
      if (status === "APPROVED") {
        await this.changeStock(c, o, "RESTORE", u.id);
        await c.query(
          "UPDATE orders SET status='RETURNED',updated_at=now() WHERE id=$1",
          [id],
        );
        const p = (
          await c.query("SELECT * FROM payments WHERE order_id=$1", [id])
        ).rows[0];
        await this.refund(c, o, p, "RETURN_APPROVED");
      }
      await c.query(
        "UPDATE returns SET status=$2,updated_at=now() WHERE id=$1",
        [r.id, status],
      );
      await this.audit(c, id, u.id, "RETURN_" + status);
      await this.emit(c, id, "Return request " + status.toLowerCase() + ".");
      return this.detailWith(c, id, u);
    });
  }
  async createProduct(u: User, d: ProductDto) {
    return this.db.tx(async (c) => {
      const p = (
        await c.query(
          "INSERT INTO products(sku,name,description,category,price,on_hand) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
          [d.sku, d.name, d.description, d.category, d.price, d.onHand],
        )
      ).rows[0];
      await this.ledger(
        c,
        p.id,
        null,
        u.id,
        "OPENING",
        d.onHand,
        0,
        "OPENING:" + p.id,
      );
      await this.audit(c, null, u.id, "PRODUCT_CREATED", {
        productId: p.id,
        sku: p.sku,
      });
      return p;
    });
  }
  async editProduct(id: string, u: User, d: PriceDto) {
    return this.db.tx(async (c) => {
      const p = (
        await c.query(
          "UPDATE products SET price=$2,active=$3,version=version+1 WHERE id=$1 AND version=$4 RETURNING *",
          [id, d.price, d.active, d.version],
        )
      ).rows[0];
      if (!p)
        throw new ConflictException("Product changed; refresh before editing");
      await this.audit(c, null, u.id, "PRODUCT_UPDATED", {
        productId: id,
        price: d.price,
        active: d.active,
      });
      return p;
    });
  }
  async stock(id: string, u: User, quantity: number, idem: string) {
    const k = key(idem),
      f = hash(JSON.stringify({ id, quantity }));
    return this.db.tx(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,1))", [
        u.id + ":" + k,
      ]);
      const old = (
        await c.query(
          "SELECT * FROM stock_requests WHERE actor_id=$1 AND key=$2",
          [u.id, k],
        )
      ).rows[0];
      if (old) {
        if (old.fingerprint !== f)
          throw new ConflictException("Stock request changed");
        return { duplicate: true };
      }
      const p = (
        await c.query(
          "UPDATE products SET on_hand=on_hand+$2,version=version+1 WHERE id=$1 RETURNING id",
          [id, quantity],
        )
      ).rows[0];
      if (!p) throw new NotFoundException("Product not found");
      await c.query(
        "INSERT INTO stock_requests(actor_id,key,fingerprint,product_id) VALUES($1,$2,$3,$4)",
        [u.id, k, f, id],
      );
      await this.ledger(
        c,
        id,
        null,
        u.id,
        "RESTOCK",
        quantity,
        0,
        "RESTOCK:" + u.id + ":" + k,
      );
      await this.audit(c, null, u.id, "STOCK_RECEIVED", {
        productId: id,
        quantity,
      });
      return { ok: true };
    });
  }
  async coupon(u: User, d: CouponDto) {
    return this.db.tx(async (c) => {
      const p = (
        await c.query(
          "INSERT INTO coupons(code,percent,minimum,max_uses,expires_at) VALUES($1,$2,$3,$4,now()+($5::integer*interval '1 day')) RETURNING *",
          [d.code, d.percent, d.minimum, d.maxUses, d.days],
        )
      ).rows[0];
      await this.audit(c, null, u.id, "COUPON_CREATED", { code: p.code });
      return p;
    });
  }
  async refundComplete(id: string, u: User, reference: string) {
    return this.db.tx(async (c) => {
      const found = (
        await c.query("SELECT order_id FROM refunds WHERE id=$1", [id])
      ).rows[0];
      if (!found) throw new NotFoundException("Refund not found");
      const o = await this.locked(c, found.order_id);
      const r = (
        await c.query(
          "SELECT r.*,p.provider FROM refunds r JOIN payments p ON p.id=r.payment_id WHERE r.id=$1 FOR UPDATE OF r",
          [id],
        )
      ).rows[0];
      if (r.provider === "sandbox")
        throw new BadRequestException("Simulated refunds are worker-managed");
      if (r.status === "COMPLETED") {
        if (r.reference !== reference)
          throw new ConflictException("Refund reference differs");
        return r;
      }
      await c.query(
        "UPDATE refunds SET status='COMPLETED',reference=$2,completed_at=now() WHERE id=$1",
        [id, reference],
      );
      await this.audit(c, o.id, u.id, "EXTERNAL_REFUND_RECORDED", {
        reference,
        provider: r.provider,
      });
      await this.emit(
        c,
        o.id,
        "Administrator recorded a refund processed outside the application.",
      );
      return { ok: true };
    });
  }
  async admin(q: PageDto) {
    const [
      products,
      refunds,
      returns,
      outbox,
      totals,
      ledger,
      heartbeat,
      coupons,
    ] = await Promise.all([
      this.db.query(
        "SELECT *,on_hand-reserved AS available FROM products ORDER BY created_at DESC LIMIT $1 OFFSET $2",
        [q.limit, (q.page - 1) * q.limit],
      ),
      this.db.query(
        "SELECT r.*,p.provider FROM refunds r JOIN payments p ON p.id=r.payment_id ORDER BY r.created_at DESC LIMIT 50",
      ),
      this.db.query("SELECT * FROM returns ORDER BY created_at DESC LIMIT 50"),
      this.db.query(
        "SELECT id,kind,order_id,attempts,last_error,processed_at FROM outbox WHERE processed_at IS NULL ORDER BY created_at LIMIT 50",
      ),
      this.db.query(
        "SELECT count(*)::integer AS orders,count(*) FILTER(WHERE status='PENDING')::integer AS pending,COALESCE(sum(total) FILTER(WHERE status IN ('PAID','PACKED','SHIPPED','DELIVERED')),0)::text AS gross_booked_paisa FROM orders",
      ),
      this.db.query(
        "SELECT l.*,p.sku FROM inventory_ledger l JOIN products p ON p.id=l.product_id ORDER BY l.id DESC LIMIT 50",
      ),
      this.db.query(
        "SELECT *,seen_at>now()-interval '90 seconds' AS healthy FROM worker_heartbeat",
      ),
      this.db.query("SELECT * FROM coupons ORDER BY code"),
    ]);
    return {
      products: products.rows,
      refunds: refunds.rows,
      returns: returns.rows,
      outbox: outbox.rows,
      totals: totals.rows[0],
      ledger: ledger.rows,
      workers: heartbeat.rows,
      coupons: coupons.rows,
    };
  }
}
