// Sends one test email through Resend, to check the key and the sender before turning notifications on.
// Run it with the key in your environment, never in a file that is committed:
//   RESEND_API_KEY=... EMAIL_FROM="Appnomics <hello@your-verified-domain>" npx tsx scripts/send-test-email.mts you@example.com [started|done|failed]
// It prints only whether the send worked and Resend's answer. It never prints the key.
import { buildEmail, sendEmail, type BuildMail } from "../src/lib/notify";

const to = process.argv[2];
const kind = (process.argv[3] ?? "done") as "started" | "done" | "failed";
if (!to || !/^\S+@\S+\.\S+$/.test(to)) {
  console.error("Usage: npx tsx scripts/send-test-email.mts you@example.com [started|done|failed]");
  process.exit(1);
}
const projectUrl = "https://builder.appnomics.dev";
const mails: Record<string, BuildMail> = {
  started: { kind: "started", siteName: "Test site", projectUrl, by: "someone@example.com" },
  done: { kind: "done", siteName: "Test site", projectUrl, siteUrl: "https://example.appnomics.live", showcase: true },
  failed: { kind: "failed", siteName: "Test site", projectUrl, stageLabel: "Putting it online", retryPublish: true },
};
if (!mails[kind]) { console.error("Kind must be started, done or failed."); process.exit(1); }
const from = process.env.EMAIL_FROM || "Appnomics <onboarding@resend.dev>";
console.log(`Sending a "${kind}" test email to ${to} from ${from} ...`);
const r = await sendEmail(process.env, to, buildEmail(mails[kind]));
console.log(r.ok ? "Sent. Check the inbox (and the spam folder)." : `Not sent: ${r.error}`);
process.exit(r.ok ? 0 : 1);
