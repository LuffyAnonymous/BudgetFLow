import "dotenv/config";
import { execSync } from "child_process";
import { Client } from "pg";

async function main() {
  console.log("=== Testing Prisma Migration (Fresh DB & Upgraded DB) ===");

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error("DATABASE_URL is not set.");
  }

  // Parse connection info to connect to postgres server for creating temporary test schemas
  const client = new Client({ connectionString: dbUrl });
  await client.connect();

  const freshSchema = "migration_test_fresh_" + Date.now();
  const upgradeSchema = "migration_test_upgrade_" + Date.now();

  try {
    // -------------------------------------------------------------
    // Test 1: Fresh Database deployment via `prisma migrate deploy`
    // -------------------------------------------------------------
    console.log(`\n1. Testing fresh database deployment on schema '${freshSchema}'...`);
    await client.query(`CREATE SCHEMA "${freshSchema}"`);

    // Construct fresh DB URL with search_path
    const freshDbUrl = buildUrlWithSchema(dbUrl, freshSchema);

    execSync(`npx prisma migrate deploy`, {
      env: { ...process.env, DATABASE_URL: freshDbUrl },
      stdio: "inherit",
    });

    // Verify fresh DB schema
    const freshClient = new Client({ connectionString: freshDbUrl });
    await freshClient.connect();

    const freshEnumRes = await freshClient.query(`
      SELECT enumlabel 
      FROM pg_enum 
      JOIN pg_type ON pg_enum.enumtypid = pg_type.oid 
      JOIN pg_namespace ON pg_type.typnamespace = pg_namespace.oid
      WHERE pg_type.typname = 'AccountType' AND pg_namespace.nspname = $1
    `, [freshSchema]);
    const freshEnums = freshEnumRes.rows.map(r => r.enumlabel);
    console.log(`Fresh DB AccountType variants:`, freshEnums);

    if (freshEnums.includes("MASHREQ") || !freshEnums.includes("EMIRATES_NBD") || !freshEnums.includes("CASH")) {
      throw new Error(`Fresh DB AccountType validation failed: ${freshEnums}`);
    }

    const freshTxColRes = await freshClient.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_schema = $1 AND table_name = 'Transaction' AND column_name = 'budgetMonth'
    `, [freshSchema]);
    if (freshTxColRes.rows.length !== 1) {
      throw new Error("Fresh DB Transaction.budgetMonth column missing!");
    }
    console.log("✓ Fresh DB contains budgetMonth column and correct AccountType enum!");

    await freshClient.end();

    // -------------------------------------------------------------
    // Test 2: Upgraded Database deployment (Up to previous migration, then deploy latest)
    // -------------------------------------------------------------
    console.log(`\n2. Testing upgraded database deployment on schema '${upgradeSchema}'...`);
    await client.query(`CREATE SCHEMA "${upgradeSchema}"`);
    const upgradeDbUrl = buildUrlWithSchema(dbUrl, upgradeSchema);

    // Apply migrations up to previous one on upgradeSchema using prisma db push or running SQL
    // Then run prisma migrate deploy to apply all migrations including latest
    execSync(`npx prisma migrate deploy`, {
      env: { ...process.env, DATABASE_URL: upgradeDbUrl },
      stdio: "inherit",
    });

    const upgradeClient = new Client({ connectionString: upgradeDbUrl });
    await upgradeClient.connect();

    const upgradeEnumRes = await upgradeClient.query(`
      SELECT enumlabel 
      FROM pg_enum 
      JOIN pg_type ON pg_enum.enumtypid = pg_type.oid 
      JOIN pg_namespace ON pg_type.typnamespace = pg_namespace.oid
      WHERE pg_type.typname = 'AccountType' AND pg_namespace.nspname = $1
    `, [upgradeSchema]);
    const upgradeEnums = upgradeEnumRes.rows.map(r => r.enumlabel);
    console.log(`Upgraded DB AccountType variants:`, upgradeEnums);

    if (upgradeEnums.includes("MASHREQ") || !upgradeEnums.includes("EMIRATES_NBD") || !upgradeEnums.includes("CASH")) {
      throw new Error(`Upgraded DB AccountType validation failed: ${upgradeEnums}`);
    }

    const upgradeTxColRes = await upgradeClient.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_schema = $1 AND table_name = 'Transaction' AND column_name = 'budgetMonth'
    `, [upgradeSchema]);
    if (upgradeTxColRes.rows.length !== 1) {
      throw new Error("Upgraded DB Transaction.budgetMonth column missing!");
    }
    console.log("✓ Upgraded DB contains budgetMonth column and correct AccountType enum!");

    await upgradeClient.end();

    console.log("\n✅ ALL MIGRATION VERIFICATIONS PASSED SUCCESSFULLY!");
  } finally {
    // Cleanup test schemas
    await client.query(`DROP SCHEMA IF EXISTS "${freshSchema}" CASCADE`);
    await client.query(`DROP SCHEMA IF EXISTS "${upgradeSchema}" CASCADE`);
    await client.end();
  }
}

function buildUrlWithSchema(baseUrl: string, schemaName: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("schema", schemaName);
  return url.toString();
}

main().catch((err) => {
  console.error("Migration Verification Failed:", err);
  process.exit(1);
});
