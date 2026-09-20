// Project overview (14 §1): environments, repos, settings.
import { useState } from "react";
import { api, errMsg } from "../api.ts";
import { useApi, useDocumentTitle, useTopic } from "../hooks.ts";
import { Link, navigate } from "../router.tsx";
import { Empty, ErrorBox, Field, Loading, Time, tierLabel } from "../components/ui.tsx";
import { useToast } from "../components/Toasts.tsx";
import type { EnvView, ProjectDetail, Repo } from "../types.ts";

export function ProjectPage({ id }: { id: string }) {
  const p = useApi<ProjectDetail>(`/api/projects/${id}`, [id]);
  const toast = useToast();
  const [addEnv, setAddEnv] = useState(false);
  const [addRepo, setAddRepo] = useState(false);
  useTopic("global", (ev) => {
    if (ev.type === "job.done" && (ev.jobType === "index_repo" || ev.jobType === "probe_env")) p.reload();
    if (ev.type === "env.updated" && ev.projectId === id) p.reload();
  });
  useDocumentTitle(p.data?.name);
  if (p.error) return <ErrorBox message={p.error} onRetry={p.reload} />;
  if (!p.data) return <Loading />;
  const d = p.data;
  const reindex = async (r: Repo) => {
    try {
      await api(`/api/repos/${r.id}/index`, { method: "POST" });
      toast("Repo indexing scheduled");
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <span className="t-caption"><Link to="/projects">Projects</Link></span>
          <h1 className="t-title">{d.name}</h1>
          <span className="t-caption">{d.client_name ?? "No client name"} · prefix <span className="t-mono">{d.key_prefix}</span> · default budget ${d.default_budget_usd.toFixed(2)} · auto-run agent {d.auto_run_agent ? "enabled" : "disabled"}</span>
        </div>
        <Link to={`/issues/new?project=${d.id}`} className="btn primary">New issue</Link>
      </div>

      <section className="block" aria-labelledby="h-envs">
        <div className="row-between"><h2 id="h-envs" className="t-heading">Environments</h2><button className="btn" onClick={() => setAddEnv(true)}>Add environment</button></div>
        {addEnv && <NewEnvForm projectId={d.id} onDone={(e) => navigate(`/projects/${d.id}/env/${e.id}`)} onCancel={() => setAddEnv(false)} />}
        {!d.environments.length && !addEnv ? (
          <Empty title="No environments yet" action={<button className="btn primary" onClick={() => setAddEnv(true)}>Add sandbox</button>}>The wizard will guide you through the MCP role, integration record, OAuth, and capability probe.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="t">
              <caption className="sr-only">Environments</caption>
              <thead><tr><th scope="col">Name</th><th scope="col">Kind</th><th scope="col">Account ID</th><th scope="col">Tier</th><th scope="col">Automation consent</th><th scope="col" className="num">Last probe</th></tr></thead>
              <tbody>
                {d.environments.map((e: EnvView) => (
                  <tr key={e.id} className="clickable" onClick={() => navigate(`/projects/${d.id}/env/${e.id}`)}>
                    <td><Link to={`/projects/${d.id}/env/${e.id}`} onClick={(x) => x.stopPropagation()}>{e.name}</Link></td>
                    <td>{e.kind}</td>
                    <td className="t-mono">{e.account_id}</td>
                    <td>{tierLabel(e.profile?.tier ?? "none")}{e.profile?.capabilities.prod_write_exposed && <span className="err-text"> · write tool exposed</span>}</td>
                    <td>{e.automation_consent_at ? <Time ms={e.automation_consent_at} withDate /> : <span className="warn-text">not recorded yet</span>}</td>
                    <td className="num"><Time ms={e.profile?.probed_at} withDate /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="block" aria-labelledby="h-repos">
        <div className="row-between"><h2 id="h-repos" className="t-heading">SDF repos</h2><button className="btn" onClick={() => setAddRepo(true)}>Connect repo</button></div>
        {addRepo && <NewRepoForm projectId={d.id} onDone={() => { setAddRepo(false); p.reload(); }} onCancel={() => setAddRepo(false)} />}
        {!d.repos.length && !addRepo ? (
          <Empty title="No repos yet" action={<button className="btn" onClick={() => setAddRepo(true)}>Connect repo</button>}>Without a repo, the agent can still analyze attachments and live data. Static code analysis requires an SDF repo.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="t">
              <caption className="sr-only">Repos</caption>
              <thead><tr><th scope="col">Location</th><th scope="col">Type</th><th scope="col" className="num">Files</th><th scope="col" className="num">SDF objects</th><th scope="col" className="num">Edges</th><th scope="col" className="num">Indexed</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {d.repos.map((r) => (
                  <tr key={r.id}>
                    <td className="t-mono" style={{ overflowWrap: "anywhere" }}>{r.location}</td>
                    <td>{r.project_type ?? "-"}</td>
                    <td className="num">{r.stats?.files ?? 0}</td>
                    <td className="num">{r.stats?.objects ?? 0}</td>
                    <td className="num">{r.stats?.edges ?? 0}</td>
                    <td className="num">{r.last_indexed_at ? <Time ms={r.last_indexed_at} withDate /> : <span className="warn-text">not yet</span>}</td>
                    <td><button className="btn ghost sm" onClick={() => reindex(r)}>Reindex</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function NewEnvForm({ projectId, onDone, onCancel }: { projectId: string; onDone: (e: EnvView) => void; onCancel: () => void }) {
  const [f, setF] = useState({ name: "SB1", kind: "sandbox", account_id: "", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      onDone(await api<EnvView>(`/api/projects/${projectId}/environments`, { method: "POST", json: f }));
    } catch (x) {
      setErr(errMsg(x));
    }
  };
  return (
    <form className="stack" onSubmit={submit} style={{ maxWidth: 720 }}>
      <div className="form-grid">
        <Field label="Name" htmlFor="en"><input id="en" className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Kind" htmlFor="ek" help={f.kind === "production" ? "Production is always read-only: the agent only uses read tools and the browser guard is active." : undefined}>
          <select id="ek" className="select" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            <option value="sandbox">sandbox</option><option value="production">production</option><option value="release_preview">release preview</option><option value="dev">dev</option>
          </select>
        </Field>
        <Field label="Account ID" htmlFor="ea" help="E.g. 1234567 or 1234567_SB1"><input id="ea" className="input mono" required pattern="[A-Za-z0-9_-]+" value={f.account_id} onChange={(e) => setF({ ...f, account_id: e.target.value.trim() })} /></Field>
        <Field label="Account timezone" htmlFor="et"><input id="et" className="input" value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} /></Field>
      </div>
      {err && <div className="err-text t-compact" role="alert">{err}</div>}
      <div className="row"><button className="btn primary">Save and open wizard</button><button type="button" className="btn" onClick={onCancel}>Cancel</button></div>
    </form>
  );
}

function NewRepoForm({ projectId, onDone, onCancel }: { projectId: string; onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState({ source: "local_path", location: "", default_branch: "main" });
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api(`/api/projects/${projectId}/repos`, { method: "POST", json: f });
      toast("Repo connected, indexing in progress", "success");
      onDone();
    } catch (x) {
      setErr(errMsg(x));
    }
  };
  return (
    <form className="stack" onSubmit={submit} style={{ maxWidth: 720 }}>
      <div className="form-grid">
        <Field label="Source" htmlFor="rs"><select id="rs" className="select" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}><option value="local_path">Local path</option><option value="git_url">Git URL</option></select></Field>
        <Field label="Default branch" htmlFor="rb"><input id="rb" className="input mono" value={f.default_branch} onChange={(e) => setF({ ...f, default_branch: e.target.value })} /></Field>
        <Field label={f.source === "local_path" ? "Absolute path to repo folder" : "Git URL"} htmlFor="rl" className="full"><input id="rl" className="input mono" required value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
      </div>
      {err && <div className="err-text t-compact" role="alert">{err}</div>}
      <div className="row"><button className="btn primary">Connect</button><button type="button" className="btn" onClick={onCancel}>Cancel</button></div>
    </form>
  );
}
