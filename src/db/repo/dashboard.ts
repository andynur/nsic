import { db } from "../db.ts";
import type { Dashboard } from "../../../web/app/dashboard-types.ts";

const OPEN = "i.status NOT IN ('resolved','closed','cancelled')";
const ATTENTION = "i.status IN ('awaiting_user','blocked','budget_exceeded')";

/** All aggregates share one SQLite snapshot; no issue-list pagination is involved. */
export function dashboard(days: 7 | 30, projectId?: string, now = Date.now()): Dashboard {
  return db().transaction(() => {
    const dayMs = 86400000;
    const from = Math.floor(now / dayMs) * dayMs - (days - 1) * dayMs;
    const scope = projectId ? "i.project_id = ?" : "1=1";
    const args = projectId ? [projectId] : [];
    const projects = db().query("SELECT id, name FROM projects ORDER BY name, id").all() as Dashboard["projects"];
    const counts = db().query(`SELECT COUNT(*) AS total, COALESCE(SUM(${OPEN}),0) AS open,
      COALESCE(SUM(${ATTENTION}),0) AS attention_count FROM issues i WHERE ${scope}`).get(...args) as Pick<Dashboard, "total" | "open" | "attention_count">;
    const statuses = db().query(`SELECT status, COUNT(*) AS count FROM issues i WHERE ${scope} GROUP BY status ORDER BY count DESC, status`).all(...args) as Dashboard["statuses"];
    const levels = db().query(`SELECT evidence_level AS level, COUNT(*) AS count FROM issues i WHERE ${scope} AND ${OPEN} GROUP BY evidence_level`).all(...args) as Dashboard["evidence"];
    const evidence = Array.from({ length: 6 }, (_, level) => ({ level, count: levels.find(e => e.level === level)?.count ?? 0 }));
    const costs = db().query(`SELECT strftime('%Y-%m-%d', c.created_at / 1000, 'unixepoch') AS day, SUM(c.cost_usd) AS cost_usd
      FROM llm_calls c LEFT JOIN issues i ON i.id = c.issue_id
      WHERE c.created_at >= ? AND c.created_at <= ? AND ${scope} GROUP BY day`).all(from, now, ...args) as Dashboard["daily"];
    const daily = Array.from({ length: days }, (_, n) => {
      const day = new Date(from + n * dayMs).toISOString().slice(0, 10);
      return { day, cost_usd: costs.find(c => c.day === day)?.cost_usd ?? 0 };
    });
    const workload = db().query(`SELECT p.id, p.name, COALESCE(SUM(${OPEN}),0) AS open, COALESCE(SUM(${ATTENTION}),0) AS attention
      FROM projects p LEFT JOIN issues i ON i.project_id = p.id ${projectId ? "WHERE p.id = ?" : ""}
      GROUP BY p.id ORDER BY open DESC, p.name, p.id`).all(...args) as Dashboard["workload"];
    const attention = db().query(`SELECT i.key, i.title, i.status, i.priority, i.updated_at,
      COALESCE((SELECT SUM(c.cost_usd) FROM llm_calls c WHERE c.issue_id = i.id),0) AS cost_usd,
      COALESCE(i.budget_usd,p.default_budget_usd) AS budget_usd
      FROM issues i JOIN projects p ON p.id = i.project_id WHERE ${scope} AND ${ATTENTION}
      ORDER BY i.updated_at, i.key LIMIT 10`).all(...args) as Dashboard["attention"];
    return { generated_at: now, from, days, projects, ...counts, statuses, evidence, daily,
      cost_usd: daily.reduce((sum, d) => sum + d.cost_usd, 0), workload, attention };
  })();
}
