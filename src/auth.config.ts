import type { NextAuthConfig } from "next-auth";

export const authConfig = {
  trustHost: true,
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const protectedRoutes = [
        "/dashboard",
        "/transactions",
        "/budgets",
        "/debts",
        "/savings",
        "/remittances",
        "/reports",
        "/settings",
      ];
      
      const isProtectedRoute = protectedRoutes.some((route) =>
        nextUrl.pathname.startsWith(route)
      );

      if (isProtectedRoute) {
        if (isLoggedIn) return true;
        return false; // Redirect unauthenticated users to login page
      } else if (isLoggedIn && (nextUrl.pathname === "/" || nextUrl.pathname === "/login")) {
        return Response.redirect(new URL("/dashboard", nextUrl));
      }
      return true;
    },
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.sessionVersion = (user as { sessionVersion?: number }).sessionVersion;
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string;
        
        try {
          const { db } = await import("@/lib/db");
          const user = await db.user.findUnique({
            where: { id: session.user.id },
            select: { sessionVersion: true },
          });
          if (!user || user.sessionVersion !== token.sessionVersion) {
            return null as unknown as typeof session;
          }
        } catch {
          // ignore or fallback
        }
      }
      return session;
    },
  },
  providers: [], // Configured in auth.ts
} satisfies NextAuthConfig;
