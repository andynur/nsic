// Environment & wizard (14 §6, 06 §3): tier header, capability table, 8-step stepper, PTY terminal.
import { useEffect, useRef, useState } from "react";
import { api, errMsg, wsSend } from "../api.ts";
import { useApi, useDocumentTitle, useTopic } from "../hooks.ts";
import { Link } from "../router.tsx";
import { CopyButton, ErrorBox, Field, Loading, Status, Time, tierLabel } from "../components/ui.tsx";
import { useToast } from "../components/Toasts.tsx";
import type { EnvView, ProjectDetail } from "../types.ts";

export function EnvironmentPage({ projectId, envId }: { projectId: string; envId: string }) {
  const env = useApi<EnvView>(`/api/environments/${envId}`, [envId]);
  const project = useApi<ProjectDetail>(`/api/projects/${projectId}`, [projectId]);
  const toast = useToast();
  useTopic(`env:${envId}`, () => env.reload());
  useTopic("global", (ev) => ev.type === "job.done" && ev.jobType === "probe_env" && env.reload());
  useDocumentTitle(env.data ? `${env.data.name} · ${project.data?.name ?? "Environment"}` : null);
  if (env.error) return <ErrorBox message={env.error} onRetry={env.reload} />;
  if (!env.data) return <Loading />;
  const e = env.data;
  const tier = e.profile?.tier ?? "none";
  const hasCred = (k: string) => e.credentials.some((c) => c.kind === k);
  const port = location.port || "4317";
  const redirect = `http://127.0.0.1:${port}/oauth/callback`;
  const probe = async () => {
    try {
      await api(`/api/environments/${envId}/probe`, { method: "POST" });
      toast("Capability probe running");
    } catch (x) {
      toast(errMsg(x), "error");
    }
  };
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <span className="t-caption"><Link to={`/projects/${projectId}`}>{project.data?.name ?? "Project"}</Link> · environment</span>
          <h1 className="t-title">{e.name} <span className="muted" style={{ fontWeight: 400 }}>· {e.kind}</span></h1>
          <div className="row t-compact muted"><span className="t-mono">{e.account_id}</span><span>·</span><span className="t-heading" style={{ color: "var(--ns-text)" }}>{tierLabel(tier)}</span><span>·</span><span>last probe <Time ms={e.profile?.probed_at} withDate /></span></div>
        </div>
        <button className="btn primary" onClick={probe}>Run probe</button>
      </div>
      {e.profile?.capabilities.prod_write_exposed && (
        <div className="error-box" role="alert"><span className="err-text w500">MCP write tool exposed in production</span><span className="t-compact">The production MCP role must be View level. The agent is forced read-only, but fix the role in NetSuite and reprobe.</span></div>
      )}
      <section className="block" aria-labelledby="h-cap">
        <h2 id="h-cap" className="t-heading">Capabilities</h2>
        <div className="table-wrap">
          <table className="t">
            <caption className="sr-only">Environment capabilities</caption>
            <thead><tr><th scope="col">Capability</th><th scope="col">Status</th><th scope="col">How to enable</th></tr></thead>
            <tbody>{e.capabilityTable.map((c) => <tr key={c.name}><td className="t-mono">{c.name}</td><td><Status value={c.available ? "done" : "draft"} label={c.available ? "available" : "unavailable"} /></td><td className="muted">{c.available ? "-" : c.hint}</td></tr>)}</tbody>
          </table>
        </div>
        {e.profile?.mcp_tools?.length ? <span className="t-caption">MCP tools: <span className="t-mono">{e.profile.mcp_tools.join(", ")}</span></span> : null}
        {e.profile?.probe_log && <details><summary className="t-label" style={{ cursor: "pointer" }}>Probe log</summary><pre className="code">{e.profile.probe_log}</pre></details>}
      </section>

      <section className="block" aria-labelledby="h-wiz">
        <h2 id="h-wiz" className="t-heading">Onboarding wizard</h2>
        <ol className="stepper">
          <li className="done"><div className="content"><span className="t-subheading">Identity</span><IdentityForm e={e} onSaved={env.reload} /></div></li>
          <li className={e.automation_consent_at ? "done" : ""}><div className="content"><span className="t-subheading">Client consent</span><ConsentForm e={e} onSaved={env.reload} /></div></li>
          <li><div className="content">
            <span className="t-subheading">NetSuite checklist (client admin)</span>
            <ul className="t-compact" style={{ margin: 0, paddingLeft: 18 }}>
              <li>Enable features: Server SuiteScript, REST Web Services, OAuth 2.0.</li>
              <li>Install SuiteApp <b>MCP Standard Tools</b>.</li>
              <li>Create a non-admin role <span className="t-mono">{e.kind === "production" ? "NSIC MCP Read" : "NSIC MCP Sandbox"}</span>: MCP Server Connection, Log in using OAuth 2.0 Access Tokens, REST Web Services, record level {e.kind === "production" ? "View" : "Create/Edit for reproduction"}, access to the SuiteApp folder in File Cabinet. The Administrator role cannot be used for MCP.</li>
              <li>Integration record: Authorization Code Grant, public client (PKCE), scope AI Connector Service, redirect URI below.</li>
            </ul>
            <div className="row"><span className="t-mono t-compact">{redirect}</span><CopyButton text={redirect} /></div>
          </div></li>
          <li className={hasCred("mcp_oauth") ? "done" : ""}><div className="content"><span className="t-subheading">Connect MCP (OAuth PKCE)</span><OAuthForm e={e} /></div></li>
          <li className={hasCred("rest_m2m") ? "done" : ""}><div className="content"><span className="t-subheading">REST M2M (optional, tier B)</span><M2mForm e={e} onSaved={env.reload} /></div></li>
          <li className={hasCred("sdf_auth_id") ? "done" : ""}><div className="content"><span className="t-subheading">SuiteCloud CLI (optional)</span><SdfForm e={e} onSaved={env.reload} /></div></li>
          <li className={hasCred("browser_session") ? "done" : ""}><div className="content"><span className="t-subheading">Login Assist (optional, tier C)</span><LoginAssist e={e} onSaved={env.reload} /></div></li>
          <li className={e.profile ? "done" : ""}><div className="content"><span className="t-subheading">Probe</span><span className="t-compact muted">Tests MCP, SuiteQL, record read, execution log, SDF, browser session, and repo. Repeats automatically every week.</span><div><button className="btn" onClick={probe}>Run probe</button></div></div></li>
        </ol>
      </section>
    </div>
  );
}

