import { describe, it, expect } from "vitest";
import { money, cartSubtotal } from "./api";
describe("commerce amounts", () => {
  it("preserves fractional taka and calculates cart subtotal in paisa", () => {
    expect(money(129050)).toContain("1,290.50");
    const p = { id: "p", price: 129050 } as any;
    expect(cartSubtotal([p], { p: 2 })).toBe(258100);
    expect(cartSubtotal([p], {})).toBe(0);
  });
});
