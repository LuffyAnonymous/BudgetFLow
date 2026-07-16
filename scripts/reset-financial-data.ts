import { db } from "../src/lib/db";

async function main() {
  const args = process.argv.slice(2);
  const confirm = args.includes("--confirm");
  const allowLocal = args.includes("--allow-local");
  const dbArg = args.find(arg => arg.startsWith("--database="));
  const databaseNameInput = dbArg ? dbArg.split("=")[1] : null;

  // 1. Get and Parse DATABASE_URL
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("Error: DATABASE_URL is not set in environment.");
    process.exit(1);
  }

  // Parse DATABASE_URL safely without regex that could break on some query parameter configurations
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(databaseUrl);
  } catch (err) {
    console.error("Error: Could not parse DATABASE_URL as a valid URL.");
    process.exit(1);
  }

  const host = parsedUrl.hostname;
  // Get database name from the pathname (remove leading slash)
  const dbName = parsedUrl.pathname.replace(/^\//, "");

  // Identify if local or remote
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "host.docker.internal";
  const locationType = isLocal ? "local" : "remote";

  console.log(`Target Database Hostname: ${host}`);
  console.log(`Target Database Name: ${dbName}`);
  console.log(`Host Location: ${locationType}`);

  // Safeguard: refuse production cleanup on localhost/127.0.0.1/host.docker.internal unless --allow-local is provided
  if (isLocal && !allowLocal) {
    console.error("Error: Production cleanup refused on a local host. To clean a local database, pass --allow-local.");
    process.exit(1);
  }

  // Retrieve row counts that will be deleted
  const attachmentCount = await db.attachment.count({
    where: {
      OR: [
        { transactionId: { not: null } },
        { debtPaymentId: { not: null } },
        { savingTxId: { not: null } },
        { remittanceId: { not: null } }
      ]
    }
  });

  const importedTxCount = await db.importedTransaction.count();
  const recurringOccurrenceCount = await db.recurringOccurrence.count();
  const savingTxCount = await db.savingTransaction.count();
  const debtPaymentCount = await db.debtPayment.count();
  const remittanceCount = await db.remittance.count();
  const transactionCount = await db.transaction.count();
  const monthlyRolloverCount = await db.monthlyRollover.count();

  const auditLogCount = await db.auditLog.count({
    where: {
      entityType: {
        in: ["TRANSACTION", "IMPORTED_TRANSACTION", "REMITTANCE", "DEBT_PAYMENT", "SAVING_TRANSACTION"]
      }
    }
  });

  const notificationCount = await db.notification.count();

  // Print counts
  console.log("\nRows that will be deleted:");
  console.log(`- Attachments (financial): ${attachmentCount}`);
  console.log(`- ImportedTransaction: ${importedTxCount}`);
  console.log(`- RecurringOccurrence: ${recurringOccurrenceCount}`);
  console.log(`- SavingTransaction: ${savingTxCount}`);
  console.log(`- DebtPayment: ${debtPaymentCount}`);
  console.log(`- Remittance: ${remittanceCount}`);
  console.log(`- Transaction: ${transactionCount}`);
  console.log(`- MonthlyRollover: ${monthlyRolloverCount}`);
  console.log(`- AuditLog (financial): ${auditLogCount}`);
  console.log(`- Notification: ${notificationCount}`);

  // Fetch accounts, saving goals, and debts to reset
  const accounts = await db.account.findMany({ select: { name: true, type: true, currentBalance: true } });
  const savingGoals = await db.savingGoal.findMany({ select: { name: true, currentAmount: true } });
  const debts = await db.debt.findMany({ select: { name: true, originalBalance: true, currentBalance: true } });

  console.log("\nAccounts to be reset (balances to 0):");
  for (const acc of accounts) {
    console.log(`- ${acc.name} (${acc.type}): ${acc.currentBalance.toString()} -> 0.00`);
  }

  console.log("\nSaving Goals to be reset (currentAmount to 0):");
  for (const goal of savingGoals) {
    console.log(`- ${goal.name}: ${goal.currentAmount.toString()} -> 0.00`);
  }

  console.log("\nDebts to be reset (currentBalance to originalBalance):");
  for (const debt of debts) {
    console.log(`- ${debt.name}: currentBalance ${debt.currentBalance.toString()} -> originalBalance ${debt.originalBalance.toString()}`);
  }

  // Dry run vs Confirmed execution check
  if (!confirm || databaseNameInput !== dbName) {
    console.log("\n=== DRY RUN MODE ===");
    console.log("No changes have been made to the database.");
    console.log(`To execute this cleanup on the database, run:`);
    console.log(`npm run db:clean-financial -- --confirm --database=${dbName}`);
    process.exit(0);
  }

  console.log("\nExecuting cleanup transaction...");

  // Execute inside a single transaction
  await db.$transaction(async (tx) => {
    // 1. Delete attachments linked to financial records
    await tx.attachment.deleteMany({
      where: {
        OR: [
          { transactionId: { not: null } },
          { debtPaymentId: { not: null } },
          { savingTxId: { not: null } },
          { remittanceId: { not: null } }
        ]
      }
    });

    // 2. Delete ImportedTransactions
    await tx.importedTransaction.deleteMany();

    // 3. Clean up RecurringTemplate references
    await tx.recurringTemplate.updateMany({
      where: {
        sourceType: { in: ["REMITTANCE_PLAN"] } // clean plans or invalid entity references
      },
      data: {
        sourceEntityId: null,
        sourceType: "GENERAL"
      }
    });

    // 4. Delete child entities in schema-respecting dependency order
    await tx.recurringOccurrence.deleteMany();
    await tx.savingTransaction.deleteMany();
    await tx.debtPayment.deleteMany();
    await tx.remittance.deleteMany();
    await tx.transaction.deleteMany();
    await tx.monthlyRollover.deleteMany();

    // 5. Delete financial audit logs
    await tx.auditLog.deleteMany({
      where: {
        entityType: {
          in: ["TRANSACTION", "IMPORTED_TRANSACTION", "REMITTANCE", "DEBT_PAYMENT", "SAVING_TRANSACTION"]
        }
      }
    });

    // 6. Delete all notifications
    await tx.notification.deleteMany();

    // 7. Reset balances
    await tx.account.updateMany({
      data: {
        currentBalance: 0,
        latestImportedBalance: null,
        lastSMSImportedAt: null,
        lastSuccessfulSyncAt: null
      }
    });

    await tx.savingGoal.updateMany({
      data: {
        currentAmount: 0
      }
    });

    // Reset debt current balances to original balance
    const allDebts = await tx.debt.findMany();
    for (const d of allDebts) {
      await tx.debt.update({
        where: { id: d.id },
        data: {
          currentBalance: d.originalBalance
        }
      });
    }
  });

  console.log("\nCleanup executed successfully! Performing verification...");

  // Post-clean verification
  const tCount = await db.transaction.count();
  const impCount = await db.importedTransaction.count();
  const remCount = await db.remittance.count();
  const dpCount = await db.debtPayment.count();
  const stCount = await db.savingTransaction.count();
  const roCount = await db.recurringOccurrence.count();
  const mrCount = await db.monthlyRollover.count();

  const attCount = await db.attachment.count({
    where: {
      OR: [
        { transactionId: { not: null } },
        { debtPaymentId: { not: null } },
        { savingTxId: { not: null } },
        { remittanceId: { not: null } }
      ]
    }
  });

  const audCount = await db.auditLog.count({
    where: {
      entityType: {
        in: ["TRANSACTION", "IMPORTED_TRANSACTION", "REMITTANCE", "DEBT_PAYMENT", "SAVING_TRANSACTION"]
      }
    }
  });

  const notCount = await db.notification.count();

  const badAccounts = await db.account.count({
    where: {
      OR: [
        { currentBalance: { not: 0 } },
        { latestImportedBalance: { not: null } },
        { lastSMSImportedAt: { not: null } },
        { lastSuccessfulSyncAt: { not: null } }
      ]
    }
  });

  const badGoals = await db.savingGoal.count({
    where: {
      currentAmount: { not: 0 }
    }
  });

  // Check if any debt's currentBalance is not equal to its originalBalance
  const allDebtsPost = await db.debt.findMany();
  let badDebts = 0;
  for (const d of allDebtsPost) {
    if (!d.currentBalance.equals(d.originalBalance)) {
      badDebts++;
    }
  }

  console.log(`- Remaining Transactions: ${tCount}`);
  console.log(`- Remaining Imported Transactions: ${impCount}`);
  console.log(`- Remaining Remittances: ${remCount}`);
  console.log(`- Remaining Debt Payments: ${dpCount}`);
  console.log(`- Remaining Saving Transactions: ${stCount}`);
  console.log(`- Remaining Recurring Occurrences: ${roCount}`);
  console.log(`- Remaining Monthly Rollovers: ${mrCount}`);
  console.log(`- Remaining Financial Attachments: ${attCount}`);
  console.log(`- Remaining Financial Audit Logs: ${audCount}`);
  console.log(`- Remaining Notifications: ${notCount}`);
  console.log(`- Accounts with bad balance: ${badAccounts}`);
  console.log(`- Saving Goals with bad balance: ${badGoals}`);
  console.log(`- Debts with bad balance: ${badDebts}`);

  if (
    tCount !== 0 ||
    impCount !== 0 ||
    remCount !== 0 ||
    dpCount !== 0 ||
    stCount !== 0 ||
    roCount !== 0 ||
    mrCount !== 0 ||
    attCount !== 0 ||
    audCount !== 0 ||
    notCount !== 0 ||
    badAccounts !== 0 ||
    badGoals !== 0 ||
    badDebts !== 0
  ) {
    console.error("\nVerification FAILED! Some balances or records are not fully cleaned.");
    process.exit(1);
  }

  console.log("\nVerification SUCCESS: Database is clean and in a fresh financial state!");
}

main()
  .catch((err) => {
    console.error("Fatal error during cleanup:", err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
