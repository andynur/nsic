// Proactive monitoring (07 §8): poll execution log errors → draft issue + TRIAGE only.
import type { JobHandler } from "../handlers.ts";
import { getEnvironment, latestAccessProfile, updateEnvironment } from "../../db/repo/environments.ts";
import { createIssue } from "../../db/repo/issues.ts";
import { insertEntity } from "../../db/repo/entities.ts";
import { insertEvidence } from "../../db/repo/evidence.ts";
import { getSetting, putSetting } from "../../db/repo/settings.ts";
import { runSuiteQL, QUERIES } from "../../netsuite/suiteql.ts";
import { startAgentSession } from "../../agent/start.ts";

const normalize = (s: string) => s.replace(/\d+/g, "#").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 200);

const handler: JobHandler = async (job) => {
  const env = getEnvironment(String(job.payload.environmentId));
  if (!env || !env.monitor_enabled) return { skipped: true };
  if (!latestAccessProfile(env.id)?.capabilities.exec_logs) return { skipped: true, reason: "exec_logs unavailable" };
  const since = new Date(env.last_polled_at ?? Date.now() - 24 * 3600_000).toISOString();
  const q = QUERIES.executionLogs(null, since, new Date().toISOString(), "ERROR");
  const r = await runSuiteQL(env.id, q, { limit: 1000 });
  if (!r.ok) throw new Error(r.error.message);
  updateEnvironment(env.id, { last_polled_at: Date.now() });
  const groups = new Map<string, { script: string; title: string; count: number; sample: Record<string, unknown> }>();
  for (const row of r.value.items) {
    const script = String(row.scriptid ?? row.scripttype ?? "unknown");
    const title = String(row.title ?? "");
    const key = `${script}|${normalize(title)}`;
    const g = groups.get(key) ?? { script, title, count: 0, sample: row };
    g.count++;
    groups.set(key, g);
  }
  const seenKey = `monitor.seen.${env.id}`;
  const seen = new Set(getSetting<string[]>(seenKey, []));
  const spike = getSetting<number>("monitor.spike_per_poll", 20);
  let created = 0;
  for (const [key, g] of groups) {
    const hash = Bun.hash(key).toString(16);
    if (seen.has(hash) && g.count < spike) continue;
    seen.add(hash);
    const issue = createIssue({ project_id: env.project_id, environment_id: env.id, title: `[Monitor] ${g.script}: ${g.title.slice(0, 120)}`, description: `Detected ${g.count} errors from ${g.script} since ${since}.\n\nSample:\n${JSON.stringify(g.sample, null, 1).slice(0, 2000)}`, priority: g.count >= spike ? "high" : "normal" });
    insertEntity({ issue_id: issue.id, type: "script_id", value: g.script, normalized: g.script.toLowerCase(), source_attachment_id: null, source_locator: "execution log", confidence: 0.95 });
    insertEvidence({ issue_id: issue.id, level: 2, kind: "execution_log", title: `${g.count} error execution log`, body: g.title, ref: { query: q } });
    startAgentSession(issue.id, "monitor");
    created++;
  }
  putSetting(seenKey, [...seen].slice(-500));
  return { groups: groups.size, created };
};
export default handler;
