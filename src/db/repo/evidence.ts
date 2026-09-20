import { db } from "../db.ts";
import { newId, now } from "../../lib/ids.ts";
import { bool, buildPatch, j, pj } from "./_util.ts";

export type EvidenceStatus = "proposed" | "confirmed" | "rejected";
export type Evidence = {
  id: string;
  issue_id: string;
  session_id: string | null;
  level: number;
  kind: string;
  title: string;
  body: string | null;
  ref: Record<string, unknown> | null;
  status: EvidenceStatus;
  private: boolean;
  created_at: number;
  seq?: number;
};

const map = (r: Record<string, unknown>): Evidence => ({ ...(r as unknown as Evidence), ref: pj(r.ref, null), private: bool(r.private) });

/** Evidence is referenced as #E{seq} (creation order per issue). */
export function listEvidence(issueId: string, opts: { includeRejected?: boolean; publicOnly?: boolean } = {}): Evidence[] {
  const rows = (db().query("SELECT * FROM evidence WHERE issue_id = ? ORDER BY created_at, id").all(issueId) as Record<string, unknown>[]).map(map);
  rows.forEach((e, i) => (e.seq = i + 1));
  return rows
    .filter((e) => opts.includeRejected !== false || e.status !== "rejected")
    .filter((e) => !opts.publicOnly || !e.private)
    .sort((a, b) => b.level - a.level || a.created_at - b.created_at);
}

export function getEvidence(id: string): Evidence | null {
  const r = db().query("SELECT * FROM evidence WHERE id = ?").get(id) as Record<string, unknown> | null;
  return r ? map(r) : null;
}

export function insertEvidence(e: { issue_id: string; session_id?: string | null; level: number; kind: string; title: string; body?: string | null; ref?: Record<string, unknown> | null; private?: boolean; status?: EvidenceStatus }): Evidence {
  const id = newId();
  db()
    .query("INSERT INTO evidence (id, issue_id, session_id, level, kind, title, body, ref, status, private, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, e.issue_id, e.session_id ?? null, e.level, e.kind, e.title, e.body ?? null, j(e.ref), e.status ?? "proposed", e.private ? 1 : 0, now());
  return getEvidence(id)!;
}

export function updateEvidence(id: string, patch: Partial<Pick<Evidence, "status" | "private" | "title" | "body" | "level">>): Evidence | null {
  const { sets, vals } = buildPatch(patch, ["status", "private", "title", "body", "level"]);
  if (sets.length) db().query(`UPDATE evidence SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
  return getEvidence(id);
}

export type Hypothesis = {
  id: string;
  issue_id: string;
  statement: string;
  confidence: number;
  status: "open" | "supported" | "refuted" | "accepted";
  supporting: string[];
  refuting: string[];
  updated_at: number;
};

const mapH = (r: Record<string, unknown>): Hypothesis => ({ ...(r as unknown as Hypothesis), supporting: pj(r.supporting, []), refuting: pj(r.refuting, []) });

export const listHypotheses = (issueId: string): Hypothesis[] =>
  (db().query("SELECT * FROM hypotheses WHERE issue_id = ? ORDER BY confidence DESC").all(issueId) as Record<string, unknown>[]).map(mapH);

export function upsertHypothesis(h: { id?: string; issue_id: string; statement: string; confidence: number; status?: Hypothesis["status"]; supporting?: string[]; refuting?: string[] }): Hypothesis {
  const id = h.id && db().query("SELECT 1 FROM hypotheses WHERE id = ? AND issue_id = ?").get(h.id, h.issue_id) ? h.id : newId();
  db()
    .query(
      `INSERT INTO hypotheses (id, issue_id, statement, confidence, status, supporting, refuting, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET statement=excluded.statement, confidence=excluded.confidence, status=excluded.status,
         supporting=excluded.supporting, refuting=excluded.refuting, updated_at=excluded.updated_at`,
    )
    .run(id, h.issue_id, h.statement, Math.max(0, Math.min(1, h.confidence)), h.status ?? "open", j(h.supporting ?? []), j(h.refuting ?? []), now());
  return mapH(db().query("SELECT * FROM hypotheses WHERE id = ?").get(id) as Record<string, unknown>);
}
