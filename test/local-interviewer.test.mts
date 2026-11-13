import assert from "node:assert/strict";
import { makeLocalInterviewer, ownerSaidYes, saidPrivateTest, summarizeRead } from "../src/lib/agents/local-interviewer";
import { LOCAL_OPENER, type Chat } from "../src/lib/agents/site-interviewer";
import { localCard, validateSiteBrief } from "../src/lib/builder/site-brief";
import { emptyState, pushMsg } from "../src/lib/workspace/state";
import type { WorkspaceState } from "../src/lib/workspace/types";
import type { ImportResult } from "../src/lib/builder/site-import";
import type { ReadWebsite } from "../src/lib/builder/read-website";

let failed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log("PASS", name); } catch (e) { failed++; console.log("FAIL", name, e); }
}

const site = {
  name: "Test Kitchen", kind: "Indian and Himalayan restaurant", tagline: "Real food.", about: "We cook food from the hills.", address: "1 Test St", phone: "510-555-0100", hours: ["Open daily 10 to 10"],
  menu: [{ category: "Appetizers", items: [{ name: "Veg Samosa", price: "$6.95" }, { name: "Papadam" }] }, { category: "Momo", items: [{ name: "Veg Steam Momo", price: "$15" }] }],
  socials: [], testimonials: [], signup: false, sourceUrl: "https://testkitchen.example/", dropped: [], pagesRead: 3, readPages: [], textChars: 100, warnings: [], linksSeen: [], catalog: [], extras: [],
  images: [{ src: "https://img.example.com/1.jpg", alt: "Veg Samosa" }, { src: "https://img.example.com/2.jpg", alt: "" }],
  actions: [{ label: "Menu", url: "https://testkitchen.example/menu" }],
} as unknown as ImportResult;
const software = { ...site, name: "Acme Cloud", kind: "software company", menu: [], extras: [] } as unknown as ImportResult;

const usage = { inputTokens: 1000, outputTokens: 100, costUsd: 0.02 };
type Step = { text?: string; tools?: { name: string; input: unknown }[]; throws?: boolean };
const script = (...steps: Step[]) => {
  const calls: Parameters<Chat>[0][] = [];
  let i = 0;
  const chat: Chat = async (req) => {
    calls.push(JSON.parse(JSON.stringify(req)));
    const st = steps[Math.min(i++, steps.length - 1)];
    if (st.throws) throw new Error("boom");
    const toolUses = (st.tools ?? []).map((t, k) => ({ id: `tu${i}_${k}`, ...t }));
    return { text: st.text ?? "", toolUses, content: [{ type: "text", text: st.text ?? "" }, ...toolUses.map((t) => ({ type: "tool_use", ...t }))], usage };
  };
  return { chat, calls };
};
const reader = (result: ImportResult = site, fail?: string) => {
  const urls: string[] = [];
  const read: ReadWebsite = async (url) => { urls.push(url); if (fail) throw new Error(fail); return { result, costUsd: 0.01, inputTokens: 500, outputTokens: 50 }; };
  return { read, urls };
};
const start = (): WorkspaceState => pushMsg({ ...emptyState(), phase: "intake", sitePack: "local" }, { kind: "bot", text: LOCAL_OPENER });
const bots = (s: WorkspaceState) => s.msgs.filter((m) => m.kind === "bot").map((m) => (m as { text: string }).text);
const lastResult = (c: Parameters<Chat>[0]) => ((c.messages.at(-1)!.content as { content: string; is_error?: boolean }[])[0]);

// A state after the site was read and shown to the person, ready for their answer.
async function afterRead() {
  const { chat } = script({ tools: [{ name: "read_website", input: { url: "https://testkitchen.example" } }] }, { text: "I found Test Kitchen with 3 dishes. Is this your website and may we use it?" });
  const r = reader();
  const ai = makeLocalInterviewer(chat, "fake", r.read);
  const out = await ai.turn(start(), "My site is https://testkitchen.example", { userEmail: "owner@example.com" });
  return out.state;
}

