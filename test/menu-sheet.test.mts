import assert from "node:assert/strict";
import { cellText, menuFromRows, menuSummary, parseCsv } from "../src/lib/builder/menu-sheet";
import { readXlsx } from "../src/lib/builder/xlsx-read";
import { zipSync, strToU8 } from "fflate";
import { briefFromOwner, localPlanText, withMenu } from "../src/lib/builder/local-edit";

let failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log("PASS " + name); } catch (e) { failed++; console.log("FAIL " + name + "\n  " + (e instanceof Error ? e.message : e)); }
}

await test("a csv with quotes, commas and a BOM reads as typed", () => {
  const rows = parseCsv('﻿Section,Dish,Price,Description\nStarters,"Samosa, two pieces",$5,"Crisp, with ""green"" chutney"\nStarters,Soup,6,\n');
  assert.deepEqual(rows[1], ["Starters", "Samosa, two pieces", "$5", 'Crisp, with "green" chutney']);
  const m = menuFromRows(rows);
  assert.ok(m.ok);
  if (m.ok) {
    assert.equal(m.dishes, 2);
    assert.deepEqual(m.categories[0].items[0], { name: "Samosa, two pieces", price: "$5", description: 'Crisp, with "green" chutney' });
    assert.deepEqual(m.categories[0].items[1], { name: "Soup", price: "6" });
  }
});

await test("semicolon and tab files are read, and a section carries down", () => {
  const m = menuFromRows(parseCsv("Dish;Price;Category\nNaan;3;Breads\nRoti;2;\n"));
  assert.ok(m.ok);
  if (m.ok) assert.deepEqual(m.categories.map((c) => [c.name, c.items.map((i) => i.name)]), [["Breads", ["Naan", "Roti"]]]);
  const t = menuFromRows(parseCsv("Item\tCost\nTea\t2\n"));
  assert.ok(t.ok);
});

await test("headers are found by name, in any order and case", () => {
  const m = menuFromRows([["PRICE", "item name", "Course"], ["$9", "Dal", "Mains"]]);
  assert.ok(m.ok);
  if (m.ok) assert.deepEqual(m.categories[0], { name: "Mains", items: [{ name: "Dal", price: "$9" }] });
});

await test("no dish column is an error; no section column puts everything under Menu", () => {
  const bad = menuFromRows([["Foo", "Bar"], ["a", "b"]]);
  assert.ok(!bad.ok && /dish column/.test(bad.error));
  const m = menuFromRows([["Dish"], ["Tea"], ["Coffee"]]);
  assert.ok(m.ok && m.categories[0].name === "Menu");
});

await test("rows that cannot be used are skipped and named, never repaired", () => {
  const m = menuFromRows([["Section", "Dish", "Price"], ["A", "", "5"], ["A", "Fine dish", "7"], ["A", "See https://x.example", "1"], ["A", "x".repeat(81), "1"], ["A", "Tag <b>", "1"], ["", "", ""]]);
  assert.ok(m.ok);
  if (m.ok) {
    assert.equal(m.dishes, 1);
    assert.equal(m.skipped.length, 4);
    assert.ok(m.skipped.includes("row 2 has no dish name"));
    assert.ok(m.skipped.includes("row 4 has a link or markup in it"));
    assert.ok(m.skipped.includes("row 5: the dish name is too long"));
  }
});

await test("limits: too many sections, too many dishes in one section, empty file", () => {
  const many = [["Section", "Dish"], ...Array.from({ length: 13 }, (_, i) => [`S${i}`, `D${i}`])];
  const r = menuFromRows(many);
  assert.ok(!r.ok && /13 sections/.test(r.error));
  const big = menuFromRows([["Section", "Dish"], ...Array.from({ length: 45 }, (_, i) => ["A", `D${i}`])]);
  assert.ok(big.ok && big.dishes === 40 && big.skipped.length === 5);
  assert.ok(!menuFromRows([]).ok);
  assert.ok(!menuFromRows([["Dish"]]).ok);
});

