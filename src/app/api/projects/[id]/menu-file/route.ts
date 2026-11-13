import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import readXlsxFile from "read-excel-file/node";
import { db, schema } from "@/db";
import { getUser } from "@/lib/session";
import { loadOwned } from "@/lib/projects";
import { pushMsg } from "@/lib/workspace/state";
import { localPlanText, withMenu } from "@/lib/builder/local-edit";
import { cellText, MAX_SHEET_BYTES, menuFromRows, menuSummary, parseCsv } from "@/lib/builder/menu-sheet";
import type { WorkspaceState } from "@/lib/workspace/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

/**
 * A restaurant menu from a spreadsheet (.csv or .xlsx), added to the saved brief before the site is built.
 * Code reads the file. Nothing is guessed: rows that cannot be used are skipped and listed back in the chat.
 * After the site is built, menu changes go through the change box instead.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return fail("Sign in first.", 401);
  const { id } = await ctx.params;
  const p = await loadOwned(id, user.id);
  if (!p) return fail("Not found.", 404);
  if (p.kind !== "site") return fail("This project is not a website.", 400);
  const state = p.state as WorkspaceState;
  const brief = state.site?.brief as Record<string, unknown> | undefined;
  if (!brief || (brief.site as { kind?: string } | undefined)?.kind !== "local-business") return fail("Tell me about the restaurant first, then send the menu.", 409);
  if (state.site?.build) return fail("The site is already built. Ask for the menu change in the change box.", 409);

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return fail("Attach a .csv or .xlsx file.", 400);
  if (file.size > MAX_SHEET_BYTES) return fail("That file is too big. Keep it under 1 MB.", 413);
  const name = file.name.replace(/[^\w .()-]/g, "").slice(0, 60) || "menu";
  const lower = file.name.toLowerCase();

  let rows: unknown[][];
  try {
    if (lower.endsWith(".csv") || lower.endsWith(".tsv") || lower.endsWith(".txt")) rows = parseCsv(await file.text());
    else if (lower.endsWith(".xlsx")) rows = (await readXlsxFile(Buffer.from(await file.arrayBuffer()))).map((r) => r.map(cellText));
    else return fail("Use a .csv or .xlsx file. In Excel or Sheets, choose Save as or Download as one of those.", 400);
  } catch {
    return fail("I could not open that file. Save it again as .csv or .xlsx and try once more.", 400);
  }

  const menu = menuFromRows(rows);
  let next = pushMsg(state, { kind: "user", text: `Attached ${name}` });
  if (!menu.ok) {
    next = pushMsg(next, { kind: "bot", text: menu.error });
  } else {
    const made = withMenu(brief as never, menu.categories);
    if ("error" in made) next = pushMsg(next, { kind: "bot", text: made.error });
    else {
      next = pushMsg({ ...next, site: { ...(next.site ?? {}), brief: made.brief as never } }, { kind: "bot", text: menuSummary(menu, name) });
      next = pushMsg(next, { kind: "bot", text: localPlanText(made.brief) });
    }
  }
  await db.update(schema.projects).set({ state: next, updatedAt: new Date() }).where(eq(schema.projects.id, p.id));
  return NextResponse.json({ state: next });
}
