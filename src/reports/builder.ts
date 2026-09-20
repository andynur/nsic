// Build report artifacts from a draft (12 §5): PDF, XLSX, MD, and the issue ZIP bundle.
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { dataPath, issueDir, relData, writeData } from "../lib/fs.ts";
import { findSecrets } from "../lib/redact-secrets.ts";
import { type Result, ok, appErr } from "../lib/result.ts";
import { insertArtifact, listArtifacts, type Artifact } from "../db/repo/artifacts.ts";
import { getIssue } from "../db/repo/issues.ts";
import { listEvidence } from "../db/repo/evidence.ts";
import { listEntities } from "../db/repo/entities.ts";
import { getReportDraft, updateReportDraft } from "../db/repo/reports.ts";
import { audit } from "../db/repo/audit.ts";
import { writeZip } from "../lib/zip.ts";
import { applyOverrides } from "./narrative.ts";
import { renderReportHtml } from "./html.ts";
import { renderMarkdown } from "./md.ts";
import { htmlFileToPdf } from "./pdf.ts";
import { writeXlsx, type SheetData } from "./xlsx.ts";
import { levelLabel, type ReportModel, type ReportOptions } from "./model.ts";

/** Internal patterns that must never reach a client audience (12 §6). */
const CLIENT_LEAKS = [/\/Users\/[^\s<"]+/, /[A-Z]:\\\\Users\\\\/, /\bnsic\/[A-Za-z0-9._-]+\b/, /\bdata\/issues\//];

export function checkClientSafe(text: string): string[] {
  const hits = findSecrets(text);
  for (const re of CLIENT_LEAKS) if (re.test(text)) hits.push(`internal:${re.source.slice(0, 20)}`);
  return hits;
}

export function xlsxSheets(m: ReportModel): SheetData[] {
  const sheets: SheetData[] = [
    {
      name: "Summary",
      header: ["Field", "Value"],
      rows: [
        ["Issue key", m.meta.issueKey],
        ["Title", m.meta.title],
        ["Finding", m.narrative.titleClaim],
        ["Answer", m.answer.oneLine],
        ["Status", m.answer.status],
        ["Evidence level", levelLabel(m.answer.evidenceLevel)],
        ["Root cause", m.answer.rootCause ?? ""],
        ["Fix", m.answer.fix ?? ""],
        ["Verification", m.answer.verification ?? ""],
        ["Environment", m.meta.environment ?? ""],
        ["Prepared", new Date(m.meta.preparedAt)],
      ],
    },
    { name: "Timeline", header: ["Time", "Actor", "Event", "Detail"], rows: m.timeline.map((t) => [new Date(t.at), t.actor, t.event, t.detail]) },
    { name: "Evidence", header: ["ID", "Level", "Kind", "Title", "Summary", "Reference", "Status", "Artifacts"], rows: m.evidence.map((e) => [`#E${e.seq}`, e.level, e.kind, e.title, e.body, e.ref, e.status, e.artifactIds.join(", ")]) },
    { name: "Steps", header: ["No", "Caption", "Status", "Detected error", "Screenshot file"], rows: m.steps.map((s) => [s.index, s.caption, s.status, s.note ?? "", s.screenshotPath ? s.screenshotPath.split("/").pop() : ""]) },
  ];
  if (m.usage) sheets.push({ name: "Token Usage", header: ["Time", "Purpose", "Model", "Input", "Output", "Cache write", "Cache read", "Cost (USD)"], rows: m.usage.calls.map((c) => [new Date(c.at), c.purpose, c.model, c.input, c.output, c.cacheWrite, c.cacheRead, Number(c.cost.toFixed(6))]) });
  return sheets;
}

export async function buildReport(draftId: string): Promise<Result<Artifact[]>> {
  const draft = getReportDraft(draftId);
  if (!draft) return appErr("not_found", "report draft not found");
  const opts = draft.options as unknown as ReportOptions;
  const m = applyOverrides(draft.model as unknown as ReportModel, draft.overrides);
  const issue = getIssue(draft.issue_id)!;
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const base = `${issue.key}-${opts.audience}-${stamp}`;
  const dirRel = issueDir(issue.id, "reports");
  const out: Artifact[] = [];
  const add = (kind: Artifact["kind"], rel: string, mime: string, size: number, caption: string) => out.push(insertArtifact({ issue_id: issue.id, run_id: null, kind, step_index: null, caption, storage_path: rel, mime, size_bytes: size, redacted: opts.audience === "client" }));

  const htmlAbs = dataPath(dirRel, `${base}.html`);
  const html = renderReportHtml(m, (_id, p) => pathToFileURL(dataPath(p)).toString());
  if (opts.audience === "client") {
    const leaks = checkClientSafe(html);
    if (leaks.length) return appErr("client_leak", `Report held: internal or secret content detected (${leaks.join(", ")}). Edit the narrative or mark the evidence private.`);
  }
  await writeData(relData(htmlAbs), html);

  if (opts.formats.includes("pdf")) {
    const pdf = await htmlFileToPdf(htmlAbs, `${issue.key} · ${m.meta.brandName}`);
    if (!pdf.ok) return pdf;
    const rel = join(dirRel, `${base}.pdf`);
    await writeData(rel, pdf.value);
    add("report_pdf", rel, "application/pdf", pdf.value.length, `Report PDF (${opts.audience})`);
  }
  if (opts.formats.includes("xlsx")) {
    const x = writeXlsx(xlsxSheets(m));
    const rel = join(dirRel, `${base}.xlsx`);
    await writeData(rel, x);
    add("report_xlsx", rel, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", x.length, `Report XLSX (${opts.audience})`);
  }
  if (opts.formats.includes("md")) {
    const md = renderMarkdown(m);
    const rel = join(dirRel, `${base}.md`);
    await writeData(rel, md);
    add("report_md", rel, "text/markdown", md.length, `Report Markdown (${opts.audience})`);
  }
  if (opts.formats.includes("zip")) {
    const entries: { name: string; data: Uint8Array }[] = [];
    const enc = new TextEncoder();
    entries.push({ name: "issue.json", data: enc.encode(JSON.stringify({ issue: opts.audience === "client" ? { key: issue.key, title: issue.title, status: issue.status, evidence_level: issue.evidence_level, root_cause: issue.root_cause } : issue, evidence: listEvidence(issue.id, { publicOnly: opts.audience === "client" }), entities: opts.audience === "client" ? [] : listEntities(issue.id), report: m }, null, 1)) });
    entries.push({ name: `${base}.html`, data: enc.encode(renderReportHtml(m, (_id, p) => `artifacts/${p.split("/").pop()}`)) });
    for (const a of [...listArtifacts(issue.id), ...out]) {
      if (a.kind === "bundle_zip") continue;
      if (opts.redactedOnly && ["screenshot", "video"].includes(a.kind) && !a.redacted) continue;
      const f = Bun.file(dataPath(a.storage_path));
      if (!(await f.exists()) || f.size > 200 * 1024 * 1024) continue;
      entries.push({ name: `artifacts/${a.storage_path.split("/").pop()}`, data: new Uint8Array(await f.arrayBuffer()) });
    }
    const z = writeZip(entries);
    const rel = join(dirRel, `${base}.zip`);
    await writeData(rel, z);
    add("bundle_zip", rel, "application/zip", z.length, `Issue bundle (${opts.audience})`);
  }
  updateReportDraft(draftId, { status: "final" });
  audit("user", "export.create", { issueId: issue.id, detail: { draftId, formats: opts.formats, audience: opts.audience } });
  return ok(out);
}
