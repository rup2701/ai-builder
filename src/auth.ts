import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { cookies } from "next/headers";
import { db, schema } from "@/db";
import { ACCESS_COOKIE, findMember, redeemForNewUser } from "@/lib/access-code";

/** These emails always can sign in (you). Everyone else joins with an access code, see src/lib/access-code.ts. */
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
      if (!email) return false;
      if (allowedEmails().includes(email)) {
        await db
          .insert(schema.users)
          .values({ email, name: user.name ?? null })
          .onConflictDoNothing({ target: schema.users.email });
        return true;
      }
      // Someone who joined earlier with a code that is still valid.
      if (await findMember(email)) return true;
      // A new person: the sign-in page put the code they typed in a short-lived cookie.
      const jar = await cookies();
      const code = jar.get(ACCESS_COOKIE)?.value;
      if (!code) return false;
      const joined = await redeemForNewUser(email, user.name ?? null, code);
      try {
        jar.delete(ACCESS_COOKIE);
      } catch {
        /* the cookie expires by itself after ten minutes */
      }
      return joined;
    },
  },
});
