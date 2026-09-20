// Issue workspace (14 §4): left summary + evidence board, center agent/consultant, right session + actions + artifacts.
import { useEffect, useMemo, useState } from "react";
import { api, artifactSrc, errMsg, isMock } from "../api.ts";
import { useApi, useDebounced, useTopic } from "../hooks.ts";
import { Link, navigate } from "../router.tsx";
import { CopyButton, Dialog, Empty, ErrorBox, EvidenceLevel, Html, Loading, Money, Status, Time, fmtTokens, stateLabel, tierLabel } from "../components/ui.tsx";
import { Icon } from "../components/Icon.tsx";
import { useToast } from "../components/Toasts.tsx";
import type { Artifact, Evidence, IssueDetail, Message, Run, Step } from "../types.ts";

export function IssuePage({ issueKey }: { issueKey: string }) {
  const d = useApi<IssueDetail>(`/api/issues/${encodeURIComponent(issueKey)}`, [issueKey]);
  const [tab, setTab] = useState<"agent" | "consultant">("agent");
  const [mview, setMview] = useState<"summary" | "agent" | "artifacts">("agent");
  const [live, setLive] = useState<{ stepId: string; text: string } | null>(null);
  const [tick, setTick] = useState(0);
  const toast = useToast();
  const reload = useDebounced(() => {
    d.reload();
    setTick((t) => t + 1);
  }, 300);
  const issueId = d.data?.issue.id ?? null;

  useTopic(issueId ? `issue:${issueId}` : null, (ev) => {
    if (ev.type === "llm.delta") {
      setLive((l) => (l && l.stepId === ev.stepId ? { stepId: l.stepId, text: (l.text + String(ev.text)).slice(-1500) } : { stepId: String(ev.stepId), text: String(ev.text) }));
      return;
    }
    if (ev.type === "step.done") setLive(null);
    if (ev.type === "usage.warning") toast(`Usage reached ${Math.round(Number(ev.percent))}% of issue budget`, "warning");
    if (ev.type === "usage.exceeded") toast("Issue budget exhausted. Add budget then Resume.", "error");
    if (ev.type === "browser.blocked") toast(`Blocked by guard: ${ev.reason}`, "warning");
    if (ev.type === "job.failed") toast(`Job failed: ${ev.error}`, "error");
    if (ev.type === "checkpoint") toast("Agent is waiting for your answer", "info");
    if (ev.type !== "tool.call") reload();
  });
  useTopic("global", (ev) => ev.type === "ws.reconnected" && reload());

  if (d.error) return <ErrorBox message={d.error} onRetry={d.reload} />;
  if (!d.data) return <Loading lines={8} />;
  const x = d.data;
  const i = x.issue;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <span className="t-caption"><Link to="/">Inbox</Link> · {x.project.name}</span>
          <h1 className="t-title"><span className="t-mono faint" style={{ fontSize: 18, marginRight: 8 }}>{i.key}</span>{i.title}</h1>
          <div className="row t-compact muted">
            <Status value={i.status} />
            <span>·</span>
            <EvidenceLevel level={i.evidence_level} long />
            {x.environment && <><span>·</span><span>{x.environment.name} ({x.environment.kind}) · {tierLabel(x.environment.tier)}</span></>}
            {i.category && <><span>·</span><span>{i.category} · {i.severity} · {i.module_area}</span></>}
          </div>
        </div>
      </div>
      <div className="mobile-tabs tabs" role="tablist" aria-label="Issue sections">
        {([["summary", "Summary"], ["agent", "Agent"], ["artifacts", "Artifacts"]] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={mview === k} onClick={() => setMview(k)}>{l}</button>
        ))}
      </div>
      <div className="workspace" data-mview={mview}>
        <LeftColumn x={x} reload={d.reload} />
        <div className="col col-center" style={{ gap: "var(--ns-space-4)" }}>
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === "agent"} onClick={() => setTab("agent")}>Agent</button>
            <button role="tab" aria-selected={tab === "consultant"} onClick={() => setTab("consultant")}>Consultant</button>
          </div>
          {tab === "agent" ? <AgentPanel x={x} live={live} tick={tick} /> : <ConsultantPanel issueId={i.id} tick={tick} />}
        </div>
        <RightColumn x={x} reload={d.reload} />
      </div>
    </div>
  );
}

