import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { auth, devLoginEnabled, signIn } from "@/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const dynamic = "force-dynamic";

export default async function SignIn({ searchParams }: { searchParams: Promise<{ idea?: string; kind?: string; error?: string }> }) {
  const { idea, kind, error } = await searchParams;
  // Your idea travels with the sign-in, so it is still there when you arrive.
  const newParams = new URLSearchParams({ ...(idea?.trim() ? { idea: idea.trim().slice(0, 1000) } : {}), ...(kind === "site" ? { kind } : {}) }).toString();
  const target = newParams ? `/new?${newParams}` : "/projects";
  const session = await auth();
  if (session?.user) redirect(target);

  const google = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
  const dev = devLoginEnabled();

  async function googleAction() {
    "use server";
    await signIn("google", { redirectTo: target });
  }
  async function devAction(fd: FormData) {
    "use server";
    try {
      await signIn("dev", { email: String(fd.get("email") ?? ""), redirectTo: target });
    } catch (e) {
      if (e instanceof AuthError) redirect(`/signin?error=AccessDenied${idea ? `&idea=${encodeURIComponent(idea)}` : ""}${kind === "site" ? "&kind=site" : ""}`);
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
          That email isn't on the list yet. Ask for access and try again.
        </p>
      )}
      <div className="mt-6 space-y-4">
        {google && (
          <form action={googleAction}>
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
