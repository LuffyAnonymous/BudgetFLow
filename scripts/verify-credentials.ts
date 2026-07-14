import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import path from "path";

// 1. Load environment variables from the project root .env
dotenv.config({ path: path.resolve(__dirname, "../.env") });

async function verify() {
  const prisma = new PrismaClient();
  let dbConnected = "no";
  let userFound = "no";
  let passwordValid = "no";

  try {
    // 2. Connect to the configured Neon DATABASE_URL
    await prisma.$connect();
    dbConnected = "yes";

    const seedEmail = process.env.SEED_USER_EMAIL;
    const seedPassword = process.env.SEED_USER_PASSWORD;

    if (seedEmail && seedPassword) {
      // 3. Normalize SEED_USER_EMAIL using trim().toLowerCase()
      const normalizedEmail = seedEmail.trim().toLowerCase();
      
      // 4. Find the matching user
      const user = await prisma.user.findUnique({
        where: { email: normalizedEmail },
      });

      if (user) {
        userFound = "yes";
        
        // 5. Compare SEED_USER_PASSWORD against user.passwordHash using bcryptjs
        if (user.passwordHash) {
          const match = await bcrypt.compare(seedPassword, user.passwordHash);
          if (match) {
            passwordValid = "yes";
          }
        }
      }
    }
  } catch (error) {
    dbConnected = "no";
  } finally {
    // 8. Always disconnect Prisma in a finally block
    await prisma.$disconnect();
    
    // 6. Print only requested details
    console.log(`database connected: ${dbConnected}`);
    console.log(`user found: ${userFound}`);
    console.log(`password valid: ${passwordValid}`);
  }
}

verify();
