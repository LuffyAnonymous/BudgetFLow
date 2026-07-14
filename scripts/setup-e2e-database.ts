/**
 * scripts/setup-e2e-database.ts
 *
 * Creates and migrates the isolated E2E database.
 *
 * Safety requirements (Check #4):
 *   - DATABASE_URL_E2E must be set and must differ from DATABASE_URL
 *   - Must not target the development database (budgetflow without _e2e suffix)
 *   - Must not target a production-like host (postgres.budgetflow.app, *.vercel.app, etc.)
 *   - Must include "_e2e" or "-e2e" in the database name
 *
 * Run once before starting the E2E test suite, or as part of CI setup.
 *
 * Usage:
 *   npm run db:e2e:setup
 */

import { execSync } from "child_process";
import { Client } from "pg";

// ─── Safety validation ────────────────────────────────────────────────────────

const DEV_URL = process.env.DATABASE_URL ?? "";
const E2E_URL = process.env.DATABASE_URL_E2E ?? "";

/** Dangerous production-like hostnames that must never be targeted by E2E */
const PRODUCTION_HOST_PATTERNS = [
  /\.vercel\.app$/,
  /\.railway\.app$/,
  /\.render\.com$/,
  /\.supabase\.co$/,
  /budgetflow\.app/,
  /\.db\.ondigitalocean\.com$/,
];

function validateE2eUrl(url: string, devUrl: string): void {
  if (!url) {
    console.error("[e2e:setup] FATAL: DATABASE_URL_E2E is not set.");
    console.error("  Set DATABASE_URL_E2E to a dedicated test database, e.g.");
    console.error("  postgresql://postgres:postgres@localhost:5435/budgetflow_e2e");
    process.exit(1);
  }

  if (url === devUrl && devUrl !== "") {
    console.error("[e2e:setup] FATAL: DATABASE_URL_E2E equals DATABASE_URL.");
    console.error("  E2E tests must use a separate database from the development database.");
    process.exit(1);
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    console.error("[e2e:setup] FATAL: DATABASE_URL_E2E is not a valid URL.");
    process.exit(1);
  }

  const dbName = parsed.pathname.replace(/^\//, "").split("?")[0];

  // Database name must contain '_e2e' or '-e2e' (case-insensitive)
  if (!/[\-_]e2e/i.test(dbName)) {
    console.error(
      `[e2e:setup] FATAL: E2E database name "${dbName}" does not contain "_e2e" or "-e2e".`
    );
    console.error("  Rename the database to include the e2e suffix to prevent accidental data loss.");
    process.exit(1);
  }

  // Reject production-like hosts
  const host = parsed.hostname;
  for (const pattern of PRODUCTION_HOST_PATTERNS) {
    if (pattern.test(host)) {
      console.error(
        `[e2e:setup] FATAL: DATABASE_URL_E2E targets a production-like host: ${host}`
      );
      console.error("  E2E tests must not run against production databases.");
      process.exit(1);
    }
  }

  console.log(`[e2e:setup] URL safety check passed for database "${dbName}" on "${host}".`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

validateE2eUrl(E2E_URL, DEV_URL);

function parseConnectionUrl(url: string) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || "5432", 10),
    user: parsed.username,
    password: parsed.password,
    database: parsed.pathname.replace("/", "").split("?")[0],
  };
}

async function main() {
  const { host, port, user, password, database } = parseConnectionUrl(E2E_URL);

  console.log(`[e2e:setup] Connecting to PostgreSQL at ${host}:${port}`);

  // Connect to postgres system database to create the target DB if needed
  const sysClient = new Client({
    host,
    port,
    user,
    password,
    database: "postgres",
  });

  await sysClient.connect();
  try {
    const res = await sysClient.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [database]
    );

    if (res.rowCount === 0) {
      console.log(`[e2e:setup] Database "${database}" not found. Creating…`);
      await sysClient.query(`CREATE DATABASE "${database}"`);
      console.log(`[e2e:setup] Database "${database}" created.`);
    } else {
      console.log(`[e2e:setup] Database "${database}" already exists. Skipping creation.`);
    }
  } finally {
    await sysClient.end();
  }

  // Apply all Prisma migrations against the E2E database
  console.log("[e2e:setup] Applying Prisma migrations…");
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: E2E_URL,
    },
  });

  console.log("[e2e:setup] E2E database is ready.");
}

main().catch((err) => {
  console.error("[e2e:setup] FAILED:", err.message);
  process.exit(1);
});