await test("ownerSaidYes needs the exact words, a yes, and no no", () => {
  assert.equal(ownerSaidYes("Yes, I own it", "Yes, I own it, go ahead"), true);
  assert.equal(ownerSaidYes("YES, I own   it", "yes, i own it!"), true);
  assert.equal(ownerSaidYes("yes i own it", "Yes, I own it"), false);
  assert.equal(ownerSaidYes("I own it", "Yes, I own it"), true);
  assert.equal(ownerSaidYes("I own it", "no"), false);
  assert.equal(ownerSaidYes("No, it is not mine", "No, it is not mine"), false);
  assert.equal(ownerSaidYes("I don't own it", "I don't own it"), false);
  assert.equal(ownerSaidYes("yes", "maybe later"), false);
  assert.equal(ownerSaidYes("", "yes"), false);
  assert.equal(ownerSaidYes(undefined, "yes"), false);
  assert.equal(ownerSaidYes("x".repeat(500), "x".repeat(500)), false);
});

await test("reading the site the person typed keeps it and tells the model what was found", async () => {
  const { chat, calls } = script({ tools: [{ name: "read_website", input: { url: "https://testkitchen.example" } }] }, { text: "Found Test Kitchen. Is it yours?" });
  const r = reader();
  const out = await makeLocalInterviewer(chat, "fake", r.read).turn(start(), "My site is https://testkitchen.example");
  assert.deepEqual(r.urls, ["https://testkitchen.example"]);
  const res = lastResult(calls[1]);
  assert.ok(!res.is_error);
  const sum = JSON.parse(res.content);
  assert.equal(sum.name, "Test Kitchen");
  assert.equal(sum.dishes, 3);
  assert.equal(sum.pictures_without_captions, 1);
  assert.ok(sum.not_found.includes("customer reviews"));
  assert.equal(out.state.local?.reads, 1);
  assert.ok(out.state.local?.read);
  assert.equal(out.state.phase, "intake");
  assert.equal(out.state.site, undefined);
  assert.equal(bots(out.state).at(-1), "Found Test Kitchen. Is it yours?");
  assert.equal(out.usage?.costUsd, 0.02 * 2 + 0.01);
  assert.equal(out.usage?.inputTokens, 2500);
});

await test("an address the person did not write is not read", async () => {
  const { chat, calls } = script({ tools: [{ name: "read_website", input: { url: "https://evil.example/" } }] }, { text: "Which website?" });
  const r = reader();
  const out = await makeLocalInterviewer(chat, "fake", r.read).turn(start(), "My site is https://testkitchen.example");
  assert.deepEqual(r.urls, []);
  assert.equal(lastResult(calls[1]).is_error, true);
  assert.equal(out.state.local, undefined);
});

await test("an address without https is refused", async () => {
  const { chat, calls } = script({ tools: [{ name: "read_website", input: { url: "http://testkitchen.example" } }] }, { text: "Please send the https address." });
  const r = reader();
  await makeLocalInterviewer(chat, "fake", r.read).turn(start(), "My site is http://testkitchen.example");
  assert.deepEqual(r.urls, []);
  assert.equal(lastResult(calls[1]).is_error, true);
});

await test("a site that cannot be read gives the plain reason, and the try is counted", async () => {
  const { chat, calls } = script({ tools: [{ name: "read_website", input: { url: "https://testkitchen.example" } }] }, { text: "I could not open it." });
  const r = reader(site, "That website did not answer.");
  const out = await makeLocalInterviewer(chat, "fake", r.read).turn(start(), "https://testkitchen.example");
  assert.equal(lastResult(calls[1]).content, "That website did not answer.");
  assert.equal(out.state.local?.reads, 1);
  assert.equal(out.state.local?.read, undefined);
});

await test("a site that is not a food business is not kept", async () => {
  const { chat, calls } = script({ tools: [{ name: "read_website", input: { url: "https://acme.example" } }] }, { text: "That does not look like a restaurant." });
  const r = reader(software);
  const out = await makeLocalInterviewer(chat, "fake", r.read).turn(start(), "https://acme.example");
  assert.equal(lastResult(calls[1]).is_error, true);
  assert.match(lastResult(calls[1]).content, /restaurants/);
  assert.equal(out.state.local?.read, undefined);
});

await test("only three reads per project", async () => {
  let s = start();
  const r = reader();
  for (let n = 0; n < 3; n++) {
    const { chat } = script({ tools: [{ name: "read_website", input: { url: "https://testkitchen.example" } }] }, { text: "ok" });
    s = (await makeLocalInterviewer(chat, "fake", r.read).turn(s, "https://testkitchen.example")).state;
  }
  const { chat, calls } = script({ tools: [{ name: "read_website", input: { url: "https://testkitchen.example" } }] }, { text: "ok" });
  await makeLocalInterviewer(chat, "fake", r.read).turn(s, "https://testkitchen.example");
  assert.equal(r.urls.length, 3);
  assert.equal(lastResult(calls[1]).is_error, true);
});

