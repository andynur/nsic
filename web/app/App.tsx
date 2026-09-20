import { useEffect, useState } from "react";
import { Router, Link, useRoute, navigate, type RouteDef } from "./router.tsx";
import { onOnline, wsStart } from "./api.ts";
import { ToastProvider } from "./components/Toasts.tsx";
import { Icon } from "./components/Icon.tsx";
import { DashboardPage } from "./pages/dashboard.tsx";
import { InboxPage } from "./pages/Inbox.tsx";
import { ProjectsPage } from "./pages/Projects.tsx";
import { ProjectPage } from "./pages/Project.tsx";
import { EnvironmentPage } from "./pages/Environment.tsx";
import { NewIssuePage } from "./pages/NewIssue.tsx";
import { IssuePage } from "./pages/Issue.tsx";
import { ReportPage } from "./pages/Report.tsx";
import { UsagePage } from "./pages/Usage.tsx";
import { SettingsPage } from "./pages/Settings.tsx";
import { Empty } from "./components/ui.tsx";
import { useTheme } from "./theme.ts";
import { useDocumentTitle } from "./hooks.ts";

const ROUTES: RouteDef[] = [
  { name: "dashboard", pattern: "/dashboard" },
  { name: "inbox", pattern: "/" },
  { name: "projects", pattern: "/projects" },
  { name: "env", pattern: "/projects/:id/env/:envId" },
  { name: "project", pattern: "/projects/:id" },
  { name: "newIssue", pattern: "/issues/new" },
  { name: "report", pattern: "/issues/:key/report" },
  { name: "issue", pattern: "/issues/:key" },
  { name: "usage", pattern: "/usage" },
  { name: "settings", pattern: "/settings" },
];

const TITLES: Record<string, string> = { dashboard: "Dashboard", inbox: "Inbox", projects: "Projects", project: "Project", env: "Environment", newIssue: "New issue", issue: "Issue", report: "Report", usage: "Usage", settings: "Settings" };
const NAV_KEY = "nsic.nav.collapsed";

function Page() {
  const { match } = useRoute();
  const p = match?.params ?? {};
  // Pages with a more specific name (issue key, project name) override this with useDocumentTitle.
  useDocumentTitle(match ? (p.key ? `${p.key}${match.name === "report" ? " report" : ""}` : TITLES[match.name] ?? null) : "Page not found");
  switch (match?.name) {
    case "dashboard": return <DashboardPage />;
    case "inbox": return <InboxPage />;
    case "projects": return <ProjectsPage />;
    case "project": return <ProjectPage id={p.id!} />;
    case "env": return <EnvironmentPage projectId={p.id!} envId={p.envId!} />;
    case "newIssue": return <NewIssuePage />;
    case "issue": return <IssuePage issueKey={p.key!} />;
    case "report": return <ReportPage issueKey={p.key!} />;
    case "usage": return <UsagePage />;
    case "settings": return <SettingsPage />;
    default: return <Empty title="Page not found" action={<Link to="/" className="btn">Back to Inbox</Link>} />;
  }
}

function readCollapsed() {
  try {
    return localStorage.getItem(NAV_KEY) === "1";
  } catch {
    return false;
  }
}

function Shell() {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [theme, setTheme] = useTheme();
  useEffect(() => {
    try {
      localStorage.setItem(NAV_KEY, collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [collapsed]);
  const [online, setOnline] = useState(true);
  useEffect(() => {
    wsStart();
    const off = onOnline(setOnline);
    return () => {
      off();
    };
  }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable]") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "c") {
        e.preventDefault();
        navigate("/issues/new");
      }
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, []);
  return (
    <div className={`shell${collapsed ? " collapsed" : ""}`}>
      <a className="skip-link" href="#main">Skip to content</a>
      <nav className="nav" aria-label="Main navigation">
        <div className="brand">
          <strong>NSIC</strong>
          <button className="btn ghost sm" aria-label={collapsed ? "Open navigation" : "Collapse navigation"} onClick={() => setCollapsed((c) => !c)}><Icon name="menu" /></button>
        </div>
        <Link to="/dashboard"><Icon name="chart" /><span className="label">Dashboard</span></Link>
        <Link to="/"><Icon name="inbox" /><span className="label">Inbox</span></Link>
        <Link to="/issues/new"><Icon name="plus" /><span className="label">New issue</span></Link>
        <Link to="/projects"><Icon name="folder" /><span className="label">Projects</span></Link>
        <Link to="/usage"><Icon name="chart" /><span className="label">Usage</span></Link>
        <div className="spacer" />
        <button type="button" className="nav-btn" aria-pressed={theme === "dark"} title={collapsed ? (theme === "dark" ? "Dark theme on" : "Dark theme off") : undefined} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
          <Icon name={theme === "dark" ? "moon" : "sun"} /><span className="label">Dark theme</span><span className="label switch" aria-hidden="true" />
        </button>
        <Link to="/settings"><Icon name="settings" /><span className="label">Settings</span></Link>
      </nav>
      <div style={{ minWidth: 0 }}>
        {!online && <div className="banner" role="alert"><Icon name="warning" className="warn-text" />Server not connected. Retrying automatically.</div>}
        <main className="content" id="main"><Page /></main>
      </div>
    </div>
  );
}

export function App() {
  return (
    <ToastProvider>
      <Router routes={ROUTES}><Shell /></Router>
    </ToastProvider>
  );
}
