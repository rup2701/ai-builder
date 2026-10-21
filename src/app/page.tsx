import { redirect } from "next/navigation";
import { getUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** The marketing hero links here as /?idea=… */
export default async function Home({ searchParams }: { searchParams: Promise<{ idea?: string }> }) {
  const { idea } = await searchParams;
  const q = idea?.trim() ? `?idea=${encodeURIComponent(idea.trim().slice(0, 1000))}` : "";
  const user = await getUser();
  if (user) redirect(q ? `/new${q}` : "/projects");
  redirect(`/signin${q}`);
}
