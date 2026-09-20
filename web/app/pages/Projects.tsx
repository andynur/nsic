import { useState } from "react";
import { api, errMsg } from "../api.ts";
import { useApi } from "../hooks.ts";
import { Link, navigate } from "../router.tsx";
import { Empty, ErrorBox, Field, Loading, tierLabel } from "../components/ui.tsx";
import { useToast } from "../components/Toasts.tsx";
import type { Project, ProjectListItem } from "../types.ts";

export function ProjectsPage() {
  const list = useApi<ProjectListItem[]>("/api/projects");
  const [creating, setCreating] = useState(false);
  return (
    <div className="page">
      <div className="page-head">
        <div><h1 className="t-title">Projects</h1><span className="t-caption">One project per client or implementation.</span></div>
        <button className="btn primary" onClick={() => setCreating(true)}>New project</button>
      </div>
      {creating && <NewProjectForm onDone={(p) => navigate(`/projects/${p.id}`)} onCancel={() => setCreating(false)} />}
      {list.error ? <ErrorBox message={list.error} onRetry={list.reload} /> : list.loading && !list.data ? <Loading /> : !list.data?.length ? (
        !creating && <Empty title="No projects yet" action={<button className="btn primary" onClick={() => setCreating(true)}>Create project</button>}>Add a project, then its NetSuite environments and SDF repo.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="t">
            <caption className="sr-only">Projects</caption>
            <thead><tr><th scope="col">Name</th><th scope="col">Client</th><th scope="col">Prefix</th><th scope="col">Environments</th><th scope="col" className="num">Repos</th><th scope="col" className="num">Default budget</th></tr></thead>
            <tbody>
              {list.data.map((p) => (
                <tr key={p.id} className="clickable" onClick={() => navigate(`/projects/${p.id}`)}>
                  <td><Link to={`/projects/${p.id}`} onClick={(e) => e.stopPropagation()}>{p.name}</Link></td>
                  <td>{p.client_name ?? <span className="faint">-</span>}</td>
                  <td className="t-mono">{p.key_prefix}</td>
                  <td>{p.environments.length ? p.environments.map((e) => `${e.name} (${tierLabel(e.tier ?? "none").split(" · ")[0]})`).join(", ") : <span className="faint">-</span>}</td>
                  <td className="num">{p.repos.length}</td>
                  <td className="num">${p.default_budget_usd.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function NewProjectForm({ onDone, onCancel }: { onDone: (p: Project) => void; onCancel: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: "", client_name: "", key_prefix: "", default_budget_usd: "3" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const p = await api<Project>("/api/projects", { method: "POST", json: { name: f.name, client_name: f.client_name || null, ...(f.key_prefix && { key_prefix: f.key_prefix.toUpperCase() }), default_budget_usd: Number(f.default_budget_usd) } });
      toast(`Project ${p.name} created`, "success");
      onDone(p);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="stack-lg" onSubmit={submit} style={{ maxWidth: 720 }}>
      <h2 className="t-heading">New project</h2>
      <div className="form-grid">
        <Field label="Project name" htmlFor="pn"><input id="pn" className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Client name" htmlFor="pc"><input id="pc" className="input" value={f.client_name} onChange={(e) => setF({ ...f, client_name: e.target.value })} /></Field>
        <Field label="Issue key prefix" htmlFor="pk" help="E.g. ACME produces ACME-42"><input id="pk" className="input mono" maxLength={10} value={f.key_prefix} onChange={(e) => setF({ ...f, key_prefix: e.target.value.replace(/[^A-Za-z0-9]/g, "") })} /></Field>
        <Field label="Default budget per issue (USD)" htmlFor="pb"><input id="pb" className="input" type="text" inputMode="decimal" autoComplete="off" value={f.default_budget_usd} onChange={(e) => { const v = e.target.value.replace(",", "."); if (/^\d*\.?\d*$/.test(v)) setF({ ...f, default_budget_usd: v }); }} /></Field>
      </div>
      {err && <div className="err-text t-compact" role="alert">{err}</div>}
      <div className="row"><button className="btn primary" disabled={busy}>Save</button><button type="button" className="btn" onClick={onCancel}>Cancel</button></div>
    </form>
  );
}
