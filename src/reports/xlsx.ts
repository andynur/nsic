// Minimal XLSX writer (12 §4): shared strings, numbers, dates (serial), bold header, frozen row 1, column widths, autofilter.
import { writeZip } from "../lib/zip.ts";

export type Cell = string | number | Date | null | undefined;
export type SheetData = { name: string; header: string[]; rows: Cell[][] };

const CTRL = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g;
const x = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!).replace(CTRL, "");
export const colName = (i: number) => {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
/** Excel date serial (1900 system) from epoch ms (UTC). */
export const excelSerial = (d: Date) => d.getTime() / 86400000 + 25569;

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

export function writeXlsx(sheets: SheetData[]): Uint8Array {
  const strings: string[] = [];
  const idx = new Map<string, number>();
  const si = (s: string) => {
    let i = idx.get(s);
    if (i === undefined) {
      i = strings.length;
      strings.push(s);
      idx.set(s, i);
    }
    return i;
  };
  const enc = new TextEncoder();
  const safeName = (n: string, i: number) => x(n.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || `Sheet${i + 1}`);

  const sheetXml = sheets.map((sh) => {
    const all: Cell[][] = [sh.header, ...sh.rows];
    const widths = sh.header.map((_, c) => Math.min(80, Math.max(8, ...all.map((r) => (r[c] instanceof Date ? 16 : String(r[c] ?? "").length + 2)))));
    const rows = all
      .map((r, ri) => {
        const cells = r
          .map((v, ci) => {
            const ref = `${colName(ci)}${ri + 1}`;
            if (v === null || v === undefined || v === "") return "";
            const style = ri === 0 ? ' s="1"' : "";
            if (v instanceof Date) return `<c r="${ref}" s="2"><v>${excelSerial(v)}</v></c>`;
            if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"${style}><v>${v}</v></c>`;
            return `<c r="${ref}" t="s"${style}><v>${si(String(v).slice(0, 32000))}</v></c>`;
          })
          .join("");
        return `<row r="${ri + 1}">${cells}</row>`;
      })
      .join("");
    const lastCol = colName(Math.max(0, sh.header.length - 1));
    return (
      XML_HEAD +
      `<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
      `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
      `<sheetFormatPr defaultRowHeight="15"/>` +
      `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` +
      `<sheetData>${rows}</sheetData>` +
      (all.length > 1 ? `<autoFilter ref="A1:${lastCol}${all.length}"/>` : "") +
      `</worksheet>`
    );
  });

  const definedNames = sheets
    .map((s, i) => (s.rows.length ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${safeName(s.name, i)}'!$A$1:$${colName(s.header.length - 1)}$${s.rows.length + 1}</definedName>` : ""))
    .join("");

  const files: { name: string; data: Uint8Array }[] = [
    {
      name: "[Content_Types].xml",
      data: enc.encode(
        XML_HEAD +
          `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>` +
          sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
          `</Types>`,
      ),
    },
    { name: "_rels/.rels", data: enc.encode(XML_HEAD + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
    {
      name: "xl/workbook.xml",
      data: enc.encode(XML_HEAD + `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><sheets>${sheets.map((s, i) => `<sheet name="${safeName(s.name, i)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>${definedNames ? `<definedNames>${definedNames}</definedNames>` : ""}</workbook>`),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: enc.encode(
        XML_HEAD +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${NS_REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
          `<Relationship Id="rId${sheets.length + 1}" Type="${NS_REL}/styles" Target="styles.xml"/><Relationship Id="rId${sheets.length + 2}" Type="${NS_REL}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
      ),
    },
    {
      name: "xl/styles.xml",
      data: enc.encode(
        XML_HEAD +
          `<styleSheet xmlns="${NS_MAIN}"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`,
      ),
    },
  ];
  sheetXml.forEach((xml, i) => files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc.encode(xml) }));
  files.push({ name: "xl/sharedStrings.xml", data: enc.encode(XML_HEAD + `<sst xmlns="${NS_MAIN}" count="${strings.length}" uniqueCount="${strings.length}">${strings.map((s) => `<si><t xml:space="preserve">${x(s)}</t></si>`).join("")}</sst>`) });
  return writeZip(files);
}