await test("the model cannot confirm in the same turn it read the site", async () => {
  const { chat, calls } = script(
    { tools: [{ name: "read_website", input: { url: "https://testkitchen.example" } }, { name: "confirm_ownership", input: { quote: "I own it" } }] },
    { text: "Is it yours?" },
  );
  const out = await makeLocalInterviewer(chat, "fake", reader().read).turn(start(), "I own it, https://testkitchen.example");
  const results = calls[1].messages.at(-1)!.content as { is_error?: boolean }[];
  assert.equal(results[1].is_error, true);
  assert.equal(out.state.site, undefined);
});

await test("after the owner says yes, code builds and saves a valid brief with the owner's words as proof", async () => {
  const s0 = await afterRead();
  const { chat } = script({ tools: [{ name: "confirm_ownership", input: { quote: "Yes, I own it" } }] });
  const out = await makeLocalInterviewer(chat, "fake", reader().read).turn(s0, "Yes, I own it and you can use everything.", { userEmail: "owner@example.com" });
  const brief = out.state.site!.brief as Record<string, any>;
  assert.equal(validateSiteBrief(brief, "local").ok, true);
  assert.equal(brief.consent.owner_confirmed, true);
  assert.equal(brief.consent.by, "owner@example.com");
  assert.equal(brief.consent.quote, "Yes, I own it");
  assert.equal(brief.images.owner_confirmed, true);
  assert.equal(brief.private_test, undefined);
  assert.equal(brief.menu.categories[0].items[0].name, "Veg Samosa");
  assert.equal(out.state.phase, "summary");
  assert.match(bots(out.state).at(-1)!, /3 dishes in 2 menu sections/);
  const card = localCard(brief);
  assert.equal(card.name, "Test Kitchen");
  assert.equal(card.dishes, 3);
  assert.equal(card.pictures, 1);
  assert.ok(card.notFound.includes("customer reviews"));
});

await test("a quote that is not in their message does not save", async () => {
  const s0 = await afterRead();
  const { chat, calls } = script({ tools: [{ name: "confirm_ownership", input: { quote: "Yes, I own the place" } }] }, { text: "Just to be sure, is it yours?" });
  const out = await makeLocalInterviewer(chat, "fake", reader().read).turn(s0, "ok sounds good", { userEmail: "owner@example.com" });
  assert.equal(lastResult(calls[1]).is_error, true);
  assert.equal(out.state.site, undefined);
  assert.equal(out.state.phase, "intake");
});

await test("a no never saves, even if the model calls the tool", async () => {
  const s0 = await afterRead();
  const { chat } = script({ tools: [{ name: "confirm_ownership", input: { quote: "No, it is not my website" } }] }, { text: "Then I cannot use it." });
  const out = await makeLocalInterviewer(chat, "fake", reader().read).turn(s0, "No, it is not my website");
  assert.equal(out.state.site, undefined);
});

await test("confirming with nothing read does not save", async () => {
  const { chat, calls } = script({ tools: [{ name: "confirm_ownership", input: { quote: "Yes, I own it" } }] }, { text: "Which website?" });
  const out = await makeLocalInterviewer(chat, "fake", reader().read).turn(start(), "Yes, I own it");
  assert.equal(lastResult(calls[1]).is_error, true);
  assert.equal(out.state.site, undefined);
});

await test("once saved (and before the build) only the two edit tools exist, the saved state is kept and the model is told the brief is saved", async () => {
  const s0 = await afterRead();
  const a = makeLocalInterviewer(script({ tools: [{ name: "confirm_ownership", input: { quote: "Yes, I own it" } }] }).chat, "fake", reader().read);
  const saved = (await a.turn(s0, "Yes, I own it", { userEmail: "o@example.com" })).state;
  const { chat, calls } = script({ text: "It has three dishes." });
  const out = await makeLocalInterviewer(chat, "fake", reader().read).turn(saved, "How many dishes?");
  assert.deepEqual(calls[0].tools.map((t) => t.name).sort(), ["set_section", "update_brief"]);
  assert.match(calls[0].system, /already saved/);
  assert.ok(out.state.site?.brief);
  assert.equal(out.state.phase, "summary");
});

