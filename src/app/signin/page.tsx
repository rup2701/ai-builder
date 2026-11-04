import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { devLoginEnabled, signIn } from "@/auth";
import { REQUEST_ACCESS_HREF } from "@/lib/brand";
import { getUser } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Image from "next/image";
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
  const target = newParams ? `/new?${newParams}` : "/";
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
    <main className="grid min-h-[100dvh] lg:grid-cols-2">
      <section className="relative flex min-h-[100dvh] flex-col justify-center px-6 py-24 sm:px-10">
        <div className="absolute inset-x-6 top-6 flex items-center justify-between sm:inset-x-10 sm:top-8 lg:top-8">
          <Image src="/images/appnomics-logo.svg" alt="Appnomics" width={122} height={32} />
          <span className="rounded-full bg-foreground/[0.06] px-2.5 py-0.5 text-xs text-foreground/70">Private beta</span>
        </div>

        <div className="mx-auto w-full max-w-[24rem]">
          <h1 className="text-3xl leading-tight">Sign in</h1>
          {error && (
            <div role="alert" data-testid="signin-error" className="mt-5 flex gap-2.5 rounded-xl border border-destructive/25 bg-destructive/[0.06] p-3 text-sm leading-relaxed text-destructive">
              <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v5M12 16.5v.01" />
              </svg>
              <p>
                {error === "BadCode"
                  ? "That access code isn't valid, or it has already been used. Check it and try again."
                  : "That email isn't on the list yet. Enter your access code and try again."}
              </p>
            </div>
          )}

          <div className="mt-8 space-y-4">
            {google && (
              <form action={googleAction} className="space-y-4">
                <div>
                  <label htmlFor="code" className="text-sm font-medium">
                    Access code
                  </label>
                  <Input
                    id="code"
                    name="code"
                    type="text"
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    aria-describedby="code-hint"
                    placeholder="NAME-XXXX-XXXX-XXXX"
                    className="mt-1.5 h-11 uppercase tracking-wide placeholder:normal-case placeholder:tracking-normal"
                  />
                  <p id="code-hint" className="mt-1.5 text-xs text-foreground/60">
                    First time here? Enter the code you were sent. Signing in again? Leave it empty.
                  </p>
                </div>
                <Button type="submit" variant="outline" className="h-11 w-full gap-3 border-[#dadce0] bg-white text-[#1f1f1f] hover:bg-[#f8f9fa] hover:text-[#1f1f1f]">
                  <GoogleMark />
                  Continue with Google
                </Button>
                <p className="text-center text-sm text-foreground/60">
                  No code?{" "}
                  <a href={REQUEST_ACCESS_HREF} className="text-foreground underline underline-offset-4 hover:no-underline">
                    Request access
                  </a>
                </p>
              </form>
            )}
            {dev && (
              <form action={devAction} className="space-y-2 border-t border-border pt-4">
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

          <p className="mt-6 text-center text-xs text-foreground/55">Google is only used to sign you in.</p>
        </div>
      </section>

      {/* Just the picture: one of our own builds, running off the right edge. Hidden on phones and tablets. */}
      <aside aria-hidden="true" data-testid="signin-art" className="hidden items-center bg-white lg:flex lg:pl-24">
        <div
          className="h-[min(62vh,40rem)] w-full rounded-l-[32px] bg-cover bg-left-top bg-no-repeat"
          style={{ backgroundImage: "url(/images/signin-hero.webp)" }}
        />
      </aside>
    </main>
  );
}

/** The Google "G", in its four brand colours. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="h-[18px] w-[18px]" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