await test("excel cells: numbers keep their stored value, other types are empty", () => {
  assert.equal(cellText(12.5), "12.5");
  assert.equal(cellText("Naan"), "Naan");
  assert.equal(cellText(new Date()), "");
  assert.equal(cellText(null), "");
});

await test("summary names the counts and the skipped rows, and warns about bare numbers", () => {
  const m = menuFromRows([["Section", "Dish", "Price"], ["A", "Tea", "2"], ["A", "", "3"]]);
  assert.ok(m.ok);
  if (m.ok) {
    const s = menuSummary(m, "menu.csv");
    assert.match(s, /I read 1 dish in 1 section from menu\.csv\./);
    assert.match(s, /skipped 1 row: row 3 has no dish name/);
    assert.match(s, /no currency sign/);
  }
});

await test("the menu goes into the brief, replaces the old one, and clears the not-found note", () => {
  const noMenu = briefFromOwner({ name: "Bukhara", kind_label: "Uzbek restaurant", address: "1 Main St, Oakland" }, { by: "o@example.com", at: "2026-11-13T00:00:00Z" });
  assert.ok(!("error" in noMenu));
  if ("error" in noMenu) return;
  assert.ok(noMenu.notFound.includes("menu"));
  const m = menuFromRows([["Section", "Dish", "Price", "Description"], ["Mains", "Plov", "$14", "Rice and lamb"], ["Mains", "Lagman", "$13", ""], ["Sides", "Naan", "$3", ""]]);
  assert.ok(m.ok);
  if (!m.ok) return;
  const out = withMenu(noMenu.brief, m.categories);
  assert.ok("brief" in out);
  if (!("brief" in out)) return;
  const b = out.brief as Record<string, any>;
  assert.equal(b.menu.categories[0].items[0].description, "Rice and lamb");
  assert.ok(!(b.not_found as string[]).includes("menu"));
  assert.equal(b.menu.highlights.length, 0);
  assert.match(localPlanText(out.brief), /Menu/);
  // Highlights now come from the real dishes, as colour blocks, in template mode.
});

await test("an .xlsx is read: first sheet by its relationship, inline and rich text, entities, gaps, numbers as stored", () => {
  const sheet = '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Section</t></is></c><c r="B1" t="inlineStr"><is><t>Dish</t></is></c><c r="C1" t="inlineStr"><is><t>Price</t></is></c></row>'
    + '<row r="3"><c r="A3" t="inlineStr"><is><r><t>Mai</t></r><r><t>ns</t></r></is></c><c r="B3" t="inlineStr"><is><t>Fish &amp; Chips</t></is></c><c r="C3"><v>12.5</v></c></row></sheetData></worksheet>';
  const bytes = zipSync({
    "xl/workbook.xml": strToU8('<workbook><sheets><sheet name="Menu" sheetId="1" r:id="rId7"/></sheets></workbook>'),
    "xl/_rels/workbook.xml.rels": strToU8('<Relationships><Relationship Id="rId7" Target="worksheets/sheet2.xml"/></Relationships>'),
    "xl/worksheets/sheet2.xml": strToU8(sheet),
    "xl/worksheets/sheet1.xml": strToU8("<worksheet><sheetData><row r=\"1\"><c r=\"A1\" t=\"inlineStr\"><is><t>WRONG SHEET</t></is></c></row></sheetData></worksheet>"),
  });
  const rows = readXlsx(bytes);
  assert.deepEqual(rows[0], ["Section", "Dish", "Price"]);
  assert.deepEqual(rows[2], ["Mains", "Fish & Chips", "12.5"]);
  const m = menuFromRows(rows);
  assert.ok(m.ok && m.categories[0].items[0].name === "Fish & Chips" && m.categories[0].items[0].price === "12.5");
  assert.throws(() => readXlsx(new Uint8Array([1, 2, 3])));
  assert.throws(() => readXlsx(zipSync({ "readme.txt": strToU8("x") })), /No sheet/);
});

if (failed) { console.log(failed + " failed"); process.exit(1); }
console.log("menu-sheet tests passed");
