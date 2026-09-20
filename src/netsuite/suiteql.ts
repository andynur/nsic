// SuiteQL via REST (07 §4) + guard: SELECT/WITH only, one statement (06 §6 layer 4).
import { type Result, ok, appErr, errorMessage } from "../lib/result.ts";
import { getEnvironment } from "../db/repo/environments.ts";
import { getRestAccessToken } from "./m2m-jwt.ts";
import { metadataUrl, recordUrl, suiteqlUrl } from "./urls.ts";

const DML = /\b(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|exec|execute|call)\b/i;

/** Strip comments & string literals before checking keywords. */
function stripLiterals(q: string): string {
  return q.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"]|"")*"/g, '""');
}

export function guardSuiteQL(q: string): Result<string> {
  const trimmed = q.trim().replace(/;\s*$/, "");
  const bare = stripLiterals(trimmed).trim();
  if (!/^(select|with)\b/i.test(bare)) return appErr("suiteql_guard", "Only SELECT/WITH queries are allowed");
  if (bare.includes(";")) return appErr("suiteql_guard", "Only one statement per query");
  if (DML.test(bare)) return appErr("suiteql_guard", "The query contains a write/DDL keyword");
  return ok(trimmed);
}

export type SuiteQLResult = { items: Record<string, unknown>[]; totalResults: number | null; hasMore: boolean };

async function restFetch(envId: string, url: string, init: RequestInit = {}): Promise<Result<Response>> {
  const tok = await getRestAccessToken(envId);
  if (!tok.ok) return tok;
  try {
    const res = await fetch(url, { ...init, headers: { authorization: `Bearer ${tok.value}`, accept: "application/json", ...(init.headers ?? {}) }, signal: AbortSignal.timeout(120_000) });
    return ok(res);
  } catch (e) {
    return appErr("rest_network", errorMessage(e));
  }
}

export async function runSuiteQL(envId: string, query: string, opts: { limit?: number; offset?: number } = {}): Promise<Result<SuiteQLResult>> {
  const g = guardSuiteQL(query);
  if (!g.ok) return g;
  const env = getEnvironment(envId);
  if (!env) return appErr("not_found", "environment not found");
  const limit = Math.min(1000, Math.max(1, opts.limit ?? 200));
  const url = `${suiteqlUrl(env.account_id)}?limit=${limit}&offset=${opts.offset ?? 0}`;
  const r = await restFetch(envId, url, { method: "POST", headers: { "content-type": "application/json", prefer: "transient" }, body: JSON.stringify({ q: g.value }) });
  if (!r.ok) return r;
  const text = await r.value.text();
  if (!r.value.ok) return appErr("suiteql_http", `SuiteQL HTTP ${r.value.status}: ${text.slice(0, 500)}`);
  const j = JSON.parse(text) as { items?: Record<string, unknown>[]; totalResults?: number; hasMore?: boolean };
  return ok({ items: (j.items ?? []).map(({ links: _l, ...rest }) => rest), totalResults: j.totalResults ?? null, hasMore: !!j.hasMore });
}

export async function getRecord(envId: string, type: string, id: string, fields?: string[]): Promise<Result<Record<string, unknown>>> {
  const env = getEnvironment(envId);
  if (!env) return appErr("not_found", "environment not found");
  if (!/^[a-z_0-9]+$/i.test(type) || !/^[\w-]+$/.test(id)) return appErr("bad_input", "invalid type/id");
  const url = recordUrl(env.account_id, type, id) + (fields?.length ? `?fields=${encodeURIComponent(fields.join(","))}` : "");
  const r = await restFetch(envId, url, { method: "GET" });
  if (!r.ok) return r;
  const text = await r.value.text();
  if (!r.value.ok) return appErr("record_http", `Record HTTP ${r.value.status}: ${text.slice(0, 400)}`);
  return ok(JSON.parse(text) as Record<string, unknown>);
}

export async function pingMetadata(envId: string): Promise<Result<true>> {
  const env = getEnvironment(envId);
  if (!env) return appErr("not_found", "environment not found");
  const r = await restFetch(envId, `${metadataUrl(env.account_id)}?select=subsidiary`, { method: "GET" });
  if (!r.ok) return r;
  return r.value.ok ? ok(true) : appErr("metadata_http", `metadata HTTP ${r.value.status}`);
}

/** Ready-made queries for agent tools. [SPIKE S-05]: the execution log table depends on the account. */
export const QUERIES = {
  systemNotes: (recordTypeId: string, recordId: string) =>
    `SELECT sn.date, BUILTIN.DF(sn.name) AS who, BUILTIN.DF(sn.role) AS role, sn.field, sn.oldvalue, sn.newvalue, sn.context, sn.type FROM systemnote sn WHERE sn.recordid = ${Number(recordId)} AND sn.recordtypeid = ${Number(recordTypeId) || `'${recordTypeId.replace(/'/g, "")}'`} ORDER BY sn.date DESC`,
  executionLogs: (scriptId: string | null, fromIso: string, toIso: string, level = "ERROR") =>
    `SELECT sel.date, sel.type, sel.title, sel.detail, BUILTIN.DF(sel.scripttype) AS scripttype, s.scriptid FROM scriptexecutionlog sel LEFT JOIN script s ON s.id = sel.scripttype WHERE sel.date BETWEEN TO_DATE('${fromIso.slice(0, 10)}','YYYY-MM-DD') AND TO_DATE('${toIso.slice(0, 10)}','YYYY-MM-DD') + 1${level !== "ALL" ? ` AND sel.type IN ('ERROR','EMERGENCY'${level === "DEBUG" ? ",'DEBUG','AUDIT'" : ""})` : ""}${scriptId ? ` AND LOWER(s.scriptid) = '${scriptId.toLowerCase().replace(/[^a-z0-9_]/g, "")}'` : ""} ORDER BY sel.date DESC`,
  probe: "SELECT id FROM subsidiary FETCH FIRST 1 ROWS ONLY",
  probeLogs: "SELECT id FROM scriptexecutionlog FETCH FIRST 1 ROWS ONLY",
};
