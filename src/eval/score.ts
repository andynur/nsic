// Eval scoring (pure): does an investigation outcome match a case's expected root cause, and do the
// run metrics meet the MVP targets (doc 15 §MVP)?
import { s } from "../lib/schema.ts";

export const EvalCase = s.object({
  id: s.string({ min: 2, max: 80 }),
  title: s.string({ min: 3, max: 300 }),
  description: s.string({ max: 20_000 }),
  /** Repo path, relative to the NSIC root or absolute. */
  repo: s.string().optional(),
  /** Attachment paths, relative to the evals/ folder. */
  attachments: s.array(s.string()).optional(),
  budget_usd: s.number({ min: 0, max: 100 }).optional(),
  expect: s.object({
    min_level: s.number({ int: true, min: 0, max: 5 }),
    /** At least one of these file names must be cited by E4 evidence or the root cause. */
    files: s.array(s.string()).optional(),
    /** Every entry must appear in the root cause; "a|b" accepts either alternative. Case-insensitive. */
    keywords: s.array(s.string()).optional(),
  }),
});
export type EvalCaseT = {
  id: string;
  title: string;
  description: string;
  repo?: string;
  attachments?: string[];
  budget_usd?: number;
  expect: { min_level: number; files?: string[]; keywords?: string[] };
};

export type Outcome = { evidenceLevel: number; rootCause: string; evidenceRefs: { level: number; file?: string; scriptid?: string }[] };

export type Score = { pass: boolean; levelOk: boolean; fileHit: boolean | null; keywordsHit: number; keywordsTotal: number; missing: string[] };

const base = (p: string) => p.split(/[\\/]/).pop()!.toLowerCase();

export function scoreOutcome(c: EvalCaseT, o: Outcome): Score {
  const text = o.rootCause.toLowerCase();
  const levelOk = o.evidenceLevel >= c.expect.min_level;
  let fileHit: boolean | null = null;
  if (c.expect.files?.length) {
    const want = c.expect.files.map(base);
    const cited = o.evidenceRefs.filter((r) => r.level >= 4 && r.file).map((r) => base(r.file!));
    fileHit = want.some((w) => cited.includes(w) || text.includes(w));
  }
  const kws = c.expect.keywords ?? [];
  const missing = kws.filter((k) => !k.split("|").some((alt) => text.includes(alt.trim().toLowerCase())));
  const keywordsHit = kws.length - missing.length;
  return { pass: levelOk && fileHit !== false && missing.length === 0, levelOk, fileHit, keywordsHit, keywordsTotal: kws.length, missing };
}

export type RunMetrics = { costUsd: number | null; llmCalls: number; toolCalls: number; inputTokensPerCall: number[]; cacheRead: number; cacheWrite: number; input: number; durationMs: number };

/** MVP success targets (the eval gate). */
export const TARGETS = { accuracy: 0.6, cacheHitRatio: 0.7, medianInputPerCall: 15_000, maxToolCallsPerSession: 25 };

export const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2;
};

export type Summary = {
  cases: number;
  passed: number;
  accuracy: number;
  medianCostUsd: number | null;
  cacheHitRatio: number | null;
  medianInputPerCall: number;
  medianToolCalls: number;
  medianDurationMs: number;
  gates: { name: string; ok: boolean | null; value: string; target: string }[];
};

export function summarize(results: { score: Score; metrics: RunMetrics }[]): Summary {
  const n = results.length;
  const passed = results.filter((r) => r.score.pass).length;
  const costs = results.map((r) => r.metrics.costUsd).filter((c): c is number => c !== null);
  const input = results.reduce((a, r) => a + r.metrics.input, 0);
  const read = results.reduce((a, r) => a + r.metrics.cacheRead, 0);
  const write = results.reduce((a, r) => a + r.metrics.cacheWrite, 0);
  const cache = input + read + write > 0 ? read / (input + read + write) : null;
  const perCall = median(results.flatMap((r) => r.metrics.inputTokensPerCall));
  const tools = median(results.map((r) => r.metrics.toolCalls));
  const accuracy = n ? passed / n : 0;
  // Cache reads are only reported by the Messages API; the CLI engine reports none, so the gate is not applicable there.
  const cacheKnown = read + write > 0 ? cache : null;
  return {
    cases: n,
    passed,
    accuracy,
    medianCostUsd: costs.length ? median(costs) : null,
    cacheHitRatio: cacheKnown,
    medianInputPerCall: perCall,
    medianToolCalls: tools,
    medianDurationMs: median(results.map((r) => r.metrics.durationMs)),
    gates: [
      { name: "Root cause accuracy", ok: accuracy >= TARGETS.accuracy, value: `${(accuracy * 100).toFixed(0)}%`, target: `≥ ${TARGETS.accuracy * 100}%` },
      { name: "Cache hit ratio", ok: cacheKnown === null ? null : cacheKnown >= TARGETS.cacheHitRatio, value: cacheKnown === null ? "n/a" : `${(cacheKnown * 100).toFixed(0)}%`, target: `≥ ${TARGETS.cacheHitRatio * 100}%` },
      { name: "Median input tokens per call", ok: perCall < TARGETS.medianInputPerCall, value: Math.round(perCall).toLocaleString("en-US"), target: `< ${TARGETS.medianInputPerCall.toLocaleString("en-US")}` },
      { name: "Median tool calls per session", ok: tools < TARGETS.maxToolCallsPerSession, value: String(tools), target: `< ${TARGETS.maxToolCallsPerSession}` },
    ],
  };
}
