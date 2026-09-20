// Settings (14 §1): LLM engine and models, pricing, general, system check.
import { useEffect, useState } from "react";
import { api, errMsg } from "../api.ts";
import { useApi } from "../hooks.ts";
import { DecimalInput, ErrorBox, Field, Loading, Status } from "../components/ui.tsx";
import { useToast } from "../components/Toasts.tsx";
import { useTheme } from "../theme.ts";

type Pricing = { model: string; input_per_mtok: number; output_per_mtok: number; cache_write_per_mtok: number; cache_read_per_mtok: number; note: string | null };
type Models = Record<string, string> & { max_tokens: Record<string, number> };
type Engine = "api" | "claude-code" | "codex";
type LlmSettings = { engine: Engine; profiles: Record<Engine, Models> };
type General = { brandName: string; preparedBy: string; maxToolCalls: number; maxDurationMin: number; monthlyBudgetUsd: number | null; spikePerPoll: number };
type Check = { name: string; ok: boolean; detail: string | null; needed: string };

const PRICE_COLS: [keyof Pricing & `${string}_per_mtok`, string][] = [["input_per_mtok", "Input"], ["output_per_mtok", "Output"], ["cache_write_per_mtok", "Cache write"], ["cache_read_per_mtok", "Cache read"]];

const ROLES: [string, string][] = [["agent_main", "Main agent"], ["agent_escalation", "Escalation"], ["ingest", "Ingestion"], ["triage", "Triage"], ["intent", "Intent chat"], ["consultant", "Consultant"], ["report_writer", "Report writer"]];
const CODEX_PRESETS: Record<string, string> = { agent_main: "gpt-5.6-terra", agent_escalation: "gpt-5.6-sol", ingest: "gpt-5.6-luna", triage: "gpt-5.6-luna", intent: "gpt-5.6-luna", consultant: "gpt-5.6-luna", report_writer: "gpt-5.6-terra" };

