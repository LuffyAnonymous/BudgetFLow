/**
 * tests/e2e/auth.setup.ts
 *
 * Playwright auth setup — logs in once and saves auth cookies to disk.
 * Other test specs load the saved state from tests/e2e/.auth/user.json
 * so they don't need to go through the login flow every time.
 *
 * Run automatically by Playwright as a dependency of the "chromium" project.
 */

import { test as setup, expect } from "@playwright/test";
import path from "path";
import * as fs from "fs";

const AUTH_FILE = path.resolve(__dirname, ".auth/user.json");

// Credentials for the E2E test user
// These must match a seeded user in the E2E database
const E2E_EMAIL = process.env.E2E_TEST_EMAIL ?? "e2e@budgetflow.test";
const E2E_PASSWORD = process.env.E2E_TEST_PASSWORD ?? "E2E_Test_Password_123!";

setup("authenticate", async ({ page }) => {
  // Ensure the .auth directory exists
  const authDir = path.dirname(AUTH_FILE);
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }

  await page.goto("/login");
  await expect(page).toHaveTitle(/BudgetFlow/i);

  await page.fill('input[name="email"], input[type="email"]', E2E_EMAIL);
  await page.fill('input[name="password"], input[type="password"]', E2E_PASSWORD);
  await page.click('button[type="submit"]');

  // Wait for redirect to dashboard after successful login
  await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
  await expect(page.locator("main")).toBeVisible();

  // Save auth state (cookies + localStorage) for reuse in other specs
  await page.context().storageState({ path: AUTH_FILE });
  console.log(`[e2e:auth.setup] Auth state saved to ${AUTH_FILE}`);
});
