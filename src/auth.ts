import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { db, schema } from "@/db";

/** Only these emails can sign in. Sharing the builder means adding an email here. */
export function allowedEmails(): string[] {
  return (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export const devLoginEnabled = () => process.env.ALLOW_DEV_LOGIN === "1" && process.env.NODE_ENV !== "production";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  trustHost: true,
  pages: { signIn: "/signin", error: "/signin" },
  providers: [
    ...(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET ? [Google] : []),
    ...(devLoginEnabled()
      ? [
          Credentials({
            id: "dev",
            name: "Dev login",
            credentials: { email: {} },
            authorize: async (c) => {
              const email = String(c?.email ?? "").trim().toLowerCase();
              return email ? { id: email, email, name: email.split("@")[0] } : null;
            },
          }),
        ]
      : []),
  ],
  callbacks: {
    async signIn({ user }) {
      const email = user.email?.trim().toLowerCase();
      if (!email || !allowedEmails().includes(email)) return false;
      await db
        .insert(schema.users)
        .values({ email, name: user.name ?? null })
        .onConflictDoNothing({ target: schema.users.email });
      return true;
    },
  },
});
