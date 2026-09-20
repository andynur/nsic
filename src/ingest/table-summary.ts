// Table summary for the LLM (09 §3): column schema + 30 sample rows + per-column statistics.
import { renderTable } from "./docx.ts";

export function summarizeTable(name: string, rows: string[][], sampleRows = 30): string {
  if (!rows.length) return `### ${name}\n(empty)`;
  const header = rows[0]!;
  const body = rows.slice(1);
  const stats = header.map((h, i) => {
    const vals = body.map((r) => r[i] ?? "").filter((v) => v !== "");
    const nums = vals.map(Number).filter((n) => Number.isFinite(n));
    const distinct = new Set(vals).size;
    const numeric = nums.length === vals.length && vals.length > 0;
    return `- ${h || `(column ${i + 1})`}: ${vals.length} filled, ${distinct} distinct${numeric ? `, numeric min ${Math.min(...nums)} max ${Math.max(...nums)}` : vals.length ? `, e.g. "${vals[0]!.slice(0, 40)}"` : ""}`;
  });
  const sample = [header, ...body.slice(0, sampleRows)].map((r) => r.map((c) => c.replace(/\s+/g, " ").slice(0, 80)));
  return [`### ${name}`, `${body.length} data rows, ${header.length} columns.`, "Columns:", ...stats, "", `Sample of ${Math.min(sampleRows, body.length)} rows:`, renderTable(sample)].join("\n");
}

export function tableToMarkdown(name: string, rows: string[][]): string {
  return rows.length ? `### ${name}\n\n${renderTable(rows.map((r) => r.map((c) => c.replace(/\|/g, "\\|").replace(/\r?\n/g, " "))))}` : `### ${name}\n(empty)`;
}