await test("the model sees what was read earlier when the person answers", async () => {
  const s0 = await afterRead();
  const { chat, calls } = script({ text: "Thanks, is it yours?" });
  await makeLocalInterviewer(chat, "fake", reader().read).turn(s0, "hmm");
  assert.match(calls[0].system, /<site_read>/);
  assert.match(calls[0].system, /Test Kitchen/);
  assert.ok(calls[0].messages.at(-1)!.role === "user");
});

await test("a model failure gives a plain apology and keeps what was read", async () => {
  const s0 = await afterRead();
  const out = await makeLocalInterviewer(script({ throws: true }).chat, "fake", reader().read).turn(s0, "Yes");
  assert.match(bots(out.state).at(-1)!, /Sorry/);
  assert.ok(out.state.local?.read);
  assert.equal(out.usage?.model, "local-fallback");
});

await test("an empty message changes nothing", async () => {
  const s = start();
  const out = await makeLocalInterviewer(script({ text: "x" }).chat, "fake", reader().read).turn(s, "   ");
  assert.equal(out.state, s);
});

await test("summarizeRead is counts and names only", () => {
  const sum = summarizeRead(site, ["tagline"]);
  assert.equal(sum.menu_sections.length, 2);
  assert.ok(!JSON.stringify(sum).includes("We cook food"));
  assert.equal(sum.story_page_found, true);
  assert.equal(summarizeRead(site, ["story page", "catering page"]).story_page_found, false);
  assert.equal(summarizeRead(site, ["story page", "catering page"]).catering_page_found, false);
});

await test("saidPrivateTest needs their exact words about a private test", () => {
  assert.equal(saidPrivateTest("this is a private test", "this is a private test"), true);
  assert.equal(saidPrivateTest("this is a private test", "yes"), false);
  assert.equal(saidPrivateTest("it is not a private test", "it is not a private test"), false);
  assert.equal(saidPrivateTest("yes", "yes"), false);
});

await test("an admin can save a private test: marked, in their name, no ownership claim", async () => {
  const s0 = await afterRead();
  const { chat, calls } = script({ tools: [{ name: "confirm_private_test", input: { quote: "private test" } }] });
  const out = await makeLocalInterviewer(chat, "fake", reader().read).turn(s0, "It is a private test", { userEmail: "rp@example.com", isAdmin: true });
  const brief = out.state.site!.brief as Record<string, any>;
  assert.equal(validateSiteBrief(brief, "local").ok, true);
  assert.equal(brief.private_test, true);
  assert.equal(brief.consent.private_test, true);
  assert.equal(brief.consent.owner_confirmed, undefined);
  assert.equal(brief.images.owner_confirmed, false);
  assert.equal(brief.consent.by, "rp@example.com");
  assert.ok(calls[0].tools.some((t) => t.name === "confirm_private_test"));
  assert.match(calls[0].system, /private test/);
  assert.match(bots(out.state).at(-1)!, /never published/);
});

await test("someone who is not an admin has no private-test tool, and calling it saves nothing", async () => {
  const s0 = await afterRead();
  const { chat, calls } = script({ tools: [{ name: "confirm_private_test", input: { quote: "private test" } }] }, { text: "Is it yours?" });
  const out = await makeLocalInterviewer(chat, "fake", reader().read).turn(s0, "It is a private test", { userEmail: "x@example.com" });
  assert.ok(!calls[0].tools.some((t) => t.name === "confirm_private_test"));
  assert.equal(out.state.site, undefined);
});


// ---- Changes before the build, and an owner with no website ----------------------------------------------------------

async function saved() {
  const s0 = await afterRead();
  const a = makeLocalInterviewer(script({ tools: [{ name: "confirm_ownership", input: { quote: "Yes, I own it" } }] }).chat, "fake", reader().read);
  return (await a.turn(s0, "Yes, I own it", { userEmail: "o@example.com" })).state;
}

await test("update_brief changes the name only to the person's exact words, spelling and capitals included", async () => {
  const s0 = await saved();
  const { chat } = script({ tools: [{ name: "update_brief", input: { field: "name", value: "Testkitchen" } }] }, { text: "Done." });
  const out = await makeLocalInterviewer(chat, "fake", reader().read).turn(s0, "please change the name to Testkitchen, it is not camel case");
  const brief = out.state.site!.brief as Record<string, any>;
  assert.equal(brief.site.name, "Testkitchen");
  assert.equal(validateSiteBrief(brief, "local").ok, true);
  assert.equal(localCard(brief).name, "Testkitchen");
});

