import dotenv from "dotenv";
import path from "path";

// Load environment variables from the .env file in the root
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const testDbUrl = process.env.DATABASE_URL_TEST;
if (!testDbUrl) {
  throw new Error(
    "CRITICAL TEST ERROR: DATABASE_URL_TEST environment variable is not defined in your .env file."
  );
}

// Safety check to prevent running tests against a production or dev database
if (!testDbUrl.includes("test")) {
  throw new Error(
    "CRITICAL TEST ERROR: DATABASE_URL_TEST must contain the word 'test' in the database name to prevent accidental data loss."
  );
}

// Force the database URL before any test files or prisma clients are imported
process.env.DATABASE_URL = testDbUrl;

import { beforeAll } from "vitest";
import { execSync } from "child_process";

beforeAll(() => {
  console.log("Preparing isolated test database...");
  try {
    // Synchronously deploy migrations to the test database. Prisma's
    // migrate commands always connect via `directUrl` (schema.prisma's
    // DIRECT_URL binding) when it's present, bypassing `DATABASE_URL`
    // entirely — without this, migrate deploy silently targets whatever
    // DIRECT_URL resolves to instead of the test database.
    execSync("npx prisma migrate deploy", {
      env: {
        ...process.env,
        DATABASE_URL: testDbUrl,
        DIRECT_URL: testDbUrl,
      },
      stdio: "pipe", // Suppress noisy output but throw on error
    });
    console.log("Test database schema deployed successfully.");
  } catch (error) {
    console.error("Failed to deploy test database schema:", error);
    throw error;
  }
});
