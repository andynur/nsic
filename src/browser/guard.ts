// Browser production guard (08 §5, 06 §6 layer 6). Active automatically for the production env; cannot be turned off from the UI.
// CHANGES TO THIS FILE MUST BE ACCOMPANIED BY A TEST IN tests/guard/ (AGENTS.md rule 6).
import type { ReproScript, ReproStep } from "./dsl.ts";

export type GuardMode = "production" | "audit_only";
export const guardModeFor = (envKind: string): GuardMode => (envKind === "production" ? "production" : "audit_only");

export type GuardViolation = { stepId?: string; reason: string; target: string };

/** Element id/name that must not be clicked in production. */
export const DENY_IDS = ["submitter", "btn_multibutton_submitter", "secondarysubmitter", "edit", "delete", "approve", "reject", "resetter", "secondaryedit", "secondarydelete", "void", "secondaryapprove", "secondaryreject", "saveandnew", "saveandclose", "process", "markpacked", "markshipped", "tbl_submitter", "spn_multibutton_submitter", "_approve", "_reject"];

/** Dangerous localized button text. Matched as a whole word, case-insensitive. Do not translate: these must match real page content. */
export const DENY_TEXTS = [
  "save", "submit", "approve", "reject", "delete", "edit", "void", "close", "bill", "receive", "fulfill", "fulfil", "process", "post", "cancel order", "make copy", "mark shipped", "mark packed", "enter bill", "create", "new",
  "simpan", "kirim", "setujui", "tolak", "hapus", "ubah", "batalkan", "tutup", "terima", "proses", "buat",
];

