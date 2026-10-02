import { BadRequestException } from "@nestjs/common";
import { hash } from "./crypto";
export const money = (n: number) => {
  if (!Number.isSafeInteger(n) || n < 0 || n > 2147483647)
    throw new BadRequestException("Invalid monetary total");
  return n;
};
export function pricing(subtotal: number, percent = 0) {
  money(subtotal);
  const discount = Math.floor((subtotal * percent) / 100);
  const shipping = subtotal - discount >= 250000 ? 0 : 4990;
  return {
    subtotal,
    discount,
    shipping,
    total: money(subtotal - discount + shipping),
  };
}
export function canonical(
  items: { productId: string; quantity: number }[],
  address: any,
  coupon?: string,
) {
  return hash(
    JSON.stringify({
      items: [...items].sort((a, b) => a.productId.localeCompare(b.productId)),
      address: address
        ? {
            name: address.name,
            phone: address.phone,
            street: address.street,
            city: address.city,
          }
        : null,
      coupon: coupon?.toUpperCase() ?? null,
    }),
  );
}
export function key(value: unknown) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(value))
    throw new BadRequestException(
      "Idempotency-Key must be 8-100 letters, digits, underscores or hyphens",
    );
  return value;
}
export const nextStage: Record<string, string> = {
  PAID: "PACKED",
  PACKED: "SHIPPED",
  SHIPPED: "DELIVERED",
};