// ───────── Left ─────────
function LeftColumn({ x, reload }: { x: IssueDetail; reload: () => void }) {
  const toast = useToast();
  const [showDesc, setShowDesc] = useState(false);
  const i = x.issue;
  const patchEntity = async (id: string, status: string) => {
    try {
      await api(`/api/entities/${id}`, { method: "PATCH", json: { status } });
      reload();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };
  const patchEvidence = async (id: string, body: Record<string, unknown>) => {
    try {
      await api(`/api/evidence/${id}`, { method: "PATCH", json: body });
      reload();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };
  const ents = x.entities.filter((e) => e.status !== "rejected");
  return (
    <div className="col col-left">
      <section className="block" aria-labelledby="h-sum">
        <h2 id="h-sum" className="t-subheading">Summary</h2>
        {x.rootCauseHtml ? <Html html={x.rootCauseHtml} className="t-compact" /> : <p className="t-compact muted" style={{ margin: 0 }}>Root cause not yet determined.</p>}
        <dl className="kv">
          <dt>Reporter</dt><dd>{i.reporter ?? "-"}</dd>
          <dt>Priority</dt><dd>{i.priority}</dd>
          <dt>Created</dt><dd><Time ms={i.created_at} withDate /></dd>
        </dl>
        {i.description && (
          <div className="stack" style={{ gap: 4 }}>
            <button className="link-btn" onClick={() => setShowDesc((v) => !v)}>{showDesc ? "Hide description" : "Show description"}</button>
            {showDesc && <div className="t-compact" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{i.description}</div>}
          </div>
        )}
        {i.triage && (
          <details>
            <summary className="t-label" style={{ cursor: "pointer" }}>Investigation plan</summary>
            <ol className="t-compact" style={{ paddingLeft: 18, margin: "8px 0 0" }}>{i.triage.plan.map((p, k) => <li key={k}>{p}</li>)}</ol>
          </details>
        )}
        {!!i.questions_for_client?.length && (
          <details>
            <summary className="t-label" style={{ cursor: "pointer" }}>Questions for client ({i.questions_for_client.length})</summary>
            <ul className="t-compact" style={{ paddingLeft: 18, margin: "8px 0 0" }}>{i.questions_for_client.map((q, k) => <li key={k}>{q}</li>)}</ul>
            <CopyButton text={i.questions_for_client.map((q) => `- ${q}`).join("\n")} label="Copy questions" />
          </details>
        )}
      </section>

      <section className="block" aria-labelledby="h-att">
        <h2 id="h-att" className="t-subheading">Attachments <span className="faint">{x.attachments.length}</span></h2>
        {!x.attachments.length ? <span className="t-compact muted">No attachments.</span> : (
          <ul className="list">
            {x.attachments.map((a) => (
              <li key={a.id}>
                <div className="line"><a className="grow t-compact" href={isMock() ? "#" : `/api/attachments/${a.id}/raw`}>{a.filename}</a><Status value={a.ingest_status === "done" ? "done" : a.ingest_status === "unsupported" ? "blocked" : a.ingest_status} /></div>
                {a.summary && <span className="t-caption" style={{ overflowWrap: "anywhere" }}>{a.summary}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="block" aria-labelledby="h-ent">
        <h2 id="h-ent" className="t-subheading">Entities <span className="faint">{ents.length}</span></h2>
        {!ents.length ? <span className="t-compact muted">No entities extracted yet.</span> : (
          <ul className="list">
            {ents.map((e) => (
              <li key={e.id}>
                <span className="t-caption">{e.type.replace(/_/g, " ")}{e.source_locator ? ` · ${e.source_locator}` : ""}</span>
                <div className="line">
                  <span className="grow t-mono" style={{ overflowWrap: "anywhere" }}>{e.normalized ?? e.value}</span>
                  {e.status === "confirmed" || e.status === "manual" ? <Icon name="check" label="Confirmed" className="ok-text" /> : (
                    <>
                      <button className="btn ghost sm" aria-label={`Confirm ${e.value}`} onClick={() => patchEntity(e.id, "confirmed")}><Icon name="check" /></button>
                      <button className="btn ghost sm" aria-label={`Reject ${e.value}`} onClick={() => patchEntity(e.id, "rejected")}><Icon name="x" /></button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="block" aria-labelledby="h-ev">
        <h2 id="h-ev" className="t-subheading">Evidence board</h2>
        {!x.evidence.length ? <span className="t-compact muted">No evidence yet.</span> : (
          <ul className="list">
            {x.evidence.map((e: Evidence) => (
              <li key={e.id} style={{ opacity: e.status === "rejected" ? 0.5 : 1 }}>
                <div className="line"><span className="t-mono faint">#E{e.seq}</span><EvidenceLevel level={e.level} /><span className="grow t-compact w500">{e.title}</span></div>
                {e.body && <span className="t-caption" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{e.body.slice(0, 400)}</span>}
                {e.ref && <span className="t-mono t-caption" style={{ overflowWrap: "anywhere" }}>{refLine(e.ref)}</span>}
                <div className="row actions">
                  <span className="t-caption">{e.status}{e.private ? " · private" : ""}</span>
                  {e.status !== "confirmed" && <button className="btn ghost sm" onClick={() => patchEvidence(e.id, { status: "confirmed" })}>Confirm</button>}
                  {e.status !== "rejected" && <button className="btn ghost sm" onClick={() => patchEvidence(e.id, { status: "rejected" })}>Reject</button>}
                  <button className="btn ghost sm" onClick={() => patchEvidence(e.id, { private: !e.private })}>{e.private ? "Public" : "Private"}</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="block" aria-labelledby="h-hyp">
        <h2 id="h-hyp" className="t-subheading">Hypotheses</h2>
        {!x.hypotheses.length ? <span className="t-compact muted">No hypotheses yet.</span> : (
          <ul className="list">
            {x.hypotheses.map((h) => (
              <li key={h.id}>
                <div className="line"><span className="t-mono num" style={{ minWidth: 40 }}>{Math.round(h.confidence * 100)}%</span><span className="grow t-compact" style={{ textDecoration: h.status === "refuted" ? "line-through" : undefined }}>{h.statement}</span></div>
                <span className="t-caption">{h.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

const refLine = (r: Record<string, unknown>) => (r.file && r.line ? `${String(r.file).split("/").pop()}:${r.line}` : r.scriptid ? String(r.scriptid) : r.query ? String(r.query).slice(0, 100) : r.run_id ? `run ${String(r.run_id).slice(-6)}` : JSON.stringify(r).slice(0, 100));

// ───────── Center: agent ─────────
function AgentPanel({ x, live, tick }: { x: IssueDetail; live: { stepId: string; text: string } | null; tick: number }) {
  const sessions = x.sessions;
  const [sid, setSid] = useState<string | null>(null);
  const current = sid ?? x.activeSession?.id ?? sessions[0]?.id ?? null;
  const steps = useApi<{ steps: Step[]; totals: IssueDetail["usage"]["totals"] }>(current ? `/api/sessions/${current}/steps` : null, [current, tick]);
  const msgs = useApi<Message[]>(`/api/issues/${x.issue.id}/threads/agent/messages`, [tick]);
  const sess = sessions.find((s) => s.id === current);
  const lastCheckpoint = [...(msgs.data ?? [])].reverse().find((m) => m.meta?.checkpoint);
  const pending = sess?.status === "awaiting_user" && lastCheckpoint;
  return (
    <div className="stack-lg">
      {sessions.length > 1 && (
        <div className="row t-compact">
          <label htmlFor="sess">Session</label>
          <select id="sess" className="select" style={{ width: "auto" }} value={current ?? ""} onChange={(e) => setSid(e.target.value)}>
            {sessions.map((s) => <option key={s.id} value={s.id}>{new Date(s.started_at).toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" })} · {s.trigger} · {s.status}</option>)}
          </select>
        </div>
      )}
      {x.blocked.length > 0 && (
        <div className="stack" style={{ gap: 4 }}>
          {x.blocked.slice(0, 5).map((b) => (
            <div key={b.id} className="row t-compact"><Icon name="warning" className="warn-text" /><span className="warn-text w500">Blocked</span><span className="muted" style={{ overflowWrap: "anywhere" }}>{String(b.detail?.reason ?? b.action)}{b.detail?.target ? `: ${String(b.detail.target).slice(0, 100)}` : ""}</span></div>
          ))}
        </div>
      )}
      <section className="block" aria-labelledby="h-tl">
        <h2 id="h-tl" className="sr-only">Timeline</h2>
        {!current ? <Empty title="Agent hasn't run yet">Session starts automatically after ingestion, or send instructions via chat.</Empty> : steps.error ? <ErrorBox message={steps.error} onRetry={steps.reload} /> : !steps.data ? <Loading /> : (
          <div className="timeline">
            {steps.data.steps.filter((s) => s.kind !== "checkpoint").map((s) => <StepRow key={s.id} s={s} />)}
            {live && sess?.status === "running" && <div className="live" aria-live="polite">{live.text}</div>}
            {sess?.status === "running" && !live && <div className="t-caption" style={{ paddingLeft: 72 }}><Status value="running" label={stateLabel(sess.state)} /></div>}
          </div>
        )}
      </section>
      {pending && lastCheckpoint && <CheckpointBlock issueId={x.issue.id} m={lastCheckpoint} deploy={sess?.state === "AWAIT_DEPLOY_APPROVAL"} sessionId={sess!.id} />}
      <ChatThread issueId={x.issue.id} messages={(msgs.data ?? []).filter((m) => !(pending && m.id === lastCheckpoint?.id))} reload={msgs.reload} />
    </div>
  );
}

function StepRow({ s }: { s: Step }) {
  const [open, setOpen] = useState(false);
  const u = s.usage;
  const cacheRatio = u ? u.cache_read_tokens / Math.max(1, u.input_tokens + u.cache_read_tokens + u.cache_write_tokens) : 0;
  const ms = s.ended_at ? s.ended_at - s.started_at : 0;
  const dur = s.kind !== "transition" && ms >= 100 ? `${(ms / 1000).toFixed(1)}s` : "";
  return (
    <div className={`step ${s.kind}${s.status === "failed" ? " failed" : ""}`}>
      <span className="time">{new Date(s.started_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })}</span>
      <div className="body">
        <button className="expander" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span className={`title ${s.kind === "transition" ? "t-caption" : "t-subheading"}`} style={{ fontSize: s.kind === "tool" ? 13 : undefined }}>{s.title ?? s.kind}</span>
        </button>
        {s.summary && <div className="summary">{open ? s.summary : s.summary.slice(0, 220)}{!open && s.summary.length > 220 ? "…" : ""}</div>}
        {(u || dur) && <span className="chip">{u ? `in ${fmtTokens(u.input_tokens)} · out ${fmtTokens(u.output_tokens)} · cache ${Math.round(cacheRatio * 100)}% · $${u.cost_usd.toFixed(3)}` : ""}{u && dur ? " · " : ""}{dur}</span>}
        {open && s.toolCalls.map((t) => (
          <div key={t.id} className="stack" style={{ gap: 4, marginTop: 4 }}>
            <span className="t-caption">{t.tool} · {t.risk}{t.duration_ms ? ` · ${t.duration_ms} ms` : ""}{t.ok === false ? " · failed" : ""}</span>
            <pre className="code">{JSON.stringify(t.input, null, 1)}</pre>
            {t.output_preview && <pre className="code">{t.output_preview}</pre>}
          </div>
        ))}
      </div>
    </div>
  );
}

type Approval = { toolCallId?: string; branch?: string; files?: string[]; objects?: string[]; diff?: string };

function CheckpointBlock({ issueId, m, deploy, sessionId }: { issueId: string; m: Message; deploy: boolean; sessionId: string }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const opts = (m.meta?.options as string[] | undefined) ?? [];
  const approval = (m.meta?.approval as Approval | undefined) ?? null;
  const answer = async (a: string) => {
    setBusy(true);
    try {
      if (deploy) {
        let id = approval?.toolCallId;
        if (!id) {
          const steps = await api<{ steps: Step[] }>(`/api/sessions/${sessionId}/steps`);
          id = steps.steps.flatMap((s) => s.toolCalls).reverse().find((t) => t.tool === "sdf_deploy_sandbox")?.id;
        }
        if (!id) throw new Error("No pending deploy approval was found for this session.");
        const approve = /^approve/i.test(a.trim());
        await api(`/api/approvals/${id}`, { method: "POST", json: { approve, note: a } });
        toast(approve ? "Deploy approved. The agent will deploy to sandbox and verify." : "Deploy rejected", approve ? "success" : "info");
      } else await api(`/api/issues/${issueId}/threads/agent/messages`, { method: "POST", json: { content: a } });
      setText("");
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  };
  const objects = approval?.objects ?? [];
  const files = approval?.files ?? [];
  return (
    <div className="checkpoint" role="region" aria-label={deploy ? "Deploy approval" : "Agent question"}>
      <div className="t-subheading">{m.content}</div>
      {deploy && (
        <div className="stack">
          {approval?.branch && <span className="t-caption">Branch <span className="t-mono">{approval.branch}</span></span>}
          {files.length + objects.length > 0 ? (
            <table className="t">
              <caption className="sr-only">Changes to deploy</caption>
              <thead><tr><th scope="col">Changed file or object</th><th scope="col">Type</th></tr></thead>
              <tbody>
                {files.map((f) => <tr key={f}><td className="t-mono" style={{ overflowWrap: "anywhere" }}>{f}</td><td>file</td></tr>)}
                {objects.map((o) => <tr key={o}><td className="t-mono" style={{ overflowWrap: "anywhere" }}>{o}</td><td>SDF object</td></tr>)}
              </tbody>
            </table>
          ) : <span className="t-compact muted">The change list isn't available. Check the FIX steps in the timeline before approving.</span>}
          {approval?.diff && (
            <details open>
              <summary className="t-label" style={{ cursor: "pointer" }}>Diff</summary>
              <Diff text={approval.diff} />
            </details>
          )}
          <span className="t-caption">Deploys only to the sandbox account. Production is never written to.</span>
        </div>
      )}
      <div className="row">
        {opts.map((o, k) => {
          const reject = deploy && /^reject/i.test(o);
          return <button key={o} disabled={busy} className={`btn${k === 0 ? " primary" : reject ? " danger" : ""}`} onClick={() => answer(o)}>{o}</button>;
        })}
      </div>
      {!deploy && (
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (text.trim()) void answer(text); }}>
          <input className="input" style={{ flex: 1 }} placeholder="Or type your own answer" value={text} onChange={(e) => setText(e.target.value)} aria-label="Answer" />
          <button className="btn" disabled={busy || !text.trim()}>Send</button>
        </form>
      )}
    </div>
  );
}

/** Unified diff with +/- markers kept in the text, so color is never the only signal. */
function Diff({ text }: { text: string }) {
  return (
    <pre className="code diff">
      {text.split("\n").map((l, k) => (
        <span key={k} className={l.startsWith("+") && !l.startsWith("+++") ? "add" : l.startsWith("-") && !l.startsWith("---") ? "del" : l.startsWith("@@") ? "hunk" : undefined}>{l}{"\n"}</span>
      ))}
    </pre>
  );
}

const COMMAND_HELP: Record<string, string> = { "/capture": "Final capture: screenshots and video (needs E3)", "/fix": "Draft a fix on a branch (sandbox tier A/B)", "/verify": "Replay the repro script after the fix", "/stop": "Stop the running session" };

function ChatThread({ issueId, messages, reload }: { issueId: string; messages: Message[]; reload: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const send = async (content: string) => {
    if (!content.trim()) return;
    setBusy(true);
    try {
      await api(`/api/issues/${issueId}/threads/agent/messages`, { method: "POST", json: { content } });
      setText("");
      reload();
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="block" aria-labelledby="h-chat">
      <h2 id="h-chat" className="t-subheading">Chat</h2>
      <div className="chat">
        {!messages.length && <span className="t-compact muted">No messages yet. Give the agent direction, ask what it has proven so far, or confirm evidence.</span>}
        {messages.map((m) => (
          <div key={m.id} className={`msg${m.role === "system_event" ? " system" : ""}`}>
            {m.role !== "system_event" && <span className="who">{m.role === "user" ? "You" : "Agent"} · <Time ms={m.created_at} /></span>}
            {m.role === "system_event" ? <span>· {m.content}</span> : <Html html={m.html} />}
          </div>
        ))}
      </div>
      <form className="composer" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
        <textarea className="textarea" placeholder="Ask a question, give direction (e.g. check the approval workflow), or confirm evidence (e.g. #E3 is correct). Press Cmd+Enter to send." value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send(text); }} aria-label="Message to agent" />
        <div className="row-between">
          <div className="row">
            <span className="t-caption">Commands</span>
            {["/capture", "/fix", "/verify", "/stop"].map((c) => <button key={c} type="button" className="btn ghost sm t-mono" title={COMMAND_HELP[c]} onClick={() => send(c)} disabled={busy}>{c}</button>)}
          </div>
          <button className="btn primary" disabled={busy || !text.trim()}>Send</button>
        </div>
      </form>
    </section>
  );
}

// ───────── Center: consultant ─────────
function ConsultantPanel({ issueId, tick }: { issueId: string; tick: number }) {
  const msgs = useApi<Message[]>(`/api/issues/${issueId}/threads/consultant/messages`, [tick]);
  const [q, setQ] = useState("");
  const [p, setP] = useState({ language: "auto", tone: "casual", length: "short", audience: "functional", eta: "" });
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const draft = async (question: string, extra: Record<string, unknown> = {}) => {
    setBusy(true);
    try {
      await api(`/api/issues/${issueId}/threads/consultant/draft`, { method: "POST", json: { question, ...p, ...(p.eta ? {} : { eta: undefined }), ...extra } });
      msgs.reload();
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  };
  const faq = async (id: string, v: boolean) => {
    await api(`/api/messages/${id}/faq`, { method: "POST", json: { faq: v } }).catch((e) => toast(errMsg(e), "error"));
    msgs.reload();
  };
  const drafts = (msgs.data ?? []).filter((m) => m.role === "assistant").reverse();
  return (
    <div className="stack-lg">
      <form className="stack" onSubmit={(e) => { e.preventDefault(); if (q.trim()) void draft(q); }}>
        <textarea className="textarea" rows={4} placeholder="Paste the consultant's question" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Consultant question" />
        <div className="row">
          <select className="select" style={{ width: "auto" }} aria-label="Language" value={p.language} onChange={(e) => setP({ ...p, language: e.target.value })}><option value="auto">Match question</option><option value="id">Indonesian</option><option value="en">English</option></select>
          <select className="select" style={{ width: "auto" }} aria-label="Tone" value={p.tone} onChange={(e) => setP({ ...p, tone: e.target.value })}><option value="casual">Casual-professional</option><option value="formal">Formal</option></select>
          <select className="select" style={{ width: "auto" }} aria-label="Length" value={p.length} onChange={(e) => setP({ ...p, length: e.target.value })}><option value="short">1–2 sentences</option><option value="paragraph">1 paragraph</option><option value="bullets">Bullet points</option></select>
          <select className="select" style={{ width: "auto" }} aria-label="Audience" value={p.audience} onChange={(e) => setP({ ...p, audience: e.target.value })}><option value="functional">Functional consultant</option><option value="client">End-user client</option><option value="technical">Technical team</option></select>
          <input className="input" style={{ width: 160 }} placeholder="ETA (optional)" aria-label="ETA" value={p.eta} onChange={(e) => setP({ ...p, eta: e.target.value })} />
          <button className="btn primary" disabled={busy || !q.trim()}>{busy ? "Drafting" : "Create draft"}</button>
        </div>
      </form>
      {msgs.error ? <ErrorBox message={msgs.error} onRetry={msgs.reload} /> : !drafts.length ? <Empty title="No drafts yet">Answers are drafted only from this issue's public evidence; secrets, local paths, and costs are filtered out.</Empty> : (
        <div className="stack-lg">
          {drafts.map((m) => {
            const held = m.meta?.held === true;
            return (
              <div key={m.id} className="stack">
                <span className="t-caption">Question: {String(m.meta?.question ?? "").slice(0, 200)}</span>
                {held ? <div className="error-box"><span className="warn-text w500">Draft held</span><span className="t-compact">Detected: {(m.meta?.violations as string[]).join(", ")}. Review before copying.</span><div className="t-compact" style={{ whiteSpace: "pre-wrap" }}>{m.content}</div></div> : <div className="t-body" style={{ whiteSpace: "pre-wrap" }}>{m.content}</div>}
                <span className="t-caption">References: {((m.meta?.cited as string[]) ?? []).join(", ") || "-"}{m.meta?.confidence_note ? ` · ${String(m.meta.confidence_note)}` : ""}</span>
                <div className="row">
                  {!held && <CopyButton text={m.content} />}
                  <button className="btn ghost sm" disabled={busy} onClick={() => draft(String(m.meta?.question ?? ""), { modifier: "shorter", previousDraftId: m.id })}>Shorter</button>
                  <button className="btn ghost sm" disabled={busy} onClick={() => draft(String(m.meta?.question ?? ""), { modifier: "more_formal", tone: "formal", previousDraftId: m.id })}>More formal</button>
                  <button className="btn ghost sm" disabled={busy} onClick={() => draft(String(m.meta?.question ?? ""), { modifier: "translate", language: p.language === "en" ? "id" : "en", previousDraftId: m.id })}>Translate</button>
                  <button className="btn ghost sm" onClick={() => faq(m.id, !(m.meta?.faq === true))}>{m.meta?.faq ? "Remove from FAQ" : "Add to issue FAQ"}</button>
                </div>
                <hr className="sep" />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ───────── Right ─────────
function RightColumn({ x, reload }: { x: IssueDetail; reload: () => void }) {
  const toast = useToast();
  const [lightbox, setLightbox] = useState<{ list: Artifact[]; idx: number } | null>(null);
  const [addBudget, setAddBudget] = useState(false);
  const s = x.activeSession ?? x.sessions[0] ?? null;
  const pct = x.usage.budget > 0 ? (x.usage.totals.cost_usd / x.usage.budget) * 100 : 0;
  const tier = x.environment?.tier ?? "none";
  const canFix = x.environment?.kind === "sandbox" && ["A", "B"].includes(tier);
  // Final capture replays a repro script in a NetSuite environment; code-only E4 has nothing to replay.
  const canCapture = !!x.environment && x.issue.evidence_level >= 3;
  const captureHint = !x.environment ? "Requires a NetSuite environment" : x.issue.evidence_level < 3 ? "Requires at least E3" : undefined;
  const call = async (path: string, json: unknown, ok: string) => {
    try {
      await api(path, { method: "POST", json });
      toast(ok, "success");
      reload();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };
  const shotsByRun = useMemo(() => {
    const m = new Map<string, Artifact[]>();
    for (const a of x.artifacts.filter((a) => a.kind === "screenshot")) m.set(a.run_id ?? "-", [...(m.get(a.run_id ?? "-") ?? []), a]);
    return m;
  }, [x.artifacts]);
  const videos = x.artifacts.filter((a) => a.kind === "video");
  const reports = x.artifacts.filter((a) => a.kind.startsWith("report_") || a.kind === "bundle_zip");
  return (
    <div className="col col-sticky col-right">
      <section className="block" aria-labelledby="h-sess">
        <h2 id="h-sess" className="t-subheading">Session</h2>
        {!s ? <span className="t-compact muted">No session yet.</span> : (
          <dl className="kv">
            <dt>Status</dt><dd><Status value={s.status} /></dd>
            <dt>State</dt><dd>{stateLabel(s.state)}</dd>
            <dt>Model</dt><dd className="t-mono">{s.model_main}</dd>
            <dt>Started</dt><dd><Time ms={s.started_at} /></dd>
            {s.error && <><dt>Error</dt><dd className="err-text">{s.error}</dd></>}
          </dl>
        )}
        <div className="stack" style={{ gap: 4 }}>
          <div className="row-between t-compact"><span>Cost</span><span className="num"><Money usd={x.usage.totals.cost_usd} /> / ${x.usage.budget.toFixed(2)}</span></div>
          <div className={`bar${pct >= 100 ? " over" : pct >= 80 ? " warn" : ""}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label="Budget usage"><span style={{ width: `${Math.min(100, pct)}%` }} /></div>
          <span className="t-caption">{fmtTokens(x.usage.totals.input_tokens + x.usage.totals.cache_read_tokens + x.usage.totals.cache_write_tokens)} in · {fmtTokens(x.usage.totals.output_tokens)} out · cache {Math.round(x.usage.cacheHitRatio * 100)}% · {x.usage.totals.calls} calls</span>
        </div>
        <div className="row">
          {s?.status === "running" && <button className="btn sm" onClick={() => call(`/api/sessions/${s.id}/cancel`, {}, "Session cancelled")}><Icon name="stop" />Stop</button>}
          {s && ["awaiting_user", "budget_exceeded", "failed", "cancelled"].includes(s.status) && <button className="btn sm" onClick={() => call(`/api/sessions/${s.id}/resume`, {}, "Session resumed")}><Icon name="play" />Resume</button>}
          <button className="btn sm" onClick={() => setAddBudget((v) => !v)}>Add budget</button>
        </div>
        {addBudget && (
          <div className="row">
            {[1, 5].map((n) => <button key={n} className="btn sm" onClick={async () => { await api(`/api/issues/${x.issue.id}`, { method: "PATCH", json: { add_budget_usd: n } }).catch((e) => toast(errMsg(e), "error")); setAddBudget(false); reload(); }}>+${n}</button>)}
          </div>
        )}
      </section>

      <section className="block" aria-labelledby="h-act">
        <h2 id="h-act" className="t-subheading">Actions</h2>
        <div className="stack" style={{ gap: 8 }}>
          <button className={`btn block${canCapture ? " primary" : ""}`} disabled={!canCapture} title={captureHint} onClick={() => call(`/api/issues/${x.issue.id}/sessions`, { trigger: "capture", state: "CAPTURE" }, "Final capture scheduled")}>Capture final</button>
          {x.issue.evidence_level < 3 && <span className="t-caption">Capture becomes available once the issue is reproduced (E3).</span>}
          <button className="btn block" disabled={!canFix} title={canFix ? undefined : "Requires sandbox tier A/B"} onClick={() => call(`/api/issues/${x.issue.id}/sessions`, { trigger: "fix", state: "FIX" }, "Agent is drafting a fix")}>Fix</button>
          <button className={`btn block${canCapture ? "" : " primary"}`} onClick={() => navigate(`/issues/${x.issue.key}/report`)}>Export</button>
          <button className="btn block" onClick={() => call(`/api/issues/${x.issue.id}/sessions`, { trigger: "manual", state: "TRIAGE" }, "Investigation restarted")}><Icon name="refresh" />Re-run</button>
        </div>
      </section>

      <section className="block" aria-labelledby="h-art">
        <h2 id="h-art" className="t-subheading">Artifacts</h2>
        {!x.artifacts.length ? <span className="t-compact muted">Screenshots, videos, and reports appear here.</span> : null}
        {[...shotsByRun.entries()].map(([runId, list]) => {
          const run = x.runs.find((r: Run) => r.id === runId);
          return (
            <div key={runId} className="stack" style={{ gap: 6 }}>
              <span className="t-caption">{run ? `${run.mode} · ${run.status} · ` : ""}{list.length} screenshot</span>
              <div className="gallery">
                {list.map((a, k) => (
                  <figure key={a.id}>
                    <img src={artifactSrc(a.id)} alt={a.caption ?? `Step ${a.step_index}`} loading="lazy" onClick={() => setLightbox({ list, idx: k })} />
                    <figcaption><span className="t-mono">{a.step_index}</span> · {a.caption}</figcaption>
                  </figure>
                ))}
              </div>
            </div>
          );
        })}
        {videos.map((v) => <VideoBlock key={v.id} v={v} x={x} />)}
        {reports.length > 0 && (
          <ul className="list">
            {reports.map((r) => <li key={r.id}><div className="line"><Icon name="download" /><a className="grow t-compact" href={artifactSrc(r.id, true)}>{r.caption}</a><span className="t-caption"><Time ms={r.created_at} /></span></div></li>)}
          </ul>
        )}
      </section>
      {lightbox && <Lightbox list={lightbox.list} idx={lightbox.idx} onClose={() => setLightbox(null)} />}
    </div>
  );
}

function VideoBlock({ v, x }: { v: Artifact; x: IssueDetail }) {
  const run = x.runs.find((r) => r.id === v.run_id);
  const cap = x.artifacts.find((a) => a.kind === "captions" && a.run_id === v.run_id);
  const [el, setEl] = useState<HTMLVideoElement | null>(null);
  const [cues, setCues] = useState<{ start: number; text: string }[]>([]);
  useEffect(() => {
    if (!cap || isMock()) return;
    fetch(`/api/artifacts/${cap.id}/file`).then((r) => r.text()).then((t) => {
      const out: { start: number; text: string }[] = [];
      for (const m of t.matchAll(/(\d\d):(\d\d):(\d\d)\.(\d{3}) --> [^\n]+\n([^\n]+)/g)) out.push({ start: +m[1]! * 3600 + +m[2]! * 60 + +m[3]! + +m[4]! / 1000, text: m[5]! });
      setCues(out);
    }).catch(() => {});
  }, [cap?.id]);
  return (
    <div className="stack" style={{ gap: 6 }}>
      <span className="t-caption">Video {run?.mode ?? ""}</span>
      <video ref={setEl} controls preload="metadata" src={`/api/artifacts/${v.id}/file`}>{cap && <track kind="captions" src={`/api/artifacts/${cap.id}/file`} default />}</video>
      {cues.length > 0 && <ol className="t-compact" style={{ paddingLeft: 18, margin: 0 }}>{cues.map((c, k) => <li key={k}><button className="btn ghost sm" style={{ height: "auto", padding: 0 }} onClick={() => { if (el) { el.currentTime = c.start; void el.play(); } }}>{c.text}</button></li>)}</ol>}
    </div>
  );
}

function Lightbox({ list, idx, onClose }: { list: Artifact[]; idx: number; onClose: () => void }) {
  const [k, setK] = useState(idx);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setK((v) => Math.min(list.length - 1, v + 1));
      if (e.key === "ArrowLeft") setK((v) => Math.max(0, v - 1));
    };
    addEventListener("keydown", h);
    return () => removeEventListener("keydown", h);
  }, [list.length]);
  const a = list[k]!;
  return (
    <Dialog title={`Step ${a.step_index}`} onClose={onClose} wide>
      <div className="lightbox stack">
        <img src={artifactSrc(a.id)} alt={a.caption ?? ""} />
        <div className="row-between"><span className="t-compact">{a.caption}</span><div className="row"><button className="btn sm" disabled={k === 0} onClick={() => setK(k - 1)}>Previous</button><button className="btn sm" disabled={k === list.length - 1} onClick={() => setK(k + 1)}>Next</button></div></div>
      </div>
    </Dialog>
  );
}
