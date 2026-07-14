/**
 * tests/e2e/dashboard.spec.ts
 *
 * Smoke tests for the BudgetFlow dashboard.
 *
 * Verifies:
 *   - Dashboard renders without errors (authenticated)
 *   - Automation Status Panel is present (replaces removed Quick Actions)
 *   - Quick actions (Add Expense, Add Income, etc.) are NOT present
 *   - Navigation is rendered
 *
 * These tests use the API-based E2E login (no storageState required).
 */

import { test, expect } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3001";
const E2E_USER_EMAIL = process.env.E2E_USER_EMAIL ?? "e2e@budgetflow.test";

async function getAuthCookie(request: Parameters<typeof test>[1]["request"]): Promise<string> {
  const loginRes = await request.post(`${BASE_URL}/api/e2e/login`, {
    data: { email: E2E_USER_EMAIL },
  });
  expect(loginRes.ok(), `E2E login failed: ${loginRes.status()}`).toBe(true);

  const rawCookies = loginRes.headers()["set-cookie"] ?? "";
  const cookieLines = rawCookies.split("\n").map((c) => c.trim()).filter(Boolean);
  const sessionCookie = cookieLines
    .map((line) => line.split(";")[0].trim())
    .find((c) => c.startsWith("authjs.session-token="));

  expect(sessionCookie, "authjs.session-token missing").toBeTruthy();
  return sessionCookie!;
}

test.describe("Dashboard", () => {
  let authCookie: string;

  test.beforeAll(async ({ request }) => {
    authCookie = await getAuthCookie(request);
  });

  test("loads the financial overview page (authenticated)", async ({ page }) => {
    await page.context().addCookies([
      {
        name: "authjs.session-token",
        value: authCookie.split("=").slice(1).join("="),
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto("/dashboard");

    // Page title
    await expect(page).toHaveTitle(/BudgetFlow/i);

    // Main heading
    await expect(
      page.getByRole("heading", { name: /Financial Overview/i })
    ).toBeVisible();

    // Navigation is rendered
    await expect(page.getByRole("navigation", { name: /Main navigation/i }).first()).toBeVisible();
  });

  test("Automation Status Panel is present — Quick Actions removed", async ({ page }) => {
    await page.context().addCookies([
      {
        name: "authjs.session-token",
        value: authCookie.split("=").slice(1).join("="),
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto("/dashboard");

    // Quick Actions must NOT be present (Check #7)
    await expect(page.locator("#qa-add-income")).not.toBeAttached();
    await expect(page.locator("#qa-add-expense")).not.toBeAttached();
    await expect(page.locator("#qa-record-debt")).not.toBeAttached();
    await expect(page.locator("#qa-deposit-savings")).not.toBeAttached();

    // Text form of removed quick actions must not appear as buttons
    await expect(page.getByRole("button", { name: /Add Income/i })).not.toBeAttached();
    await expect(page.getByRole("button", { name: /Add Expense/i })).not.toBeAttached();
    await expect(page.getByRole("button", { name: /Debt Payment/i })).not.toBeAttached();
    await expect(page.getByRole("button", { name: /Deposit Savings/i })).not.toBeAttached();
    await expect(page.getByRole("button", { name: /Record Remittance/i })).not.toBeAttached();

    // Automation Status Panel must be present
    // (The panel renders bank import health + salary status)
    await expect(page.getByText(/Bank Import|Import Status|Automation/i)).toBeVisible();
  });
});
