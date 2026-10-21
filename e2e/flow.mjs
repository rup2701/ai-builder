// End to end: sign-in with the idea preserved, intake on the server, build on the worker,
// persistence, ownership, and the publish request. Needs: next dev on :3100, `npm run worker`, Postgres.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";

const BASE = process.env.BASE ?? "http://localhost:3100";
const DB = process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/appnomics_builder";
const check = (n, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); if (!ok) process.exitCode = 1; };
const sql = (q) => execFileSync("psql", [DB, "-At", "-c", q], { encoding: "utf8" }).trim();
const IDEA = "I want to build an online clothing boutique in Los Gatos";
const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });

const login = async (p, email, idea) => {
  await p.goto(`${BASE}/${idea ? "?idea=" + encodeURIComponent(idea) : "signin"}`);
  await p.locator("#email").fill(email);
  await p.getByRole("button", { name: "Sign in" }).click();
};
const chat = async (p, t) => { await p.locator("#builder-input").fill(t); await p.keyboard.press("Enter"); };
const ready = (p) => p.waitForFunction(() => document.querySelector("[aria-label=Progress] [aria-current=step]")?.textContent?.includes("Iterate"), null, { timeout: 20000 });
sql("delete from projects; delete from users;");

const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(String(e))); p.on("console", (m) => m.type() === "error" && !/Failed to load resource|favicon/.test(m.text()) && errs.push(m.text()));

// 1. Unsigned visitor with an idea lands on sign-in, idea shown as saved
await p.goto(`${BASE}/?idea=${encodeURIComponent(IDEA)}`);
check("unsigned visitor is sent to sign-in", p.url().includes("/signin"));
check("idea is shown as saved on sign-in", (await p.locator("main").innerText()).includes("online clothing boutique"));

// 2. Not on the list
await p.locator("#email").fill("stranger@example.com");
await p.getByRole("button", { name: "Sign in" }).click();
await p.getByTestId("signin-error").waitFor();
check("email not on the allowlist is refused", /isn.t on the list/.test(await p.getByTestId("signin-error").innerText()));
check("the refused visitor has no projects", sql("select count(*) from projects") === "0");

// 3. On the list: idea is carried through authentication into a new project
await p.locator("#email").fill("rp@example.com");
await p.getByRole("button", { name: "Sign in" }).click();
await p.waitForURL(/\/projects\/[0-9a-f-]{36}/);
const projectUrl = p.url();
check("idea survives sign-in and opens a project", true);
check("idea is the first message", (await p.locator("[role=log]").innerText()).includes("online clothing boutique in Los Gatos"));
check("already-answered questions are skipped (asks the name)", (await p.locator("[role=log]").innerText()).includes("What's your store called?"));
check("project row saved with idea and owner", sql("select count(*) from projects p join users u on u.id=p.owner_id where u.email='rp@example.com' and p.idea like '%Los Gatos%'") === "1");

// 4. Intake runs on the server
await chat(p, "Willow & Thread");
await p.getByText("How will customers get their orders?").waitFor();
await chat(p, "maybe");
await p.getByText(/I didn't catch that/).waitFor();
check("unclear answer is re-asked by the server", true);
await p.getByRole("button", { name: "Shipped" }).click();
await p.getByText("What look do you want?").waitFor();
await p.getByRole("button", { name: "Modern" }).click();
await p.getByText("Do you already have your products somewhere?").waitFor();
await p.getByRole("button", { name: "Not yet" }).click();
await p.getByTestId("brief-summary").waitFor();
check("summary appears", /not available yet/i.test(await p.getByTestId("brief-summary").innerText()));
await p.reload();
check("reload keeps the intake (summary still there)", (await p.getByTestId("brief-summary").count()) === 1);
check("nothing is built before Build it", (await p.locator("[data-testid=store-name]").count()) === 0);

// 5. Build on the worker, with the step-away note
await p.getByRole("button", { name: "Build it", exact: true }).last().click();
await p.getByTestId("step-away").waitFor();
check("step-away note is shown during the build", /close this tab/.test(await p.getByTestId("step-away").innerText()));
check("a build job was queued", Number(sql("select count(*) from jobs where type='build'")) >= 1);
await ready(p);
check("worker finished the build", sql("select status from jobs order by created_at desc limit 1") === "done");
check("store is drawn with the brief's name", (await p.locator("[data-testid=store-name]").innerText()) === "Willow & Thread");
check("usage was logged for intake and build", Number(sql("select count(*) from usage")) >= 2);

// 6. Iterate and persist
const historyLen = () => Number(sql("select jsonb_array_length(state->'history') from projects where idea like '%Los Gatos%'"));
const until = async (fn, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await new Promise((r) => setTimeout(r, 150)); } return false; };
await chat(p, "use sage green");
await p.getByText("Version 2").waitFor();
check("a change is saved shortly after it happens", await until(() => historyLen() === 2));
await p.reload();
await p.locator("[data-testid=store-name]").waitFor();
check("reload keeps the built store and the change (v2)", (await p.getByTestId("version").innerText()) === "v2");
await chat(p, "use navy");
await p.getByText("Version 3").waitFor();
await p.goto(`${BASE}/projects`);
check("leaving the page right after a change still saves it", await until(() => historyLen() === 3));
check("project row shows ready with the store name as title", sql("select status || '|' || title from projects where idea like '%Los Gatos%'") === "ready|Willow & Thread");

// 7. Closing the tab does not stop a build
await p.goto(`${BASE}/new?idea=${encodeURIComponent("a plant shop in Campbell")}`);
await p.getByRole("button", { name: "Just build it" }).click();
await p.getByRole("button", { name: "Build it", exact: true }).last().click();
await p.getByTestId("step-away").waitFor();
await p.goto(`${BASE}/projects`);
await p.waitForTimeout(3500);
const rows = await p.getByRole("list", { name: "Projects" }).innerText();
check("projects list shows both, with status", /Willow & Thread/.test(rows) && /ready/.test(rows));
await p.locator("a[href^=\"/projects/\"]").first().click();
await p.waitForURL(/\/projects\/[0-9a-f-]{36}/);
await ready(p);
check("a build left running while away finished", true);

// 8. Publish request
await p.goto(projectUrl);
await p.locator("[data-testid=store-name]").waitFor();
await p.getByRole("button", { name: "Publish", exact: true }).click();
await p.locator("#publish-email").fill("rp@example.com");
await p.getByRole("button", { name: "Send me the plan" }).click();
await p.getByText("You're on the list").waitFor();
check("publish request stored", sql("select count(*) from publish_requests where email='rp@example.com'") === "1");

// 9. Ownership and API auth
const ctx2 = await b.newContext();
const g = await ctx2.newPage();
await login(g, "guest@example.com");
await g.waitForURL(/\/projects$/);
check("another user sees no projects", /Nothing here yet/.test(await g.locator("main").innerText()));
const r1 = await g.goto(projectUrl);
check("another user cannot open someone else's project (404)", r1.status() === 404);
const id = projectUrl.split("/").pop();
const api = await g.request.get(`${BASE}/api/projects/${id}`);
check("another user cannot read the project API (404)", api.status() === 404);
const put = await g.request.put(`${BASE}/api/projects/${id}/state`, { data: {} });
check("another user cannot write its state (404)", put.status() === 404);
const anon = await b.newContext();
const a = await anon.request.get(`${BASE}/api/projects/${id}`);
check("signed-out API call is 401", a.status() === 401);

check("no page errors", errs.length === 0, errs.join(" | "));
await b.close();
