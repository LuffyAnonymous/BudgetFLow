import "dotenv/config";
import { db } from "../src/lib/db";

async function main() {
  const transactions = await db.transaction.findMany({
    include: { category: true },
    orderBy: { date: "asc" },
  });
  console.log(`Found ${transactions.length} transactions:`);
  for (const t of transactions) {
    console.log(`ID: ${t.id} | Date: ${t.date.toISOString()} | BudgetMonth: ${t.budgetMonth} | Type: ${t.type} | Amount: ${t.amount} | Desc: ${t.description}`);
  }

  const imported = await db.importedTransaction.findMany({});
  console.log(`\nFound ${imported.length} imported transactions:`);
  for (const imp of imported) {
    console.log(`ID: ${imp.id} | ReceivedAt: ${imp.receivedAt.toISOString()} | BudgetMonth: ${imp.budgetMonth} | Amount: ${imp.parsedAmount}`);
  }
}

main().catch(console.error).finally(() => db.$disconnect());
