// Report preview & export (14 §7, 12 §5): options, HTML preview matching the PDF, inline narrative editing, finalize.
import { useEffect, useRef, useState } from "react";
import { api, artifactSrc, errMsg } from "../api.ts";
import { useApi, useTopic } from "../hooks.ts";
import { Link } from "../router.tsx";
import { ErrorBox, Loading, Time } from "../components/ui.tsx";
import { useToast } from "../components/Toasts.tsx";
import type { IssueDetail } from "../types.ts";

type Draft = { id: string; status: string; options: Record<string, unknown>; created_at: number };

export function ReportPage({ issueKey }: { issueKey: string }) {
  const d = useApi<IssueDetail>(`/api/issues/${encodeURIComponent(issueKey)}`, [issueKey]);
  const toast = useToast();
  const [opts, setOpts] = useState({ audience: "internal", includeCost: false, redactedOnly: false, formats: ["pdf", "xlsx"] as string[] });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [builtWith, setBuiltWith] = useState("");
  const [busy, setBusy] = useState(false);
  const [v, setV] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);
  useTopic(d.data ? `issue:${d.data.issue.id}` : null, (ev) => {
    if (ev.type === "job.done" && ev.jobType === "build_report") {
      toast("Report finished building", "success");
      d.reload();
    }
    if (ev.type === "job.failed") toast(String(ev.error), "error");
  });
  useEffect(() => setOpts((o) => ({ ...o, redactedOnly: o.audience === "client", includeCost: o.audience === "client" ? false : o.includeCost })), [opts.audience]);
  if (d.error) return <ErrorBox message={d.error} onRetry={d.reload} />;
  if (!d.data) return <Loading />;
  const issue = d.data.issue;
  const reports = d.data.artifacts.filter((a) => a.kind.startsWith("report_") || a.kind === "bundle_zip");

  const build = async () => {
    setBusy(true);
    try {
      setDraft(await api<Draft>(`/api/issues/${issue.id}/reports`, { method: "POST", json: { ...opts } }));
      setBuiltWith(JSON.stringify(opts));
      setV((x) => x + 1);
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  };
  const collectEdits = () => {
    const doc = frame.current?.contentDocument;
    const out: Record<string, string> = {};
    doc?.querySelectorAll<HTMLElement>("[data-edit]").forEach((el) => (out[el.dataset.edit!] = el.innerText.trim()));
    return out;
  };
  const saveEdits = async () => {
    if (!draft) return;
    try {
      await api(`/api/reports/${draft.id}`, { method: "PATCH", json: { overrides: collectEdits() } });
      toast("Narrative changes saved", "success");
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };
  const finalize = async () => {
    if (!draft) return;
    try {
      await api(`/api/reports/${draft.id}/finalize`, { method: "POST", json: { overrides: collectEdits() } });
      toast("Building report files");
      setDraft({ ...draft, status: "building" });
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };
  const fmt = (f: string) => setOpts((o) => ({ ...o, formats: o.formats.includes(f) ? o.formats.filter((x) => x !== f) : [...o.formats, f] }));
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <span className="t-caption"><Link to={`/issues/${issue.key}`}>{issue.key}</Link> · report</span>
          <h1 className="t-title">Report and export</h1>
        </div>
      </div>
      <div className="row" style={{ gap: "var(--ns-space-6)", alignItems: "flex-end" }}>
        <label className="field"><span className="label">Audience</span><select className="select" value={opts.audience} onChange={(e) => setOpts({ ...opts, audience: e.target.value })}><option value="internal">Internal</option><option value="client">Client</option></select></label>
        <fieldset className="row" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="t-label" style={{ marginBottom: 6 }}>Format</legend>
          {["pdf", "xlsx", "md", "zip"].map((f) => <label key={f} className="check t-compact"><input type="checkbox" checked={opts.formats.includes(f)} onChange={() => fmt(f)} />{f.toUpperCase()}</label>)}
        </fieldset>
        <label className="check t-compact"><input type="checkbox" disabled={opts.audience === "client"} checked={opts.includeCost} onChange={(e) => setOpts({ ...opts, includeCost: e.target.checked })} />Include cost</label>
        <label className="check t-compact"><input type="checkbox" disabled={opts.audience === "client"} checked={opts.redactedOnly} onChange={(e) => setOpts({ ...opts, redactedOnly: e.target.checked })} />Redacted artifacts only</label>
        <button className={`btn${draft ? "" : " primary"}`} disabled={busy || !opts.formats.length} onClick={build}>{busy ? "Building" : draft ? "Rebuild preview" : "Build preview"}</button>
      </div>
      {draft && (
        <div className="stack">
          <div className="row-between">
            <span className="t-caption">{builtWith !== JSON.stringify(opts) ? <span className="warn-text">Options changed. Rebuild the preview to apply them.</span> : "Click text with a dashed outline to edit the narrative. The preview matches the PDF."}</span>
            <div className="row"><button className="btn" onClick={saveEdits}>Save edits</button><button className="btn primary" onClick={finalize} disabled={draft.status !== "draft"}>{draft.status === "building" ? "Building files" : "Finalize"}</button></div>
          </div>
          <iframe ref={frame} key={v} className="report" title="Report preview" src={`/api/issues/${issue.id}/reports/preview?draft=${draft.id}&edit=1&audience=${opts.audience}`} />
        </div>
      )}
      <section className="block" aria-labelledby="h-files">
        <h2 id="h-files" className="t-heading">Report files</h2>
        {!reports.length ? <span className="t-compact muted">No final report yet. Build a preview, then Finalize to create the files.</span> : (
          <table className="t">
            <caption className="sr-only">Report files</caption>
            <thead><tr><th scope="col">File</th><th scope="col" className="num">Size</th><th scope="col" className="num">Created</th></tr></thead>
            <tbody>{reports.map((r) => <tr key={r.id}><td><a href={artifactSrc(r.id, true)}>{r.storage_path.split("/").pop()}</a></td><td className="num">{r.size_bytes ? `${Math.max(1, Math.round(r.size_bytes / 1024))} KB` : <span className="faint">-</span>}</td><td className="num"><Time ms={r.created_at} withDate /></td></tr>)}</tbody>
          </table>
        )}
      </section>
    </div>
  );
}
