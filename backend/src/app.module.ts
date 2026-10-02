import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { Database } from "./db";
import { RedisService } from "./platform";
import { AuthService, SessionGuard } from "./auth";
import { CommerceService } from "./commerce";
import { PaymentsService } from "./payments";
import {
  AuthController,
  CatalogController,
  OrdersController,
  PaymentController,
  AdminController,
  NotificationsController,
  HealthController,
} from "./controllers";
@Global()
@Module({
  providers: [Database, RedisService],
  exports: [Database, RedisService],
})
export class InfrastructureModule {}
@Module({
  providers: [AuthService, SessionGuard],
  exports: [AuthService, SessionGuard],
})
export class AuthModule {}
@Module({ providers: [CommerceService], exports: [CommerceService] })
export class CommerceModule {}
@Module({
  imports: [CommerceModule],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
@Module({
  imports: [InfrastructureModule, AuthModule, CommerceModule, PaymentsModule],
  controllers: [
    AuthController,
    CatalogController,
    OrdersController,
    PaymentController,
    AdminController,
    NotificationsController,
    HealthController,
  ],
  providers: [{ provide: APP_GUARD, useExisting: SessionGuard }],
})
export class AppModule {}
