import { redirect } from "next/navigation";
import { getUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** The marketing hero links here as /?idea=… */
export default async function Home({ searchParams }: { searchParams: Promise<{ idea?: string; kind?: string }> }) {
  const { idea, kind } = await searchParams;
  const params = new URLSearchParams({ ...(idea?.trim() ? { idea: idea.trim().slice(0, 1000) } : {}), ...(kind === "site" ? { kind } : {}) }).toString();
  const q = params ? `?${params}` : "";
  const user = await getUser();
  if (user) redirect(q ? `/new${q}` : "/projects");
  redirect(`/signin${q}`);
}
