// Eval runner: replay historical issues through the real pipeline (ingest → agent session) against a fresh,
// throwaway data dir, then score each root cause and check the MVP gates.
// Usage: bun run eval [--case <id>] [--keep]
// The LLM engine comes from Settings; cost is only tracked with the Messages API engine.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { Database } from "bun:sqlite";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { parseArgs } from "node:util";

const ROOT = resolve(import.meta.dir, "..", "..");
const sourceDbPath = resolve(ROOT, process.env.DATA_DIR ?? "./data", "nsic.db");
const { values: args } = parseArgs({ options: { case: { type: "string" }, keep: { type: "boolean" } } });

// Isolate before any module reads config() or opens the DB.
const dataDir = mkdtempSync(join(tmpdir(), "nsic-eval-"));
process.env.DATA_DIR = dataDir;
process.env.NSIC_INPROCESS_JOBS = "1";
process.env.LOG_LEVEL = process.env.NSIC_EVAL_LOG_LEVEL ?? "warn"; // .env sets LOG_LEVEL; keep eval output readable

const { EvalCase, scoreOutcome, summarize } = await import("./score.ts");
type EvalCaseT = import("./score.ts").EvalCaseT;
const { db } = await import("../db/db.ts");
const { upsertPricing, listPricing, putSetting } = await import("../db/repo/settings.ts");
const { DEFAULT_PRICING, modelFor } = await import("../llm/models.ts");
const { llmStatus } = await import("../llm/anthropic.ts");
const { createProject } = await import("../db/repo/projects.ts");
const { createRepo } = await import("../db/repo/code.ts");
const { indexRepo } = await import("../repo/indexer.ts");
const { createIssue, getIssue } = await import("../db/repo/issues.ts");
const { listEvidence } = await import("../db/repo/evidence.ts");
const { countToolCalls, getSession } = await import("../db/repo/sessions.ts");
const { storeUpload, ingestIssue } = await import("../ingest/pipeline.ts");
const { startAgentSession } = await import("../agent/start.ts");
const { runSession } = await import("../agent/orchestrator.ts");
const { formatIssues } = await import("../lib/schema.ts");

db();
if (existsSync(sourceDbPath)) {
  const source = new Database(sourceDbPath, { readonly: true });
  try {
    const rows = source.query("SELECT key, value FROM settings WHERE key IN ('llm.engine', 'llm.models.api', 'llm.models.claude-code', 'llm.models.codex', 'models')").all() as { key: string; value: string }[];
    for (const row of rows) putSetting(row.key, JSON.parse(row.value) as unknown);
  } finally { source.close(); }
}
const llm = llmStatus();
if (!llm.ok) {
  console.error(`LLM not configured: ${llm.detail}`);
  process.exit(1);
}
if (listPricing().length === 0) for (const p of DEFAULT_PRICING) upsertPricing(p);

const casesDir = join(ROOT, "evals", "cases");
const cases: EvalCaseT[] = [];
for (const f of readdirSync(casesDir).filter((x) => x.endsWith(".json")).sort()) {
  const r = EvalCase.parse(JSON.parse(readFileSync(join(casesDir, f), "utf8")));
  if (!r.ok) {
    console.error(`${f}: ${formatIssues(r.error)}`);
    process.exit(1);
  }
  const c = r.value as EvalCaseT;
  if (!args.case || args.case === c.id) cases.push(c);
}
if (!cases.length) {
  console.error(args.case ? `No case with id ${args.case}` : "No cases in evals/cases");
  process.exit(1);
}

console.log(`NSIC eval · ${cases.length} case(s) · engine ${llm.engine} · agent model ${modelFor("agent_main")} · data ${dataDir}\n`);

const project = createProject({ name: "Eval", client_name: "Eval", key_prefix: "EVAL", default_budget_usd: 3 });
const repoIds = new Map<string, string>();

type Row = { id: string; score: ReturnType<typeof scoreOutcome>; metrics: import("./score.ts").RunMetrics; status: string; oneLine: string };
const rows: Row[] = [];

