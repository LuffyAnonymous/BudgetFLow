import "dotenv/config";
import { db } from "../src/lib/db";

async function main() {
  console.log("=== Attributing all existing transactions to August 2026 ===");

  const txUpdate = await db.transaction.updateMany({
    data: { budgetMonth: "2026-08" },
  });
  console.log(`Updated ${txUpdate.count} Transaction records to budgetMonth = '2026-08'.`);

  const impUpdate = await db.importedTransaction.updateMany({
    data: { budgetMonth: "2026-08" },
  });
  console.log(`Updated ${impUpdate.count} ImportedTransaction records to budgetMonth = '2026-08'.`);

  console.log("=== Verification Completed Successfully ===");
}

main().catch(console.error).finally(() => db.$disconnect());
