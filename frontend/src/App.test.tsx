import {
  render,
  screen,
  waitFor,
  fireEvent,
  cleanup,
} from "@testing-library/react";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import App from "./App";
const p = {
  id: "p",
  sku: "CF-KB-001",
  name: "Studio Mechanical Keyboard",
  category: "Workspace",
  description: "A thoughtful keyboard for your workspace.",
  price: 129050,
  onHand: 4,
  reserved: 1,
  available: 3,
};
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: any) => {
      const url = String(input);
      if (url.includes("/auth/me"))
        return { ok: false, json: async () => ({ message: "Sign in" }) };
      if (url.includes("/categories"))
        return { ok: true, json: async () => ["Workspace"] };
      if (url.includes("/methods"))
        return { ok: true, json: async () => ({ sandbox: true }) };
      return { ok: true, json: async () => ({ items: [p], total: 1 }) };
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("storefront", () => {
  it("loads the catalog and displays exact prices without authentication", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText(p.name)).toBeInTheDocument());
    expect(screen.getByText(/1,290.50/)).toBeInTheDocument();
    expect(screen.getByText("3 available")).toBeInTheDocument();
  });
  it("adds a product to the bag and exposes delivery details", async () => {
    render(<App />);
    await screen.findByText(p.name);
    fireEvent.click(screen.getByRole("button", { name: "Add " + p.name }));
    expect(
      screen.getByRole("complementary", { name: "Shopping bag" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Recipient name")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sign in to checkout" }),
    ).toBeInTheDocument();
  });
  it("opens sign in without exposing demo secrets", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(
      screen.getByRole("dialog", { name: "Account access" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "type",
      "password",
    );
  });
});