for (const c of cases) {
  const started = Date.now();
  process.stdout.write(`▸ ${c.id} … `);
  let repoId: string | undefined;
  if (c.repo) {
    const loc = isAbsolute(c.repo) ? c.repo : join(ROOT, c.repo);
    repoId = repoIds.get(loc);
    if (!repoId) {
      // Index each repo once. Cross-issue memory only holds resolved issues, so cases cannot see each other's answers.
      repoId = createRepo({ project_id: project.id, source: "local_path", location: loc }).id;
      await indexRepo(repoId);
      repoIds.set(loc, repoId);
    }
  }
  const issue = createIssue({ project_id: project.id, title: c.title, description: c.description, budget_usd: c.budget_usd ?? null });
  for (const a of c.attachments ?? []) {
    const p = join(ROOT, "evals", a);
    await storeUpload(issue.id, { name: basename(p), data: new Uint8Array(readFileSync(p)) }, "upload");
  }
  await ingestIssue(issue.id);
  const { session } = startAgentSession(issue.id, "manual");
  await runSession(session.id, new AbortController().signal);

  const done = getIssue(issue.id)!;
  const ev = listEvidence(issue.id);
  const score = scoreOutcome(c, {
    evidenceLevel: done.evidence_level,
    rootCause: done.root_cause ?? "",
    evidenceRefs: ev.map((e) => ({ level: e.level, file: (e.ref as { file?: string } | null)?.file, scriptid: (e.ref as { scriptid?: string } | null)?.scriptid })),
  });
  const calls = db().query("SELECT input_tokens, cache_read_tokens, cache_write_tokens, cost_usd FROM llm_calls WHERE issue_id = ?").all(issue.id) as { input_tokens: number; cache_read_tokens: number; cache_write_tokens: number; cost_usd: number | null }[];
  // Cost and cache numbers are only NSIC's own with the Messages API; a CLI engine reports its own session usage.
  const api = llm.engine === "api";
  const metrics = {
    costUsd: api ? calls.reduce((a, x) => a + (x.cost_usd ?? 0), 0) : null,
    llmCalls: calls.length,
    toolCalls: countToolCalls(session.id),
    inputTokensPerCall: calls.map((x) => x.input_tokens + x.cache_read_tokens + x.cache_write_tokens),
    input: calls.reduce((a, x) => a + x.input_tokens, 0),
    cacheRead: api ? calls.reduce((a, x) => a + x.cache_read_tokens, 0) : 0,
    cacheWrite: api ? calls.reduce((a, x) => a + x.cache_write_tokens, 0) : 0,
    durationMs: Date.now() - started,
  };
  const status = `${getSession(session.id)?.status ?? "?"} · E${done.evidence_level}`;
  rows.push({ id: c.id, score, metrics, status, oneLine: (done.root_cause ?? "").split("\n")[0]!.slice(0, 140) });
  console.log(`${score.pass ? "PASS" : "FAIL"} (${status}, ${(metrics.durationMs / 1000).toFixed(0)}s)`);
  if (!score.pass) {
    const why = [!score.levelOk && `level E${done.evidence_level} < E${c.expect.min_level}`, score.fileHit === false && `expected file not cited (${c.expect.files?.join(", ")})`, score.missing.length && `missing keywords: ${score.missing.join(", ")}`].filter(Boolean);
    console.log(`    ${why.join("; ")}`);
    const err = getSession(session.id)?.error;
    if (err) console.log(`    session error: ${err.slice(0, 300)}`);
  }
  console.log(`    ${rows.at(-1)!.oneLine || "(no root cause)"}`);
}

const sum = summarize(rows);
console.log(`\n${"Case".padEnd(26)}${"Result".padEnd(8)}${"Status".padEnd(24)}${"LLM".padStart(5)}${"Tools".padStart(7)}${"Cost".padStart(10)}${"Time".padStart(8)}`);
for (const r of rows) {
  console.log(`${r.id.padEnd(26)}${(r.score.pass ? "pass" : "fail").padEnd(8)}${r.status.padEnd(24)}${String(r.metrics.llmCalls).padStart(5)}${String(r.metrics.toolCalls).padStart(7)}${(r.metrics.costUsd === null ? "n/a" : `$${r.metrics.costUsd.toFixed(3)}`).padStart(10)}${`${(r.metrics.durationMs / 1000).toFixed(0)}s`.padStart(8)}`);
}
console.log(`\nMVP gates (${sum.passed}/${sum.cases} passed)`);
for (const g of sum.gates) console.log(`  ${g.ok === null ? "  -" : g.ok ? " ok" : "MISS"}  ${g.name.padEnd(32)}${g.value.padStart(10)}   target ${g.target}`);
if (sum.medianCostUsd !== null) console.log(`       Median cost per issue${`$${sum.medianCostUsd.toFixed(3)}`.padStart(17)}`);

const outDir = join(ROOT, "data", "evals");
const out = join(outDir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
await Bun.write(out, JSON.stringify({ engine: llm.engine, model: modelFor("agent_main"), summary: sum, results: rows }, null, 1));
console.log(`\nResults: ${out}`);
db().close();
if (!args.keep) rmSync(dataDir, { recursive: true, force: true });
process.exit(sum.gates[0]!.ok ? 0 : 1);