/** Paths that create/change data or open scripting areas. */
export const DENY_PATHS = [/\/app\/common\/scripting\//i, /\/app\/setup\//i, /\/app\/common\/media\/.*upload/i, /\/app\/site\/hosting\/scriptlet\.nl.*(?:deploy|script)=/i];

export type TargetInfo = { id?: string | null; name?: string | null; text?: string | null; tag?: string | null; type?: string | null; href?: string | null; value?: string | null; form?: boolean };

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

export function checkClickTarget(t: TargetInfo): string | null {
  const id = norm(t.id);
  const name = norm(t.name);
  for (const d of DENY_IDS) {
    if (id === d || name === d || id.endsWith(`_${d}`) || id.startsWith(`${d}_`) || id === `spn_${d}` || id === `tdbody_${d}`) return `element ${t.id || t.name} is on the denylist`;
  }
  const texts = [norm(t.text), norm(t.value)].filter(Boolean);
  for (const tx of texts) {
    const clean = tx.replace(/\s+/g, " ").slice(0, 80);
    for (const d of DENY_TEXTS) if (new RegExp(`(^|[^\\p{L}])${d.replace(/ /g, "\\s+")}([^\\p{L}]|$)`, "iu").test(clean)) return `button "${clean}" is a write action`;
  }
  const tag = norm(t.tag);
  const type = norm(t.type);
  if ((tag === "input" || tag === "button") && type === "submit") return "form submit button";
  if (t.href && checkUrl(t.href) !== null) return `link goes to ${checkUrl(t.href)}`;
  return null;
}

/** Check a navigation URL. Returns the block reason or null. */
export function checkUrl(url: string, accountHost?: string): string | null {
  let u: URL;
  try {
    u = new URL(url, "https://placeholder.app.netsuite.com");
  } catch {
    return "invalid URL";
  }
  if (u.protocol === "javascript:") return "javascript: URL blocked";
  const params = new URLSearchParams(u.search);
  if (params.get("e")?.toUpperCase() === "T") return "edit mode (e=T)";
  if (params.get("cp")?.toUpperCase() === "F" || params.get("copy")?.toUpperCase() === "T" || params.get("memdoc")) return "creating a copy/new record";
  if (/\.nl$/i.test(u.pathname) && !params.get("id") && /\/app\/accounting\/transactions\/|\/app\/common\/entity\/|\/app\/common\/custom\/custrecordentry/i.test(u.pathname) && !/list|search|report/i.test(u.pathname)) return "opening a new record form (no id)";
  for (const re of DENY_PATHS) if (re.test(u.pathname + u.search)) return `path ${u.pathname} blocked`;
  if (params.get("delete") || params.get("_delete") || /delete/i.test(params.get("action") ?? "")) return "delete action";
  if (accountHost && u.hostname !== "placeholder.app.netsuite.com" && !u.hostname.endsWith("netsuite.com")) return `domain outside NetSuite: ${u.hostname}`;
  return null;
}

/** Validate the Repro DSL before running (DSL layer). */
export function checkScript(script: ReproScript, mode: GuardMode): { violations: GuardViolation[]; skipped: string[] } {
  const violations: GuardViolation[] = [];
  const skipped: string[] = [];
  if (mode !== "production") return { violations, skipped };
  for (const st of script.steps) {
    const v = checkStep(st);
    if (v === "skip") skipped.push(st.id);
    else if (v) violations.push({ stepId: st.id, reason: v, target: describeStep(st) });
  }
  return { violations, skipped };
}

/** Per step: 'skip' for sandboxOnly, a reason string when rejected, null when allowed. */
export function checkStep(st: ReproStep): string | "skip" | null {
  if (st.sandboxOnly) return "skip";
  if (st.action === "type" || st.action === "select") return `action ${st.action} is not allowed in production`;
  if (st.action === "navigate" && st.url) return checkUrl(st.url);
  if (st.action === "click" && st.target) {
    const t = st.target;
    const r = checkClickTarget({ id: t.field ? t.field : t.selector?.match(/#([\w-]+)/)?.[1], text: t.text, name: t.field });
    if (r) return r;
  }
  return null;
}

export const describeStep = (st: ReproStep) => `${st.action} ${st.url ?? JSON.stringify(st.target ?? st.fn ?? "")}`.trim();

/** Network request: non-GET to the account domain is rejected except for the read allowlist. */
export const NETWORK_READ_ALLOWLIST = [/\/app\/common\/search\/searchresults\.nl/i, /\/app\/site\/hosting\/restlet\.nl.*nsic_log_reader/i, /\/core\/media\//i, /\/app\/center\/userprefs\//i, /\/rum\//i, /\/app\/common\/scripting\/nlapihandler\.nl.*(?:getRecord|search)/i];

export function checkRequest(method: string, url: string, accountHost: string | null): string | null {
  const m = method.toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") {
    const r = checkUrl(url);
    return r && /e=T|new record|delete/.test(r) ? r : null;
  }
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return "invalid URL";
  }
  const isAccount = accountHost ? host.includes(accountHost) || host.endsWith("netsuite.com") : host.endsWith("netsuite.com");
  if (!isAccount) return null;
  if (NETWORK_READ_ALLOWLIST.some((re) => re.test(url))) return null;
  return `request ${m} to ${host} blocked`;
}

/** Script injected on each new document (DOM layer): prevent form submits & confirm dialogs. */
export const DOM_GUARD_SCRIPT = `(() => {
  if (window.__nsicGuard) return; window.__nsicGuard = true; window.__nsicBlocked = [];
  const report = (reason, target) => { try { window.__nsicBlocked.push({ reason, target: String(target).slice(0, 200), at: Date.now() }); } catch (e) {} };
  document.addEventListener('submit', (e) => { e.preventDefault(); e.stopImmediatePropagation(); report('form.submit', (e.target && (e.target.id || e.target.name || e.target.action)) || 'form'); }, true);
  const origSubmit = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function () { report('form.submit()', this.id || this.name || this.action); };
  HTMLFormElement.prototype.requestSubmit = function () { report('form.requestSubmit()', this.id || this.name || this.action); };
  window.confirm = (m) => { report('confirm', m); return false; };
  void origSubmit;
})();`;
