import { describe, expect, test } from "bun:test";
import { median, scoreOutcome, summarize, type EvalCaseT, type RunMetrics } from "../../src/eval/score.ts";

const c: EvalCaseT = { id: "x", title: "t", description: "d", expect: { min_level: 4, files: ["ue_vb_sync_ap.js"], keywords: ["RCRD_HAS_BEEN_CHANGED|has been changed", "afterSubmit"] } };

describe("eval scoring", () => {
  test("passes with level, cited file and every keyword group", () => {
    const s = scoreOutcome(c, { evidenceLevel: 4, rootCause: "Both afterSubmit scripts save; Record has been changed.", evidenceRefs: [{ level: 4, file: "src/FileCabinet/SuiteScripts/acme/ue_vb_sync_ap.js" }] });
    expect(s.pass).toBe(true);
  });
  test("a file named only in lower-level evidence does not count, but the root cause text does", () => {
    const refs = [{ level: 2, file: "ue_vb_sync_ap.js" }];
    expect(scoreOutcome(c, { evidenceLevel: 4, rootCause: "afterSubmit has been changed", evidenceRefs: refs }).fileHit).toBe(false);
    expect(scoreOutcome(c, { evidenceLevel: 4, rootCause: "afterSubmit in ue_vb_sync_ap.js has been changed", evidenceRefs: refs }).fileHit).toBe(true);
  });
  test("fails on a low level or a missing keyword", () => {
    const refs = [{ level: 4, file: "ue_vb_sync_ap.js" }];
    expect(scoreOutcome(c, { evidenceLevel: 2, rootCause: "afterSubmit has been changed", evidenceRefs: refs }).pass).toBe(false);
    const s = scoreOutcome(c, { evidenceLevel: 4, rootCause: "has been changed", evidenceRefs: refs });
    expect(s.pass).toBe(false);
    expect(s.missing).toEqual(["afterSubmit"]);
  });
  test("summary gates", () => {
    const m = (over: Partial<RunMetrics>): RunMetrics => ({ costUsd: 0.5, llmCalls: 8, toolCalls: 12, inputTokensPerCall: [9000, 11000], cacheRead: 80_000, cacheWrite: 5_000, input: 15_000, durationMs: 60_000, ...over });
    const pass = { pass: true, levelOk: true, fileHit: true, keywordsHit: 1, keywordsTotal: 1, missing: [] };
    const sum = summarize([{ score: pass, metrics: m({}) }, { score: { ...pass, pass: false }, metrics: m({ costUsd: 1.5 }) }]);
    expect(sum.accuracy).toBe(0.5);
    expect(sum.medianCostUsd).toBe(1);
    expect(sum.cacheHitRatio).toBe(0.8);
    expect(sum.gates.map((g) => g.ok)).toEqual([false, true, true, true]);
    const cli = summarize([{ score: pass, metrics: m({ costUsd: null, cacheRead: 0, cacheWrite: 0 }) }]);
    expect(cli.cacheHitRatio).toBeNull();
    expect(cli.medianCostUsd).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
  });
});
