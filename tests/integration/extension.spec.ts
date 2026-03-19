import { test, expect, chromium } from "@playwright/test";
import path from "node:path";
import { execSync } from "node:child_process";

test("extension popup loads and can start on a fixture site", async () => {
  execSync("npm run build", { cwd: process.cwd(), stdio: "inherit" });
  const extensionPath = path.join(process.cwd(), "dist");
  const context = await chromium.launchPersistentContext("", {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
  });

  try {
    const page = await context.newPage();
    await page.goto("http://127.0.0.1:4173/");
    const background = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    await expect(background.url()).toContain("background.js");
  } finally {
    await context.close();
  }
});
