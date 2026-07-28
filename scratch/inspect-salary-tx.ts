import { db } from "../src/lib/db";

async function main() {
  const salaryTxs = await db.transaction.findMany({
    where: {
      amount: 5750,
    },
    include: {
      category: true,
      account: true,
    },
  });

  console.log("Found AED 5750 transactions:", salaryTxs.length);
  salaryTxs.forEach((tx) => {
    console.log({
      id: tx.id,
      date: tx.date,
      description: tx.description,
      amount: tx.amount.toString(),
      type: tx.type,
      category: tx.category.name,
      account: tx.account?.name,
    });
  });

  const importedTxs = await db.importedTransaction.findMany({
    where: {
      parsedAmount: 5750,
    },
  });
  console.log("Found AED 5750 imported transactions:", importedTxs.length);
  importedTxs.forEach((itx) => {
    console.log({
      id: itx.id,
      receivedAt: itx.receivedAt,
      financialDate: itx.financialDate,
      status: itx.status,
      transactionId: itx.transactionId,
    });
  });
}

main().catch(console.error).finally(() => db.$disconnect());
