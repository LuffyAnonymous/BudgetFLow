/**
 * playwright.config.ts
 *
 * E2E test configuration for BudgetFlow.
 *
 * Automatic E2E server startup:
 *   Playwright starts the BudgetFlow dev server on port 3001 automatically.
 *   The user does NOT need to run `npm run dev` before running tests.
 *
 *   webServer uses:
 *     - DATABASE_URL_E2E (E2E-only database, never the dev database)
 *     - AUTH_SECRET (deterministic E2E secret, not a real production secret)
 *     - Port 3001 (separate from the dev server on port 3000)
 *     - cross-env for cross-platform environment variable syntax
 *
 *   The server is started fresh before the suite and shut down after.
 *   reuseExistingServer=true in dev (so you can optionally keep it running
 *   between runs for faster iteration). In CI, always starts fresh.
 *
 * Prerequisites:
 *   Run once before the first E2E run to create and migrate the E2E database:
 *     npm run db:e2e:setup
 *
 *   DATABASE_URL_E2E must point to an isolated E2E database (see scripts/setup-e2e-database.ts).
 *
 * Failure artifacts:
 *   - Trace: always captured (for investigation on any failure)
 *   - Screenshots: captured on failure
 *   - Video: retained on failure
 */

import { defineConfig, devices } from "@playwright/test";
import path from "path";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3001";

// Deterministic E2E credentials — not real secrets, never used in production
const E2E_AUTH_SECRET = "e2e-test-secret-not-for-production-32bytes!";
const E2E_DATABASE_URL =
  process.env.DATABASE_URL_E2E ??
  "postgresql://postgres:postgres@localhost:5435/budgetflow_e2e?schema=public";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false, // Sequential — tests share state via a single DB
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,

  reporter: [
    ["list"],
    ["html", { outputFolder: "tests/e2e/reports", open: "never" }],
  ],

  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },

  use: {
    baseURL,

    // Always capture trace — needed to diagnose failures reliably
    trace: "on",
    screenshot: "only-on-failure",
    video: "retain-on-failure",

    actionTimeout: 15_000,
  },

  projects: [
    // Chromium (primary)
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],

  // ── Automatic E2E server (Check #3) ─────────────────────────────────────────
  //
  // Playwright starts the BudgetFlow app on port 3001 before the tests run.
  // cross-env ensures this works on Windows, macOS, and Linux.
  // The server is shut down automatically after the suite completes.
  //
  webServer: {
    command: [
      "npx cross-env",
      `DATABASE_URL=${E2E_DATABASE_URL}`,
      `AUTH_SECRET=${E2E_AUTH_SECRET}`,
      `NEXTAUTH_URL=${baseURL}`,
      "E2E_ENABLED=1",
      "next dev --port 3001",
    ].join(" "),
    url: baseURL,
    // In dev: reuse an already-running server to avoid startup wait.
    // In CI: always start fresh for clean state.
    reuseExistingServer: !process.env.CI,
    timeout: 120_000, // allow up to 2 minutes for Turbopack to compile on first start
    stdout: "pipe",
    stderr: "pipe",
  },

  globalSetup: path.resolve(__dirname, "tests/e2e/global-setup.ts"),
});
