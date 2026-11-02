import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { devLoginEnabled, signIn } from "@/auth";
import { getUser } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ACCESS_COOKIE, checkCode, normalizeCode } from "@/lib/access-code";

export const dynamic = "force-dynamic";

/** Where to go back to on an error, keeping the idea and kind the person arrived with. */
function backTo(err: string, idea: string | undefined, kind: string | undefined) {
  return `/signin?error=${err}${idea ? `&idea=${encodeURIComponent(idea)}` : ""}${kind === "site" ? "&kind=site" : ""}`;
}

/** A typed code is checked now (so a typo is caught before Google) and kept ten minutes in a cookie for the sign-in step. */
async function holdCode(fd: FormData, idea: string | undefined, kind: string | undefined) {
  const code = normalizeCode(String(fd.get("code") ?? ""));
  if (!code) return;
  if (!(await checkCode(code)).ok) redirect(backTo("BadCode", idea, kind));
  (await cookies()).set(ACCESS_COOKIE, code, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 600, path: "/" });
}

export default async function SignIn({ searchParams }: { searchParams: Promise<{ idea?: string; kind?: string; error?: string }> }) {
  const { idea, kind, error } = await searchParams;
  // Your idea travels with the sign-in, so it is still there when you arrive.
  const newParams = new URLSearchParams({ ...(idea?.trim() ? { idea: idea.trim().slice(0, 1000) } : {}), ...(kind === "site" ? { kind } : {}) }).toString();
  const target = newParams ? `/new?${newParams}` : "/projects";
  // Decide by whether this person may still use the builder, not by whether a session cookie exists:
  // after a code is revoked the cookie is still there, and sending them on would loop back here.
  if (await getUser()) redirect(target);

  const google = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
  const dev = devLoginEnabled();

  async function googleAction(fd: FormData) {
    "use server";
    await holdCode(fd, idea, kind);
    await signIn("google", { redirectTo: target });
  }
  async function devAction(fd: FormData) {
    "use server";
    await holdCode(fd, idea, kind);
    try {
      await signIn("dev", { email: String(fd.get("email") ?? ""), redirectTo: target });
    } catch (e) {
      if (e instanceof AuthError) redirect(backTo("AccessDenied", idea, kind));
      throw e;
    }
  }

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col justify-center px-4 py-12">
      <h1 className="text-4xl">Sign in to build</h1>
      {idea?.trim() && (
        <p className="mt-4 rounded-2xl border border-border bg-card p-4 text-sm leading-relaxed text-foreground/80">
          Your idea is saved: <span className="text-foreground">“{idea.trim().slice(0, 200)}”</span>
        </p>
      )}
      {error && (
        <p role="alert" data-testid="signin-error" className="mt-4 text-sm text-destructive">
          {error === "BadCode"
            ? "That access code isn't valid, or it has already been used. Check it and try again."
            : "That email isn't on the list yet. Enter your access code and try again."}
        </p>
      )}
      <div className="mt-6 space-y-4">
        {google && (
          <form action={googleAction} className="space-y-3">
            <div>
              <label htmlFor="code" className="text-sm">
                Access code <span className="text-foreground/60">(the first time only)</span>
              </label>
              <Input id="code" name="code" type="text" autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="NAME-XXXX-XXXX-XXXX" className="mt-1.5" />
            </div>
            <Button type="submit" className="w-full">
              Continue with Google
            </Button>
          </form>
        )}
        {dev && (
          <form action={devAction} className="space-y-2">
            <label htmlFor="email" className="text-sm">
              Email (development sign-in)
            </label>
            <Input id="email" name="email" type="email" required placeholder="you@example.com" />
            <Input name="code" type="text" autoComplete="off" placeholder="Access code (first time only)" aria-label="Access code" />
            <Button type="submit" variant="outline" className="w-full">
              Sign in
            </Button>
          </form>
        )}
        {!google && !dev && <p className="text-sm text-foreground/70">No sign-in method is configured. Set AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET.</p>}
      </div>
    </main>
  );
}
