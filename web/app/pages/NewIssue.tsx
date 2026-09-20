// New issue (14 §3): project, env (tier), title, description (paste image), attachment dropzone, auto-run, budget.
import { useEffect, useRef, useState } from "react";
import { api, errMsg } from "../api.ts";
import { useApi } from "../hooks.ts";
import { Link, navigate, useQuery } from "../router.tsx";
import { Empty, ErrorBox, Field, Loading, tierLabel } from "../components/ui.tsx";
import { Icon } from "../components/Icon.tsx";
import type { Issue, ProjectListItem } from "../types.ts";

const SUPPORTED = /\.(png|jpe?g|webp|gif|pdf|docx|xlsx|csv|txt|log|json|xml|js|eml|md|tsv)$/i;
const HINT: Record<string, string> = { msg: "Save the email as .eml", xls: "Save as .xlsx or .csv", zip: "Extract it first, archives aren't processed automatically" };
const MAX_BYTES = 50 * 1024 * 1024;
const fmtSize = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export function NewIssuePage() {
  const qs = useQuery();
  const projects = useApi<ProjectListItem[]>("/api/projects");
  const [projectId, setProjectId] = useState(qs.get("project") ?? "");
  const [envId, setEnvId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [reporter, setReporter] = useState("");
  const [priority, setPriority] = useState("normal");
  const [files, setFiles] = useState<{ file: File; pasted: boolean }[]>([]);
  const [autoRun, setAutoRun] = useState(true);
  const [budget, setBudget] = useState("");
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const project = projects.data?.find((p) => p.id === projectId);

  useEffect(() => {
    if (!projectId && projects.data?.length === 1) setProjectId(projects.data[0]!.id);
  }, [projects.data, projectId]);
  useEffect(() => {
    if (project) {
      setAutoRun(project.auto_run_agent);
      setBudget(String(project.default_budget_usd));
      setEnvId(project.environments.find((e) => e.kind === "sandbox")?.id ?? project.environments[0]?.id ?? "");
    }
  }, [project?.id]);

  const add = (list: FileList | File[], pasted = false) => setFiles((fs) => [...fs, ...Array.from(list).map((file) => ({ file, pasted }))]);
  const onPaste = (e: React.ClipboardEvent) => {
    const imgs = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
    if (imgs.length) {
      e.preventDefault();
      add(imgs.map((f, i) => new File([f], `paste-${Date.now()}-${i}.${f.type.split("/")[1] ?? "png"}`, { type: f.type })), true);
    }
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const fd = new FormData();
    fd.set("projectId", projectId);
    if (envId) fd.set("environmentId", envId);
    fd.set("title", title);
    fd.set("description", description);
    fd.set("reporter", reporter);
    fd.set("priority", priority);
    fd.set("autoRun", String(autoRun));
    if (budget) fd.set("budgetUsd", budget);
    for (const f of files) fd.append(f.pasted ? "pasted" : "files", f.file);
    try {
      const issue = await api<Issue>("/api/issues", { method: "POST", body: fd });
      navigate(`/issues/${issue.key}`);
    } catch (x) {
      setErr(errMsg(x));
      setBusy(false);
    }
  };
  if (projects.error) return <ErrorBox message={projects.error} onRetry={projects.reload} />;
  if (projects.loading && !projects.data) return <Loading />;
  if (!projects.data?.length)
    return (
      <div className="page">
        <div className="page-head"><div><h1 className="t-title">New issue</h1></div></div>
        <Empty title="Create a project first" action={<Link to="/projects" className="btn primary">Create project</Link>}>Every issue belongs to a project, which holds the client's NetSuite environments and SDF repo.</Empty>
      </div>
    );
  return (
    <form className="page" onSubmit={submit} style={{ maxWidth: 880 }}>
      <div className="page-head"><div><h1 className="t-title">New issue</h1><span className="t-caption">After submitting, attachments are processed and the agent starts investigating.</span></div></div>
      <div className="form-grid">
        <Field label="Project" htmlFor="ip">
          <select id="ip" className="select" required value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Select project</option>
            {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Environment" htmlFor="ie" help={project && !project.environments.length ? "This project doesn't have an environment yet; analysis will rely only on attachments and code." : undefined}>
          <select id="ie" className="select" value={envId} onChange={(e) => setEnvId(e.target.value)}>
            <option value="">No environment</option>
            {project?.environments.map((e) => <option key={e.id} value={e.id}>{e.name} · {e.kind} · {tierLabel(e.tier ?? "none")}</option>)}
          </select>
        </Field>
        <Field label="Title" htmlFor="it" className="full"><input id="it" className="input" required minLength={3} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="E.g. Vendor bill VB-1042 fails to approve" /></Field>
        <Field label="Description from client" htmlFor="id" className="full" help="Paste email or chat text. Paste an image directly here to turn it into an attachment.">
          <textarea id="id" className="textarea" rows={8} value={description} onChange={(e) => setDescription(e.target.value)} onPaste={onPaste} />
        </Field>
        <Field label="Reporter" htmlFor="ir"><input id="ir" className="input" value={reporter} onChange={(e) => setReporter(e.target.value)} /></Field>
        <Field label="Priority" htmlFor="ipr"><select id="ipr" className="select" value={priority} onChange={(e) => setPriority(e.target.value)}>{["low", "normal", "high", "urgent"].map((p) => <option key={p}>{p}</option>)}</select></Field>
      </div>
      <section className="block" aria-labelledby="h-att">
        <h2 id="h-att" className="t-subheading">Attachments</h2>
        <div className={`dropzone${over ? " over" : ""}`} role="button" tabIndex={0} onClick={() => input.current?.click()} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}>
          Drag files here or click to choose. Images, PDF, DOCX, XLSX, CSV, TXT, JSON, XML, JS, EML. Max 50 MB per file.
          <input ref={input} type="file" multiple hidden onChange={(e) => e.target.files && add(e.target.files)} />
        </div>
        {files.length > 0 && (
          <table className="t">
            <caption className="sr-only">Selected files</caption>
            <thead><tr><th scope="col">File</th><th scope="col">Type</th><th scope="col" className="num">Size</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {files.map((f, i) => {
                const ext = f.file.name.split(".").pop()?.toLowerCase() ?? "";
                const ok = SUPPORTED.test(f.file.name) || f.pasted;
                const tooBig = f.file.size > MAX_BYTES;
                return (
                  <tr key={i}>
                    <td className="t-mono">{f.file.name}</td>
                    <td>{ok ? (f.pasted ? "image (pasted)" : ext) : <span className="row" style={{ gap: 4, flexWrap: "nowrap" }}><Icon name="warning" className="warn-text" /><span><span className="warn-text">Unsupported</span>{HINT[ext] ? `. ${HINT[ext]}` : ""}</span></span>}</td>
                    <td className="num">{tooBig ? <span className="warn-text">{fmtSize(f.file.size)}, over 50 MB</span> : fmtSize(f.file.size)}</td>
                    <td><button type="button" className="btn ghost sm" aria-label={`Remove ${f.file.name}`} onClick={() => setFiles((fs) => fs.filter((_, j) => j !== i))}>Remove</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
      <div className="row" style={{ gap: "var(--ns-space-6)" }}>
        <label className="check"><input type="checkbox" checked={autoRun} onChange={(e) => setAutoRun(e.target.checked)} />Run agent automatically</label>
        <label className="row t-compact">Budget (USD) <input className="input num" style={{ width: 96 }} type="text" inputMode="decimal" autoComplete="off" value={budget} onChange={(e) => { const v = e.target.value.replace(",", "."); if (/^\d*\.?\d*$/.test(v)) setBudget(v); }} aria-label="Budget (USD)" /></label>
      </div>
      {err && <div className="err-text" role="alert">{err}</div>}
      <div className="row"><button className="btn primary" disabled={busy || !projectId || title.length < 3 || files.some((f) => f.file.size > MAX_BYTES)}>{busy ? "Creating issue" : "Create issue"}</button></div>
    </form>
  );
}
