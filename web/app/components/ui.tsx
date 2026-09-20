import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "./Icon.tsx";

export const LEVEL_NAME = ["Unverified", "Reported", "Observed", "Reproduced", "Root-caused", "Verified fix"];

export function EvidenceLevel({ level, long }: { level: number; long?: boolean }) {
  return (
    <span title={LEVEL_NAME[level]}>
      <span className={`ev${level >= 4 ? " strong" : ""}`}>E{level}</span>
      {long ? <span className={level >= 4 ? "w500" : undefined}> · {LEVEL_NAME[level]}</span> : null}
    </span>
  );
}

const STATUS_TONE: Record<string, string> = {
  draft: "", ingesting: "info", investigating: "info", awaiting_user: "warning", reproduced: "info", root_caused: "success", fixing: "info", verifying: "info",
  resolved: "success", closed: "", blocked: "error", budget_exceeded: "error", cancelled: "",
  running: "info", done: "success", failed: "error", passed: "success", queued: "", skipped: "",
};
export function Status({ value, label }: { value: string; label?: string }) {
  return (
    <span className="status">
      <span className={`dot ${STATUS_TONE[value] ?? ""}`} aria-hidden="true" />
      {label ?? value.replace(/_/g, " ")}
    </span>
  );
}

/** Agent state label (05 §3) for the UI. */
export const STATE_LABEL: Record<string, string> = {
  TRIAGE: "triage", INVESTIGATE: "investigating", HYPOTHESIZE: "hypothesizing", REPRODUCE: "reproducing", ROOT_CAUSE: "root cause", REPORT_DRAFT: "drafting report",
  AWAIT_USER: "awaiting user", CAPTURE: "capturing", FIX: "fixing", VALIDATE: "validating", AWAIT_DEPLOY_APPROVAL: "awaiting approval", DEPLOY_SANDBOX: "deploying", VERIFY: "verifying", DONE: "done", BLOCKED: "blocked", BUDGET_EXCEEDED: "budget exceeded",
};
export const stateLabel = (s: string) => STATE_LABEL[s] ?? s.toLowerCase().replace(/_/g, " ");

const TIER_NAME: Record<string, string> = { A: "Full", B: "Developer", C: "UI only", P: "Production read-only", none: "No access" };
export const tierLabel = (t: string) => `Tier ${t === "none" ? "none" : t} · ${TIER_NAME[t] ?? ""}`;

export function Money({ usd, digits = 4 }: { usd: number | null | undefined; digits?: number }) {
  if (usd === null || usd === undefined) return <span className="faint">-</span>;
  return <span className="num">${usd.toFixed(digits)}</span>;
}
export const fmtTokens = (n: number) => (n >= 1_000_000 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

export function Time({ ms, withDate }: { ms: number | null | undefined; withDate?: boolean }) {
  if (!ms) return <span className="faint">-</span>;
  const d = new Date(ms);
  const s = withDate || Date.now() - ms > 20 * 3600_000 ? d.toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" }) : d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  return <time dateTime={d.toISOString()}>{s}</time>;
}

export function relative(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  return `${Math.floor(s / 86400)} days ago`;
}

export function Loading({ lines = 3 }: { lines?: number }) {
  return (
    <div className="stack" aria-busy="true" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => <div key={i} className="skeleton" style={{ width: `${90 - i * 15}%` }} />)}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-box" role="alert">
      <div className="row"><Icon name="warning" /><span className="err-text w500">Failed to load</span></div>
      <div className="t-compact">{message}</div>
      {onRetry && <div><button className="btn sm" onClick={onRetry}>Retry</button></div>}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="t-subheading" style={{ color: "var(--ns-text)" }}>{title}</div>
      {children && <div className="t-compact">{children}</div>}
      {action}
    </div>
  );
}

export function Field({ label, help, error, children, className, htmlFor }: { label: string; help?: ReactNode; error?: string | null; children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={`field ${className ?? ""}`}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? <div className="err">{error}</div> : help ? <div className="help">{help}</div> : null}
    </div>
  );
}

/** Server-sanitized HTML (markdown without raw HTML). */
export function Html({ html, className }: { html: string; className?: string }) {
  return <div className={`md ${className ?? ""}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1500);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <button className="btn ghost sm" onClick={() => navigator.clipboard.writeText(text).then(() => setDone(true))}>
      <Icon name={done ? "check" : "copy"} />
      {done ? "Copied" : label}
    </button>
  );
}

export function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="overlay" onClick={onClose}>
      <div className={`dialog${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="row-between">
          <h2 className="t-heading">{title}</h2>
          <button className="btn ghost sm" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * Decimal number input that always shows a dot separator. A native type="number" follows the OS locale
 * (e.g. "1,25"), which disagrees with the rest of the English UI. A typed comma is accepted as a dot.
 */
export function DecimalInput({ value, onChange, className, ...rest }: { value: number | null; onChange: (v: number | null) => void; className?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">) {
  const [text, setText] = useState(value === null ? "" : String(value));
  useEffect(() => {
    setText((t) => (t !== "" && Number(t) === value) || (t === "" && value === null) ? t : value === null ? "" : String(value));
  }, [value]);
  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      className={`input num ${className ?? ""}`}
      value={text}
      onChange={(e) => {
        const v = e.target.value.replace(",", ".");
        if (!/^\d*\.?\d*$/.test(v)) return;
        setText(v);
        if (v === "" || v === ".") onChange(null);
        else onChange(Number(v));
      }}
    />
  );
}
