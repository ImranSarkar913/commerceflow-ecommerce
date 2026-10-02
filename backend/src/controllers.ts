import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Req,
  Res,
  Headers,
  ParseUUIDPipe,
  HttpCode,
  BadRequestException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  ApiTags,
  ApiCookieAuth,
  ApiHeader,
  ApiOperation,
} from "@nestjs/swagger";
import { Response } from "express";
import { AuthService, AuthRequest, Public, Roles } from "./auth";
import { CommerceService } from "./commerce";
import { Database } from "./db";
import { RedisService } from "./platform";
import { PaymentsService } from "./payments";
import { config } from "./config";
import { verifySignature } from "./crypto";
import { stripe } from "./providers";
import {
  LoginDto,
  RegisterDto,
  OrderDto,
  PageDto,
  ProductDto,
  RestockDto,
  PriceDto,
  FulfillDto,
  ReasonDto,
  ReturnDecisionDto,
  CouponDto,
  SimulateDto,
  CheckoutDto,
  RefundDto,
  WebhookDto,
} from "./dto";
@ApiTags("Authentication")
@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Public() @Post("register") async register(@Body() d: RegisterDto) {
    await this.auth.register(d.email, d.name, d.password);
    return { ok: true };
  }
  @Public() @Post("login") @HttpCode(200) login(
    @Body() d: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.login(d.email, d.password, res);
  }
  @Get("me") me(@Req() r: AuthRequest) {
    return { user: r.user, csrf: r.session.csrf };
  }
  @Post("logout") @HttpCode(200) logout(
    @Req() r: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.logout(r, res);
  }
}
@ApiTags("Catalog")
@Controller("catalog")
export class CatalogController {
  constructor(private readonly c: CommerceService) {}
  @Public() @Get("products") products(@Query() q: PageDto) {
    return this.c.catalog(q);
  }
  @Public() @Get("categories") categories() {
    return this.c.categories();
  }
}
@ApiTags("Orders")
@ApiCookieAuth()
@Controller("orders")
export class OrdersController {
  constructor(
    private readonly c: CommerceService,
    private readonly pay: PaymentsService,
  ) {}
  @Get() list(@Req() r: AuthRequest, @Query() q: PageDto) {
    return this.c.list(r.user, q);
  }
  @Roles("CUSTOMER")
  @Post()
  @ApiHeader({ name: "Idempotency-Key", required: true })
  place(
    @Req() r: AuthRequest,
    @Body() d: OrderDto,
    @Headers("idempotency-key") key: string,
  ) {
    return this.c.place(r.user, d, key);
  }
  @Get(":id") detail(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() r: AuthRequest,
  ) {
    return this.c.detail(id, r.user);
  }
  @Roles("CUSTOMER", "ADMIN") @Post(":id/cancel") cancel(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() r: AuthRequest,
  ) {
    return this.c.cancel(id, r.user);
  }
  @Roles("CUSTOMER")
  @Post(":id/simulate")
  @ApiOperation({ summary: "Local simulation only; no real money" })
  simulate(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() r: AuthRequest,
    @Body() d: SimulateDto,
  ) {
    return this.c.simulate(id, r.user, d.outcome);
  }
  @Roles("CUSTOMER") @Post(":id/checkout") checkout(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() r: AuthRequest,
    @Body() d: CheckoutDto,
  ) {
    return this.pay.create(id, r.user, d.provider);
  }
  @Roles("CUSTOMER") @Post(":id/return") requestReturn(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() r: AuthRequest,
    @Body() d: ReasonDto,
  ) {
    return this.c.requestReturn(id, r.user, d.reason);
  }
  @Roles("STAFF", "ADMIN") @Post(":id/fulfill") fulfill(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() r: AuthRequest,
    @Body() d: FulfillDto,
  ) {
    return this.c.fulfill(id, r.user, d.status, d.tracking);
  }
}
@ApiTags("Payments")
@Controller("payments")
export class PaymentController {
  constructor(
    private readonly p: PaymentsService,
    private readonly c: CommerceService,
  ) {}
  @Public() @Get("methods") methods() {
    return this.p.methods();
  }
  @Roles("CUSTOMER", "ADMIN") @Post(":id/verify") verify(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() r: AuthRequest,
  ) {
    return this.p.verifyPayment(id, r.user, true);
  }
  @Public() @Post("sandbox/webhook") @HttpCode(200) webhook(
    @Req() r: AuthRequest & { rawBody?: Buffer },
    @Body() d: WebhookDto,
    @Headers("x-webhook-timestamp") timestamp: string,
    @Headers("x-webhook-signature") sig: string,
  ) {
    if (
      !config.sandbox ||
      !r.rawBody ||
      !verifySignature(
        config.webhookSecret,
        timestamp ?? "",
        r.rawBody,
        sig ?? "",
      )
    )
      throw new UnauthorizedException("Invalid webhook signature");
    return this.c.settle(
      d.paymentId,
      d.eventId,
      d.outcome,
      d.amount,
      d.currency,
      "sandbox",
    );
  }
  @Public() @Post("stripe/webhook") @HttpCode(200) async stripeWebhook(
    @Req() r: AuthRequest & { rawBody?: Buffer },
    @Headers("stripe-signature") sig: string,
  ) {
    if (!config.stripe || !r.rawBody)
      throw new BadRequestException("Stripe webhook disabled");
    let event;
    try {
      event = stripe().webhooks.constructEvent(
        r.rawBody,
        sig,
        config.stripeWebhook,
      );
    } catch {
      throw new UnauthorizedException("Invalid Stripe signature");
    }
    if (
      [
        "checkout.session.completed",
        "checkout.session.async_payment_succeeded",
      ].includes(event.type)
    )
      return this.p.stripeNotification(event.data.object);
    return { ignored: true };
  }
  @Public() @Get("bkash/return") async bkashReturn(
    @Query("paymentID") id: string,
    @Res() res: Response,
  ) {
    if (!config.bkash || !id || id.length > 120)
      throw new BadRequestException("Invalid bKash callback");
    try {
      await this.p.bkashReturn(id);
      return res.redirect(303, config.origin + "/?payment=return");
    } catch {
      return res.redirect(303, config.origin + "/?payment=pending");
    }
  }
}
@ApiTags("Operations")
@ApiCookieAuth()
@Roles("ADMIN")
@Controller("admin")
export class AdminController {
  constructor(
    private readonly c: CommerceService,
    private readonly db: Database,
  ) {}
  @Get("overview") overview(@Query() q: PageDto) {
    return this.c.admin(q);
  }
  @Post("products") create(@Req() r: AuthRequest, @Body() d: ProductDto) {
    return this.c.createProduct(r.user, d);
  }
  @Patch("products/:id") update(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() r: AuthRequest,
    @Body() d: PriceDto,
  ) {
    return this.c.editProduct(id, r.user, d);
  }
  @Post("products/:id/restock")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  restock(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() r: AuthRequest,
    @Body() d: RestockDto,
    @Headers("idempotency-key") key: string,
  ) {
    return this.c.stock(id, r.user, d.quantity, key);
  }
  @Post("coupons") coupon(@Req() r: AuthRequest, @Body() d: CouponDto) {
    return this.c.coupon(r.user, d);
  }
  @Post("orders/:id/return-decision") decide(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() r: AuthRequest,
    @Body() d: ReturnDecisionDto,
  ) {
    return this.c.decideReturn(id, r.user, d.status);
  }
  @Post("refunds/:id/record-completion")
  @ApiOperation({
    summary: "Record a refund already processed in the merchant portal",
  })
  refund(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() r: AuthRequest,
    @Body() d: RefundDto,
  ) {
    return this.c.refundComplete(id, r.user, d.reference);
  }
  @Post("jobs/:id/retry") async retry(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() r: AuthRequest,
  ) {
    const changed = await this.db.query(
      "UPDATE outbox SET published_at=NULL,last_error=NULL,attempts=0 WHERE id=$1 AND processed_at IS NULL RETURNING id",
      [id],
    );
    if (!changed.rowCount)
      throw new BadRequestException("Job unavailable or already completed");
    await this.c.audit(this.db.pool, null, r.user.id, "JOB_RETRY_REQUESTED", {
      jobId: id,
    });
    return { ok: true };
  }
}
@ApiTags("Notifications")
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly db: Database) {}
  @Get() async list(@Req() r: AuthRequest) {
    return (
      await this.db.query(
        "SELECT id,order_id,message,created_at FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50",
        [r.user.id],
      )
    ).rows;
  }
}
@ApiTags("Health")
@Public()
@Controller()
export class HealthController {
  constructor(
    private readonly db: Database,
    private readonly redis: RedisService,
  ) {}
  @Get("health") health() {
    return { status: "ok" };
  }
  @Get("ready") async ready() {
    await this.db.query("SELECT 1");
    await this.redis.client.ping();
    return { status: "ready" };
  }
}
