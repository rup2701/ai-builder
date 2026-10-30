import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { siteSlug } from "./site-brief";
import type { WorkspaceState } from "@/lib/workspace/types";

/**
 * Development convenience until the worker starts the runner itself: when RUNNER_DIR is set,
 * every saved brief is also written to <RUNNER_DIR>/briefs/ with a readable transcript,
 * so it can be built with `npm run create -- "..." --specs vertical-packs/site/specs --brief <file>`.
 */
export async function saveBriefForRunner(projectId: string, state: WorkspaceState): Promise<string | null> {
  const dir = process.env.RUNNER_DIR;
  const brief = state.site?.brief as { site?: { name?: string } } | undefined;
  if (!dir || !brief) return null;
  const base = `${siteSlug(brief.site?.name ?? "site")}-${projectId.slice(0, 8)}`;
  const out = path.resolve(dir, "briefs");
  await mkdir(out, { recursive: true });
  const file = path.join(out, `${base}.json`);
  await writeFile(file, JSON.stringify(brief, null, 2) + "\n");
  const lines = state.msgs
    .filter((m) => m.kind === "user" || m.kind === "bot")
    .map((m) => `**${m.kind === "user" ? "Person" : "Interviewer"}:** ${(m as { text: string }).text}`);
  await writeFile(path.join(out, `${base}.interview.md`), `# Interview for ${brief.site?.name ?? "site"}\n\n${lines.join("\n\n")}\n`);
  console.log(`brief saved for the runner: ${file}`);
  return file;
}
