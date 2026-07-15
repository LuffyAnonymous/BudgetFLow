import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

async function checkAllowlist() {
  const prisma = new PrismaClient();
  try {
    const email = process.env.SEED_USER_EMAIL;
    if (!email) {
      console.log("SEED_USER_EMAIL is not set in env");
      return;
    }
    const normalizedEmail = email.trim().toLowerCase();
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      console.log(`User not found: ${normalizedEmail}`);
      return;
    }

    const importSetting = await prisma.importSetting.findUnique({
      where: { userId: user.id },
    });

    if (!importSetting) {
      console.log(`Import settings not found for user: ${user.id}`);
      return;
    }

    console.log(`userId: ${importSetting.userId}`);
    console.log(`enabled: ${importSetting.enabled}`);
    console.log(`allowedSenders: ${JSON.stringify(importSetting.senderAllowlist)}`);

  } catch (error) {
    console.error("Database query failed:", error);
  } finally {
    await prisma.$disconnect();
  }
}

checkAllowlist();
