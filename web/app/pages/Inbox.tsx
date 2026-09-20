// Inbox (14 §2): cross-project issue table, filters, FTS, keyboard j/k/Enter, '/'.
import { useEffect, useRef, useState } from "react";
import { useApi, useDebounced, useTopic } from "../hooks.ts";
import { Link, navigate } from "../router.tsx";
import { Empty, ErrorBox, EvidenceLevel, Loading, Money, Status, relative, stateLabel } from "../components/ui.tsx";
import type { IssueRow, ProjectListItem } from "../types.ts";

const STATUSES = ["", "draft", "ingesting", "investigating", "awaiting_user", "reproduced", "root_caused", "fixing", "verifying", "resolved", "closed", "blocked", "budget_exceeded"];

export function InboxPage() {
  const [q, setQ] = useState("");
  const [project, setProject] = useState("");
  const [status, setStatus] = useState("");
  const [envKind, setEnvKind] = useState("");
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [sel, setSel] = useState(-1);
  const search = useRef<HTMLInputElement>(null);
  const params = new URLSearchParams({ ...(q && { q }), ...(project && { project }), ...(status && { status }), ...(envKind && { envKind }), ...(onlyOpen && !status && { open: "1" }) });
  const issues = useApi<IssueRow[]>(`/api/issues?${params}`, []);
  const projects = useApi<ProjectListItem[]>("/api/projects");
  const reload = useDebounced(issues.reload, 400);
  useTopic("global", (ev) => {
    if (["issue.updated", "session.state", "session.ended", "usage.updated", "session.started"].includes(ev.type)) reload();
  });
  const rows = issues.data ?? [];
  const filtered = !!(q || project || status || envKind);
  const clearFilters = () => {
    setQ("");
    setProject("");
    setStatus("");
    setEnvKind("");
  };

  useEffect(() => {
    if (sel >= 0) document.querySelector(`tr[data-idx="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key === "/" && !el.closest("input, textarea")) {
        e.preventDefault();
        search.current?.focus();
        return;
      }
      if (el.closest("input, textarea, select")) return;
      if (e.key === "j") setSel((s) => Math.min(rows.length - 1, s + 1));
      else if (e.key === "Escape") setSel(-1);
      else if (e.key === "k") setSel((s) => Math.max(0, s - 1));
      else if (e.key === "Enter" && rows[sel]) navigate(`/issues/${rows[sel]!.key}`);
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [rows, sel]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="t-title">Inbox</h1>
          <span className="t-caption">Press c for a new issue, / to search, j/k to navigate.</span>
        </div>
        <Link to="/issues/new" className="btn primary">New issue</Link>
      </div>
      <div className="row" role="search">
        <input ref={search} className="input" style={{ maxWidth: 280 }} placeholder="Search title, description, root cause" aria-label="Search issues" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" style={{ width: "auto" }} aria-label="Project" value={project} onChange={(e) => setProject(e.target.value)}>
          <option value="">All projects</option>
          {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select className="select" style={{ width: "auto" }} aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUSES.map((s) => <option key={s} value={s}>{s ? s.replace(/_/g, " ") : "All statuses"}</option>)}
        </select>
        <select className="select" style={{ width: "auto" }} aria-label="Environment kind" value={envKind} onChange={(e) => setEnvKind(e.target.value)}>
          <option value="">All environments</option>
          <option value="sandbox">sandbox</option>
          <option value="production">production</option>
          <option value="release_preview">release preview</option>
        </select>
        <label className="check t-compact" title={status ? "Not applied while a status is selected" : undefined}><input type="checkbox" disabled={!!status} checked={onlyOpen && !status} onChange={(e) => setOnlyOpen(e.target.checked)} />Unresolved only</label>
        {filtered && <button type="button" className="btn ghost sm" onClick={clearFilters}>Clear filters</button>}
      </div>
      {issues.error ? (
        <ErrorBox message={issues.error} onRetry={issues.reload} />
      ) : issues.loading && !issues.data ? (
        <Loading lines={6} />
      ) : !rows.length && filtered ? (
        <Empty title="No issues match these filters" action={<button className="btn" onClick={clearFilters}>Clear filters</button>}>Try a shorter search or a different project, status, or environment.</Empty>
      ) : !rows.length && onlyOpen && projects.data?.length ? (
        <Empty title="No unresolved issues" action={<button className="btn" onClick={() => setOnlyOpen(false)}>Show resolved issues</button>}>Every issue is resolved or closed.</Empty>
      ) : !rows.length ? (
        <Empty title={projects.data?.length ? "No issues yet" : "Start by creating a project"} action={projects.data?.length ? <Link to="/issues/new" className="btn primary">Create first issue</Link> : <Link to="/projects" className="btn primary">Create project</Link>}>
          {projects.data?.length ? "New issues are automatically processed by the agent after submission." : "A project represents one client, with sandbox/production environments and an SDF repo."}
        </Empty>
      ) : (
        <div className="table-wrap">
          <table className="t">
            <caption className="sr-only">Issues, {rows.length} shown</caption>
            <thead>
              <tr><th scope="col">Key</th><th scope="col">Title</th><th scope="col">Project</th><th scope="col">Env</th><th scope="col">Status</th><th scope="col">Evidence</th><th scope="col" className="num">Cost</th><th scope="col" className="num">Updated</th></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} data-idx={i} className={`clickable${i === sel ? " selected" : ""}`} onClick={() => navigate(`/issues/${r.key}`)}>
                  <td className="t-mono"><Link to={`/issues/${r.key}`} onClick={(e) => e.stopPropagation()}>{r.key}</Link></td>
                  <td style={{ maxWidth: 420 }}>{r.title}</td>
                  <td>{r.project_name}</td>
                  <td>{r.env_name ? `${r.env_name}` : <span className="faint">-</span>}{r.env_kind === "production" && <span className="t-caption"> · prod</span>}</td>
                  <td><Status value={r.session_state ? "running" : r.status} label={r.session_state ? stateLabel(r.session_state) : undefined} /></td>
                  <td><EvidenceLevel level={r.evidence_level} /></td>
                  <td className="num"><Money usd={r.cost_usd} digits={2} /></td>
                  <td className="num t-caption">{relative(r.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
