// ReportModel (12 §2): one data model for every format.
import { getIssue } from "../db/repo/issues.ts";
import { getProject } from "../db/repo/projects.ts";
import { getEnvironment, latestAccessProfile } from "../db/repo/environments.ts";
import { listEvidence } from "../db/repo/evidence.ts";
import { listArtifacts, listRuns, listRunArtifacts } from "../db/repo/artifacts.ts";
import { listSessions, listSteps } from "../db/repo/sessions.ts";
import { listMessages } from "../db/repo/threads.ts";
import { issueByPurpose, issueCalls, issueTotals } from "../db/repo/usage.ts";
import { getSetting } from "../db/repo/settings.ts";
import { listAudit } from "../db/repo/audit.ts";

export type Audience = "internal" | "client";
export type ReportFormat = "pdf" | "xlsx" | "md" | "zip";
export type ReportOptions = { audience: Audience; includeCost: boolean; redactedOnly: boolean; formats: ReportFormat[] };

export type ReportModel = {
  meta: { issueKey: string; title: string; project: string; client: string | null; environment: string | null; envKind: string | null; preparedBy: string; preparedAt: number; audience: Audience; includeCost: boolean; brandName: string; timezone: string | null };
  answer: { status: string; evidenceLevel: number; oneLine: string; rootCause: string | null; fix: string | null; verification: string | null };
  timeline: { at: number; actor: string; event: string; detail: string }[];
  evidence: { id: string; seq: number; level: number; kind: string; title: string; body: string; ref: string; status: string; artifactIds: string[] }[];
  steps: { index: number; caption: string; screenshotPath: string | null; status: string; note: string | null; artifactId: string | null }[];
  beforeAfter: { step: string; before: string; after: string }[];
  qa: { question: string; answer: string }[];
  usage: {
    byPurpose: { purpose: string; tokens: number; cost: number }[];
    byModel: { model: string; tokens: number; cost: number }[];
    total: { tokens: number; cost: number };
    calls: { at: number; purpose: string; model: string; input: number; output: number; cacheWrite: number; cacheRead: number; cost: number }[];
  } | null;
  caveats: string[];
  narrative: { titleClaim: string; causeIntro: string; evidenceIntro: string; stepsIntro: string; fixIntro: string };
  artifacts: { id: string; kind: string; caption: string | null; path: string; redacted: boolean }[];
};

const LEVEL_NAME = ["Unverified", "Reported", "Observed", "Reproduced", "Root-caused", "Verified fix"];
export const levelLabel = (l: number) => `E${l} · ${LEVEL_NAME[l] ?? ""}`;

type RunStep = { index: number; caption?: string; action: string; status: string; note?: string; screenshotArtifactId?: string; errors?: { codes: string[] } };

function refText(ref: Record<string, unknown> | null, audience: Audience): string {
  if (!ref) return "";
  const r = { ...ref };
  if (audience === "client") {
    delete r.branch;
    delete r.files;
    delete r.run_id;
    delete r.attachments;
    if (typeof r.file === "string") r.file = r.file.split("/").pop();
  }
  if (r.file && r.line) return `${r.file}:${r.line}`;
  if (r.scriptid) return String(r.scriptid);
  if (r.query) return String(r.query).slice(0, 160);
  return Object.entries(r)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(", ")
    .slice(0, 200);
}

/** Agent transitions shown to a client: [from state, event label, include the summary]. */
const CLIENT_MILESTONES: [string, string, boolean][] = [
  ["TRIAGE", "Investigation started", false],
  ["ROOT_CAUSE", "Root cause identified", false],
  ["REPORT_DRAFT", "Findings summarized", true],
  ["VERIFY", "Fix verified", false],
];

/** The stored root cause may end with a "**Limitations**" list (report-draft.ts); those belong in the Limitations section only. */
export function splitRootCause(text: string): { body: string; limitations: string[] } {
  const m = /\n*\*\*Limitations\*\*\n((?:- .*(?:\n|$))+)\s*$/.exec(text);
  if (!m) return { body: text, limitations: [] };
  return { body: text.slice(0, m.index).trimEnd(), limitations: m[1]!.split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2).trim()) };
}

