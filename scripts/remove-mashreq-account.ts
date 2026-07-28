import { db } from "../src/lib/db";

async function main() {
  console.log("Checking for Mashreq accounts to remove safely...");
  const mashreqAccounts = await db.account.findMany({
    where: { type: "MASHREQ" },
  });

  if (mashreqAccounts.length === 0) {
    console.log("No Mashreq accounts found in database.");
    return;
  }

  for (const acc of mashreqAccounts) {
    const txCount = await db.transaction.count({
      where: {
        OR: [
          { accountId: acc.id },
          { toAccountId: acc.id },
        ],
      },
    });

    if (txCount > 0) {
      console.error(`ABORT: Account ${acc.name} (${acc.id}) has ${txCount} linked transactions. Cannot delete safely without reassigning transactions.`);
      process.exit(1);
    }

    await db.account.delete({
      where: { id: acc.id },
    });
    console.log(`Successfully deleted Mashreq account ID ${acc.id}`);
  }
}

main().catch(console.error).finally(() => db.$disconnect());
