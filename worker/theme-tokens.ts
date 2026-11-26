/**
 * PR B: a showcase build starts from the same design tokens as the Visual design tile the owner saw. Runs after the design
 * brief step and before the runner is called. Only the tokens go to the runner (as a JSON file it writes into the site as
 * src/theme.ts), never the tile's page.
 *
 * The tokens are used only when all of these hold; otherwise the build goes on exactly as before, without --theme, and the
 * build record says why:
 *   - WORKER_THEME_TOKENS is not off
 *   - the build has a design brief that passed and went to the runner
 *   - the project has a saved tile with tokens, drawn from that same design brief and the same brief (the tile's fingerprint)
 *   - the tokens have the right shape (src/lib/builder/theme-tokens.ts)
 * Never throws: an error is logged and the build goes on without tokens.
 */
import { writeFile } from "node:fs/promises";
import { readDesignBrief, tileFingerprint, type Db } from "../src/lib/design-brief-store";
import { themeTokensProblem } from "../src/lib/builder/theme-tokens";
import type { DesignBriefRecord } from "./design-brief";

/** What the build record keeps under details.theme. usedByRunner is what the runner's summary said it wrote. */
export type ThemeRecord = {
  used: boolean;
  /** Why the tokens were not used, in a few words. Null when they were. */
  why: string | null;
  file: string | null;
  /** The tile's fingerprint, when there was a tile to compare. */
  fingerprint: string | null;
  renderedAt: string | null;
  usedByRunner?: boolean;
};

const no = (why: string, fingerprint: string | null = null): ThemeRecord => ({ used: false, why, file: null, fingerprint, renderedAt: null });

export async function themeForBuild(opts: {
  db: Db;
  projectId: string;
  /** The design brief step's result for this build. */
  designBrief: DesignBriefRecord | undefined;
  /** The approved brief this build uses (the one the tile's fingerprint covers). */
  brief: Record<string, unknown>;
  /** Where to write the tokens for the runner. */
  file: string;
  env: NodeJS.ProcessEnv;
  log?: (line: string) => void;
}): Promise<ThemeRecord> {
  const log = opts.log ?? ((line: string) => console.error(line));
  if (opts.env.WORKER_THEME_TOKENS === "off") return no("switched off (WORKER_THEME_TOKENS=off)");
  try {
    const d = opts.designBrief;
    if (!d || d.skipped !== null || !d.passedToRunner || !d.json) return no("no design brief went to the runner");
    const saved = await readDesignBrief(opts.db, opts.projectId);
    if (!saved) return no("no saved design brief");
    const tile = saved.tile;
    if (!tile) return no("no Visual design tile for this design brief");
    if (tile.error || !tile.tokens) return no(`the tile has no tokens (${tile.error ?? "none saved"})`, tile.fingerprint);
    if (tile.fingerprint !== tileFingerprint(d.json, opts.brief)) return no("the tile was drawn from another design brief or brief (fingerprint mismatch)", tile.fingerprint);
    const problem = themeTokensProblem(tile.tokens);
    if (problem) return no(`the saved tokens have the wrong shape (${problem})`, tile.fingerprint);
    await writeFile(opts.file, JSON.stringify(tile.tokens, null, 2));
    return { used: true, why: null, file: opts.file, fingerprint: tile.fingerprint, renderedAt: tile.renderedAt };
  } catch (e) {
    const why = (e instanceof Error ? e.message : String(e)).slice(0, 200);
    log(`worker: theme tokens not used, the build goes on without them: ${why}`);
    return no(`error: ${why}`);
  }
}
