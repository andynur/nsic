import { db } from "../db.ts";
import { newId, now } from "../../lib/ids.ts";
import { buildPatch, j, pj } from "./_util.ts";

export type IngestStatus = "pending" | "running" | "done" | "failed" | "unsupported";
export type Attachment = {
  id: string;
  issue_id: string;
  filename: string;
  mime: string;
  size_bytes: number;
  sha256: string;
  storage_path: string;
  source: "upload" | "paste" | "email_child" | "cowork_import" | "agent";
  parent_id: string | null;
  ingest_status: IngestStatus;
  summary: string | null;
  derived_text_path: string | null;
  meta: Record<string, unknown> | null;
  created_at: number;
};

const map = (r: Record<string, unknown>): Attachment => ({ ...(r as unknown as Attachment), meta: pj(r.meta, null) });

export const listAttachments = (issueId: string): Attachment[] =>
  (db().query("SELECT * FROM attachments WHERE issue_id = ? ORDER BY created_at").all(issueId) as Record<string, unknown>[]).map(map);

export function getAttachment(id: string): Attachment | null {
  const r = db().query("SELECT * FROM attachments WHERE id = ?").get(id) as Record<string, unknown> | null;
  return r ? map(r) : null;
}

export const findAttachmentBySha = (issueId: string, sha: string): Attachment | null => {
  const r = db().query("SELECT * FROM attachments WHERE issue_id = ? AND sha256 = ? LIMIT 1").get(issueId, sha) as Record<string, unknown> | null;
  return r ? map(r) : null;
};

export function insertAttachment(a: Omit<Attachment, "id" | "created_at" | "ingest_status" | "summary" | "derived_text_path" | "meta"> & { meta?: Record<string, unknown> | null; ingest_status?: IngestStatus }): Attachment {
  const id = newId();
  db()
    .query(
      "INSERT INTO attachments (id, issue_id, filename, mime, size_bytes, sha256, storage_path, source, parent_id, ingest_status, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(id, a.issue_id, a.filename, a.mime, a.size_bytes, a.sha256, a.storage_path, a.source, a.parent_id, a.ingest_status ?? "pending", j(a.meta), now());
  return getAttachment(id)!;
}

export function updateAttachment(id: string, patch: Partial<Pick<Attachment, "ingest_status" | "summary" | "derived_text_path" | "meta" | "mime">>) {
  const { sets, vals } = buildPatch(patch, ["ingest_status", "summary", "derived_text_path", "meta", "mime"], ["meta"]);
  if (sets.length) db().query(`UPDATE attachments SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
}

export const totalAttachmentBytes = (issueId: string): number =>
  (db().query("SELECT COALESCE(SUM(size_bytes),0) AS n FROM attachments WHERE issue_id = ?").get(issueId) as { n: number }).n;
