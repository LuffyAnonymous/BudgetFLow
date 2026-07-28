import { db } from "../src/lib/db";

async function main() {
  console.log("Verifying migration on database...");

  // Check columns on Transaction
  const txCols = await db.$queryRaw<any[]>`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'Transaction' AND column_name = 'budgetMonth'
  `;
  console.log("Transaction.budgetMonth column:", txCols);

  // Check columns on ImportedTransaction
  const impCols = await db.$queryRaw<any[]>`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'ImportedTransaction' AND column_name = 'budgetMonth'
  `;
  console.log("ImportedTransaction.budgetMonth column:", impCols);

  // Check index
  const indexes = await db.$queryRaw<any[]>`
    SELECT indexname 
    FROM pg_indexes 
    WHERE tablename = 'Transaction' AND indexname = 'Transaction_userId_budgetMonth_idx'
  `;
  console.log("Transaction_userId_budgetMonth_idx:", indexes);

  // Check enum variants
  const enumVariants = await db.$queryRaw<any[]>`
    SELECT enumlabel 
    FROM pg_enum 
    JOIN pg_type ON pg_enum.enumtypid = pg_type.oid 
    WHERE pg_type.typname = 'AccountType'
  `;
  console.log("AccountType enum variants:", enumVariants);
}

main().catch(console.error).finally(() => db.$disconnect());
