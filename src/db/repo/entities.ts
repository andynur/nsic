import { db } from "../db.ts";
import { newId } from "../../lib/ids.ts";
import { buildPatch } from "./_util.ts";

export type EntityStatus = "auto" | "confirmed" | "rejected" | "manual";
export type Entity = {
  id: string;
  issue_id: string;
  type: string;
  value: string;
  normalized: string | null;
  source_attachment_id: string | null;
  source_locator: string | null;
  confidence: number | null;
  status: EntityStatus;
};

export const listEntities = (issueId: string): Entity[] =>
  db().query("SELECT * FROM entities WHERE issue_id = ? ORDER BY type, value").all(issueId) as Entity[];

export const getEntity = (id: string): Entity | null => db().query("SELECT * FROM entities WHERE id = ?").get(id) as Entity | null;

export function insertEntity(e: Omit<Entity, "id" | "status"> & { status?: EntityStatus }): Entity {
  // dedup per (issue, type, normalized)
  const key = e.normalized ?? e.value;
  const existing = db().query("SELECT * FROM entities WHERE issue_id = ? AND type = ? AND COALESCE(normalized, value) = ?").get(e.issue_id, e.type, key) as Entity | null;
  if (existing) return existing;
  const id = newId();
  db()
    .query("INSERT INTO entities (id, issue_id, type, value, normalized, source_attachment_id, source_locator, confidence, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, e.issue_id, e.type, e.value, e.normalized, e.source_attachment_id, e.source_locator, e.confidence, e.status ?? "auto");
  return getEntity(id)!;
}

export function updateEntity(id: string, patch: Partial<Pick<Entity, "value" | "normalized" | "status" | "type">>): Entity | null {
  const { sets, vals } = buildPatch(patch, ["value", "normalized", "status", "type"]);
  if (sets.length) db().query(`UPDATE entities SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
  return getEntity(id);
}
