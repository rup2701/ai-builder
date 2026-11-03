import { redirect } from "next/navigation";
import { getUser } from "@/lib/session";
import { buildAllowance } from "@/lib/builds";
import { signOutAction } from "@/app/actions";
import AppShell from "@/components/app/AppShell";

export const dynamic = "force-dynamic";

export default async function Settings() {
  const user = await getUser();
  if (!user) redirect("/signin");
  const { limit, used } = await buildAllowance(user.id, user.email ?? null);

  return (
    <AppShell active="settings" email={user.email ?? null}>
      <div className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-4xl">Settings</h1>

        <dl className="mt-8 divide-y divide-foreground/10 rounded-3xl border border-foreground/10 bg-white">
          <div className="flex items-center justify-between gap-4 p-5">
            <dt className="text-sm text-foreground/60">Signed in as</dt>
            <dd className="min-w-0 truncate text-sm">{user.email}</dd>
          </div>
          <div className="flex items-center justify-between gap-4 p-5">
            <dt className="text-sm text-foreground/60">Website builds used</dt>
            <dd className="text-sm">{limit > 0 ? `${used} of ${limit}` : `${used} (no limit)`}</dd>
          </div>
        </dl>

        <form action={signOutAction} className="mt-6">
          <button type="submit" className="rounded-xl border border-foreground/25 px-4 py-2 text-sm hover:bg-foreground hover:text-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground">
            Sign out
          </button>
        </form>
      </div>
    </AppShell>
  );
}
