// Runs the design brief step (APP-42 step 1) on a saved build record, without starting a build.
// Reads the record's interview and brief, calls the model once (twice if the first brief fails its checks), and writes
// design-brief.json, design-brief.md and result.json to the out folder. The database session is read-only; nothing is saved.
//
//   npx tsx --env-file=.env scripts/design-brief-try.mts --name SureBetz --out <folder>
//   npx tsx --env-file=.env scripts/design-brief-try.mts --record <build_records id> --out <folder>
//   npx tsx --env-file=.env scripts/design-brief-try.mts --file record-details.json --out <folder>
// --name and --record read DATABASE_URL (the database that holds the record). Only records with details.interview count
// (the interview is saved from PR 4 onward). When --name finds none, the script uses the latest record that has an
// interview and says which one. --file takes a saved copy of the record's details (with interview and brief).
// ANTHROPIC_API_KEY is needed; ANTHROPIC_DESIGN_BRIEF_MODEL picks the model (default Opus).
// Never prints DATABASE_URL, keys or database error text: a database problem is reported by its error code only.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { anthropicToolCall, designBriefModel, writeDesignBrief } from "../src/lib/agents/design-brief-writer";
import type { InterviewMessage } from "../src/lib/builder/design-brief";
import { redact } from "../worker/build-record";

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};

/** A message safe to print: no connection details, no keys. */
class Plain extends Error {}

type Source = { id: string; at: string; site: string | null; interview: { messages?: InterviewMessage[] } | null; brief: Record<string, unknown>; note?: string };

const HAS_INTERVIEW = `details->'interview' IS NOT NULL AND details->'interview' <> 'null'::jsonb`;
// Only these columns are read: the record's id, date and site name (to say which record was used), its interview and its brief.
const COLUMNS = `id, created_at, details->'site'->>'name' AS site, details->'interview' AS interview, details->'brief' AS brief`;

async function fromDb(by: { record?: string; name?: string }): Promise<Source> {
  if (!process.env.DATABASE_URL) throw new Plain("Set DATABASE_URL to the database that holds the build record.");
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  // pg errors can name the host or the user, so only the code is shown.
  const dbError = (e: unknown) => new Plain(`Could not read the build record from the database (error code ${(e as { code?: string })?.code ?? "unknown"}).`);
  c.on("error", () => {});
  try {
    await c.connect();
  } catch (e) {
    throw dbError(e);
  }
  try {
    await c.query("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
    await c.query("SET default_transaction_read_only = on");
    const pick = async (where: string, params: unknown[]) =>
      (await c.query(`SELECT ${COLUMNS} FROM build_records WHERE ${where} ORDER BY created_at DESC LIMIT 1`, params)).rows[0];
    let row = by.record ? await pick(`id = $1::uuid AND ${HAS_INTERVIEW}`, [by.record]) : await pick(`lower(details->'site'->>'name') = lower($1) AND ${HAS_INTERVIEW}`, [by.name]);
    let note: string | undefined;
    if (!row && by.name) {
      row = await pick(HAS_INTERVIEW, []);
      if (row) note = `No ${by.name} build record has a saved interview, so this is the latest build record that has one.`;
    }
    if (!row) throw new Plain(by.record ? "That build record does not exist or has no saved interview." : "No build record has a saved interview yet.");
    return { id: String(row.id), at: new Date(row.created_at).toISOString(), site: row.site ?? null, interview: row.interview, brief: row.brief, note };
  } catch (e) {
    throw e instanceof Plain ? e : dbError(e);
  } finally {
    await c.end().catch(() => {});
  }
}

async function main() {
  const out = path.resolve(arg("out") ?? "design-brief-try");
  let source: Source;
  if (arg("file")) {
    const d = JSON.parse(await readFile(arg("file")!, "utf8"));
    const details = d.details ?? d;
    source = { id: arg("file")!, at: "", site: details.site?.name ?? null, interview: details.interview, brief: details.brief };
  } else if (arg("record")) source = await fromDb({ record: arg("record")! });
  else if (arg("name")) source = await fromDb({ name: arg("name")! });
  else throw new Plain("Give --name, --record or --file.");

  const messages = source.interview?.messages ?? [];
  if (!messages.length || !source.brief) throw new Plain("The record has no interview or no brief.");
  if (!process.env.ANTHROPIC_API_KEY) throw new Plain("Set ANTHROPIC_API_KEY.");
  const model = designBriefModel();
  if (source.note) console.log(source.note);
  console.log(`Using build record ${source.id}${source.site ? `, site ${source.site}` : ""}${source.at ? `, saved ${source.at}` : ""}: ${messages.length} messages.`);
  console.log(`Model ${model}. Writing the design brief…`);
  const r = await writeDesignBrief({ messages, brief: source.brief, call: anthropicToolCall({ apiKey: process.env.ANTHROPIC_API_KEY }), model });

  await mkdir(out, { recursive: true });
  if (r.json) await writeFile(path.join(out, "design-brief.json"), JSON.stringify(r.json, null, 2));
  if (r.markdown) await writeFile(path.join(out, "design-brief.md"), r.markdown);
  const { json: _j, markdown: _m, ...rest } = r;
  await writeFile(path.join(out, "result.json"), JSON.stringify({ record: source.id, site: source.site, savedAt: source.at, note: source.note ?? null, ...rest }, null, 2));

  console.log(`\nPassed every check: ${r.passed ? "yes" : "no"} (attempts: ${r.attempts})`);
  if (r.quoteCheck) console.log(`Quotes: ${r.quoteCheck.passed} of ${r.quoteCheck.checked} found word for word${r.quoteCheck.msgCorrected ? `, ${r.quoteCheck.msgCorrected} with a corrected message number` : ""}`);
  for (const f of r.quoteCheck?.failed ?? []) console.log(`  FAILED ${f.path}: "${f.quote}" (message ${f.msg}): ${f.why}`);
  for (const p of r.problems) console.log(`  PROBLEM ${p}`);
  if (r.firstAttempt) console.log(`First attempt failed on: ${[...(r.firstAttempt.quoteCheck?.failed ?? []).map((f) => `${f.path} "${f.quote}" (${f.why})`), ...r.firstAttempt.problems].join("; ")}`);
  if (r.error) console.log(`Error: ${redact(r.error)}`);
  console.log(`Cost: $${r.costUsd.toFixed(4)} (estimate; tokens in ${r.tokens.input}, out ${r.tokens.output}, cache read ${r.tokens.cacheRead}, cache write ${r.tokens.cacheWrite}). Time ${Math.round(r.durationMs / 1000)} s.`);
  console.log(`Files in ${out}`);
}

main().catch((e) => {
  // Never a stack trace or raw error text that could carry a connection string or key.
  console.error(e instanceof Plain ? e.message : `Stopped: ${redact(e instanceof Error ? e.message : String(e)).slice(0, 300)}`);
  process.exit(1);
});
