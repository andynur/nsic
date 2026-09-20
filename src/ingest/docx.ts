// DOCX → Markdown: paragraphs, localized heading styles, lists, tables. Images are extracted as child files.
import { ZipReader } from "../lib/zip.ts";
import { attr, xmlTokens } from "./xml-tokens.ts";

export type DocxResult = { markdown: string; images: { name: string; data: Uint8Array }[] };

export function docxToMarkdown(buf: Uint8Array): DocxResult {
  const zip = new ZipReader(buf);
  const xml = zip.text("word/document.xml");
  if (!xml) throw new Error("word/document.xml not found");
  const out: string[] = [];
  let para = "";
  let style = "";
  let isList = false;
  let inText = false;
  // tables
  let tableDepth = 0;
  let rows: string[][] = [];
  let row: string[] = [];
  let cell: string[] = [];

  const endPara = () => {
    const text = para.replace(/[ \t]+/g, " ").trim();
    if (tableDepth > 0) {
      if (text) cell.push(text);
    } else if (text) {
      const h = /heading\s*(\d)|judul\s*(\d)|^title$/i.exec(style);
      if (h) out.push(`${"#".repeat(Math.min(6, Number(h[1] ?? h[2] ?? 1)))} ${text}`);
      else if (isList) out.push(`- ${text}`);
      else out.push(text);
    }
    para = "";
    style = "";
    isList = false;
  };

  for (const t of xmlTokens(xml)) {
    if (t.kind === "text") {
      if (inText) para += t.text;
      continue;
    }
    const n = t.name;
    if (n === "w:t" || n === "w:delText") inText = t.kind === "open";
    else if (n === "w:tab" && t.kind !== "close") para += "\t";
    else if ((n === "w:br" || n === "w:cr") && t.kind !== "close") para += " ";
    else if (n === "w:pStyle" && t.kind !== "close") style = attr(t.attrs, "w:val") ?? "";
    else if (n === "w:numPr" && t.kind !== "close") isList = true;
    else if (n === "w:p" && t.kind === "close") endPara();
    else if (n === "w:tbl") {
      if (t.kind === "open") {
        tableDepth++;
        if (tableDepth === 1) rows = [];
      } else if (t.kind === "close") {
        tableDepth--;
        if (tableDepth === 0 && rows.length) out.push(renderTable(rows));
      }
    } else if (n === "w:tr" && tableDepth === 1) {
      if (t.kind === "open") row = [];
      else if (t.kind === "close") rows.push(row);
    } else if (n === "w:tc" && tableDepth === 1) {
      if (t.kind === "open") cell = [];
      else if (t.kind === "close") row.push(cell.join(" ").replace(/\|/g, "\\|"));
    }
  }
  const images = zip
    .names()
    .filter((n) => n.startsWith("word/media/"))
    .map((n) => ({ name: n.slice("word/media/".length), data: zip.read(n)! }));
  return { markdown: out.join("\n\n"), images };
}

export function renderTable(rows: string[][]): string {
  const w = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]) => [...r, ...Array(w - r.length).fill("")];
  const [head, ...body] = rows.map(pad);
  return [`| ${head!.join(" | ")} |`, `|${" --- |".repeat(w)}`, ...body.map((r) => `| ${r.join(" | ")} |`)].join("\n");
}
