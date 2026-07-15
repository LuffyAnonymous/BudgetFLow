import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

async function updateAllowlist() {
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

    const updated = await prisma.importSetting.update({
      where: { userId: user.id },
      data: {
        senderAllowlist: ["ENBD", "MASHREQ"],
      },
    });

    console.log("Allowlist updated successfully!");
    console.log(`userId: ${updated.userId}`);
    console.log(`enabled: ${updated.enabled}`);
    console.log(`allowedSenders: ${JSON.stringify(updated.senderAllowlist)}`);

  } catch (error) {
    console.error("Database update failed:", error);
  } finally {
    await prisma.$disconnect();
  }
}

updateAllowlist();