await test("update_brief refuses text the person did not write, even in another case", async () => {
  const s0 = await saved();
  const { chat, calls } = script({ tools: [{ name: "update_brief", input: { field: "name", value: "Testkitchen" } }] }, { text: "I could not." });
  const out = await makeLocalInterviewer(chat, "fake", reader().read).turn(s0, "change the name to testkitchen");
  assert.equal((out.state.site!.brief as Record<string, any>).site.name, "Test Kitchen");
  assert.equal(lastResult(calls[1]).is_error, true);
  const out2 = await makeLocalInterviewer(script({ tools: [{ name: "update_brief", input: { field: "tagline", value: "The best food in town" } }] }, { text: "no" }).chat, "fake", reader().read).turn(s0, "make the tagline better");
  assert.equal((out2.state.site!.brief as Record<string, any>).site.tagline, "Real food.");
});

await test("update_brief only touches the name, tagline and kind line, and refuses links and tags", async () => {
  const s0 = await saved();
  for (const [field, value, said] of [["menu", "x", "menu"], ["name", "Visit https://evil.example", "Visit https://evil.example"], ["tagline", "<b>Hi</b>", "<b>Hi</b>"]] as const) {
    const { chat, calls } = script({ tools: [{ name: "update_brief", input: { field, value } }] }, { text: "no" });
    const out = await makeLocalInterviewer(chat, "fake", reader().read).turn(s0, said);
    assert.equal(lastResult(calls[1]).is_error, true, field);
    assert.deepEqual((out.state.site!.brief as Record<string, any>).site.name, "Test Kitchen");
  }
});

await test("set_section switches a section off and on, and says when there is nothing to show", async () => {
  const s0 = await saved();
  const off = await makeLocalInterviewer(script({ tools: [{ name: "set_section", input: { section: "catering", on: false } }] }, { text: "ok" }).chat, "fake", reader().read).turn(s0, "turn off catering");
  assert.deepEqual((off.state.site!.brief as Record<string, any>).page_plan.off, ["catering"]);
  const { chat, calls } = script({ tools: [{ name: "set_section", input: { section: "reviews", on: true } }] }, { text: "ok" });
  await makeLocalInterviewer(chat, "fake", reader().read).turn(off.state, "turn on reviews");
  assert.match(lastResult(calls[1]).content, /nothing to show/);
  const hero = script({ tools: [{ name: "set_section", input: { section: "hero", on: false } }] }, { text: "no" });
  const out = await makeLocalInterviewer(hero.chat, "fake", reader().read).turn(off.state, "remove the top of the page");
  assert.equal(lastResult(hero.calls[1]).is_error, true);
  assert.deepEqual((out.state.site!.brief as Record<string, any>).page_plan.off, ["catering"]);
});

await test("once the site is built the model has no edit tools", async () => {
  const s0 = await saved();
  const built = { ...s0, site: { ...(s0.site ?? {}), build: { stage: 5, url: "https://x.example" } } } as unknown as WorkspaceState;
  const { chat, calls } = script({ text: "Use the change box." });
  await makeLocalInterviewer(chat, "fake", reader().read).turn(built, "change the tagline");
  assert.deepEqual(calls[0].tools, []);
  assert.match(calls[0].system, /change box/);
});

const typed = {
  name: "Spice Hut", kind_label: "Indian kitchen", address: "12 Main St, Oakland", phone: "510-555-0199", hours: ["Mon to Sat 11 to 9"],
  menu_text: "Starters:\nSamosa 6\nPakora - $7\nMains:\nButter Chicken $18\nDal",
};
const details = "Spice Hut, an Indian kitchen\n12 Main St, Oakland\n510-555-0199\nMon to Sat 11 to 9\nStarters:\nSamosa 6\nPakora - $7\nMains:\nButter Chicken $18\nDal";
async function noSiteAsked() {
  const ai = makeLocalInterviewer(script({ text: "Got it. Are you the owner, and may we make the site from these details?" }).chat, "fake", reader().read);
  return (await ai.turn(start(), details, { userEmail: "o@example.com" })).state;
}

