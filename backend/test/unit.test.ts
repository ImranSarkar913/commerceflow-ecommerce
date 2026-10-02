import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  passwordHash,
  verifyPassword,
  signature,
  verifySignature,
} from "../src/crypto";
import { pricing, canonical, key, money } from "../src/domain";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { OrderDto, PageDto, RegisterDto } from "../src/dto";
test("password hashes have independent salts and reject the wrong password", async () => {
  const a = await passwordHash("correct-password"),
    b = await passwordHash("correct-password");
  assert.notEqual(a, b);
  assert.equal(await verifyPassword("correct-password", a), true);
  assert.equal(await verifyPassword("wrong-password", a), false);
});
test("webhook signatures bind the body and expire after five minutes", () => {
  const t = String(Math.floor(Date.now() / 1000)),
    raw = Buffer.from('{"amount":100}'),
    s = signature("secret", t, raw);
  assert.equal(verifySignature("secret", t, raw, s), true);
  assert.equal(
    verifySignature("secret", t, Buffer.from('{"amount":1}'), s),
    false,
  );
  assert.equal(
    verifySignature("secret", t, raw, s, Date.now() + 400000),
    false,
  );
});
test("pricing uses integer paisa and discounted merchandise shipping threshold", () => {
  assert.deepEqual(pricing(129050, 10), {
    subtotal: 129050,
    discount: 12905,
    shipping: 4990,
    total: 121135,
  });
  assert.equal(pricing(250000).shipping, 0);
  assert.equal(pricing(250000, 10).shipping, 4990);
  assert.throws(() => money(2147483648));
});
test("idempotency is stable under item reordering but binds address and quantities", () => {
  const a = [
    { productId: "b", quantity: 1 },
    { productId: "a", quantity: 2 },
  ];
  assert.equal(
    canonical(a, { city: "Dhaka" }, "save10"),
    canonical([...a].reverse(), { city: "Dhaka" }, "SAVE10"),
  );
  assert.notEqual(
    canonical(a, { city: "Dhaka" }),
    canonical(a, { city: "Sylhet" }),
  );
  assert.throws(() => key("bad"));
  assert.equal(key("valid-key-123"), "valid-key-123");
});
test("DTO validation rejects duplicate items, fractional quantities and unknown properties", async () => {
  const dto = plainToInstance(OrderDto, {
    items: [
      { productId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", quantity: 1.5 },
      { productId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", quantity: 1 },
    ],
    address: {
      name: "Alex",
      phone: "01712345678",
      street: "Road 12 House 3",
      city: "Dhaka",
    },
    total: 1,
  });
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  assert.ok(errors.some((e) => e.property === "total"));
  assert.ok(errors.some((e) => e.property === "items"));
});
test("pagination and registration bounds reject abusive inputs", async () => {
  assert.ok(
    (await validate(plainToInstance(PageDto, { page: "1.5", limit: "999" })))
      .length > 0,
  );
  assert.ok(
    (
      await validate(
        plainToInstance(RegisterDto, {
          email: "invalid",
          password: "short",
          name: "A",
        }),
      )
    ).length > 0,
  );
});