function IdentityForm({ e, onSaved }: { e: EnvView; onSaved: () => void }) {
  const [f, setF] = useState({ name: e.name, timezone: e.timezone ?? "", ui_base_url: e.ui_base_url ?? "", mcp_url: e.mcp_url ?? "", monitor_enabled: e.monitor_enabled });
  const toast = useToast();
  const save = async (ev: React.FormEvent) => {
    ev.preventDefault();
    try {
      await api(`/api/environments/${e.id}`, { method: "PATCH", json: { ...f, timezone: f.timezone || null, ui_base_url: f.ui_base_url || null, mcp_url: f.mcp_url || null } });
      toast("Saved", "success");
      onSaved();
    } catch (x) {
      toast(errMsg(x), "error");
    }
  };
  return (
    <form className="stack" onSubmit={save}>
      <div className="form-grid">
        <Field label="Name" htmlFor="in"><input id="in" className="input" value={f.name} onChange={(x) => setF({ ...f, name: x.target.value })} /></Field>
        <Field label="Timezone" htmlFor="itz"><input id="itz" className="input" value={f.timezone} onChange={(x) => setF({ ...f, timezone: x.target.value })} /></Field>
        <Field label="UI base URL" htmlFor="iu" className="full"><input id="iu" className="input mono" value={f.ui_base_url} onChange={(x) => setF({ ...f, ui_base_url: x.target.value })} /></Field>
        <Field label="MCP URL" htmlFor="im" className="full" help="Default: MCP Standard Tools endpoint. Use .../services/mcp/v1/all for all tools."><input id="im" className="input mono" value={f.mcp_url} onChange={(x) => setF({ ...f, mcp_url: x.target.value })} /></Field>
      </div>
      <label className="check t-compact"><input type="checkbox" checked={f.monitor_enabled} onChange={(x) => setF({ ...f, monitor_enabled: x.target.checked })} />Proactive execution log monitoring (every 30 minutes)</label>
      <div><button className="btn">Save</button></div>
    </form>
  );
}

