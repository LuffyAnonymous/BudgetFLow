import { PrismaClient } from "@prisma/client";

const prismaClientSingleton = () => {
  return new PrismaClient();
};

declare const globalThis: {
  prismaGlobal: ReturnType<typeof prismaClientSingleton>;
} & typeof global;

const db = globalThis.prismaGlobal ?? prismaClientSingleton();

export { db };

if (process.env.NODE_ENV !== "production") {
  globalThis.prismaGlobal = db;
} else {
  const isBuildPhase =
    process.env.NEXT_PHASE === "phase-production-build" ||
    process.env.IS_NEXT_BUILD === "true" ||
    process.env.CI === "true" ||
    process.env.VERCEL === "1";

  if (!isBuildPhase) {
    const required = [
      "DATABASE_URL",
      "AUTH_SECRET",
      "IMPORT_CLEANUP_SECRET",
    ];
    
    const missing = required.filter(name => !process.env[name]);
    if (missing.length > 0) {
      throw new Error(`PRODUCTION_STARTUP_FAILED: Missing required environment variables: ${missing.join(", ")}`);
    }

    // Webhook and app url must use HTTPS
    const appUrl = process.env.NEXTAUTH_URL || process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
    if (!appUrl) {
      throw new Error("PRODUCTION_STARTUP_FAILED: Public application URL (NEXTAUTH_URL, APP_URL, or NEXT_PUBLIC_APP_URL) is missing.");
    }
    if (!appUrl.startsWith("https://")) {
      throw new Error("PRODUCTION_STARTUP_FAILED: Public application URL must use HTTPS in production.");
    }

    // Rate Limiting Gating
    if (process.env.RATE_LIMIT_PROVIDER === "redis") {
      if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
        throw new Error("PRODUCTION_STARTUP_FAILED: Redis is selected as rate limit provider but UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN is missing.");
      }
    } else {
      console.warn("WARNING: Running with in-memory rate limiting in production. Rate limits will not be shared across serverless function instances.");
    }

    // Storage Gating
    if (process.env.STORAGE_TYPE === "s3" || process.env.STORAGE_TYPE === "r2") {
      const storageMissing = [];
      if (!process.env.STORAGE_S3_BUCKET) storageMissing.push("STORAGE_S3_BUCKET");
      if (!process.env.STORAGE_S3_REGION) storageMissing.push("STORAGE_S3_REGION");
      if (!process.env.STORAGE_S3_ACCESS_KEY_ID) storageMissing.push("STORAGE_S3_ACCESS_KEY_ID");
      if (!process.env.STORAGE_S3_SECRET_ACCESS_KEY) storageMissing.push("STORAGE_S3_SECRET_ACCESS_KEY");
      if (storageMissing.length > 0) {
        throw new Error(`PRODUCTION_STARTUP_FAILED: Missing required storage environment variables: ${storageMissing.join(", ")}`);
      }
    } else {
      console.warn("WARNING: Local filesystem storage is active in production. Attachments will be transient and not persist across serverless function recycles.");
    }

    // AUTH_SECRET Strength check
    if ((process.env.AUTH_SECRET?.length || 0) < 32) {
      throw new Error("PRODUCTION_STARTUP_FAILED: AUTH_SECRET must be at least 32 characters long in production.");
    }

    // Database URL check
    const dbUrl = process.env.DATABASE_URL || "";
    if (
      dbUrl.includes("localhost") ||
      dbUrl.includes("127.0.0.1") ||
      dbUrl.includes("_test") ||
      dbUrl.includes("-test") ||
      dbUrl.includes("_e2e") ||
      dbUrl.includes("-e2e")
    ) {
      throw new Error("PRODUCTION_STARTUP_FAILED: DATABASE_URL must be a production database, not local or test/e2e.");
    }
  }
}
