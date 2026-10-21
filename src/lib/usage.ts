import "server-only";
import { db, schema } from "@/db";

/** Record tokens and cost for one step. Rule-based steps log zero tokens so the path is exercised. */
export async function logUsage(o: {
  projectId: string;
  jobId?: string | null;
  step: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}) {
  await db.insert(schema.usage).values({
    projectId: o.projectId,
    jobId: o.jobId ?? null,
    step: o.step,
    model: o.model,
    inputTokens: o.inputTokens ?? 0,
    outputTokens: o.outputTokens ?? 0,
    costUsd: String(o.costUsd ?? 0),
  });
}