function ConsentForm({ e, onSaved }: { e: EnvView; onSaved: () => void }) {
  const [by, setBy] = useState("");
  const toast = useToast();
  if (e.automation_consent_at) return <span className="t-compact muted">Recorded <Time ms={e.automation_consent_at} withDate />.</span>;
  return (
    <form className="row" onSubmit={async (ev) => { ev.preventDefault(); try { await api(`/api/environments/${e.id}`, { method: "PATCH", json: { automation_consent: { given: true, by } } }); onSaved(); } catch (x) { toast(errMsg(x), "error"); } }}>
      <span className="t-compact">Client authorizes API, MCP, and UI automation on this account. Approved by</span>
      <input className="input" style={{ width: 220 }} required value={by} onChange={(x) => setBy(x.target.value)} aria-label="Approved by" />
      <button className="btn">Record consent</button>
    </form>
  );
}

function OAuthForm({ e }: { e: EnvView }) {
  const [clientId, setClientId] = useState("");
  const toast = useToast();
  const connect = async (ev: React.FormEvent) => {
    ev.preventDefault();
    try {
      const r = await api<{ authorizeUrl: string }>(`/api/environments/${e.id}/oauth/start`, { method: "POST", json: { clientId } });
      window.open(r.authorizeUrl, "_blank", "noopener");
      toast("Log in to NetSuite and select the MCP role (not Administrator)");
    } catch (x) {
      toast(errMsg(x), "error");
    }
  };
  return (
    <form className="row" onSubmit={connect}>
      <input className="input mono" style={{ maxWidth: 420 }} placeholder="Integration record client ID" required value={clientId} onChange={(x) => setClientId(x.target.value)} aria-label="Client ID" />
      <button className="btn" disabled={!e.automation_consent_at}>Connect</button>
      {!e.automation_consent_at && <span className="t-caption">Record consent first.</span>}
    </form>
  );
}

function M2mForm({ e, onSaved }: { e: EnvView; onSaved: () => void }) {
  const [cert, setCert] = useState<string | null>(null);
  const [f, setF] = useState({ clientId: "", certificateId: "" });
  const toast = useToast();
  const gen = async () => {
    try {
      const r = await api<{ certificatePem: string }>(`/api/environments/${e.id}/m2m/keypair`, { method: "POST" });
      setCert(r.certificatePem);
    } catch (x) {
      toast(errMsg(x), "error");
    }
  };
  return (
    <div className="stack">
      <span className="t-compact muted">The private key is generated and stored encrypted on this laptop. Upload the public certificate to Setup, Integration, OAuth 2.0 Client Credentials (M2M) Setup, then fill in the certificate ID.</span>
      <div><button className="btn" onClick={gen}>Generate key pair</button></div>
      {cert && <div className="stack"><pre className="code">{cert}</pre><div className="row"><CopyButton text={cert} label="Copy certificate" /><a className="btn sm" href={`data:application/x-pem-file,${encodeURIComponent(cert)}`} download={`nsic-${e.account_id}.pem`}>Download .pem</a></div></div>}
      <form className="row" onSubmit={async (ev) => { ev.preventDefault(); try { await api(`/api/environments/${e.id}/m2m`, { method: "PUT", json: f }); toast("Saved", "success"); onSaved(); } catch (x) { toast(errMsg(x), "error"); } }}>
        <input className="input mono" style={{ maxWidth: 280 }} placeholder="Client ID" required value={f.clientId} onChange={(x) => setF({ ...f, clientId: x.target.value })} aria-label="M2M Client ID" />
        <input className="input mono" style={{ maxWidth: 280 }} placeholder="Certificate ID" required value={f.certificateId} onChange={(x) => setF({ ...f, certificateId: x.target.value })} aria-label="Certificate ID" />
        <button className="btn">Save</button>
      </form>
    </div>
  );
}

