// WebSocket events (13 §2). One emit() function is used by the server & worker:
// - in the server: server.publish(topic) directly
// - in the worker: sent over IPC (process.send), then forwarded by the server.

export type StepPayload = { id: string; seq: number; state: string; kind: string; title: string | null; summary: string | null; status?: string };

export type WsEvent =
  | { type: "issue.updated"; issueId: string; patch: Record<string, unknown> }
  | { type: "ingest.progress"; issueId: string; attachmentId: string; status: string }
  | { type: "session.started" | "session.state" | "session.ended"; sessionId: string; issueId: string; state?: string; status?: string }
  | { type: "step.started" | "step.done"; issueId: string; sessionId: string; step: StepPayload }
  | { type: "tool.call"; issueId: string; sessionId: string; stepId: string; tool: string; risk: string; inputPreview: string }
  | { type: "tool.result"; issueId: string; sessionId: string; stepId: string; ok: boolean; outputPreview: string; durationMs: number }
  | { type: "llm.delta"; issueId: string; sessionId: string; stepId: string; text: string }
  | { type: "usage.updated"; issueId: string; sessionId: string | null; totals: Record<string, number>; budget: number }
  | { type: "usage.warning" | "usage.exceeded"; issueId: string; percent: number }
  | { type: "evidence.added" | "evidence.updated"; issueId: string; evidence: Record<string, unknown> }
  | { type: "checkpoint"; issueId: string; sessionId: string; question: string; options?: string[] }
  | { type: "approval.required"; issueId: string; toolCallId: string; summary: string; diff?: string }
  | { type: "run.step"; issueId: string; runId: string; index: number; status: string; screenshotArtifactId?: string; caption?: string }
  | { type: "run.done"; issueId: string; runId: string; status: string }
  | { type: "browser.blocked"; issueId: string; runId: string; reason: string; target: string }
  | { type: "consultant.delta" | "consultant.done"; issueId: string; messageId: string; text?: string }
  | { type: "message.added"; issueId: string; thread: "agent" | "consultant"; message: Record<string, unknown> }
  | { type: "terminal.data"; terminalId: string; data: string }
  | { type: "job.failed"; jobId: string; error: string; issueId?: string }
  | { type: "job.done"; jobId: string; jobType: string; issueId?: string; result?: Record<string, unknown> }
  | { type: "env.updated"; environmentId: string; projectId: string };

export function topicsFor(e: WsEvent): string[] {
  const t = ["global"];
  if ("issueId" in e && e.issueId) t.push(`issue:${e.issueId}`);
  if (e.type === "terminal.data") t.push(`terminal:${e.terminalId}`);
  if (e.type === "env.updated") t.push(`env:${e.environmentId}`);
  return t;
}

/** Events relevant only to issue subscribers (not sent to 'global' so the inbox isn't flooded). */
const ISSUE_ONLY = new Set(["llm.delta", "consultant.delta", "tool.call", "tool.result", "step.started", "run.step", "terminal.data"]);

type Sink = (topic: string, payload: string) => void;
let sink: Sink | undefined;

export function setEventSink(s: Sink | undefined) {
  sink = s;
}

export function emit(e: WsEvent) {
  const payload = JSON.stringify(e);
  const topics = topicsFor(e).filter((t) => !(t === "global" && ISSUE_ONLY.has(e.type)));
  if (sink) {
    for (const t of topics) sink(t, payload);
    return;
  }
  if (typeof process.send === "function") {
    process.send({ kind: "ws", topics, payload });
  }
}

/** Shape of worker → server IPC messages. */
export type IpcMessage = { kind: "ws"; topics: string[]; payload: string } | { kind: "heartbeat"; jobId: string } | { kind: "log"; line: string };
