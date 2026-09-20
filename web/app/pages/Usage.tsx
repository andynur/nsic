// Usage (14 §8, 10 §3): headline stats, per-issue table, per-model, daily trend (SVG-free bars, one scale).
import { useMemo, useState } from "react";
import { useApi } from "../hooks.ts";
import { Link } from "../router.tsx";
import { Empty, ErrorBox, Loading, Money, fmtTokens } from "../components/ui.tsx";
import type { ProjectListItem, Totals } from "../types.ts";

type Usage = { totals: Totals & { issues: number }; byIssue: (Totals & { issue_id: string; key: string | null; title: string | null })[]; byModel: (Totals & { model: string })[]; byPurpose: (Totals & { purpose: string })[]; daily: (Totals & { day: string })[]; cacheHitRatio: number };

const monthStart = (offset: number) => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + offset, 1).getTime();
};

export function UsagePage() {
  const [month, setMonth] = useState(0);
  const [project, setProject] = useState("");
  const [chartMetric, setChartMetric] = useState<"cost" | "tokens">("cost");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [sort, setSort] = useState<"day" | "cost">("day");
  const [descending, setDescending] = useState(false);
  const projects = useApi<ProjectListItem[]>("/api/projects");
  const from = monthStart(month);
  const to = monthStart(month + 1);
  const u = useApi<Usage>(`/api/usage?from=${from}&to=${to}${project ? `&project=${project}` : ""}`, []);
  const label = new Date(from).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const tok = (t: Totals) => t.input_tokens + t.output_tokens + t.cache_read_tokens + t.cache_write_tokens;
  const daily = u.data?.daily ?? [];
  const dailyValues = useMemo(() => daily.map((d) => ({ ...d, chartValue: chartMetric === "cost" ? d.cost_usd : tok(d) })), [daily, chartMetric]);
  const peak = Math.max(...dailyValues.map((d) => d.chartValue), 0.0001);
  const selected = daily.find((d) => d.day === selectedDay);
  const sortedDaily = [...daily].sort((a, b) => {
    const delta = sort === "day" ? a.day.localeCompare(b.day) : a.cost_usd - b.cost_usd;
    return descending ? -delta : delta;
  });
  const toggleSort = (next: "day" | "cost") => {
    if (sort === next) setDescending((value) => !value); else { setSort(next); setDescending(next === "cost"); }
  };
  return (
    <div className="page">
      <div className="page-head">
        <div><h1 className="t-title">Tokens and cost</h1><span className="t-caption">{label}</span></div>
        <div className="row">
          <select className="select" style={{ width: "auto" }} aria-label="Project" value={project} onChange={(e) => setProject(e.target.value)}><option value="">All projects</option>{projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <button className="btn sm" onClick={() => setMonth(month - 1)}>Previous month</button>
          <button className="btn sm" disabled={month >= 0} onClick={() => setMonth(month + 1)}>Next month</button>
        </div>
      </div>
      {u.error ? <ErrorBox message={u.error} onRetry={u.reload} /> : !u.data ? <Loading /> : !u.data.totals.calls ? <Empty title="No usage in this period" action={month < 0 ? <button className="btn" onClick={() => setMonth(0)}>Go to this month</button> : undefined}>Every Claude API call is logged per step, session, and issue.</Empty> : (
        <>
          <div className="stat-row">
            <div><div className="t-caption">Cost</div><div className="v"><Money usd={u.data.totals.cost_usd} digits={2} /></div></div>
            <div><div className="t-caption">Issues</div><div className="v">{u.data.totals.issues}</div></div>
            <div><div className="t-caption">Average per issue</div><div className="v"><Money usd={u.data.totals.issues ? u.data.totals.cost_usd / u.data.totals.issues : 0} digits={2} /></div></div>
            <div><div className="t-caption">Cache hit ratio</div><div className="v">{Math.round(u.data.cacheHitRatio * 100)}%</div></div>
          </div>
          <section className="block" aria-labelledby="h-daily">
            <div className="row-between chart-heading"><h2 id="h-daily" className="t-heading">Daily trend</h2><div className="row" role="group" aria-label="Chart metric"><button className={`btn sm ${chartMetric === "cost" ? "selected" : "ghost"}`} aria-pressed={chartMetric === "cost"} onClick={() => setChartMetric("cost")}>Cost</button><button className={`btn sm ${chartMetric === "tokens" ? "selected" : "ghost"}`} aria-pressed={chartMetric === "tokens"} onClick={() => setChartMetric("tokens")}>Tokens</button></div></div>
            <div className="bars interactive-bars" aria-label={`Daily ${chartMetric} trend`} role="group">
              {dailyValues.map((d) => {
                const ratio = d.chartValue / peak;
                const tone = ratio >= 0.75 ? "high" : ratio >= 0.4 ? "medium" : "low";
                return <button type="button" key={d.day} className={`chart-bar tone-${tone} ${selectedDay === d.day ? "selected" : ""}`} aria-label={`${d.day}: ${chartMetric === "cost" ? `$${d.cost_usd.toFixed(4)}` : `${fmtTokens(tok(d))} tokens`}`} aria-pressed={selectedDay === d.day} title={`${d.day}: ${chartMetric === "cost" ? `$${d.cost_usd.toFixed(4)}` : `${fmtTokens(tok(d))} tokens`}`} style={{ height: `${ratio * 100}%` }} onClick={() => setSelectedDay(d.day)} />;
              })}
            </div>
            <div className="row-between t-caption"><span>{u.data.daily[0]?.day}</span><span>{u.data.daily.at(-1)?.day}</span></div>
            <p className="t-caption chart-insight" role="status">{selected ? <><strong>{selected.day}</strong>: <Money usd={selected.cost_usd} digits={4} /> · {fmtTokens(tok(selected))} tokens</> : "Select a day to inspect its cost and token volume."}</p>
            <details><summary>View daily values</summary><div className="table-wrap"><table className="t"><caption>Daily usage values</caption><thead><tr><th scope="col"><button className="table-sort" onClick={() => toggleSort("day")}>Day {sort === "day" ? (descending ? "↓" : "↑") : ""}</button></th><th scope="col" className="num"><button className="table-sort" onClick={() => toggleSort("cost")}>Cost {sort === "cost" ? (descending ? "↓" : "↑") : ""}</button></th><th scope="col" className="num">Tokens</th></tr></thead><tbody>{sortedDaily.map((d) => <tr key={d.day}><td>{d.day}</td><td className="num"><Money usd={d.cost_usd} /></td><td className="num">{fmtTokens(tok(d))}</td></tr>)}</tbody></table></div></details>
          </section>
          <div className="grid-2">
            <section className="block" aria-labelledby="h-model">
              <h2 id="h-model" className="t-heading">By model</h2>
              <table className="t"><caption className="sr-only">By model</caption><thead><tr><th scope="col">Model</th><th scope="col" className="num">Calls</th><th scope="col" className="num">Tokens</th><th scope="col" className="num">Cost</th></tr></thead>
                <tbody>{u.data.byModel.map((m) => <tr key={m.model}><td className="t-mono">{m.model}</td><td className="num">{m.calls}</td><td className="num">{fmtTokens(tok(m))}</td><td className="num"><Money usd={m.cost_usd} /></td></tr>)}</tbody></table>
            </section>
            <section className="block" aria-labelledby="h-purpose">
              <h2 id="h-purpose" className="t-heading">By purpose</h2>
              <table className="t"><caption className="sr-only">By purpose</caption><thead><tr><th scope="col">Purpose</th><th scope="col" className="num">Calls</th><th scope="col" className="num">Tokens</th><th scope="col" className="num">Cost</th></tr></thead>
                <tbody>{u.data.byPurpose.map((m) => <tr key={m.purpose}><td>{m.purpose}</td><td className="num">{m.calls}</td><td className="num">{fmtTokens(tok(m))}</td><td className="num"><Money usd={m.cost_usd} /></td></tr>)}</tbody></table>
            </section>
          </div>
          <section className="block" aria-labelledby="h-issue">
            <h2 id="h-issue" className="t-heading">By issue</h2>
            <table className="t"><caption className="sr-only">By issue</caption><thead><tr><th scope="col">Issue</th><th scope="col">Title</th><th scope="col" className="num">Calls</th><th scope="col" className="num">Input</th><th scope="col" className="num">Output</th><th scope="col" className="num">Cache read</th><th scope="col" className="num">Cost</th></tr></thead>
              <tbody>{u.data.byIssue.map((r) => <tr key={r.issue_id ?? "none"}><td className="t-mono">{r.key ? <Link to={`/issues/${r.key}`}>{r.key}</Link> : "-"}</td><td>{r.title ?? "(no issue)"}</td><td className="num">{r.calls}</td><td className="num">{fmtTokens(r.input_tokens)}</td><td className="num">{fmtTokens(r.output_tokens)}</td><td className="num">{fmtTokens(r.cache_read_tokens)}</td><td className="num"><Money usd={r.cost_usd} /></td></tr>)}</tbody></table>
          </section>
        </>
      )}
    </div>
  );
}
