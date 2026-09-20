import { useEffect, useState } from "react";
import { useApi } from "../hooks.ts";
import { Link, navigate, useQuery } from "../router.tsx";
import { Empty, ErrorBox, EvidenceLevel, Loading, Money, Status, Time } from "../components/ui.tsx";
import type { Dashboard } from "../dashboard-types.ts";

export function DashboardPage() {
  const query = useQuery();
  return <DashboardView key={query.toString()} />;
}

function DashboardView() {
  const query = useQuery();
  const project = query.get("project") ?? "";
  const days = query.get("days") === "7" ? "7" : "30";
  const params = new URLSearchParams({ days, ...(project ? { project } : {}) });
  const result = useApi<Dashboard>(`/api/dashboard?${params}`);
  const { reload } = result;
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") reload(); };
    const timer = setInterval(refresh, 30000);
    document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [reload]);
  const filter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    navigate(`/dashboard?${next}`);
  };
  const d = result.data;
  const [dailyFilter, setDailyFilter] = useState<"all" | "nonzero">("all");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const visibleDaily = d?.daily.filter((day) => dailyFilter === "all" || day.cost_usd > 0) ?? [];
  const peak = Math.max(0, ...d?.daily.map(v => v.cost_usd) ?? []);
  const selectedDaily = d?.daily.find((day) => day.day === selectedDay);
  return <div className="page">
    <div className="page-head"><div><h1 className="t-title">Dashboard</h1><p className="t-caption">Your investigation workload, next actions, and AI cost.</p></div><Link to="/issues/new" className="btn primary">New issue</Link></div>
    <div className="row dashboard-filters">
      <label className="field dashboard-filter">Project<select className="select" value={project} onChange={e => filter("project", e.target.value)}><option value="">All projects</option>{d?.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label className="field dashboard-filter">Cost period<select className="select" value={days} onChange={e => filter("days", e.target.value)}><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select></label>
      <button className="btn" disabled={result.loading} onClick={reload}>{result.loading ? "Refreshing…" : "Refresh"}</button>
      {(project || days !== "30") && <button className="btn ghost" onClick={() => navigate("/dashboard")}>Clear filters</button>}
      <span className="t-caption" role="status">{d && <>Updated <Time ms={d.generated_at} /> · Refreshes every 30 seconds</>}</span>
    </div>
    {result.error ? <ErrorBox message={result.error} onRetry={reload} /> : result.loading && !d ? <Loading lines={5} /> : d && <>
      {!d.total && <Empty title="No issues yet" action={<Link className="btn" to={d.projects.length ? "/issues/new" : "/projects"}>{d.projects.length ? "Create an issue" : "Create a project"}</Link>}>Create a project and submit an issue to start tracking investigations.</Empty>}
      <dl className="stat-row dashboard-stats">
        <div><dt className="t-caption">Open issues</dt><dd className="v">{d.open}</dd></div>
        <div><dt className="t-caption">Needs attention</dt><dd className="v"><a href="#dashboard-attention">{d.attention_count}</a></dd></div>
        <div><dt className="t-caption">Total issues</dt><dd className="v">{d.total}</dd></div>
        <div><dt className="t-caption">Estimated AI cost · {days} days</dt><dd className="v"><Money usd={d.cost_usd} digits={2} /></dd></div>
      </dl>
      <section className="block" aria-labelledby="dashboard-attention"><div className="row-between"><h2 className="t-heading" id="dashboard-attention">Needs attention</h2><Link to="/">Open Inbox</Link></div><p className="t-caption">Awaiting your input, blocked access, or exceeded budget. Showing {d.attention.length} of {d.attention_count}, oldest update first. Costs are lifetime estimates.</p>
        {!d.attention.length ? <Empty title="Nothing needs your attention">No issues are awaiting input, blocked, or over budget.</Empty> : <div className="table-wrap"><table className="t"><caption className="sr-only">Issues needing attention</caption><thead><tr><th scope="col">Issue</th><th scope="col">Status</th><th scope="col">Priority</th><th scope="col" className="num">Cost / budget</th><th scope="col" className="num">Updated</th></tr></thead><tbody>{d.attention.map(i => <tr key={i.key}><td><Link to={`/issues/${encodeURIComponent(i.key)}`}><span className="t-mono">{i.key}</span> · {i.title}</Link></td><td><Status value={i.status} /></td><td>{i.priority}</td><td className="num"><Money usd={i.cost_usd} digits={2} /> / <Money usd={i.budget_usd} digits={2} /></td><td className="num"><Time ms={i.updated_at} withDate /></td></tr>)}</tbody></table></div>}
      </section>
      <div className="grid-2">
        <section className="block" aria-labelledby="dashboard-status"><h2 className="t-heading" id="dashboard-status">Current issue status</h2>{!d.statuses.length ? <p>No issues to summarize.</p> : <ul className="dashboard-distribution">{d.statuses.map(s => <li key={s.status}><Status value={s.status} /><span className="dashboard-track" aria-hidden="true"><span style={{ width: `${s.count / d.total * 100}%` }} /></span><span className="num">{s.count}</span></li>)}</ul>}</section>
        <section className="block" aria-labelledby="dashboard-evidence"><h2 className="t-heading" id="dashboard-evidence">Evidence on open issues</h2><p className="t-caption">Highest non-rejected evidence per issue. Current state, all dates.</p><ul className="dashboard-distribution">{d.evidence.map(e => <li key={e.level}><EvidenceLevel level={e.level} long /><span className="dashboard-track" aria-hidden="true"><span style={{ width: `${d.open ? e.count / d.open * 100 : 0}%` }} /></span><span className="num">{e.count}</span></li>)}</ul></section>
      </div>
      <section className="block" aria-labelledby="dashboard-cost"><div className="row-between chart-heading"><h2 className="t-heading" id="dashboard-cost">Daily AI cost</h2><div className="row"><div className="segmented" role="group" aria-label="Daily cost filter"><button className={dailyFilter === "all" ? "selected" : ""} aria-pressed={dailyFilter === "all"} onClick={() => setDailyFilter("all")}>All days</button><button className={dailyFilter === "nonzero" ? "selected" : ""} aria-pressed={dailyFilter === "nonzero"} onClick={() => setDailyFilter("nonzero")}>With cost</button></div><Link to="/usage">Usage details</Link></div></div><p className="t-caption">UTC calendar days, including today. Shared scale: $0 to ${peak.toFixed(4)}. Recorded estimates, not invoices.</p>
        <div className="bars dashboard-bars interactive-bars" aria-label="Daily AI cost trend" role="group">{visibleDaily.map(day => { const ratio = day.cost_usd / (peak || 1); const tone = ratio >= 0.75 ? "high" : ratio >= 0.4 ? "medium" : "low"; return <button type="button" key={day.day} className={`chart-bar tone-${tone} ${selectedDay === day.day ? "selected" : ""}`} aria-label={`${day.day}: $${day.cost_usd.toFixed(4)}`} aria-pressed={selectedDay === day.day} title={`${day.day}: $${day.cost_usd.toFixed(4)}`} style={{ height: `${ratio * 100}%` }} onClick={() => setSelectedDay(day.day)} />; })}</div><div className="row-between t-caption"><span>{visibleDaily[0]?.day ?? "No days"}</span><span>{visibleDaily.at(-1)?.day ?? ""}</span></div>
        <p className="t-caption chart-insight" role="status">{selectedDaily ? <><strong>{selectedDaily.day}</strong>: <Money usd={selectedDaily.cost_usd} digits={4} /></> : "Select a bar to inspect a day."}</p>
        {!d.cost_usd && <p className="t-caption">No recorded cost in this period.</p>}
        <details><summary>View daily values</summary><div className="table-wrap"><table className="t"><caption>Daily estimated cost in USD</caption><thead><tr><th scope="col">Date (UTC)</th><th scope="col" className="num">Cost</th></tr></thead><tbody>{d.daily.map(day => <tr key={day.day}><td>{day.day}</td><td className="num"><Money usd={day.cost_usd} /></td></tr>)}</tbody></table></div></details>
      </section>
      <section className="block" aria-labelledby="dashboard-projects"><h2 className="t-heading" id="dashboard-projects">Project workload</h2><div className="table-wrap"><table className="t"><caption className="sr-only">Current workload by project, all dates</caption><thead><tr><th scope="col">Project</th><th scope="col" className="num">Open issues</th><th scope="col" className="num">Needs attention</th></tr></thead><tbody>{d.workload.map(p => <tr key={p.id}><td><Link to={`/projects/${encodeURIComponent(p.id)}`}>{p.name}</Link></td><td className="num">{p.open}</td><td className="num">{p.attention}</td></tr>)}</tbody></table></div>{!d.workload.length && <p>No projects yet.</p>}</section>
    </>}
  </div>;
}
