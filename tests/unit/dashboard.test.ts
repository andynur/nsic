import { expect, test } from "bun:test";
import { db } from "../../src/db/db.ts";
import { createProject } from "../../src/db/repo/projects.ts";
import { createIssue } from "../../src/db/repo/issues.ts";
import { dashboard } from "../../src/db/repo/dashboard.ts";
import { dashboardRoutes } from "../../src/routes/dashboard.ts";

const now = Date.UTC(2026, 8, 20, 12);
const day = 86400000;
const start = Date.UTC(2026, 8, 14);
const call = (issue: string | null, time: number, cost: number) => db().query("INSERT INTO llm_calls (id, issue_id, purpose, model, cost_usd, created_at) VALUES (?, ?, 'agent', 'test', ?, ?)").run(crypto.randomUUID(), issue, cost, time);

test("dashboard counts all issues beyond list limits and excludes terminal work from evidence", () => {
  const p = createProject({ name: "Dashboard counts", key_prefix: "DCOUNT" });
  db().transaction(() => {
    for (let n = 0; n < 505; n++) createIssue({ project_id: p.id, title: `Issue ${n}`, status: "investigating" });
    for (const status of ["resolved", "closed", "cancelled"] as const) createIssue({ project_id: p.id, title: status, status });
  })();
  const d = dashboard(7, p.id, now);
  expect(d.total).toBe(508);
  expect(d.open).toBe(505);
  expect(d.evidence.reduce((n, e) => n + e.count, 0)).toBe(505);
  expect(d.workload).toEqual([{ id: p.id, name: p.name, open: 505, attention: 0 }]);
});

test("attention has a complete count, deterministic oldest-first limit, and effective budgets", () => {
  const p = createProject({ name: "Dashboard attention", key_prefix: "DATT", default_budget_usd: 9 });
  for (let n = 0; n < 12; n++) {
    const i = createIssue({ project_id: p.id, title: `Blocked ${n}`, status: "blocked", ...(n === 0 ? { budget_usd: 0 } : {}) });
    db().query("UPDATE issues SET updated_at = ? WHERE id = ?").run(now + n, i.id);
    call(i.id, start - day, 2);
  }
  const d = dashboard(7, p.id, now);
  expect(d.attention_count).toBe(12);
  expect(d.attention).toHaveLength(10);
  expect(d.attention[0]).toMatchObject({ title: "Blocked 0", budget_usd: 0, cost_usd: 2 });
  expect(d.attention[1]?.budget_usd).toBe(9);
  expect(d.cost_usd).toBe(0);
});

test("UTC costs are zero-filled, bounded, project-scoped, and include unassigned calls globally", () => {
  const p = createProject({ name: "Dashboard costs", key_prefix: "DCOST" });
  const i = createIssue({ project_id: p.id, title: "Cost" });
  call(i.id, start - 1, 100);
  call(i.id, start, 1);
  call(i.id, now, 2);
  call(i.id, now + 1, 100);
  const baseline = dashboard(7, undefined, now).cost_usd;
  call(null, now, 4);
  expect(dashboard(7, undefined, now).cost_usd).toBeCloseTo(baseline + 4);
  const d = dashboard(7, p.id, now);
  expect(d.cost_usd).toBe(3);
  expect(d.daily).toHaveLength(7);
  expect(d.daily[0]).toEqual({ day: "2026-09-14", cost_usd: 1 });
  expect(d.daily[1]?.cost_usd).toBe(0);
  expect(d.daily[6]).toEqual({ day: "2026-09-20", cost_usd: 2 });
  expect(dashboard(30, p.id, now).daily).toHaveLength(30);
});

test("empty and archived projects remain accessible without invented metrics", () => {
  const p = createProject({ name: "Dashboard empty", key_prefix: "DEMPTY" });
  db().query("UPDATE projects SET archived_at = ? WHERE id = ?").run(now, p.id);
  const d = dashboard(7, p.id, now);
  expect(d).toMatchObject({ total: 0, open: 0, attention_count: 0, cost_usd: 0, statuses: [], attention: [] });
  expect(d.workload[0]).toMatchObject({ open: 0, attention: 0 });
  expect(d.projects.some(x => x.id === p.id)).toBe(true);
});

test("dashboard API validates filters and disables caching", async () => {
  const get = (query: string) => dashboardRoutes["/api/dashboard"].GET(new Request(`http://127.0.0.1:4317/api/dashboard${query}`) as Request & { params: Record<string, string> });
  for (const query of ["?days=0", "?days=999", "?days=NaN", "?project=", "?days=7.0"]) expect((await get(query)).status).toBe(400);
  expect((await get("?project=does-not-exist")).status).toBe(404);
  const response = await get("?days=7");
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect((await response.json()).days).toBe(7);
});