await test("an owner with no website: the brief is made from exactly what they typed, with no pictures and nothing invented", async () => {
  const s0 = await noSiteAsked();
  const { chat } = script({ tools: [{ name: "save_basics", input: { ...typed, quote: "Yes, I own it" } }] });
  const out = await makeLocalInterviewer(chat, "fake", reader().read).turn(s0, "Yes, I own it", { userEmail: "o@example.com" });
  const brief = out.state.site!.brief as Record<string, any>;
  assert.equal(validateSiteBrief(brief, "local").ok, true);
  assert.equal(brief.site.name, "Spice Hut");
  assert.equal(brief.site.tagline, null);
  assert.equal(brief.images.use_photos, false);
  assert.equal(brief.images.gallery.length, 0);
  assert.equal(brief.consent.owner_confirmed, true);
  assert.equal(brief.consent.by, "o@example.com");
  assert.deepEqual(brief.menu.categories.map((c: any) => [c.name, c.items.map((i: any) => [i.name, i.price ?? null])]), [["Starters", [["Samosa", "6"], ["Pakora", "$7"]]], ["Mains", [["Butter Chicken", "$18"], ["Dal", null]]]]);
  assert.equal(brief.story, null);
  assert.ok(brief.not_found.includes("story page") && brief.not_found.includes("pictures") && brief.not_found.includes("tagline"));
  assert.equal(out.state.phase, "summary");
  assert.match(bots(out.state).at(-1)!, /4 dishes in 2 menu sections/);
  assert.match(bots(out.state).at(-1)!, /Nothing was added/);
});

await test("an owner with no website: a dish, price or phone they did not type is refused, nothing is saved", async () => {
  const s0 = await noSiteAsked();
  for (const bad of [{ ...typed, menu_text: typed.menu_text + "\nNaan $4" }, { ...typed, phone: "510-555-0100" }, { ...typed, name: "Spice hut" }, { ...typed, tagline: "Best curry in town" }, { ...typed, hours: ["Open daily"] }]) {
    const { chat, calls } = script({ tools: [{ name: "save_basics", input: { ...bad, quote: "Yes, I own it" } }] }, { text: "Sorry." });
    const out = await makeLocalInterviewer(chat, "fake", reader().read).turn(s0, "Yes, I own it", { userEmail: "o@example.com" });
    assert.equal(out.state.site, undefined);
    assert.equal(lastResult(calls[1]).is_error, true);
  }
});

await test("an owner with no website: no yes, no save", async () => {
  const s0 = await noSiteAsked();
  const { chat, calls } = script({ tools: [{ name: "save_basics", input: { ...typed, quote: "not sure" } }] }, { text: "Are you the owner?" });
  const out = await makeLocalInterviewer(chat, "fake", reader().read).turn(s0, "not sure", { userEmail: "o@example.com" });
  assert.equal(out.state.site, undefined);
  assert.equal(lastResult(calls[1]).is_error, true);
});

await test("an owner with no website: a name with no way to reach them is refused", async () => {
  const ai0 = makeLocalInterviewer(script({ text: "Anything else?" }).chat, "fake", reader().read);
  const s0 = (await ai0.turn(start(), "Spice Hut, an Indian kitchen", { userEmail: "o@example.com" })).state;
  const { chat, calls } = script({ tools: [{ name: "save_basics", input: { name: "Spice Hut", kind_label: "Indian kitchen", quote: "Yes, I own it" } }] }, { text: "I need an address or phone." });
  const out = await makeLocalInterviewer(chat, "fake", reader().read).turn(s0, "Yes, I own it", { userEmail: "o@example.com" });
  assert.equal(out.state.site, undefined);
  assert.match(lastResult(calls[1]).content, /address, a phone number or opening hours/);
});

await test("the opener tells people with no website they can say so", () => {
  assert.match(LOCAL_OPENER, /No website/);
});

await test("parseMenuText: sections, dishes, prices as typed, and no long lines", async () => {
  const { parseMenuText } = await import("../src/lib/builder/local-edit");
  const ok = parseMenuText("## Starters\n- Samosa $6\nPAKORA - 7.50\nDRINKS\nMango Lassi\nChai: $3");
  assert.equal(ok.ok, true);
  if (ok.ok) assert.deepEqual(ok.categories.map((c) => [c.name, c.items.map((i) => `${i.name}|${i.price ?? ""}`)]), [["Starters", ["Samosa|$6", "PAKORA|7.50"]], ["Drinks", ["Mango Lassi|", "Chai|$3"]]]);
  assert.equal(parseMenuText("a".repeat(90)).ok, false);
  assert.equal(parseMenuText("   ").ok, false);
});

if (failed) { console.log(`${failed} FAILED`); process.exit(1); }
console.log("all passed");
