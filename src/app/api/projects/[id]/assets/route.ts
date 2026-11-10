import { NextResponse } from "next/server";
import { count, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getUser } from "@/lib/session";
import { loadOwned } from "@/lib/projects";
import { cleanFileName, convertToWebp, MAX_ASSETS_PER_PROJECT, MAX_UPLOAD_BYTES, UploadError } from "@/lib/builder/site-assets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

/**
 * A picture the owner attaches in the chat: POST multipart form with one "file".
 * It is turned into a small WebP here and kept for this project only. Nothing goes on the site until a change uses it.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return fail("Sign in first.", 401);
  const { id } = await ctx.params;
  const p = await loadOwned(id, user.id);
  if (!p) return fail("Not found.", 404);
  if (p.kind !== "site") return fail("This project is not a website.", 400);

  // Refuse a huge body before reading it.
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_UPLOAD_BYTES + 64 * 1024) return fail("That picture is over 3 MB. Please send a smaller one.", 413);

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return fail("Attach a picture.", 400);

  const [{ n }] = await db.select({ n: count() }).from(schema.siteAssets).where(eq(schema.siteAssets.projectId, p.id));
  if (n >= MAX_ASSETS_PER_PROJECT) return fail(`This site already has ${MAX_ASSETS_PER_PROJECT} pictures attached. That is the most for now.`, 409);

  try {
    const img = await convertToWebp(Buffer.from(await file.arrayBuffer()));
    const name = cleanFileName(file.name);
    const [row] = await db
      .insert(schema.siteAssets)
      .values({ projectId: p.id, name, mime: "image/webp", width: img.width, height: img.height, size: img.size, bytes: img.bytes })
      .returning({ id: schema.siteAssets.id });
    return NextResponse.json({ id: row.id, name, width: img.width, height: img.height, size: img.size });
  } catch (e) {
    if (e instanceof UploadError) return fail(e.message, 400);
    console.error("asset upload failed:", e instanceof Error ? e.message : e);
    return fail("I could not save that picture. Please try again.", 500);
  }
}
