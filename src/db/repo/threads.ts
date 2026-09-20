import { db } from "../db.ts";
import { newId, now } from "../../lib/ids.ts";
import { j, pj } from "./_util.ts";

export type ThreadKind = "agent" | "consultant";
export type Message = {
  id: string;
  thread_id: string;
  role: "user" | "assistant" | "system_event";
  content: string;
  meta: Record<string, unknown> | null;
  created_at: number;
};

export function threadFor(issueId: string, kind: ThreadKind): string {
  const r = db().query("SELECT id FROM threads WHERE issue_id = ? AND kind = ?").get(issueId, kind) as { id: string } | null;
  if (r) return r.id;
  const id = newId();
  db().query("INSERT INTO threads (id, issue_id, kind, created_at) VALUES (?, ?, ?, ?)").run(id, issueId, kind, now());
  return id;
}

const map = (r: Record<string, unknown>): Message => ({ ...(r as unknown as Message), meta: pj(r.meta, null) });

export const listMessages = (issueId: string, kind: ThreadKind, limit = 200): Message[] =>
  (db().query("SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at, id LIMIT ?").all(threadFor(issueId, kind), limit) as Record<string, unknown>[]).map(map);

export function addMessage(issueId: string, kind: ThreadKind, m: { role: Message["role"]; content: string; meta?: Record<string, unknown> | null }): Message {
  const id = newId();
  db().query("INSERT INTO messages (id, thread_id, role, content, meta, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, threadFor(issueId, kind), m.role, m.content, j(m.meta), now());
  return getMessage(id)!;
}

export function getMessage(id: string): Message | null {
  const r = db().query("SELECT * FROM messages WHERE id = ?").get(id) as Record<string, unknown> | null;
  return r ? map(r) : null;
}

export function updateMessage(id: string, patch: { content?: string; meta?: Record<string, unknown> }) {
  if (patch.content !== undefined) db().query("UPDATE messages SET content = ? WHERE id = ?").run(patch.content, id);
  if (patch.meta !== undefined) db().query("UPDATE messages SET meta = ? WHERE id = ?").run(j(patch.meta), id);
  return getMessage(id);
}

/** Recent user messages in the agent thread after a given time (for context). */
export const userMessagesSince = (issueId: string, since: number): Message[] =>
  (db().query("SELECT * FROM messages WHERE thread_id = ? AND role = 'user' AND created_at > ? ORDER BY created_at").all(threadFor(issueId, "agent"), since) as Record<string, unknown>[]).map(map);
