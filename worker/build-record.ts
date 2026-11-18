/**
 * Learning data (APP-15): after each full site build the worker saves one row in build_records, quietly. The owner sees
 * nothing change. Saving is best effort with a time limit: a record that cannot be saved is logged and skipped, and it
 * never fails or holds up the build (the owner's site and chat are already updated when this runs).
 *
 * details holds as much as is cheap to keep, so later learning steps can decide what to use:
 *   brief, draftBrief, draftBriefAt   the brief the owner approved, and Scout's first draft of it (the owner's edits are the difference)
 *   packInfo                          pack id, specs folder, a hash of that folder, the runner's git commit (null on Fly, which has no .git)
 *   run                               the runner's run.json (turns, minutes, tokens, estimated cost, checks), or the printed summary
 *   agentLog                          every "## " section of AGENT_LOG.md, by heading (for example "Unclear, missing or misleading in the specs",
 *                                     "Mistakes made and fixed", "Not verified", "Look pass")
 *   lookPass                          when it started, the files it changed with line counts, its commits, and why (its log section)
 *   transcript                        counts only: lines, model calls, tool calls by tool (the build agent's own log, not the interview)
 *   interview                         the project chat as it was when the build started (APP-42): every message in order, secrets
 *                                     masked, owner passwords dropped. The build agent never sees it; it is kept for learning only.
 *   designBrief                       showcase builds (APP-42): the design brief JSON, its markdown (specs/design-brief.md), the quote
 *                                     check, other problems, attempts, model, tokens and cost, and whether it went to the runner.
 *                                     A brief that failed its checks is kept here too, with what failed. Null for other packs.
 *   deploy                            the runner's deploy.json without anything that looks like a secret
 *   site, timing, failure             the address, private test or not, the dates, and where a failed build stopped
 *   ownerId, projectCreatedAt         raw facts for working out later whether the site was kept or rebuilt
 *   events                            appended later: archived, restored (src/lib/build-records.ts)
 * Kept or rebuilt is worked out when reading: another record for the same project or the same address, or an archived event.
 */
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { siteAddress } from "../src/lib/project-archive";

const exec = promisify(execFile);

export type Db = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> };

export type BuildRecordInput = {
  projectId: string;
  jobId: string;
  pack: { id: string; specs: string };
  brief: Record<string, unknown>;
  draftBrief?: Record<string, unknown>;
  draftBriefAt?: string;
  /** The project chat (projects.state.msgs) when the build started. */
  interview?: unknown;
  runner: string;
  runDir?: string;
  /** The JSON summary the runner printed, used when run.json cannot be read. */
  summary?: unknown;
  startedAt: string;
  finishedAt: string;
  outcome: "live" | "private_test" | "failed";
  failedStage?: number;
  error?: string;
  url?: string | null;
  siteName: string;
  privateTest: boolean;
  heroShot?: boolean;
  /** The design brief step's result (worker/design-brief.ts), when the pack has one. */
  designBrief?: unknown;
  env: NodeJS.ProcessEnv;
};

const MAX_SECTION = 20_000;
/** Keys never kept from deploy.json or from the chat. */
const SECRET_KEY = /password|secret|token|key/i;

