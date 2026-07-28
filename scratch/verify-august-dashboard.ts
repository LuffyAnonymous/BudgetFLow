import "dotenv/config";
import { db } from "../src/lib/db";
import { DashboardService } from "../src/server/services/dashboard.service";

async function main() {
  const user = await db.user.findFirst({});
  if (!user) throw new Error("No user found");

  const dashboardService = new DashboardService();
  
  // 1. Default month dashboard
  const defaultDash = await dashboardService.getDashboardData(user.id);
  console.log("=== DEFAULT DASHBOARD ===");
  console.log("Month:", defaultDash.month);
  console.log("Actual income:", defaultDash.actual.income);
  console.log("Actual expenses:", defaultDash.actual.expenses);
  console.log("Actual debtPayments:", defaultDash.actual.debtPayments);
  console.log("Actual remaining:", defaultDash.actual.remaining);

  // 2. July 2026 dashboard
  const julyDash = await dashboardService.getDashboardData(user.id, "2026-07");
  console.log("\n=== JULY 2026 DASHBOARD ===");
  console.log("Month:", julyDash.month);
  console.log("Actual income:", julyDash.actual.income);
  console.log("Actual expenses:", julyDash.actual.expenses);
  console.log("Actual debtPayments:", julyDash.actual.debtPayments);
  console.log("Actual remaining:", julyDash.actual.remaining);

  // 3. August 2026 dashboard
  const augDash = await dashboardService.getDashboardData(user.id, "2026-08");
  console.log("\n=== AUGUST 2026 DASHBOARD ===");
  console.log("Month:", augDash.month);
  console.log("Actual income:", augDash.actual.income);
  console.log("Actual expenses:", augDash.actual.expenses);
  console.log("Actual debtPayments:", augDash.actual.debtPayments);
  console.log("Actual remaining:", augDash.actual.remaining);
}

main().catch(console.error).finally(() => db.$disconnect());
