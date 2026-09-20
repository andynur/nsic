// Automation graph query per record type (04 §4, tool get_record_automation).
import { db } from "../db/db.ts";
import { edgesFrom, edgesTo, listSdfObjects, type SdfObject } from "../db/repo/code.ts";

export type AutomationItem = {
  scriptid: string;
  objectType: string;
  scriptType?: string;
  file?: string;
  entryPoints?: string[];
  deployments: { scriptid: string; status?: unknown; recordtype?: unknown; runasrole?: unknown; loglevel?: unknown; isdeployed?: unknown; executioncontext?: unknown }[];
};

export function recordAutomation(repoIds: string[], recordType: string): { items: AutomationItem[]; fieldsWritten: { file: string; field: string }[] } {
  const rec = `rec:${recordType.toLowerCase()}`;
  const items: AutomationItem[] = [];
  const fieldsWritten: { file: string; field: string }[] = [];
  for (const repoId of repoIds) {
    const objs = new Map<string, SdfObject>(listSdfObjects(repoId).map((o) => [o.scriptid, o]));
    const sources = new Set(edgesTo(repoId, rec, "applies_to").map((e) => e.src.slice(4)));
    for (const sid of sources) {
      const o = objs.get(sid);
      if (!o || o.object_type === "scriptdeployment") continue;
      const out = edgesFrom(repoId, `obj:${sid}`);
      const file = out.find((e) => e.rel === "implements")?.dst.replace(/^(file|fc):/, "");
      const deployments = out
        .filter((e) => e.rel === "deploys")
        .map((e) => objs.get(e.dst.slice(4)))
        .filter((d): d is SdfObject => !!d && String(d.attrs.recordtype ?? "").toLowerCase().replace(/[[\]]/g, "") === recordType.toLowerCase())
        .map((d) => ({ scriptid: d.scriptid, status: d.attrs.status, recordtype: d.attrs.recordtype, runasrole: d.attrs.runasrole, loglevel: d.attrs.loglevel, isdeployed: d.attrs.isdeployed, executioncontext: d.attrs.executioncontext }));
      const cf = file ? (db().query("SELECT script_type, entry_points FROM code_files WHERE repo_id = ? AND path = ?").get(repoId, file) as { script_type: string | null; entry_points: string } | null) : null;
      items.push({ scriptid: sid, objectType: o.object_type, ...(cf?.script_type && { scriptType: cf.script_type }), ...(file && { file }), ...(cf && { entryPoints: JSON.parse(cf.entry_points) as string[] }), deployments });
      if (file) for (const e of edgesFrom(repoId, `file:${file}`)) if (e.rel === "writes_field") fieldsWritten.push({ file, field: e.dst.slice(4) });
    }
  }
  return { items, fieldsWritten };
}

/** Project summary for the agent context (cache breakpoint 2). */
export function projectCodeSummary(repoIds: string[], maxLines = 120): string {
  const lines: string[] = [];
  for (const repoId of repoIds) {
    const rows = db()
      .query(`SELECT e.dst AS rec, o.scriptid, o.object_type FROM code_edges e JOIN sdf_objects o ON o.repo_id = e.repo_id AND e.src = 'obj:' || o.scriptid
              WHERE e.repo_id = ? AND e.rel = 'applies_to' AND o.object_type != 'scriptdeployment' ORDER BY e.dst, o.object_type`)
      .all(repoId) as { rec: string; scriptid: string; object_type: string }[];
    const byRec = new Map<string, string[]>();
    for (const r of rows) byRec.set(r.rec, [...(byRec.get(r.rec) ?? []), `${r.scriptid} (${r.object_type})`]);
    for (const [rec, list] of byRec) lines.push(`- ${rec.slice(4)}: ${list.join(", ")}`);
    const counts = db().query("SELECT script_type, COUNT(*) AS n FROM code_files WHERE repo_id = ? AND script_type IS NOT NULL GROUP BY script_type").all(repoId) as { script_type: string; n: number }[];
    if (counts.length) lines.push(`- scripts by type: ${counts.map((c) => `${c.script_type} ${c.n}`).join(", ")}`);
  }
  return lines.slice(0, maxLines).join("\n") || "(no repo connected or not indexed yet)";
}
