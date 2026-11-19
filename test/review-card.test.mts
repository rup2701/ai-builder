/**
 * Scout's review drawn as a card: the parts are found in the message text, which stays as Scout wrote it.
 * Uses the real GWins review (test/fixtures/gwins-design-brief.json, message 16) and a GunnerWins update.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hexesIn, isFullReview, parseReview, splitItem } from "../src/lib/builder/review-card";

const G = JSON.parse(readFileSync(new URL("./fixtures/gwins-design-brief.json", import.meta.url), "utf8")) as { messages: { id: number; text?: string }[] };
const REVIEW = G.messages.find((m) => m.id === 16)!.text!;
let n = 0;
const ok = (name: string) => console.log("PASS", ++n, name);

// 1. The GWins review: what Scout said first stays above, the labelled sections go in the card, the question stays below.
const r = parseReview(REVIEW)!;
assert.ok(r);
assert.match(r.before, /^The main button says "Get my picks"\./);
assert.match(r.before, /Here's the review\. I drafted the wording/);
assert.deepEqual(r.sections.map((s) => s.label), ["Headline", "Subheadline", "Sections", "Benefits", "How it works", "Pricing", "FAQ", "Closing", "Look", "Main button", "Drafted by us", "Placeholders to fix"]);
assert.equal(r.sections[0].text, "Game day? Your picks are ready.");
assert.equal(r.after, "Do you want to change anything, or does this look good?");
assert.ok(isFullReview(r));
ok("the GWins review is split into the text before, the sections and the question after");

// 2. Lists belong to their section; a section with only a list has no text.
const benefits = r.sections.find((s) => s.label === "Benefits")!;
assert.equal(benefits.text, "");
assert.equal(benefits.items.length, 4);
assert.equal(benefits.items[0], "Every pick, every sport (large card): one pass covers all the sports you bet on");
assert.equal(r.sections.find((s) => s.label === "Placeholders to fix")!.items.length, 5);
assert.deepEqual(splitItem(benefits.items[0]), { title: "Every pick, every sport (large card)", rest: "one pass covers all the sports you bet on" });
assert.deepEqual(splitItem("The link for Sign in"), { title: null, rest: "The link for Sign in" });
ok("lists stay with their section, and an item with a title is split at its colon");

// 3. The look line names its hex, for a swatch.
assert.deepEqual(hexesIn(r.sections.find((s) => s.label === "Look")!.text), ["#2EE6C4"]);
ok("a hex color in a line is found for a swatch");

// 4. The GunnerWins update: labels on their own line with the text below, a short update and not a full review.
const update = parseReview("Done. The top of the page now reads:\n\n**Headline**\nWin With Gunner\n\n**Subheadline**\nSimple, Fun and Profitable Picks\n\nEverything else stays as shown above. Do you want to change anything else, or is it good to save?")!;
assert.deepEqual(update.sections, [
  { label: "Headline", text: "Win With Gunner", items: [] },
  { label: "Subheadline", text: "Simple, Fun and Profitable Picks", items: [] },
]);
assert.equal(update.before, "Done. The top of the page now reads:");
assert.match(update.after, /^Everything else stays as shown above/);
assert.equal(isFullReview(update), false);
ok("a short update with labels on their own line is a card too, not a full review");

// 5. Ordinary messages are not reviews: a question, one bold word, two labels without a headline.
assert.equal(parseReview("Who is GWins for, and what do they use today instead?"), null);
assert.equal(parseReview("**Pricing:** how many plans do you have?"), null);
assert.equal(parseReview("**Tone:** playful\n\n**Mode:** dark"), null);
assert.equal(parseReview("It is **really** good.\n\nAnd **bold** here.\n\nAnd **here**."), null, "bold inside a sentence is not a label");
ok("ordinary messages are not drawn as a review");

console.log(`\n${n} passed`);