function SdfForm({ e, onSaved }: { e: EnvView; onSaved: () => void }) {
  const [term, setTerm] = useState<string | null>(null);
  const [out, setOut] = useState("");
  const [input, setInput] = useState("");
  const [authId, setAuthId] = useState("");
  const box = useRef<HTMLPreElement>(null);
  const toast = useToast();
  useTopic(term ? `terminal:${term}` : null, (ev) => ev.type === "terminal.data" && ev.terminalId === term && setOut((o) => (o + String(ev.data)).slice(-40000)));
  useEffect(() => {
    box.current?.scrollTo(0, box.current.scrollHeight);
  }, [out]);
  // eslint-disable-next-line no-control-regex
  const clean = out.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
  return (
    <div className="stack">
      <span className="t-compact muted">Run <span className="t-mono">suitecloud account:setup</span> in the embedded terminal, then save the authId you chose.</span>
      <div className="row"><button className="btn" onClick={async () => { try { setOut(""); setTerm((await api<{ terminalId: string }>(`/api/environments/${e.id}/terminal`, { method: "POST" })).terminalId); } catch (x) { toast(errMsg(x), "error"); } }}>Open terminal</button></div>
      {term && (
        <>
          <pre ref={box} className="terminal" aria-live="polite">{clean}</pre>
          <form className="row" onSubmit={(ev) => { ev.preventDefault(); wsSend({ type: "terminal.input", terminalId: term, data: input + "\r" }); setInput(""); }}>
            <input className="input mono" style={{ flex: 1 }} value={input} onChange={(x) => setInput(x.target.value)} placeholder="Type then press Enter" aria-label="Terminal input" />
            <button type="button" className="btn sm" onClick={() => wsSend({ type: "terminal.input", terminalId: term, data: "\x1b[B" })}>Down arrow</button>
            <button className="btn sm">Send</button>
          </form>
        </>
      )}
      <form className="row" onSubmit={async (ev) => { ev.preventDefault(); try { await api(`/api/environments/${e.id}/sdf`, { method: "PUT", json: { authId } }); toast("authId saved", "success"); onSaved(); } catch (x) { toast(errMsg(x), "error"); } }}>
        <input className="input mono" style={{ maxWidth: 280 }} placeholder="authId" required value={authId} onChange={(x) => setAuthId(x.target.value)} aria-label="authId" />
        <button className="btn">Save authId</button>
      </form>
    </div>
  );
}

function LoginAssist({ e, onSaved }: { e: EnvView; onSaved: () => void }) {
  const [started, setStarted] = useState(false);
  const toast = useToast();
  return (
    <div className="stack">
      <span className="t-compact muted">Chrome opens with a profile dedicated to this environment. Log in (SSO/2FA), select the correct role, then click Done. The session is used by the runner until it expires.</span>
      <div className="row">
        <button className="btn" onClick={async () => { try { await api(`/api/environments/${e.id}/login-assist/start`, { method: "POST" }); setStarted(true); } catch (x) { toast(errMsg(x), "error"); } }}>Open Chrome</button>
        <button className="btn primary" disabled={!started} onClick={async () => { try { const r = await api<{ loggedIn: boolean }>(`/api/environments/${e.id}/login-assist/finish`, { method: "POST" }); toast(r.loggedIn ? "Session saved" : "No login detected, try again", r.loggedIn ? "success" : "warning"); setStarted(false); onSaved(); } catch (x) { toast(errMsg(x), "error"); } }}>Done</button>
      </div>
    </div>
  );
}
