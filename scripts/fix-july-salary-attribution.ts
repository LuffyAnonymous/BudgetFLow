import { db } from "../src/lib/db";

async function main() {
  console.log("Updating July 28 salary transaction attribution to August 2026...");

  // 1. Find the transaction
  const txs = await db.transaction.findMany({
    where: {
      amount: 5750,
      type: "INCOME",
    },
  });

  console.log(`Found ${txs.length} matching transaction(s).`);

  for (const tx of txs) {
    console.log(`Updating Transaction ${tx.id} (date: ${tx.date.toISOString()})...`);
    await db.transaction.update({
      where: { id: tx.id },
      data: {
        budgetMonth: "2026-08",
      },
    });
  }

  // 2. Find imported transactions linked to it
  const importedTxs = await db.importedTransaction.findMany({
    where: {
      parsedAmount: 5750,
    },
  });

  for (const itx of importedTxs) {
    console.log(`Updating ImportedTransaction ${itx.id}...`);
    await db.importedTransaction.update({
      where: { id: itx.id },
      data: {
        budgetMonth: "2026-08",
      },
    });
  }

  console.log("Salary month attribution successfully updated to 2026-08 while keeping date unchanged!");
}

main().catch(console.error).finally(() => db.$disconnect());
