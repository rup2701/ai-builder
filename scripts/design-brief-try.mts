// Runs the design brief step (APP-42 step 1) on a saved build record, without starting a build.
// Reads the record's interview and brief, calls the model once (twice if the first brief fails its checks), and writes
// design-brief.json, design-brief.md and result.json to the out folder. The database session is read-only; nothing is saved.
//
//   npx tsx --env-file=.env scripts/design-brief-try.mts --name SureBetz --out <folder>
//   npx tsx --env-file=.env scripts/design-brief-try.mts --record <build_records id> --out <folder>
//   npx tsx --env-file=.env scripts/design-brief-try.mts --file record-details.json --out <folder>
// --name and --record read DATABASE_URL (the database that holds the record). --file takes a saved copy of the record's
// details (with interview and brief). ANTHROPIC_API_KEY is needed; ANTHROPIC_DESIGN_BRIEF_MODEL picks the model (default Opus).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { anthropicToolCall, designBriefModel, writeDesignBrief } from "../src/lib/agents/design-brief-writer";
import type { InterviewMessage } from "../src/lib/builder/design-brief";

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};

async function fromDb(where: string, value: string) {
  if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL to the database that holds the build record.");
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    await c.query("SET default_transaction_read_only = on");
    const { rows } = await c.query(
      `SELECT id, created_at, details->'interview' AS interview, details->'brief' AS brief FROM build_records
        WHERE ${where} AND details->'interview' IS NOT NULL AND details->'interview' <> 'null'::jsonb
        ORDER BY created_at DESC LIMIT 1`,
      [value],
    );
    if (!rows[0]) throw new Error("No build record with an interview matches.");
    return { id: String(rows[0].id), at: String(rows[0].created_at), interview: rows[0].interview, brief: rows[0].brief };
  } finally {
    await c.end();
  }
}

const out = path.resolve(arg("out") ?? "design-brief-try");
let source: { id: string; at: string; interview: { messages?: InterviewMessage[] } | null; brief: Record<string, unknown> };
if (arg("file")) {
  const d = JSON.parse(await readFile(arg("file")!, "utf8"));
  const details = d.details ?? d;
  source = { id: arg("file")!, at: "", interview: details.interview, brief: details.brief };
} else if (arg("record")) source = await fromDb("id = $1::uuid", arg("record")!);
else if (arg("name")) source = await fromDb("lower(details->'site'->>'name') = lower($1)", arg("name")!);
else throw new Error("Give --name, --record or --file.");

const messages = source.interview?.messages ?? [];
if (!messages.length || !source.brief) throw new Error("The record has no interview or no brief.");
if (!process.env.ANTHROPIC_API_KEY) throw new Error("Set ANTHROPIC_API_KEY.");
const model = designBriefModel();
console.log(`Record ${source.id}${source.at ? ` (${source.at})` : ""}: ${messages.length} messages. Model ${model}. Writing the design brief…`);
const r = await writeDesignBrief({ messages, brief: source.brief, call: anthropicToolCall({ apiKey: process.env.ANTHROPIC_API_KEY }), model });

await mkdir(out, { recursive: true });
if (r.json) await writeFile(path.join(out, "design-brief.json"), JSON.stringify(r.json, null, 2));
if (r.markdown) await writeFile(path.join(out, "design-brief.md"), r.markdown);
const { json: _j, markdown: _m, ...rest } = r;
await writeFile(path.join(out, "result.json"), JSON.stringify({ record: source.id, ...rest }, null, 2));

console.log(`\nPassed every check: ${r.passed ? "yes" : "no"} (attempts: ${r.attempts})`);
if (r.quoteCheck) console.log(`Quotes: ${r.quoteCheck.passed} of ${r.quoteCheck.checked} found word for word${r.quoteCheck.msgCorrected ? `, ${r.quoteCheck.msgCorrected} with a corrected message number` : ""}`);
for (const f of r.quoteCheck?.failed ?? []) console.log(`  FAILED ${f.path}: "${f.quote}" (message ${f.msg}): ${f.why}`);
for (const p of r.problems) console.log(`  PROBLEM ${p}`);
if (r.firstAttempt) console.log(`First attempt failed on: ${[...(r.firstAttempt.quoteCheck?.failed ?? []).map((f) => `${f.path} "${f.quote}"`), ...r.firstAttempt.problems].join("; ")}`);
if (r.error) console.log(`Error: ${r.error}`);
console.log(`Cost: $${r.costUsd.toFixed(4)} (estimate; tokens in ${r.tokens.input}, out ${r.tokens.output}, cache read ${r.tokens.cacheRead}, cache write ${r.tokens.cacheWrite}). Time ${Math.round(r.durationMs / 1000)} s.`);
console.log(`Files in ${out}`);
