/**
 * The style tile (APP-42 step 3): tokens worked out by code from the design brief, the page drawn from them, and the five
 * checks. Uses the saved GWins project (test/fixtures/gwins-design-brief.json). No model, no database, no browser.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { DesignBrief } from "../src/lib/builder/design-brief";
import { contrast, designTokens, hexToOklch, hueDistance, neutralHueFor, NEAR_BLACK, parseHex, WHITE } from "../src/lib/builder/design-tokens";
import { BIG_CARD_MIN, briefFooterLabels, CAPTION, footerLinks, HIDDEN_FOOTER_LINKS, INDICATIVE, renderTile, testimonialsOff, tileSources } from "../src/lib/builder/style-tile";
import { checkTile, cssOf, parseCss, parseHtml } from "../src/lib/builder/tile-checks";

const G = JSON.parse(readFileSync(new URL("./fixtures/gwins-design-brief.json", import.meta.url), "utf8")) as { brief: Record<string, any>; savedDesignBrief: DesignBrief };
const DB = G.savedDesignBrief;
const BRIEF = G.brief;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
let n = 0;
const ok = (name: string) => console.log("PASS", ++n, name);
const close = (a: string, b: string) => {
  const [x, y] = [parseHex(a)!, parseHex(b)!];
  assert.ok(["r", "g", "b"].every((k) => Math.abs((x as any)[k] - (y as any)[k]) <= 1.5 / 255), `${a} is not close to ${b}`);
};
const draw = (db: DesignBrief = DB, brief: Record<string, unknown> = BRIEF) => {
  const t = designTokens(db, brief);
  const html = renderTile(db, brief, t);
  return { t, html, result: checkTile(html, tileSources(db, brief), t, briefFooterLabels(brief)) };
};
const failing = (r: ReturnType<typeof draw>["result"]) => r.checks.filter((c) => !c.ok).map((c) => c.id);

// 1. Tokens: the navy ink from look.md, the shifted hue for blue accents, text on the accent.
{
  const orange = designTokens({ ...clone(DB), look: { ...DB.look, accent: { value: "#F97316", quote: null, msg: null }, tone: { value: "bold", quote: null, msg: null } } });
  for (const [k, v] of Object.entries({ background: "#0B1020", surface: "#131A2E", border: "#26304C", text: "#F4F6FB", muted: "#9AA6C4" })) close((orange.color as any)[k], v);
  assert.equal(orange.neutralHue, 268);
  assert.equal(Math.round(neutralHueFor({ l: 0.6, c: 0.2, h: 263 })), 313);
  assert.equal(Math.round(neutralHueFor({ l: 0.6, c: 0.2, h: 300 })), 250);
  assert.equal(orange.color.onAccent, NEAR_BLACK);
  const g = designTokens(DB, BRIEF);
  assert.equal(g.color.accent, "#2EE6C4");
  assert.ok(contrast(g.color.accent, g.color.onAccent) >= 4.5);
  assert.equal(designTokens({ ...clone(DB), look: { ...DB.look, accent: { value: "#1E3A8A", quote: null, msg: null } } }).color.onAccent, WHITE, "a dark accent takes white text");
  assert.deepEqual(designTokens(DB, BRIEF), g, "same input, same tokens");
  ok("tokens: navy ink from the accent, the hue moved off a blue accent, text on the accent at 4.5:1");
}

// 2. Fonts and weights come from the pairing; only headlines go above 700, except the oversized numerals.
{
  const g = designTokens(DB, BRIEF);
  assert.deepEqual([g.font.heading, g.font.body, g.font.weight.headline, g.font.capsLabels], ["Outfit", "Inter", 800, true]);
  assert.equal(g.font.weight.numeral, 800, "GWins chose oversized-numerals");
  assert.equal(g.font.weight.strong, 700);
  assert.equal(g.direction.heroLayout, "split", "a fragment hero is split");
  assert.equal(g.radius.card, 32, "playful cards are 32 px (look.md tone table)");
  const calm = designTokens({ ...clone(DB), look: { ...DB.look, tone: { value: "calm", quote: null, msg: null } }, direction: { ...DB.direction, pairing: { value: "Neutral modern", proposal: "p1" }, signatures: [] } });
  assert.deepEqual([calm.font.heading, calm.font.weight.headline, calm.font.weight.numeral], ["Inter", 600, 700], "Neutral modern takes the tone's display weight");
  ok("fonts and weights from the pairing name, radius from the tone");
}

// 3. The GWins tile passes all six checks, and every value in the rules is a token.
{
  const { html, result } = draw();
  assert.deepEqual(failing(result), [], JSON.stringify(result.checks.filter((c) => !c.ok)));
  const css = cssOf(parseHtml(html));
  const rules = css.replace(/:root\{[^}]*\}/, "").replace(/@container[^{]*\{/g, "");
  assert.doesNotMatch(rules, /#[0-9a-f]{3,8}\b/i, "no color outside :root");
  assert.doesNotMatch(rules, /\d+px/, "no length outside :root");
  assert.doesNotMatch(html.replace(/<style>[\s\S]*?<\/style>/, ""), /style="/, "no inline styles in the markup");
  ok("GWins: all six checks pass, and the rules use tokens only");
}

// 4. What the page says: the indicative band, three marked samples with the design brief's fields, equal plans.
{
  const { html } = draw();
  assert.ok(html.includes(INDICATIVE));
  assert.ok(html.includes(CAPTION));
  assert.equal(html.match(/data-sample-card=/g)?.length, 3);
  assert.equal(html.match(/data-sample>Sample</g)?.length, 3);
  assert.ok(html.includes(">AWAY @ HOME<") && html.includes(">Odds<"), "field names from the design brief's sample card");
  assert.ok(BRIEF.blocks.find((b: any) => b.type === "pricing").plans[1].highlight, "the brief marks Monthly");
  assert.doesNotMatch(html, /class="plan highlight"/, "but the owner never asked, so plans are equal");
  const asked = clone(DB);
  asked.plans[1] = { ...asked.plans[1], highlight: true, highlight_quote: { quote: "monthly is the one to push", msg: 11 } };
  assert.match(draw(asked).html, /class="plan highlight"><h3>Monthly/);
  assert.ok(testimonialsOff(DB, BRIEF), "a betting site leaves testimonials out");
  assert.doesNotMatch(html, /Example Name|Placeholder quote|What members say/);
  assert.ok(html.includes("[Age and responsible-gambling notice: owner to supply]"));
  ok("the tile says it is indicative, marks every sample, keeps plans equal and leaves sample testimonials out");
}

// 5. Each check catches its own fault.
{
  const { t, html } = draw();
  const src = tileSources(DB, BRIEF);
  const ids = (h: string) => failing(checkTile(h, src, t, briefFooterLabels(BRIEF)));
  assert.deepEqual(ids(html.replace("</h1>", " Guaranteed winners.</h1>")), [1], "an invented line");
  assert.deepEqual(ids(html.replace(/<span class="chip caps" data-sample>Sample<\/span>/, "")), [2], "a sample card without its mark");
  assert.deepEqual(ids(html.replace(CAPTION, "")), [2], "no caption");
  assert.deepEqual(ids(html.replace(":root{", ":root{--extra:#E11D48;")), [3], "a second accent");
  assert.deepEqual(ids(html.replace(".logo{font-family:var(--font-heading);font-weight:var(--w-strong)", ".logo{font-family:var(--font-heading);font-weight:var(--w-headline)")), [4], "the logo at 800");
  assert.deepEqual(ids(html.replace("--sample-w:300px", "--sample-w:520px").replace("max-width:100%;padding:var(--gap)", "padding:var(--gap)")), [5], "a card wider than a phone");
  assert.deepEqual(ids(html.replace(".hero.split .wrap{grid-template-columns:1fr}", "")), [5], "a split hero that never stacks");
  assert.deepEqual(ids(html.replace('<span class="links">', '<span class="links"><a class="caps" href="#" data-footer-link>Blog</a>')), [1, 6], "a footer link the brief does not have");
  assert.deepEqual(ids(html.replace('<span class="links">', '<span class="links"><a class="caps" href="#" data-footer-link>Docs</a>')), [6], "a footer link the brief has but the tile leaves out");
  ok("each of the six checks fails on its own fault");
}

// 6. Other directions still pass: light mode, serious, a window frame, the owner's own image.
{
  for (const [mode, tone, heroKind, motif, pairing] of [
    ["light", "serious", "frame", "Board", "Sharp technical"],
    ["light", "calm", "owner-art", "Paper", "Editorial"],
    ["dark", "bold", "fragment", "Ledger", "Grotesk and mono"],
  ] as const) {
    const db = clone(DB);
    db.look.mode.value = mode;
    db.look.tone.value = tone;
    db.direction.hero_kind.value = heroKind;
    db.direction.motif.value = motif;
    db.direction.pairing.value = pairing;
    const { result, t } = draw(db);
    assert.deepEqual(failing(result), [], `${mode} ${tone} ${heroKind}: ${JSON.stringify(result.checks.filter((c) => !c.ok))}`);
    if (mode === "light") assert.equal(t.color.background, "#FFFFFF");
  }
  // In light mode a pale accent cannot be text: eyebrows use a darker step that reaches 4.5:1.
  const light = designTokens({ ...clone(DB), look: { ...DB.look, mode: { value: "light", quote: null, msg: null } } });
  assert.notEqual(light.color.accentText, light.color.accent);
  assert.ok(contrast(light.color.accentText, light.color.background) >= 4.5);
  assert.ok(hueDistance(hexToOklch(light.color.accentText).h, hexToOklch(light.color.accent).h) <= 15);
  ok("light mode, other tones, a window frame and the owner's image all pass");
}

// 7. The CSS reader sees the phone layout as a container query.
{
  const { containers } = parseCss(cssOf(parseHtml(draw().html)));
  assert.deepEqual(containers, ["tile (max-width: 640px)", "tile (max-width: 1100px)"]);
  ok("the phone layout is a container query on the tile");
}

// 10. Icons: the brief's names, a keyword match for others, a spark for the rest; outline only, colored by the page.
{
  const { TILE_ICONS, tileIcon } = await import("../src/lib/builder/tile-icons");
  assert.equal(tileIcon("trophy"), TILE_ICONS.trophy);
  assert.equal(tileIcon("refresh-off"), TILE_ICONS["refresh-off"]);
  assert.equal(tileIcon("calendar-days"), TILE_ICONS.calendar);
  assert.equal(tileIcon("credit-card"), TILE_ICONS.receipt);
  assert.equal(tileIcon("something-new"), TILE_ICONS.spark);
  assert.equal(tileIcon(undefined), TILE_ICONS.spark);
  for (const [k, v] of Object.entries(TILE_ICONS)) {
    assert.match(v, /stroke="currentColor"/, k);
    assert.doesNotMatch(v, /#[0-9a-f]{3,8}|fill="(?!none)/i, `${k} has no color of its own and no fill`);
  }
  ok("icons come from the brief's names, outline only, colored by the page");
}

// 8. The footer shows the brief's links only, without About, Docs, Changelog and Security.
{
  const { html } = draw();
  assert.deepEqual(footerLinks(BRIEF), ["How it works", "Pricing", "FAQ", "Contact", "Privacy", "Terms", "Sign in"]);
  for (const h of HIDDEN_FOOTER_LINKS) {
    assert.ok(briefFooterLabels(BRIEF).includes(h), `the GWins brief lists ${h}`);
    assert.doesNotMatch(html, new RegExp(`data-footer-link>${h}<`), `${h} is left out`);
  }
  const none = clone(BRIEF);
  none.blocks = none.blocks.filter((b: any) => b.type !== "footer");
  assert.doesNotMatch(draw(DB, none).html, /<footer>/, "no footer in the brief, no footer on the tile");
  ok("the footer shows the brief's links only, without the pack's About, Docs, Changelog and Security");
}

// 9. Feature cards open with the brief's icon, and numerals stay in How it works; the large card is used only when it has enough to say.
{
  const { html } = draw();
  assert.doesNotMatch(html, /class="icon"/);
  assert.match(html, /<span class="card-icon"><svg [^>]*>.*?<\/svg><\/span><h3>Every pick, every sport/, "features open with an icon");
  assert.doesNotMatch(html, /card-numeral|>0[1-4]</, "numerals only in How it works");
  assert.equal(html.match(/class="card-icon"/g)?.length, 4);
  assert.match(html, /<div class="numeral" data-ordinal[^>]*>1<\/div><h3>Choose your pass/, "How it works keeps its numerals");
  assert.doesNotMatch(html, /class="card big"/, "GWins' first card has one short line, so every card is the same size");
  assert.match(html, /<div class="grid cols-2"><div class="card">/, "four equal cards make a 2x2, never one row");
  const { cardColumns } = await import("../src/lib/builder/style-tile");
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(cardColumns), [1, 2, 3, 2, 3, 3, 3]);
  const long = clone(BRIEF);
  const bento = long.blocks.find((b: any) => b.type === "benefits_bento");
  bento.items[0].text = "One pass covers every sport you follow, from the first game of the season to the last, with every pick in one place.";
  assert.ok(`${bento.items[0].title} ${bento.items[0].text}`.length >= BIG_CARD_MIN);
  const big = draw(DB, long);
  assert.match(big.html, /<div class="grid bento"><div class="card big">/);
  assert.deepEqual(failing(big.result), []);
  // The closing block repeats the Stack as three small cards with a chip and two bars each, and no words.
  assert.equal(html.match(/<div class="mini"><b><\/b><i><\/i><i><\/i><\/div>/g)?.length, 3);
  ok("feature cards carry icons, numerals stay in How it works, the large card needs enough to say, the closing motif is three small cards");
}

console.log(`\n${n} passed`);
