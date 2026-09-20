// XLSX → one table per sheet: sharedStrings + worksheets. Formulas: use the cached <v> value.
import { ZipReader } from "../lib/zip.ts";
import { attr, xmlTokens } from "./xml-tokens.ts";

export type Sheet = { name: string; rows: string[][] };

export function colIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function sharedStrings(zip: ZipReader): string[] {
  const xml = zip.text("xl/sharedStrings.xml");
  if (!xml) return [];
  const out: string[] = [];
  let cur = "";
  let inT = false;
  let inRph = false;
  for (const t of xmlTokens(xml)) {
    if (t.kind === "text") {
      if (inT && !inRph) cur += t.text;
    } else if (t.name === "si") {
      if (t.kind === "open") cur = "";
      else if (t.kind === "close") out.push(cur);
      else out.push("");
    } else if (t.name === "t") inT = t.kind === "open";
    else if (t.name === "rPh") inRph = t.kind === "open";
  }
  return out;
}

function sheetTargets(zip: ZipReader): { name: string; path: string }[] {
  const wb = zip.text("xl/workbook.xml") ?? "";
  const rels = zip.text("xl/_rels/workbook.xml.rels") ?? "";
  const relMap = new Map<string, string>();
  for (const t of xmlTokens(rels)) {
    if ((t.kind === "open" || t.kind === "self") && t.name === "Relationship") {
      const id = attr(t.attrs, "Id");
      const target = attr(t.attrs, "Target");
      if (id && target) relMap.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`);
    }
  }
  const out: { name: string; path: string }[] = [];
  for (const t of xmlTokens(wb)) {
    if ((t.kind === "open" || t.kind === "self") && t.name === "sheet") {
      const rid = attr(t.attrs, "r:id");
      const p = rid ? relMap.get(rid) : undefined;
      if (p) out.push({ name: attr(t.attrs, "name") ?? p, path: p });
    }
  }
  if (!out.length) for (const n of zip.names().filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()) out.push({ name: n.replace(/^.*\/|\.xml$/g, ""), path: n });
  return out;
}

export function readXlsx(buf: Uint8Array, maxRowsPerSheet = 100_000): Sheet[] {
  const zip = new ZipReader(buf);
  const ss = sharedStrings(zip);
  return sheetTargets(zip).map(({ name, path }) => {
    const xml = zip.text(path) ?? "";
    const rows: string[][] = [];
    let row: string[] | null = null;
    let col = 0;
    let type = "";
    let val = "";
    let inV = false;
    let inIsT = false;
    for (const t of xmlTokens(xml)) {
      if (t.kind === "text") {
        if (inV || inIsT) val += t.text;
        continue;
      }
      if (t.name === "row") {
        if (t.kind === "open") {
          const r = Number(attr(t.attrs, "r") ?? rows.length + 1);
          while (rows.length < r - 1) rows.push([]);
          row = [];
          col = 0;
        } else if (t.kind === "close" && row) {
          if (rows.length < maxRowsPerSheet) rows.push(row);
          row = null;
        }
      } else if (t.name === "c" && row) {
        if (t.kind !== "close") {
          const ref = attr(t.attrs, "r");
          col = ref ? colIndex(ref) : row.length;
          type = attr(t.attrs, "t") ?? "";
          val = "";
        }
        if (t.kind !== "open") {
          let v = val;
          if (type === "s") v = ss[Number(val)] ?? "";
          else if (type === "b") v = val === "1" ? "TRUE" : "FALSE";
          while (row.length < col) row.push("");
          row[col] = v;
        }
      } else if (t.name === "v") inV = t.kind === "open";
      else if (t.name === "t" && type === "inlineStr") inIsT = t.kind === "open";
    }
    while (rows.length && rows[rows.length - 1]!.every((c) => c === "")) rows.pop();
    return { name, rows };
  });
}
