/**
 * PR B: a showcase build starts from the same design tokens as the Visual design tile. Runs after the design brief step and
 * before the runner is called. Only the tokens go to the runner (as a JSON file it writes into the site as src/theme.ts),
 * never the tile's page.
 *
 * Where the tokens come from (details.theme.source in the build record):
 *   tile       the tile saved on the project, when it was drawn from this build's design brief and brief (its fingerprint)
 *              and its tokens have the right shape
 *   computed   otherwise, designTokens(design brief, brief) here: the same function the tile is drawn with, so the build
 *              starts from the look the tile would show. Covers a design brief written at build start, which has no tile.
 *              themeTileWhy says why the saved tile was not used.
 * No tokens at all, and a build exactly as before (no --theme), when WORKER_THEME_TOKENS=off, when no design brief went to
 * the runner, or when the computed tokens fail (an error or a wrong shape). Never throws: an error is logged.
 */
import { writeFile } from "node:fs/promises";
import { readDesignBrief, tileFingerprint, type Db } from "../src/lib/design-brief-store";
import { designTokens } from "../src/lib/builder/design-tokens";
import { themeTokensProblem } from "../src/lib/builder/theme-tokens";
import type { DesignBriefRecord } from "./design-brief";

/** What the build record keeps under details.theme. usedByRunner is what the runner's summary said it wrote. */
export type ThemeRecord = {
  used: boolean;
  /** Where the tokens came from. Null when none were used. */
  source: "tile" | "computed" | null;
  /** Why no tokens were used, in a few words. Null when they were. */
  why: string | null;
  /** Why the saved tile was not used, when the tokens were computed (or computing them failed). */
  tileWhy?: string;
  file: string | null;
  /** The tile's fingerprint for this design brief and brief. */
  fingerprint: string | null;
  /** When the tile was drawn (source tile only). */
  renderedAt: string | null;
  usedByRunner?: boolean;
};

const none = (why: string, extra: Partial<ThemeRecord> = {}): ThemeRecord => ({ used: false, source: null, why, file: null, fingerprint: null, renderedAt: null, ...extra });
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

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
  if (opts.env.WORKER_THEME_TOKENS === "off") return none("switched off (WORKER_THEME_TOKENS=off)");
  const d = opts.designBrief;
  if (!d || d.skipped !== null || !d.passedToRunner || !d.json) return none("no design brief went to the runner");
  const json = d.json;

  let fingerprint: string | null = null;
  let tileWhy: string;
  try {
    fingerprint = tileFingerprint(json, opts.brief);
    // 1. The saved tile, when it was drawn from this same design brief and brief.
    const tile = (await readDesignBrief(opts.db, opts.projectId))?.tile;
    if (!tile) tileWhy = "no Visual design tile for this design brief";
    else if (tile.error || !tile.tokens) tileWhy = `the tile has no tokens (${tile.error ?? "none saved"})`;
    else if (tile.fingerprint !== fingerprint) tileWhy = "the tile was drawn from another design brief or brief (fingerprint mismatch)";
    else {
      const problem = themeTokensProblem(tile.tokens);
      if (problem) tileWhy = `the saved tokens have the wrong shape (${problem})`;
      else {
        await writeFile(opts.file, JSON.stringify(tile.tokens, null, 2));
        return { used: true, source: "tile", why: null, file: opts.file, fingerprint, renderedAt: tile.renderedAt };
      }
    }
  } catch (e) {
    // A tile that cannot be read or written is not a reason to go without tokens: they are worked out below instead.
    tileWhy = `error: ${msg(e)}`;
    log(`worker: the saved Visual design tile could not be used, working out the tokens instead: ${msg(e)}`);
  }

  // 2. No tile to use: the same tokens, worked out now from the design brief and the brief.
  try {
    const tokens = designTokens(json, opts.brief);
    const problem = themeTokensProblem(tokens);
    if (problem) return none(`the computed tokens have the wrong shape (${problem})`, { tileWhy, fingerprint });
    await writeFile(opts.file, JSON.stringify(tokens, null, 2));
    return { used: true, source: "computed", why: null, tileWhy, file: opts.file, fingerprint, renderedAt: null };
  } catch (e) {
    log(`worker: theme tokens not used, the build goes on without them: ${msg(e)}`);
    return none(`error: ${msg(e)}`, { tileWhy, fingerprint });
  }
}
