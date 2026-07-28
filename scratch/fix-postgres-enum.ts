import { db } from "../src/lib/db";

async function main() {
  await db.$executeRawUnsafe(`DELETE FROM "Account" WHERE "type"::text = 'MASHREQ';`);
  console.log("Deleted Mashreq account rows.");
}

main().catch(console.error).finally(() => db.$disconnect());
