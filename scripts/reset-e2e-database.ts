/**
 * scripts/reset-e2e-database.ts
 *
 * Wipes and re-initialises the E2E database between test runs.
 *
 * Safety requirements (Check #4):
 *   - DATABASE_URL_E2E must be set and must differ from DATABASE_URL
 *   - Must not target the development database (no _e2e suffix)
 *   - Must not target a production-like host
 *   - Missing DATABASE_URL_E2E causes immediate failure (no default for reset)
 *
 * The script truncates all tables in dependency order. Does NOT drop the
 * database itself — schema remains in place so the next run starts immediately.
 *
 * Usage:
 *   npm run db:e2e:reset
 *   npx tsx scripts/reset-e2e-database.ts
 */

import { PrismaClient } from "@prisma/client";

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
    console.error("[e2e:reset] FATAL: DATABASE_URL_E2E is not set.");
    console.error("  The reset script requires DATABASE_URL_E2E to be explicitly set.");
    console.error("  It does not use a default to prevent accidental data loss.");
    process.exit(1);
  }

  if (url === devUrl && devUrl !== "") {
    console.error("[e2e:reset] FATAL: DATABASE_URL_E2E equals DATABASE_URL.");
    console.error("  Refusing to truncate the development database.");
    process.exit(1);
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    console.error("[e2e:reset] FATAL: DATABASE_URL_E2E is not a valid URL.");
    process.exit(1);
  }

  const dbName = parsed.pathname.replace(/^\//, "").split("?")[0];

  // Database name must contain '_e2e' or '-e2e' (case-insensitive)
  if (!/[\-_]e2e/i.test(dbName)) {
    console.error(
      `[e2e:reset] FATAL: E2E database name "${dbName}" does not contain "_e2e" or "-e2e".`
    );
    console.error("  Refusing to truncate a database that does not appear to be an E2E database.");
    process.exit(1);
  }

  // Reject production-like hosts
  const host = parsed.hostname;
  for (const pattern of PRODUCTION_HOST_PATTERNS) {
    if (pattern.test(host)) {
      console.error(
        `[e2e:reset] FATAL: DATABASE_URL_E2E targets a production-like host: ${host}`
      );
      console.error("  Refusing to truncate a production database.");
      process.exit(1);
    }
  }

  console.log(`[e2e:reset] URL safety check passed for database "${dbName}" on "${host}".`);
}

validateE2eUrl(E2E_URL, DEV_URL);

// ─── Prisma client using the validated E2E URL ────────────────────────────────

const prisma = new PrismaClient({
  datasources: {
    db: { url: E2E_URL },
  },
});

/**
 * Tables to truncate in the correct dependency order
 * (leaf nodes first — i.e., tables that reference others first).
 */
const TABLES_IN_ORDER = [
  // Audit last-modified trail
  "AuditLog",
  // Attachments (reference everything)
  "Attachment",
  // Import engine
  "ImportedTransaction",
  "ImportSetting",
  // Finance records
  "RemittanceReversal",
  "Remittance",
  "DebtPayment",
  "SavingTransaction",
  "MonthlyRollover",
  "RecurringTemplate",
  "UpcomingPayment",
  "Budget",
  "Transaction",
  "Debt",
  "SavingGoal",
  "Category",
  "Setting",
  "Session",
  "Account",
  "VerificationToken",
  "User",
] as const;

async function main() {
  console.log("[e2e:reset] Truncating all E2E tables…");

  // Use individual statements (not a single transaction) so that a missing-table
  // error on one table does not abort and poison the rest.
  for (const table of TABLES_IN_ORDER) {
    try {
      // CASCADE handles foreign-key references automatically
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE`);
      console.log(`  ✓ ${table}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Skip tables that do not exist yet (schema can differ across branches)
      if (msg.includes("does not exist")) {
        console.warn(`  ⚠ ${table} — skipped (table not found)`);
      } else {
        throw err;
      }
    }
  }

  console.log("[e2e:reset] E2E database reset complete.");
}

main()
  .catch((err) => {
    console.error("[e2e:reset] FAILED:", err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
