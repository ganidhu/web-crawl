import { defineConfig } from "@playwright/test";
import path from "node:path";

export default defineConfig({
  testDir: "./tests/integration",
  timeout: 60_000,
  use: {
    headless: true,
    baseURL: "http://127.0.0.1:4173"
  },
  webServer: {
    command: "node tests/fixtures/server.mjs",
    port: 4173,
    reuseExistingServer: true
  }
});
