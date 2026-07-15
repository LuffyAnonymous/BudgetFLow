import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import path from "path";

// Load environment variables from the project root .env
dotenv.config({ path: path.resolve(__dirname, "../.env") });

async function verify() {
  const prisma = new PrismaClient();
  let dbConnected = "no";
  let userFound = "no";
  let importSettingsFound = "no";
  let importEngineEnabled = "no";

  try {
    await prisma.$connect();
    dbConnected = "yes";

    const seedEmail = process.env.SEED_USER_EMAIL;

    if (seedEmail) {
      const normalizedEmail = seedEmail.trim().toLowerCase();
      const user = await prisma.user.findUnique({
        where: { email: normalizedEmail },
      });

      if (user) {
        userFound = "yes";
        
        // Find import settings
        const importSetting = await prisma.importSetting.findUnique({
          where: { userId: user.id },
        });

        if (importSetting) {
          importSettingsFound = "yes";
          if (importSetting.enabled) {
            importEngineEnabled = "yes";
          }
        }
      }
    }
  } catch (error) {
    dbConnected = "no";
  } finally {
    await prisma.$disconnect();
    console.log(`database connected: ${dbConnected}`);
    console.log(`user found: ${userFound}`);
    console.log(`import settings found: ${importSettingsFound}`);
    console.log(`import engine enabled: ${importEngineEnabled}`);
  }
}

verify();