export function SettingsPage() {
  const llm = useApi<LlmSettings>("/api/settings/llm");
  const pricing = useApi<Pricing[]>("/api/settings/pricing");
  const general = useApi<General>("/api/settings/general");
  const check = useApi<Check[]>("/api/system/check");
  const toast = useToast();
  const [theme, setTheme] = useTheme();
  const [l, setL] = useState<LlmSettings | null>(null);
  const [p, setP] = useState<Pricing[]>([]);
  const [g, setG] = useState<General | null>(null);
  useEffect(() => setL(llm.data), [llm.data]);
  useEffect(() => setP(pricing.data ?? []), [pricing.data]);
  useEffect(() => setG(general.data), [general.data]);
  const save = async (path: string, json: unknown, reload: () => void) => {
    try {
      await api(path, { method: "PUT", json });
      toast("Saved", "success");
      reload();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };
  const activeModels = l?.profiles[l.engine];
  const setActiveModels = (models: Models) => setL(l && { ...l, profiles: { ...l.profiles, [l.engine]: models } });
  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <div className="page-head"><div><h1 className="t-title">Settings</h1></div></div>

      <section className="block" aria-labelledby="h-sys">
        <div className="row-between"><h2 id="h-sys" className="t-heading">System check</h2><button className="btn sm" onClick={check.reload}>Recheck</button></div>
        {check.error ? <ErrorBox message={check.error} onRetry={check.reload} /> : !check.data ? <Loading /> : (
          <table className="t"><caption className="sr-only">System dependencies</caption><thead><tr><th scope="col">Component</th><th scope="col">Status</th><th scope="col">Detail</th><th scope="col">Needed for</th></tr></thead>
            <tbody>{check.data.map((c) => <tr key={c.name}><td>{c.name}</td><td><Status value={c.ok ? "done" : "blocked"} label={c.ok ? "ok" : "missing"} /></td><td className="t-mono" style={{ overflowWrap: "anywhere" }}>{c.detail}</td><td className="muted">{c.needed}</td></tr>)}</tbody></table>
        )}
      </section>

      <section className="block" aria-labelledby="h-models">
        <h2 id="h-models" className="t-heading">LLM engine and models</h2>
        <span className="t-caption">Choose an engine and model for each role, then save. Claude Code and Codex use your local CLI login. Codex model availability depends on your account. New calls use the saved choice.</span>
        {llm.error ? <ErrorBox message={llm.error} onRetry={llm.reload} /> : !l || !activeModels ? <Loading /> : (
          <form className="stack" onSubmit={(e) => { e.preventDefault(); void save("/api/settings/llm", { engine: l.engine, models: activeModels }, () => { llm.reload(); check.reload(); }); }}>
            <fieldset className="row" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="t-label">Engine</legend>
              {([ ["api", "Claude API"], ["claude-code", "Claude Code"], ["codex", "Codex"] ] as const).map(([engine, label]) => (
                <label className="check t-compact" key={engine}><input type="radio" name="llm-engine" checked={l.engine === engine} onChange={() => setL({ ...l, engine })} />{label}</label>
              ))}
            </fieldset>
            {l.engine === "codex" && <div className="stack">
              <span className="t-caption">Suggested: Terra for main work and reports, Sol for escalation, Luna for short tasks. Enter a model ID or choose a suggestion. "default" lets the Codex CLI choose a model.</span>
              <div><button type="button" className="btn sm" onClick={() => setActiveModels({ ...activeModels, ...CODEX_PRESETS } as Models)}>Use suggested Codex models</button></div>
              <datalist id="codex-models"><option value="gpt-6-astra" /><option value="gpt-5.6-sol" /><option value="gpt-5.6-terra" /><option value="gpt-5.6-luna" /><option value="default" /></datalist>
            </div>}
            <table className="t"><caption className="sr-only">Model per role</caption><thead><tr><th scope="col">Role</th><th scope="col">Model</th><th scope="col" className="num">Max tokens</th></tr></thead>
              <tbody>{ROLES.map(([k, label]) => (
                <tr key={k}><td>{label}</td>
                  <td><input className="input mono" aria-label={`Model ${label}`} list={l.engine === "codex" ? "codex-models" : undefined} required value={activeModels[k] ?? ""} onChange={(e) => setActiveModels({ ...activeModels, [k]: e.target.value } as Models)} /></td>
                  <td className="num"><input className="input num" style={{ width: 110 }} type="number" min="1" max="200000" required aria-label={`Max tokens ${label}`} value={activeModels.max_tokens[k] ?? ""} onChange={(e) => setActiveModels({ ...activeModels, max_tokens: { ...activeModels.max_tokens, [k]: Number(e.target.value) } } as Models)} /></td></tr>
              ))}</tbody></table>
            <div><button className="btn">Save LLM settings</button></div>
          </form>
        )}
      </section>

      <section className="block" aria-labelledby="h-price">
        <h2 id="h-price" className="t-heading">Pricing (USD per 1 million tokens)</h2>
        <span className="t-caption">Check Anthropic's official pricing page before changing this. Historical costs don't change because each call stores a price snapshot.</span>
        {pricing.error ? <ErrorBox message={pricing.error} onRetry={pricing.reload} /> : !pricing.data ? <Loading /> : (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void save("/api/settings/pricing", p, pricing.reload); }}>
          <table className="t"><caption className="sr-only">Model pricing</caption><thead><tr><th scope="col">Model</th><th scope="col" className="num">Input</th><th scope="col" className="num">Output</th><th scope="col" className="num">Cache write</th><th scope="col" className="num">Cache read</th></tr></thead>
            <tbody>{p.map((row, i) => (
              <tr key={i}>
                <td><input className="input mono" aria-label={`Model name, row ${i + 1}`} placeholder="claude-model-id" value={row.model} onChange={(e) => setP(p.map((x, j) => (j === i ? { ...x, model: e.target.value } : x)))} /></td>
                {PRICE_COLS.map(([k, label]) => (
                  <td key={k} className="num"><DecimalInput style={{ width: 96 }} aria-label={`${label} price for ${row.model || `row ${i + 1}`}`} value={row[k]} onChange={(v) => setP(p.map((x, j) => (j === i ? { ...x, [k]: v ?? 0 } : x)))} /></td>
                ))}
              </tr>
            ))}</tbody></table>
          <div className="row"><button type="button" className="btn" onClick={() => setP([...p, { model: "", input_per_mtok: 0, output_per_mtok: 0, cache_write_per_mtok: 0, cache_read_per_mtok: 0, note: null }])}>Add model</button><button className="btn">Save pricing</button></div>
        </form>
        )}
      </section>

      <section className="block" aria-labelledby="h-gen">
        <h2 id="h-gen" className="t-heading">General</h2>
        {general.error ? <ErrorBox message={general.error} onRetry={general.reload} /> : !g ? <Loading /> : (
          <form className="stack" onSubmit={(e) => { e.preventDefault(); void save("/api/settings/general", g, general.reload); }}>
            <div className="form-grid">
              <Field label="Report masthead name" htmlFor="gb"><input id="gb" className="input" value={g.brandName} onChange={(e) => setG({ ...g, brandName: e.target.value })} /></Field>
              <Field label="Prepared by" htmlFor="gp"><input id="gp" className="input" value={g.preparedBy} onChange={(e) => setG({ ...g, preparedBy: e.target.value })} /></Field>
              <Field label="Max tool calls per session" htmlFor="gt"><input id="gt" className="input" type="number" value={g.maxToolCalls} onChange={(e) => setG({ ...g, maxToolCalls: Number(e.target.value) })} /></Field>
              <Field label="Max session duration (minutes)" htmlFor="gd"><input id="gd" className="input" type="number" value={g.maxDurationMin} onChange={(e) => setG({ ...g, maxDurationMin: Number(e.target.value) })} /></Field>
              <Field label="Global monthly budget cap (USD, optional)" htmlFor="gm" help="Leave empty for no limit."><DecimalInput id="gm" value={g.monthlyBudgetUsd} onChange={(v) => setG({ ...g, monthlyBudgetUsd: v })} style={{ textAlign: "left" }} /></Field>
              <Field label="Error spike threshold per poll" htmlFor="gs"><input id="gs" className="input" type="number" value={g.spikePerPoll} onChange={(e) => setG({ ...g, spikePerPoll: Number(e.target.value) })} /></Field>
            </div>
            <div><button className="btn">Save</button></div>
          </form>
        )}
      </section>

      <section className="block" aria-labelledby="h-look">
        <h2 id="h-look" className="t-heading">Appearance</h2>
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: "var(--ns-space-2)" }}>
          <legend className="t-label" style={{ marginBottom: "var(--ns-space-2)" }}>Theme</legend>
          <label className="check t-compact"><input type="radio" name="theme" checked={theme === "light"} onChange={() => setTheme("light")} />Light (default)</label>
          <label className="check t-compact"><input type="radio" name="theme" checked={theme === "dark"} onChange={() => setTheme("dark")} />Dark</label>
        </fieldset>
        <span className="t-caption">Saved in this browser. Reports and PDFs always use the light theme.</span>
      </section>
    </div>
  );
}
