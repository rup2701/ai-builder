/**
 * A menu from a spreadsheet. Code reads the rows; no model is involved and nothing is guessed.
 * Columns are found by their header names (Section, Dish, Price, Description). Dish names, prices and descriptions are used exactly as they are in the file.
 * A row that cannot be used is skipped and listed back to the owner, never repaired.
 */

export type SheetItem = { name: string; price?: string; description?: string };
export type SheetCategory = { name: string; items: SheetItem[] };
export type SheetMenu = { ok: true; categories: SheetCategory[]; dishes: number; skipped: string[] } | { ok: false; error: string };

export const MAX_SHEET_BYTES = 1_000_000;
const MAX_ROWS = 500;
const MAX_SECTIONS = 12;
const MAX_PER_SECTION = 40;

const COLS: Record<"section" | "name" | "price" | "description", string[]> = {
  section: ["section", "category", "course", "menu section", "group", "type"],
  name: ["dish", "item", "name", "dish name", "item name", "product"],
  price: ["price", "cost", "amount"],
  description: ["description", "details", "desc", "about"],
};

/** A comma, semicolon or tab separated file to rows. Quoted cells may hold commas, doubled quotes and line breaks. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const first = src.split(/\r?\n/, 1)[0] ?? "";
  const count = (ch: string) => first.split(ch).length - 1;
  const sep = count("\t") >= 1 && count("\t") >= count(",") ? "\t" : count(";") > count(",") ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      rows.push(row); row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const clean = (s: unknown): string => String(s ?? "").replace(/\s+/g, " ").trim();
const header = (s: unknown): string => clean(s).toLowerCase().replace(/[^a-z ]/g, "").trim();
/** Text that must not reach the page: markup and links. A dish list has no use for either. */
const unsafe = (s: string): boolean => /[<>]|https?:\/\/|www\./i.test(s);

export function menuFromRows(input: unknown[][]): SheetMenu {
  const rows = input.map((r) => r.map(clean));
  while (rows.length && rows[0].every((c) => c === "")) rows.shift();
  if (!rows.length) return { ok: false, error: "The file is empty." };
  if (rows.length > MAX_ROWS + 1) return { ok: false, error: `That is a very long file. Keep it under ${MAX_ROWS} rows for now.` };

  const head = rows[0].map(header);
  const col = (k: keyof typeof COLS): number => head.findIndex((h) => COLS[k].includes(h));
  const iName = col("name");
  if (iName < 0) return { ok: false, error: "I could not find the dish column. The first row should name the columns: Section, Dish, Price, Description. Only Dish is required." };
  const iSection = col("section");
  const iPrice = col("price");
  const iDesc = col("description");

  const cats: SheetCategory[] = [];
  const skipped: string[] = [];
  let last = "";
  rows.slice(1).forEach((r, k) => {
    const n = k + 2; // the row number as the owner sees it in the sheet
    if (r.every((c) => c === "")) return;
    const name = clean(r[iName]);
    const section = (iSection >= 0 ? clean(r[iSection]) : "") || last || "Menu";
    const price = iPrice >= 0 ? clean(r[iPrice]) : "";
    const description = iDesc >= 0 ? clean(r[iDesc]) : "";
    if (!name) return void skipped.push(`row ${n} has no dish name`);
    if (name.length > 80) return void skipped.push(`row ${n}: the dish name is too long`);
    if (section.length > 40) return void skipped.push(`row ${n}: the section name is too long`);
    if (price.length > 20) return void skipped.push(`row ${n}: the price is too long`);
    if (description.length > 200) return void skipped.push(`row ${n}: the description is longer than 200 characters`);
    if ([name, section, price, description].some(unsafe)) return void skipped.push(`row ${n} has a link or markup in it`);
    last = section;
    let cat = cats.find((c) => c.name === section);
    if (!cat) { cat = { name: section, items: [] }; cats.push(cat); }
    if (cat.items.length >= MAX_PER_SECTION) return void skipped.push(`row ${n}: ${section} already has ${MAX_PER_SECTION} dishes`);
    cat.items.push({ name, ...(price ? { price } : {}), ...(description ? { description } : {}) });
  });
  const kept = cats.filter((c) => c.items.length > 0);
  if (!kept.length) return { ok: false, error: "I found no dishes in the file." + (skipped.length ? ` Skipped: ${skipped.slice(0, 5).join("; ")}.` : "") };
  if (kept.length > MAX_SECTIONS) return { ok: false, error: `That has ${kept.length} sections. Keep it to ${MAX_SECTIONS} or fewer for now.` };
  return { ok: true, categories: kept, dishes: kept.reduce((n, c) => n + c.items.length, 0), skipped };
}

/** A cell from an Excel file as text. A number is written as it is stored, so 12.5 stays 12.5. Dates and other types are not menu content. */
export const cellText = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : "");

/** The owner-facing summary of what was read. */
export function menuSummary(m: Extract<SheetMenu, { ok: true }>, file: string): string {
  const sections = m.categories.length;
  const lines = [`I read ${m.dishes} dish${m.dishes === 1 ? "" : "es"} in ${sections} section${sections === 1 ? "" : "s"} from ${file}.`];
  if (m.skipped.length) lines.push(`I skipped ${m.skipped.length} row${m.skipped.length === 1 ? "" : "s"}: ${m.skipped.slice(0, 6).join("; ")}${m.skipped.length > 6 ? "; and more" : ""}. Fix those in the file and send it again if you want them in.`);
  if (m.categories.some((c) => c.items.some((i) => i.price && /^\d+(\.\d+)?$/.test(i.price)))) lines.push("Some prices are plain numbers, so they appear as written, with no currency sign. Type them as text, like $12.50, if you want that on the page.");
  return lines.join(" ");
}