/** The report already titles this section "Cause"; drop a leading heading that repeats it. */
export function stripLeadingHeading(md: string): string {
  return md.replace(/^#{1,6}\s*(root\s+)?cause\s*\n+/i, "");
}

export function buildReportModel(issueId: string, opts: ReportOptions): ReportModel {
  const issue = getIssue(issueId);
  if (!issue) throw new Error("issue not found");
  const project = getProject(issue.project_id)!;
  const env = issue.environment_id ? getEnvironment(issue.environment_id) : null;
  const client = opts.audience === "client";
  const evidence = listEvidence(issueId, { includeRejected: false, publicOnly: client });

  // Reproduce steps: the latest capture run, falling back to the reproduce run.
  const runs = listRuns(issueId);
  const capture = runs.find((r) => r.mode === "capture" && r.status !== "running") ?? runs.find((r) => r.mode === "reproduce" && r.status !== "running");
  const stepsRes = ((capture?.result as { steps?: RunStep[] } | null)?.steps ?? []);
  const arts = capture ? listRunArtifacts(capture.id) : [];
  const steps = stepsRes.map((s) => {
    const a = arts.find((x) => x.id === s.screenshotArtifactId);
    const allowed = !!a && (!opts.redactedOnly || a.redacted);
    return { index: s.index, caption: s.caption ?? s.action, screenshotPath: allowed ? a!.storage_path : null, status: s.status, note: s.note ?? null, artifactId: allowed ? a!.id : null };
  });

  const before = runs.find((r) => r.mode === "verify_before");
  const after = runs.find((r) => r.mode === "verify_after");
  const beforeAfter: ReportModel["beforeAfter"] = [];
  if (before && after) {
    const bs = (before.result as { steps?: RunStep[] } | null)?.steps ?? [];
    const as = (after.result as { steps?: RunStep[] } | null)?.steps ?? [];
    const desc = (x: RunStep | undefined) => (x ? `${x.status}${x.errors?.codes.length ? ` (${x.errors.codes.join(", ")})` : ""}` : "-");
    bs.forEach((b, i) => beforeAfter.push({ step: b.caption ?? b.action, before: desc(b), after: desc(as[i]) }));
  }

  const timeline: ReportModel["timeline"] = [{ at: issue.created_at, actor: "Developer", event: "Issue created", detail: issue.title }];
  for (const s of [...listSessions(issueId)].reverse()) {
    for (const st of listSteps(s.id)) {
      if (st.kind !== "transition" && st.kind !== "checkpoint") continue;
      // A client sees milestones only; agent state names and plans are internal.
      if (client) {
        const m = CLIENT_MILESTONES.find(([from]) => st.kind === "transition" && st.title?.startsWith(`${from} →`));
        if (m) timeline.push({ at: st.started_at, actor: "Investigation", event: m[1], detail: m[2] ? (st.summary ?? "").slice(0, 300) : "" });
      } else timeline.push({ at: st.started_at, actor: "Agent", event: st.title ?? st.state, detail: (st.summary ?? "").slice(0, 300) });
    }
  }
  for (const r of runs) timeline.push({ at: r.started_at, actor: "Runner", event: `Browser run ${r.mode}`, detail: r.status });
  if (!client) for (const a of listAudit({ issueId, action: "browser.blocked" }).slice(0, 20)) timeline.push({ at: a.at, actor: "Guard", event: "Action blocked", detail: String(a.detail?.reason ?? "") });
  if (issue.resolved_at) timeline.push({ at: issue.resolved_at, actor: "Developer", event: "Issue resolved", detail: issue.resolution ?? "" });
  timeline.sort((a, b) => a.at - b.at);

  const qa = listMessages(issueId, "consultant")
    .filter((m) => m.role === "assistant" && m.meta?.faq === true)
    .map((m) => ({ question: String(m.meta?.question ?? ""), answer: m.content }));

  let usage: ReportModel["usage"] = null;
  if (opts.includeCost && !client) {
    const t = issueTotals(issueId);
    const calls = issueCalls(issueId);
    const byModel = new Map<string, { tokens: number; cost: number }>();
    for (const c of calls) {
      const m = byModel.get(c.model) ?? { tokens: 0, cost: 0 };
      m.tokens += c.input_tokens + c.output_tokens + c.cache_read_tokens + c.cache_write_tokens;
      m.cost += c.cost_usd;
      byModel.set(c.model, m);
    }
    usage = {
      byPurpose: issueByPurpose(issueId).map((p) => ({ purpose: p.purpose, tokens: p.input_tokens + p.output_tokens + p.cache_read_tokens + p.cache_write_tokens, cost: p.cost_usd })),
      byModel: [...byModel].map(([model, v]) => ({ model, ...v })),
      total: { tokens: t.input_tokens + t.output_tokens + t.cache_read_tokens + t.cache_write_tokens, cost: t.cost_usd },
      calls: calls.map((c) => ({ at: c.created_at, purpose: c.purpose, model: c.model, input: c.input_tokens, output: c.output_tokens, cacheWrite: c.cache_write_tokens, cacheRead: c.cache_read_tokens, cost: c.cost_usd })),
    };
  }

  const caveats: string[] = [];
  const profile = env ? latestAccessProfile(env.id) : null;
  if (!env) caveats.push("The issue isn't linked to a NetSuite environment; the analysis is based on attachments and code only.");
  else if (!profile || profile.tier === "none") caveats.push("No validated NetSuite access yet; live evidence (data, logs, reproduction) is unavailable.");
  else if (profile.tier === "C") caveats.push("UI access only; data queries and execution logs are unavailable.");
  else if (profile.tier === "P") caveats.push("Production was accessed read-only; the fix was not tested directly in this account.");
  if (issue.evidence_level < 3) caveats.push("The issue has not been reproduced yet; conclusions still rely on the report and on code or data analysis.");
  if (issue.evidence_level === 4) caveats.push("The fix has not yet been verified with a replay in sandbox.");

  const split = splitRootCause(issue.root_cause ?? "");
  for (const l of split.limitations) if (!caveats.includes(l)) caveats.push(l);
  const [firstLine, ...rest] = split.body.split("\n\n");
  const fixEv = evidence.find((e) => e.kind === "deploy_result" || e.kind === "test_result");
  const verEv = evidence.find((e) => e.level === 5);
  const claim = firstLine?.trim() || issue.title;
  return {
    meta: {
      issueKey: issue.key,
      title: issue.title,
      project: project.name,
      client: project.client_name,
      environment: env?.name ?? null,
      envKind: env?.kind ?? null,
      preparedBy: getSetting("report.prepared_by", "NSIC"),
      preparedAt: Date.now(),
      audience: opts.audience,
      includeCost: !!usage,
      brandName: getSetting("report.brand_name", "NSIC"),
      timezone: env?.timezone ?? null,
    },
    answer: { status: issue.status, evidenceLevel: issue.evidence_level, oneLine: claim, rootCause: stripLeadingHeading(rest.join("\n\n").trim()) || null, fix: fixEv?.body ?? null, verification: verEv?.body ?? null },
    timeline,
    evidence: evidence.map((e) => ({ id: e.id, seq: e.seq ?? 0, level: e.level, kind: e.kind, title: e.title, body: e.body ?? "", ref: refText(e.ref, opts.audience), status: e.status, artifactIds: e.ref?.artifact_id ? [String(e.ref.artifact_id)] : [] })),
    steps,
    beforeAfter,
    qa,
    usage,
    caveats,
    narrative: { titleClaim: claim, causeIntro: "", evidenceIntro: `Evidence is ordered from the highest level, ${evidence.length} ${evidence.length === 1 ? "item" : "items"}.`, stepsIntro: steps.length ? "Each image shows one step; the clicked element is highlighted." : "", fixIntro: "" },
    artifacts: listArtifacts(issueId)
      .filter((a) => !opts.redactedOnly || a.redacted || !["screenshot", "video"].includes(a.kind))
      .map((a) => ({ id: a.id, kind: a.kind, caption: a.caption, path: a.storage_path, redacted: a.redacted })),
  };
}
