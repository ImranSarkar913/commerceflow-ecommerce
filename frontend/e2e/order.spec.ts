import { test, expect } from "@playwright/test";

test("customer reserves stock, pays, and cancels a simulated order", async ({
  page,
}) => {
  const password = process.env.E2E_DEMO_PASSWORD;
  test.skip(!password, "Set E2E_DEMO_PASSWORD for a seeded disposable demo.");
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Email address").fill("customer@commerceflow.example");
  await page.getByLabel("Password", { exact: true }).fill(password!);
  await page
    .getByRole("button", { name: "Sign in", exact: true })
    .last()
    .click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await page
    .getByRole("button", { name: "Add Studio Mechanical Keyboard" })
    .click();
  await page.getByLabel("Recipient name").fill("Demo Customer");
  await page.getByLabel("Phone", { exact: true }).fill("01712345678");
  await page.getByLabel("Street address").fill("House 3 Road 12");
  await page.getByRole("button", { name: "Reserve & checkout" }).click();
  await page
    .getByRole("button", { name: "Simulate successful payment" })
    .click();
  await expect(page.locator(".order-modal .badge.paid")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Cancel order" }).click();
  await expect(page.locator(".order-modal .badge.cancelled")).toBeVisible();
});