/** Never keep keys or passwords, even if the agent wrote one into its log: database addresses, API keys and NAME=value secrets are masked. */
export function redact(text: string): string {
  return text
    .replace(/\b(postgres(?:ql)?:\/\/)[^\s'"`)]+/gi, "$1***")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "***")
    .replace(/\b([A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN|API_KEY|PRIVATE_KEY)[A-Z0-9_]*)\s*=\s*\S+/g, "$1=***");
}

/**
 * The project chat as it goes into the record: every message in order, each text masked like the agent log and capped.
 * Any field named like a password or secret is dropped (a "site ready" message keeps the owner password until the owner
 * says they saved it). Anything that is not a list of messages gives null, so a missing interview never breaks a record.
 */
export function interviewForRecord(msgs: unknown): { messageCount: number; messages: Record<string, unknown>[] } | null {
  if (!Array.isArray(msgs) || msgs.length === 0) return null;
  const clean = (v: unknown, depth: number): unknown => {
    if (typeof v === "string") return redact(v).slice(0, MAX_SECTION);
    if (Array.isArray(v)) return depth > 4 ? [] : v.map((x) => clean(x, depth + 1));
    if (v && typeof v === "object") {
      if (depth > 4) return {};
      return Object.fromEntries(Object.entries(v).filter(([k]) => !SECRET_KEY.test(k)).map(([k, x]) => [k, clean(x, depth + 1)]));
    }
    return v;
  };
  const messages = msgs.filter((m): m is Record<string, unknown> => !!m && typeof m === "object" && !Array.isArray(m)).map((m) => clean(m, 0) as Record<string, unknown>);
  return messages.length ? { messageCount: messages.length, messages } : null;
}

/** The "## " sections of AGENT_LOG.md, by heading, each with its "### " subsections. A repeated heading gets " (2)", " (3)". */
export function logSections(md: string): Record<string, string> {
  const out: Record<string, string> = {};
  const parts = md.split(/^## +(.+)$/m);
  for (let i = 1; i < parts.length; i += 2) {
    const base = parts[i].trim();
    let key = base;
    for (let n = 2; key in out; n++) key = `${base} (${n})`;
    out[key] = redact(parts[i + 1].trim()).slice(0, MAX_SECTION);
  }
  return out;
}

/**
 * Counts from transcript.jsonl, and when the look pass started. The runner numbers turns from 1 for each agent session,
 * so the first line whose turn is lower than the one before is the first turn of the look pass.
 */
export function transcriptFacts(text: string): { lines: number; modelCalls: number; toolCalls: Record<string, number>; lookPassStartedAt: string | null } {
  let lines = 0, modelCalls = 0, prev = 0;
  let lookPassStartedAt: string | null = null;
  const toolCalls: Record<string, number> = {};
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    lines++;
    let d: { t?: string; turn?: number; tool?: string; model_call?: unknown };
    try { d = JSON.parse(line); } catch { continue; }
    if (d.model_call) modelCalls++;
    if (typeof d.tool === "string") toolCalls[d.tool] = (toolCalls[d.tool] ?? 0) + 1;
    if (typeof d.turn === "number") {
      if (d.turn < prev && !lookPassStartedAt) lookPassStartedAt = d.t ?? null;
      prev = d.turn;
    }
  }
  return { lines, modelCalls, toolCalls, lookPassStartedAt };
}

/** A short hash of every file in the pack's specs folder, so two builds can be told apart by the pack they used. */
export async function specsHash(dir: string): Promise<string | null> {
  try {
    const files: string[] = [];
    const walk = async (d: string) => {
      for (const e of await readdir(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) await walk(p);
        else if (e.isFile()) files.push(p);
      }
    };
    await walk(dir);
    if (!files.length) return null;
    const h = createHash("sha256");
    for (const f of files.sort()) h.update(path.relative(dir, f)).update("\0").update(await readFile(f)).update("\0");
    return h.digest("hex").slice(0, 16);
  } catch {
    return null;
  }
}

const git = async (cwd: string, args: string[]) => {
  try { return (await exec("git", args, { cwd, timeout: 10_000, maxBuffer: 5_000_000 })).stdout.trim(); } catch { return ""; }
};

/** "12\t3\tsrc/app/page.tsx" lines from git diff --numstat. Binary files show "-". */
export function parseNumstat(out: string): { path: string; added: number | null; removed: number | null }[] {
  return out.split("\n").filter(Boolean).map((l) => {
    const [a, r, ...p] = l.split("\t");
    return { path: p.join("\t"), added: a === "-" ? null : Number(a), removed: r === "-" ? null : Number(r) };
  });
}

/** What the look pass changed: the commits made after it started, and the files they touched with line counts. */
export async function lookPassChanges(appDir: string, startedAt: string) {
  const base = await git(appDir, ["rev-list", "-1", `--before=${startedAt}`, "HEAD"]);
  if (!base) return { base: null, files: [], commits: [] };
  const files = parseNumstat(await git(appDir, ["diff", "--numstat", base, "HEAD"]));
  const commits = (await git(appDir, ["log", "--format=%h%x09%cI%x09%s", `${base}..HEAD`])).split("\n").filter(Boolean).map((l) => {
    const [hash, at, ...s] = l.split("\t");
    return { hash, at, subject: s.join("\t") };
  });
  return { base: base.slice(0, 12), files, commits };
}

const readJson = async (file: string): Promise<Record<string, unknown> | null> => {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return null; }
};

/** Everything that goes into one record. Never throws: a part that cannot be read is simply left out (null). */
export async function gatherBuildRecord(r: BuildRecordInput): Promise<{ pack: string; outcome: string; details: Record<string, unknown> }> {
  const appDir = r.runDir ? path.join(r.runDir, "app") : null;
  const agentLogText = appDir ? await readFile(path.join(appDir, "AGENT_LOG.md"), "utf8").catch(() => null) : null;
  const sections = agentLogText ? logSections(agentLogText) : null;
  const transcriptText = r.runDir ? await readFile(path.join(r.runDir, "transcript.jsonl"), "utf8").catch(() => null) : null;
  const tf = transcriptText ? transcriptFacts(transcriptText) : null;
  const look = appDir && tf?.lookPassStartedAt ? await lookPassChanges(appDir, tf.lookPassStartedAt) : null;
  const deployRaw = r.runDir ? await readJson(path.join(r.runDir, "deploy.json")) : null;
  const deploy = deployRaw ? Object.fromEntries(Object.entries(deployRaw).filter(([k]) => !SECRET_KEY.test(k))) : null;
  const run = r.runDir ? ((await readJson(path.join(r.runDir, "run.json"))) ?? r.summary ?? null) : (r.summary ?? null);
  return {
    pack: r.pack.id,
    outcome: r.outcome,
    details: {
      brief: r.brief,
      draftBrief: r.draftBrief ?? null,
      draftBriefAt: r.draftBriefAt ?? null,
      briefSchemaVersion: (r.brief.schema_version as string | undefined) ?? null,
      packInfo: {
        id: r.pack.id,
        specs: r.pack.specs,
        specsHash: await specsHash(path.join(r.runner, r.pack.specs)),
        runnerCommit: (await git(r.runner, ["rev-parse", "HEAD"])) || null,
        builderImage: r.env.FLY_IMAGE_REF ?? null,
      },
      run,
      agentLog: sections,
      lookPass: tf?.lookPassStartedAt ? { startedAt: tf.lookPassStartedAt, ...look, why: sections?.["Look pass"] ?? null } : null,
      transcript: tf ? { lines: tf.lines, modelCalls: tf.modelCalls, toolCalls: tf.toolCalls } : null,
      interview: interviewForRecord(r.interview),
      designBrief: r.designBrief ?? null,
      deploy,
      site: { name: r.siteName, url: r.url ?? null, address: siteAddress(r.url ?? undefined), privateTest: r.privateTest, heroShot: r.heroShot ?? false },
      timing: { startedAt: r.startedAt, finishedAt: r.finishedAt },
      failure: r.outcome === "failed" ? { stage: r.failedStage ?? null, error: r.error ? redact(r.error).slice(0, 2000) : null } : null,
      runDir: r.runDir ?? null,
      events: [],
    },
  };
}

/** Gather and save one record. Gives up after WORKER_RECORD_MS (default 20 s). Never throws. */
export async function saveBuildRecord(db: Db, r: BuildRecordInput): Promise<boolean> {
  const limit = Number(r.env.WORKER_RECORD_MS ?? 20_000);
  let timer: NodeJS.Timeout | undefined;
  const work = (async () => {
    const rec = await gatherBuildRecord(r);
    await db.query(
      `INSERT INTO build_records (project_id, job_id, pack, outcome, details)
       VALUES ($1, $2, $3, $4, $5::jsonb || COALESCE((SELECT jsonb_build_object('ownerId', owner_id, 'projectCreatedAt', created_at) FROM projects WHERE id = $1), '{}'::jsonb))`,
      [r.projectId, r.jobId, rec.pack, rec.outcome, JSON.stringify(rec.details)],
    );
    return true;
  })();
  try {
    return await Promise.race([work, new Promise<boolean>((_, no) => { timer = setTimeout(() => no(new Error(`took longer than ${limit} ms`)), limit); })]);
  } catch (e) {
    console.warn(`[build-record] ${r.jobId.slice(0, 8)} not saved: ${e instanceof Error ? e.message : e}`);
    work.catch(() => {});
    return false;
  } finally {
    clearTimeout(timer);
  }
}
