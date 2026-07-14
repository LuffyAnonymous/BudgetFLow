import { beforeAll } from "vitest";
import { execSync } from "child_process";
import dotenv from "dotenv";
import path from "path";

// Load environment variables from the .env file in the root
dotenv.config({ path: path.resolve(__dirname, "../.env") });

beforeAll(() => {
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

  // Override the database URL so that the Prisma Client resolves queries against the isolated test database
  process.env.DATABASE_URL = testDbUrl;

  console.log("Preparing isolated test database...");
  try {
    // Synchronously push the schema to the test database and force reset any existing records
    execSync("npx prisma db push --accept-data-loss --force-reset", {
      env: {
        ...process.env,
        DATABASE_URL: testDbUrl,
      },
      stdio: "pipe", // Suppress noisy output but throw on error
    });
    console.log("Test database schema pushed successfully.");
  } catch (error) {
    console.error("Failed to push test database schema:", error);
    throw error;
  }
});
