// Mock server-only before any other imports
const Module = require("module");
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id: string) {
  if (id === "server-only") return {};
  return originalRequire.apply(this, arguments);
};

import { smsParserRegistry } from "../src/imports/sms/parser-registry";
import { importService } from "../src/imports/engine/import.service";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

async function runTest() {
  const prisma = new PrismaClient();
  try {
    const email = process.env.SEED_USER_EMAIL;
    if (!email) {
      console.log("SEED_USER_EMAIL not set in env");
      return;
    }
    const user = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    if (!user) {
      console.log("User not found in DB");
      return;
    }

    console.log("Starting test for payload with sender 'Mashreq'...");
    
    // Simulate webhook processing
    const result = await importService.processSms(user.id, {
      sender: "Mashreq",
      message: "Test transaction AED 50.00 at Carrefour",
      receivedAt: new Date("2026-07-15T04:52:00.000Z"),
    });

    console.log("Outcome result:", JSON.stringify(result, null, 2));

  } catch (error) {
    console.error("Test failed with error:", error);
  } finally {
    await prisma.$disconnect();
  }
}

runTest();
