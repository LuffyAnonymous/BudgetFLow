import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  let dbStatus: "connected" | "unavailable" = "connected";
  let appStatus: "ok" | "degraded" = "ok";

  try {
    // Simple fast query to check DB connectivity
    await db.$queryRaw`SELECT 1`;
  } catch {
    dbStatus = "unavailable";
    appStatus = "degraded";
  }

  const response = {
    status: appStatus,
    database: dbStatus,
    version: process.env.APP_VERSION || process.env.BUILD_SHA || "1.0.0",
    timestamp: new Date().toISOString(),
  };

  return Response.json(response, {
    status: appStatus === "ok" ? 200 : 503,
  });
}
