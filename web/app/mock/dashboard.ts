import type { Dashboard } from "../dashboard-types.ts";
import * as F from "./fixtures.ts";

export function dashboardFixture(days: number, project: string | null): Dashboard {
  const generated_at = Date.now();
  const dayMs = 86400000;
  const from = Math.floor(generated_at / dayMs) * dayMs - (days - 1) * dayMs;
  const rows = F.issueRows().filter(i => !project || i.project_id === project);
  const open = rows.filter(i => !["resolved", "closed", "cancelled"].includes(i.status));
  const attention = open.filter(i => ["awaiting_user", "blocked", "budget_exceeded"].includes(i.status));
  const projects = F.projects.map(({ id, name }) => ({ id, name }));
  const daily = Array.from({ length: days }, (_, n) => ({ day: new Date(from + n * dayMs).toISOString().slice(0, 10), cost_usd: rows.reduce((sum, i) => sum + (i.cost_usd ?? 0), 0) * ((n * 7) % 11) / Math.max(1, Array.from({ length: days }, (_, j) => (j * 7) % 11).reduce((a, b) => a + b, 0)) }));
  return {
    generated_at, from, days, projects, total: rows.length, open: open.length,
    attention_count: attention.length, cost_usd: daily.reduce((n, d) => n + d.cost_usd, 0), daily,
    statuses: [...new Set(rows.map(i => i.status))].map(status => ({ status, count: rows.filter(i => i.status === status).length })).sort((a, b) => b.count - a.count || a.status.localeCompare(b.status)),
    evidence: Array.from({ length: 6 }, (_, level) => ({ level, count: open.filter(i => i.evidence_level === level).length })),
    workload: projects.filter(p => !project || p.id === project).map(p => ({ ...p, open: open.filter(i => i.project_id === p.id).length, attention: attention.filter(i => i.project_id === p.id).length })).sort((a, b) => b.open - a.open || a.name.localeCompare(b.name)),
    attention: attention.sort((a, b) => a.updated_at - b.updated_at || a.key.localeCompare(b.key)).slice(0, 10).map(i => ({ key: i.key, title: i.title, status: i.status, priority: i.priority, updated_at: i.updated_at, cost_usd: i.cost_usd ?? 0, budget_usd: i.budget_usd ?? F.projects.find(p => p.id === i.project_id)!.default_budget_usd })),
  };
}
