// Replays one website interview turn from a project's saved chat against the real model, to see why a turn failed.
// Reads the project read-only (the session is read-only; nothing is saved), rebuilds the chat as it was before the
// failed turn (the owner's message and the "Sorry, something went wrong" answers after it are taken off), and runs that
// turn once through the same interviewer as production: up to three model calls, as in production. Prints, for each call,
// what the model returned (block types, its reply fields, whether it saved a brief) and the brief's validation errors.
//
//   npx tsx --env-file=.env scripts/turn-replay.mts --project <projects id>
//   npx tsx --env-file=.env scripts/turn-replay.mts --project <projects id> --text "yes"   (send these words instead)
//
// DATABASE_URL must be the database that holds the project. ANTHROPIC_API_KEY is needed; ANTHROPIC_MODEL picks the
// model, as in production (default claude-sonnet-5-5). Never prints DATABASE_URL, keys or database error text.
import pg from "pg";
import { anthropicChat } from "../src/lib/agents/anthropic";
import { makeSiteInterviewer, type Chat } from "../src/lib/agents/site-interviewer";
import { normalizePack, validateSiteBrief } from "../src/lib/builder/site-brief";
import type { Msg, WorkspaceState } from "../src/lib/workspace/types";
import { redact } from "../worker/build-record";

const FALLBACK = "Sorry, something went wrong on my side. Please send that again.";
const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
/** A message safe to print: no connection details, no keys. */
class Plain extends Error {}
const cut = (t: unknown, n = 300) => {
  const s = redact(typeof t === "string" ? t : JSON.stringify(t ?? null));
  return s.length > n ? `${s.slice(0, n)}…` : s;
};

async function readProject(id: string): Promise<{ kind: string; state: WorkspaceState }> {
  if (!process.env.DATABASE_URL) throw new Plain("Set DATABASE_URL to the database that holds the project.");
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  const dbError = (e: unknown) => new Plain(`Could not read the project (database error code ${(e as { code?: string })?.code ?? "unknown"}).`);
  c.on("error", () => {});
  try {
    await c.connect();
  } catch (e) {
    throw dbError(e);
  }
  try {
    await c.query("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
    await c.query("SET default_transaction_read_only = on");
    // Only the project's kind and saved state are read.
    const { rows } = await c.query("SELECT kind, state FROM projects WHERE id = $1::uuid", [id]);
    if (!rows[0]) throw new Plain("That project does not exist.");
    return { kind: String(rows[0].kind), state: rows[0].state as WorkspaceState };
  } catch (e) {
    throw e instanceof Plain ? e : dbError(e);
  } finally {
    await c.end().catch(() => {});
  }
}

async function main() {
  const id = arg("project");
  if (!id) throw new Plain("Give --project <projects id>.");
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Plain("Set ANTHROPIC_API_KEY.");
  const { kind, state } = await readProject(id);
  if (kind !== "site") throw new Plain(`This project is a ${kind} project, not a website project.`);

  // Take off the failed turns at the end: the owner's message and the fallback answer, as many times as it happened.
  const msgs: Msg[] = [...state.msgs];
  let failed = 0;
  let sent: string | undefined;
  while (msgs.length >= 2 && msgs.at(-1)?.kind === "bot" && (msgs.at(-1) as { text: string }).text === FALLBACK && msgs.at(-2)?.kind === "user") {
    sent = (msgs.at(-2) as { text: string }).text;
    msgs.splice(-2, 2);
    failed++;
  }
  const text = arg("text") ?? sent;
  if (!text) throw new Plain("The chat does not end with a failed turn. Give --text with the words to send.");
  const before: WorkspaceState = { ...state, msgs };
  const pack = normalizePack(before.sitePack);
  const lastBot = [...msgs].reverse().find((m) => m.kind === "bot") as { text: string } | undefined;
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

  console.log(`Project ${id}: pack ${pack}, phase ${before.phase}, ${msgs.length} messages before the turn, brief saved: ${before.site?.brief ? "yes" : "no"}.`);
  console.log(`Failed turns taken off the end: ${failed}. Replaying the owner's message: ${JSON.stringify(cut(text, 200))}`);
  console.log(`Scout's last message before it: ${JSON.stringify(cut(lastBot?.text, 400))}`);
  console.log(`Model ${model}. Up to three calls, as in production.\n`);

  const base = anthropicChat({ apiKey: key, model });
  let n = 0;
  const chat: Chat = async (req) => {
    const r = await base(req);
    n++;
    const blocks = (r.content as { type: string; name?: string }[]).map((b) => (b.type === "tool_use" ? `tool_use:${b.name}` : b.type));
    console.log(`=== Call ${n}: blocks [${blocks.join(", ")}], tokens in/out ${r.usage.inputTokens}/${r.usage.outputTokens}`);
    if (r.text) console.log(`  plain text: ${JSON.stringify(cut(r.text, 500))}`);
    for (const t of r.toolUses) {
      if (t.name === "reply") {
        const i = (t.input ?? {}) as { understood?: unknown; question?: unknown; parts?: unknown };
        console.log(`  reply.understood: ${JSON.stringify(cut(i.understood ?? null))}`);
        console.log(`  reply.question:   ${JSON.stringify(cut(i.question ?? null))}`);
        console.log(`  reply.parts:      ${cut(i.parts ?? null)}`);
        const other = Object.keys(i).filter((k) => !["understood", "question", "parts"].includes(k));
        if (other.length) console.log(`  reply other fields: ${other.join(", ")}`);
      } else if (t.name === "save_brief") {
        const brief = (t.input as { brief?: unknown } | undefined)?.brief;
        const v = validateSiteBrief(brief, pack);
        const keys = brief && typeof brief === "object" ? Object.keys(brief).join(", ") : typeof brief;
        console.log(`  save_brief: brief with keys [${keys}]`);
        console.log(v.ok ? "  validation: passed" : `  validation: FAILED\n${v.error.split("\n").slice(1).map((l) => `    ${cut(l, 200)}`).join("\n")}`);
      } else console.log(`  tool ${t.name}: ${cut(t.input)}`);
    }
    return r;
  };

  const r = await makeSiteInterviewer(chat, model).turn(before, text);
  const last = r.state.msgs.at(-1) as { kind: string; text?: string };
  console.log(`\nResult after ${n} call(s): phase ${r.state.phase}, brief saved: ${r.state.site?.brief ? "yes" : "no"}.`);
  console.log(`Last message shown: ${JSON.stringify(cut(last.text, 400))}`);
  console.log("Nothing was written to the database.");
}

main().catch((e) => {
  console.error(e instanceof Plain ? e.message : `Failed: ${cut(e instanceof Error ? e.message : e, 300)}`);
  process.exit(1);
});
