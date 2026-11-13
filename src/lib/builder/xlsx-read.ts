import { unzipSync } from "fflate";

/**
 * Reads the first sheet of an .xlsx file as rows of text, with no spreadsheet library: an .xlsx is a zip of small XML files.
 * Text cells keep their text, number cells keep the number as stored (14 stays 14, 13.5 stays 13.5). Formulas give their stored result.
 * Dates and everything else that is not text or a number come back empty. Only the few files needed are opened, each with a size cap.
 */

const MAX_FILE_BYTES = 8_000_000; // per file inside the zip, after unzipping
const MAX_CELLS = 20_000;

const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    const k = e.toLowerCase();
    if (k === "amp") return "&";
    if (k === "lt") return "<";
    if (k === "gt") return ">";
    if (k === "quot") return '"';
    if (k === "apos") return "'";
    const n = k.startsWith("#x") ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
  });

/** All the text inside the <t> elements of a fragment, joined (rich text is split over several). */
const textOf = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decodeEntities(m[1])).join("");

/** Column letters to a zero-based index: A is 0, Z is 25, AA is 26. */
const colIndex = (ref: string): number => {
  let n = 0;
  for (const ch of ref.replace(/[^A-Za-z]/g, "").toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

export function readXlsx(bytes: Uint8Array): string[][] {
  const wanted = (name: string) => name === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(name) || name === "xl/workbook.xml" || name === "xl/_rels/workbook.xml.rels";
  const files = unzipSync(bytes, { filter: (f) => wanted(f.name) && f.originalSize <= MAX_FILE_BYTES });
  const read = (name: string) => (files[name] ? new TextDecoder().decode(files[name]) : "");

  // The first sheet in the workbook, by its relationship; else sheet1.xml; else the lowest numbered sheet.
  let sheetPath = "";
  const first = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(read("xl/workbook.xml"));
  if (first) {
    const rel = new RegExp(`<Relationship\\b[^>]*\\bId="${first[1].replace(/[^\w-]/g, "")}"[^>]*>`).exec(read("xl/_rels/workbook.xml.rels"));
    const target = rel && /\bTarget="([^"]+)"/.exec(rel[0]);
    if (target) sheetPath = target[1].startsWith("/") ? target[1].slice(1) : "xl/" + target[1].replace(/^\.\//, "");
  }
  if (!files[sheetPath]) sheetPath = files["xl/worksheets/sheet1.xml"] ? "xl/worksheets/sheet1.xml" : Object.keys(files).filter((n) => n.startsWith("xl/worksheets/")).sort()[0] ?? "";
  if (!sheetPath) throw new Error("No sheet found in the file.");

  const shared = [...read("xl/sharedStrings.xml").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
  const rows: string[][] = [];
  let cells = 0;
  for (const rm of read(sheetPath).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      if (++cells > MAX_CELLS) throw new Error("That sheet is too big.");
      const attrs = cm[1];
      const ref = /\br="([A-Za-z]+\d+)"/.exec(attrs)?.[1];
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? "n";
      const body = cm[2] ?? "";
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = "";
      if (type === "s") value = v !== undefined ? shared[Number(v)] ?? "" : "";
      else if (type === "inlineStr") value = textOf(body);
      else if (type === "str") value = v !== undefined ? decodeEntities(v) : "";
      else if (type === "n" && v !== undefined && /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(v)) value = String(Number(v));
      const i = ref ? colIndex(ref) : row.length;
      while (row.length < i) row.push("");
      row[i] = value;
    }
    const r = /\br="(\d+)"/.exec(rm[0].slice(0, 200))?.[1];
    const at = r ? Number(r) - 1 : rows.length;
    while (rows.length < at) rows.push([]);
    rows[at] = row;
  }
  return rows;
}
