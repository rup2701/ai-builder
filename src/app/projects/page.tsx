import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { signOut } from "@/auth";
import { getUser } from "@/lib/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function Projects() {
  const user = await getUser();
  if (!user) redirect("/signin");
  const rows = await db.select().from(schema.projects).where(eq(schema.projects.ownerId, user.id)).orderBy(desc(schema.projects.updatedAt));

  async function out() {
    "use server";
    await signOut({ redirectTo: "/signin" });
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-4xl">Your projects</h1>
        <div className="flex items-center gap-2">
          <Button asChild>
            <Link href="/new">New project</Link>
          </Button>
          <form action={out}>
            <Button type="submit" variant="ghost">
              Sign out
            </Button>
          </form>
        </div>
      </div>
      <p className="mt-2 text-sm text-foreground/60">Signed in as {user.email}</p>

      {rows.length === 0 ? (
        <p className="mt-10 text-foreground/70">Nothing here yet. Start a project and describe what you want to launch.</p>
      ) : (
        <ul className="mt-8 space-y-3" aria-label="Projects">
          {rows.map((p) => (
            <li key={p.id}>
              <Link href={`/projects/${p.id}`} className="block rounded-3xl outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                <Card className="transition-colors hover:border-foreground/30">
                  <CardContent className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="truncate text-base">{p.title}</p>
                      <p className="mt-0.5 text-xs text-foreground/55">Updated {p.updatedAt.toLocaleString("en-US", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" })} UTC</p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      {p.isSample && <Badge variant="outline">Sample</Badge>}
                      <Badge>{p.status}</Badge>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
