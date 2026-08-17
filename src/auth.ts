import NextAuth from "next-auth";
import { authConfig } from "./auth.config";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      async authorize(credentials) {
        const isDev = process.env.NODE_ENV === "development";
        
        // Trim and lowercase email, preserve password exactly
        const email = typeof credentials?.email === "string" ? credentials.email.trim().toLowerCase() : "";
        const password = typeof credentials?.password === "string" ? credentials.password : "";

        if (isDev) {
          console.log("[Auth Debug] Authorize invoked");
          console.log(`[Auth Debug] Submitted email: "${email}"`);
          console.log(`[Auth Debug] Password length: ${password.length}`);
        }

        const parsedCredentials = z
          .object({
            email: z.string().email(),
            password: z.string().min(6),
          })
          .safeParse({ email, password });

        if (!parsedCredentials.success) {
          if (isDev) {
            console.log("[Auth Debug] Validation failed:", parsedCredentials.error.format());
          }
          return null;
        }

        try {
          const user = await db.user.findUnique({
            where: { email },
          });

          const userFound = !!user;
          if (isDev) {
            console.log(`[Auth Debug] User found: ${userFound}`);
          }

          if (!user || !user.passwordHash) {
            return null;
          }

          const passwordsMatch = await bcrypt.compare(password, user.passwordHash);
          if (isDev) {
            console.log(`[Auth Debug] Password matched: ${passwordsMatch}`);
          }

          if (passwordsMatch) {
            const returnedUser = {
              id: user.id,
              email: user.email,
              name: user.name,
              sessionVersion: user.sessionVersion,
            };
            if (isDev) {
              console.log("[Auth Debug] Authorize returning user:", returnedUser);
            }
            return returnedUser;
          }
        } catch (error) {
          if (isDev) {
            console.error("[Auth Debug] Database or bcrypt error:", error);
          }
        }

        return null;
      },
    }),
  ],
});

export const { GET, POST } = handlers;
