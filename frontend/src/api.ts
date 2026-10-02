export interface User {
  id: string;
  name: string;
  email: string;
  role: "CUSTOMER" | "STAFF" | "ADMIN";
}
export interface Product {
  id: string;
  sku: string;
  name: string;
  description: string;
  category: string;
  price: number;
  onHand: number;
  reserved: number;
  available: number;
  version: number;
  active: boolean;
}
export interface Order {
  id: string;
  status: string;
  total: number;
  subtotal: number;
  discount: number;
  shipping: number;
  currency: string;
  expires_at: string;
  created_at: string;
  customer_name: string;
  tracking: string | null;
  items: {
    product_id: string;
    name: string;
    sku: string;
    quantity: number;
    price: number;
  }[];
  payment: {
    id: string;
    provider: string;
    state: string;
    checkout_url: string | null;
  };
  refund: {
    id: string;
    status: string;
    amount: number;
    reference: string | null;
  } | null;
  return: { status: string; reason: string } | null;
  timeline: { action: string; created_at: string }[];
  address: { name: string; phone: string; street: string; city: string };
}
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}
export interface SessionResponse {
  user: User;
  csrf: string;
}
export interface PaymentMethods {
  sandbox: boolean;
  stripe: boolean;
  bkash: boolean;
}
export interface Notification {
  id: string;
  order_id: string;
  message: string;
  created_at: string;
}
export interface Overview {
  products: {
    id: string;
    name: string;
    sku: string;
    price: number;
    on_hand: number;
    reserved: number;
    available: number;
    version: number;
    active: boolean;
  }[];
  totals: { orders: number; pending: number; gross_booked_paisa: string };
  workers: { name: string; healthy: boolean; seen_at: string }[];
  coupons: {
    code: string;
    percent: number;
    minimum: number;
    used: number;
    max_uses: number;
  }[];
  refunds: {
    id: string;
    order_id: string;
    amount: number;
    provider: string;
    reason: string;
    status: string;
  }[];
  ledger: {
    id: string;
    sku: string;
    kind: string;
    on_hand_delta: number;
    reserved_delta: number;
    created_at: string;
  }[];
  outbox: {
    id: string;
    kind: string;
    last_error: string | null;
    attempts: number;
  }[];
}
let csrf = "";
export function setCsrf(value: string) {
  csrf = value;
}
export async function api<T = unknown>(
  path: string,
  body?: object,
  method = body ? "POST" : "GET",
  idem?: string,
): Promise<T> {
  const response = await fetch("/api" + path, {
    method,
    credentials: "include",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      ...(idem ? { "Idempotency-Key": idem } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response
    .json()
    .catch(() => ({ message: "Invalid server response" }));
  if (!response.ok)
    throw new Error(
      Array.isArray(data.message)
        ? data.message.join("; ")
        : (data.message ?? "Request failed"),
    );
  return data;
}
export const money = (value: number) =>
  new Intl.NumberFormat("en-BD", {
    style: "currency",
    currency: "BDT",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 100);
export function cartSubtotal(
  products: Product[],
  cart: Record<string, number>,
) {
  return products.reduce((sum, p) => sum + p.price * (cart[p.id] ?? 0), 0);
}
