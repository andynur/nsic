// Token & cost accounting (10 §1-2) + budget (10 §4).
import { getPricing, type Pricing } from "../db/repo/settings.ts";
import { insertLlmCall, issueTotals, type LlmPurpose } from "../db/repo/usage.ts";
import { effectiveBudget } from "../db/repo/issues.ts";
import { emit } from "../realtime/events.ts";
import type { Usage } from "./types.ts";

export function costOf(u: Usage, p: Pick<Pricing, "input_per_mtok" | "output_per_mtok" | "cache_write_per_mtok" | "cache_read_per_mtok"> | null): number | null {
  if (!p || (p.input_per_mtok === 0 && p.output_per_mtok === 0)) return null;
  return (
    (u.input_tokens * p.input_per_mtok + u.output_tokens * p.output_per_mtok + u.cache_creation_input_tokens * p.cache_write_per_mtok + u.cache_read_input_tokens * p.cache_read_per_mtok) / 1e6
  );
}

export const cacheHitRatio = (t: { input_tokens: number; cache_read_tokens: number; cache_write_tokens: number }): number => {
  const d = t.input_tokens + t.cache_read_tokens + t.cache_write_tokens;
  return d ? t.cache_read_tokens / d : 0;
};

/** Find a price: exact match, then prefix (e.g. 'claude-haiku-4-5-20251001' → 'claude-haiku-4-5'). */
export function pricingFor(model: string): Pricing | null {
  const exact = getPricing(model);
  if (exact) return exact;
  const stripped = model.replace(/-\d{8}$/, "");
  return stripped !== model ? getPricing(stripped) : null;
}

export type UsageCtx = { issueId?: string | null; sessionId?: string | null; stepId?: string | null; purpose: LlmPurpose };

export function recordUsage(ctx: UsageCtx, model: string, u: Usage, meta: { latencyMs: number; stopReason: string | null; requestId: string | null }) {
  const p = pricingFor(model);
  const cost = costOf(u, p);
  const row = insertLlmCall({
    issue_id: ctx.issueId ?? null,
    session_id: ctx.sessionId ?? null,
    step_id: ctx.stepId ?? null,
    purpose: ctx.purpose,
    model,
    input_tokens: u.input_tokens,
    output_tokens: u.output_tokens,
    cache_write_tokens: u.cache_creation_input_tokens,
    cache_read_tokens: u.cache_read_input_tokens,
    cost_usd: cost ?? 0,
    pricing_snapshot: p ? { ...p, priced: cost !== null } : { priced: false },
    latency_ms: meta.latencyMs,
    stop_reason: meta.stopReason,
    request_id: meta.requestId,
  });
  if (ctx.issueId) {
    const totals = issueTotals(ctx.issueId);
    const budget = effectiveBudget(ctx.issueId);
    emit({ type: "usage.updated", issueId: ctx.issueId, sessionId: ctx.sessionId ?? null, totals: totals as unknown as Record<string, number>, budget });
    const pct = budget > 0 ? (totals.cost_usd / budget) * 100 : 0;
    const before = budget > 0 ? ((totals.cost_usd - (cost ?? 0)) / budget) * 100 : 0;
    if (pct >= 100 && before < 100) emit({ type: "usage.exceeded", issueId: ctx.issueId, percent: pct });
    else if (pct >= 80 && before < 80) emit({ type: "usage.warning", issueId: ctx.issueId, percent: pct });
  }
  return row;
}

/** Token estimate from text length (≈ 3.5 characters/token), good enough for the budget guard. */
export const estimateTokens = (s: string): number => Math.ceil(s.length / 3.5);

/** Pre-call check: the maximum cost (counted input + max_tokens output) must not exceed the remaining budget. */
export function checkBudget(issueId: string, model: string, estInputTokens: number, maxTokens: number): { ok: boolean; remaining: number; estimate: number; budget: number; spent: number } {
  const budget = effectiveBudget(issueId);
  const spent = issueTotals(issueId).cost_usd;
  const p = pricingFor(model);
  const estimate = costOf({ input_tokens: estInputTokens, output_tokens: maxTokens, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, p) ?? 0;
  const remaining = budget - spent;
  const ok = estimate === 0 ? remaining > 0 || spent === 0 : estimate <= remaining;
  return { ok, remaining, estimate, budget, spent };
}
