/**
 * Masking for anything kept from a build or an interview: build records (worker/build-record.ts) and the design brief
 * (APP-42, APP-49) read the chat through interviewForRecord, so the web app and the worker see exactly the same text.
 */

export const MAX_SECTION = 20_000;
/** Keys never kept from deploy.json or from the chat. */
export const SECRET_KEY = /password|secret|token|key/i;

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
