import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3002",
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  reporter: "list",
});
