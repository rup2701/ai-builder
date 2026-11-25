import assert from "node:assert/strict";
import { DEFAULT_TEMPLATE, handoff, PILL_GROUPS } from "../src/components/app/home-pills";
import { TEMPLATES_BY_ID } from "../src/components/app/templates";

// A typed idea with no card clicked: each pill builds its default template, sent the same way as a card click.
assert.deepEqual(handoff("mobile", null), { kind: "site" }, "Mobile app defaults to the waitlist site (no pack)");
assert.deepEqual(handoff("saas", null), { kind: "site", pack: "showcase" }, "SaaS defaults to the product showcase");
assert.deepEqual(handoff("site", null), { kind: "site" }, "Website with no card stays the waitlist site");
assert.deepEqual(handoff("store", null), { kind: "store" });
// The default is the same as clicking that card.
assert.deepEqual(handoff("mobile", null), handoff("mobile", DEFAULT_TEMPLATE.mobile!));
assert.deepEqual(handoff("saas", null), handoff("saas", DEFAULT_TEMPLATE.saas!));
// A clicked card wins over the default.
assert.deepEqual(handoff("mobile", "website-saas"), { kind: "site", pack: "showcase" });
assert.deepEqual(handoff("saas", "website-mvp"), { kind: "site" });
assert.deepEqual(handoff("site", "website-restaurant"), { kind: "site", pack: "local" });

// Every listed card exists, and the shared cards are the same object under every pill (listed, not copied).
for (const [pill, groups] of Object.entries(PILL_GROUPS))
  for (const g of groups) for (const it of g.items) assert.ok(TEMPLATES_BY_ID[it.id], `${pill}: no card ${it.id}`);
const ids = (p: keyof typeof PILL_GROUPS) => PILL_GROUPS[p].map((g) => [g.heading, g.items.map((i) => i.id)]);
assert.deepEqual(ids("mobile"), [["Launch page", ["website-mvp", "website-saas"]], ["The app itself", ["mobile-app"]]]);
assert.deepEqual(ids("saas"), [["Launch page", ["website-saas", "website-mvp"]], ["The app itself", ["saas-app"]]]);
assert.ok(PILL_GROUPS.site[0].items.some((i) => i.id === "website-mvp") && PILL_GROUPS.site[0].items.some((i) => i.id === "website-saas"), "Website keeps both");
// Default cards are live; the app cards are Coming soon.
assert.ok(!TEMPLATES_BY_ID[DEFAULT_TEMPLATE.mobile!].soon && !TEMPLATES_BY_ID[DEFAULT_TEMPLATE.saas!].soon);
assert.ok(TEMPLATES_BY_ID["mobile-app"].soon && TEMPLATES_BY_ID["saas-app"].soon);
console.log("PASS home-pills");
