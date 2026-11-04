/**
 * The email a person gets when their site build ends. Sent from the worker through Resend's HTTP API.
 * Best effort: a failed email never fails a build. The password is never put in an email; the message
 * links to the project, where the ready card shows it.
 */

export type BuildMail =
  | { kind: "done"; siteName: string; projectUrl: string; siteUrl: string }
  | { kind: "failed"; siteName: string; projectUrl: string; stageLabel: string; retryPublish: boolean };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function buildEmail(m: BuildMail): { subject: string; text: string; html: string } {
  const name = m.siteName || "Your site";
  let subject: string;
  let lines: string[];
  let cta: string;
  if (m.kind === "done") {
    subject = `${name} is live`;
    lines = [`${name} is live at ${m.siteUrl}.`, "Your owner sign-in and the checklist to read before you share it are waiting in your project."];
    cta = "Open your project";
  } else {
    subject = `${name}: the build stopped`;
    lines = [
      `The build of ${name} stopped at "${m.stageLabel}". Nothing was lost.`,
      m.retryPublish ? "The site itself is built, so you can press Retry publishing to try only the last step." : "Open your project and press Try again.",
    ];
    cta = "Open your project";
  }
  const text = `${lines.join("\n\n")}\n\n${cta}: ${m.projectUrl}\n`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1a1a1a"><h1 style="font-size:22px;margin:0 0 16px">${esc(subject)}</h1>${lines.map((l) => `<p style="line-height:1.5;margin:0 0 12px">${esc(l)}</p>`).join("")}<p style="margin:20px 0"><a href="${esc(m.projectUrl)}" style="background:#1a1a1a;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none">${cta}</a></p></div>`;
  return { subject, text, html };
}

type Env = Record<string, string | undefined>;

/** Sends one email through Resend. Returns ok:false with a reason instead of throwing. */
export async function sendEmail(
  env: Env,
  to: string,
  msg: { subject: string; text: string; html: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; error?: string }> {
  const key = env.RESEND_API_KEY;
  if (!key) return { ok: false, error: "RESEND_API_KEY is not set." };
  try {
    const r = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from: env.EMAIL_FROM || "Appnomics <onboarding@resend.dev>", to: [to], ...msg }),
    });
    if (!r.ok) return { ok: false, error: `Resend answered ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Where the person opens the project from an email link. */
export const projectLink = (env: Env, projectId: string) => `${(env.APP_URL || "https://builder.appnomics.dev").replace(/\/$/, "")}/projects/${projectId}`;

/** Builds and sends the end-of-build email, and logs (never throws) the outcome. */
export async function notifyBuildEnd(env: Env, to: string | undefined, m: BuildMail, fetchImpl?: typeof fetch) {
  if (!to) return;
  const r = await sendEmail(env, to, buildEmail(m), fetchImpl);
  console.log(r.ok ? `worker: emailed ${m.kind} notice` : `worker: email not sent (${r.error})`);
}
