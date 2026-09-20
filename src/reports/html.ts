// Render the HTML report (12 §3) with CSS from templates/report.html + tokens.css. Markdown is rendered without raw HTML.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.ts";
import { levelLabel, type ReportModel } from "./model.ts";

export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Markdown → safe HTML: raw HTML dropped, links only http(s)/#, images dropped (03 §4). */
/** Shorten at a word boundary and mark the cut, so a clipped sentence never reads as complete. */
export function clipWords(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.-]+$/, "")}…`;
}

export function safeMarkdown(md: string): string {
  const html = Bun.markdown.html(md, { noHtmlBlocks: true, noHtmlSpans: true, tagFilter: true });
  return html.replace(/href="(?!https?:|#)[^"]*"/gi, 'href="#"').replace(/<img[^>]*>/gi, "");
}

let cssCache: string | undefined;
function reportCss(): string {
  if (cssCache) return cssCache;
  const tpl = readFileSync(join(config().rootDir, "templates", "report.html"), "utf8");
  const style = /<style>([\s\S]*?)<\/style>/.exec(tpl)?.[1] ?? "";
  const tokens = readFileSync(join(config().rootDir, "web", "styles", "tokens.css"), "utf8");
  cssCache =
    style.replace(/\/\*[^*]*tokens\.css[^*]*\*\/\s*\{\{tokensCss\}\}/, tokens).replace("{{tokensCss}}", tokens) +
    `
  main{display:grid;gap:var(--ns-space-10)}
  .md p{margin:0 0 8px;max-width:68ch} .md ul,.md ol{margin:0 0 8px;padding-left:20px} .md code{font-family:var(--ns-font-mono);font-size:12px;background:var(--ns-bg-subtle);padding:1px 4px;border-radius:4px}
  .qa dt{font-weight:500;margin-top:12px} .qa dd{margin:4px 0 0 0;color:var(--ns-text-secondary)}
  [contenteditable]{outline:1px dashed var(--ns-border-strong);outline-offset:2px} [contenteditable]:focus{outline:2px solid var(--ns-focus)}
  @media print { .shell{padding:0} [contenteditable]{outline:none} }`;
  return cssCache;
}

const fmtTime = (ms: number, tz: string | null) => {
  try {
    return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", ...(tz ? { timeZone: tz } : {}) }).format(ms);
  } catch {
    return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
  }
};

/** imgSrc maps an artifact to a src (file:// for PDF, /api/artifacts/.. for preview). */
export function renderReportHtml(m: ReportModel, imgSrc: (artifactId: string, path: string) => string, opts: { editable?: boolean } = {}): string {
  const ed = (key: string) => (opts.editable ? ` contenteditable="true" data-edit="${key}"` : "");
  const keyShot = m.steps.find((s) => s.screenshotPath && /error|fail/i.test(`${s.caption} ${s.note ?? ""} ${s.status}`)) ?? m.steps.find((s) => s.screenshotPath);
  const sec = (id: string, title: string, body: string) => (body.trim() ? `<section aria-labelledby="${id}"><h2 id="${id}">${esc(title)}</h2>${body}</section>` : "");
  const evidenceRows = m.evidence.map((e) => `<tr><td class="mono">#E${e.seq}</td><td class="mono">E${e.level}</td><td>${esc(e.title)}<br><span class="status">${esc(clipWords(e.body, 400))}</span></td><td class="mono">${esc(e.ref)}</td></tr>`).join("");
  const timelineRows = m.timeline.map((t) => `<tr><td class="mono when">${esc(fmtTime(t.at, m.meta.timezone))}</td><td>${esc(t.actor)}</td><td>${esc(t.event)}</td><td>${esc(t.detail)}</td></tr>`).join("");
  const steps = m.steps
    .map((s) => `<figure>${s.screenshotPath && s.artifactId ? `<img src="${esc(imgSrc(s.artifactId, s.screenshotPath))}" alt="Step ${s.index}">` : ""}<figcaption><span class="mono">${s.index}</span> · ${esc(s.caption)}${s.status !== "passed" ? ` · <b>${esc(s.status)}</b>${s.note ? `: ${esc(s.note)}` : ""}` : ""}</figcaption></figure>`)
    .join("");
  const ba = m.beforeAfter.length
    ? `<table><caption>Before and after the fix in sandbox</caption><thead><tr><th scope="col">Step</th><th scope="col">Before</th><th scope="col">After</th></tr></thead><tbody>${m.beforeAfter.map((r) => `<tr><td>${esc(r.step)}</td><td>${esc(r.before)}</td><td>${esc(r.after)}</td></tr>`).join("")}</tbody></table>`
    : "";
  const usage = m.usage
    ? `<table><caption>AI usage by purpose</caption><thead><tr><th scope="col">Purpose</th><th scope="col" class="num">Tokens</th><th scope="col" class="num">Cost (USD)</th></tr></thead><tbody>${m.usage.byPurpose.map((u) => `<tr><td>${esc(u.purpose)}</td><td class="num">${u.tokens.toLocaleString("en-US")}</td><td class="num">${u.cost.toFixed(4)}</td></tr>`).join("")}<tr><td><b>Total</b></td><td class="num">${m.usage.total.tokens.toLocaleString("en-US")}</td><td class="num">${m.usage.total.cost.toFixed(4)}</td></tr></tbody></table>`
    : "";
  const keyFig = keyShot?.screenshotPath && keyShot.artifactId ? `<figure><img src="${esc(imgSrc(keyShot.artifactId, keyShot.screenshotPath))}" alt="Decisive evidence"><figcaption>Step ${keyShot.index}: ${esc(keyShot.caption)}</figcaption></figure>` : "<div></div>";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(m.meta.issueKey)} · ${esc(m.narrative.titleClaim)}</title>
<style>${reportCss()}</style></head>
<body><div class="shell">
<header class="masthead"><span class="id">${esc(m.meta.brandName)}</span><span><span class="mono">${esc(m.meta.issueKey)}</span> · ${esc(fmtTime(m.meta.preparedAt, m.meta.timezone))}</span></header>
<main>
<div class="opening"><div class="answer">
<h1${ed("titleClaim")}>${esc(m.narrative.titleClaim)}</h1>
<p${ed("oneLine")}>${esc(m.answer.oneLine)}</p>
<p class="status">Status <b>${esc(m.answer.status.replace(/_/g, " "))}</b> · Evidence <b><span class="mono">E${m.answer.evidenceLevel}</span> ${esc(levelLabel(m.answer.evidenceLevel).split(" · ")[1] ?? "")}</b>${m.meta.environment ? ` · Environment <b>${esc(m.meta.environment)}</b> (${esc(m.meta.envKind)})` : ""} · For <b>${m.meta.audience === "client" ? "client" : "internal"}</b></p>
</div>${keyFig}</div>
${sec("h-cause", "Cause", `${m.narrative.causeIntro || opts.editable ? `<p${ed("causeIntro")}>${esc(m.narrative.causeIntro)}</p>` : ""}${m.answer.rootCause ? `<div class="md">${safeMarkdown(m.answer.rootCause)}</div>` : "<p>The cause has not been confirmed yet.</p>"}`)}
${sec("h-timeline", "What happened", `<table><caption>Investigation timeline</caption><thead><tr><th scope="col">Time</th><th scope="col">Actor</th><th scope="col">Event</th><th scope="col">Detail</th></tr></thead><tbody>${timelineRows}</tbody></table>`)}
${sec("h-evidence", "Evidence", `<p${ed("evidenceIntro")}>${esc(m.narrative.evidenceIntro)}</p><table><caption>Evidence, highest level first</caption><thead><tr><th scope="col">ID</th><th scope="col">Level</th><th scope="col">Evidence</th><th scope="col">Reference</th></tr></thead><tbody>${evidenceRows}</tbody></table>`)}
${m.steps.length ? sec("h-steps", "Steps to reproduce", `<p${ed("stepsIntro")}>${esc(m.narrative.stepsIntro)}</p><div class="steps">${steps}</div>`) : ""}
${m.answer.fix || m.answer.verification || ba ? sec("h-fix", "Fix and verification", `<p${ed("fixIntro")}>${esc(m.narrative.fixIntro)}</p>${m.answer.fix ? `<div class="md">${safeMarkdown(m.answer.fix)}</div>` : ""}${m.answer.verification ? `<div class="md">${safeMarkdown(m.answer.verification)}</div>` : ""}${ba}`) : ""}
${m.qa.length ? sec("h-qa", "Questions and answers", `<dl class="qa">${m.qa.map((q) => `<dt>${esc(q.question)}</dt><dd>${esc(q.answer)}</dd>`).join("")}</dl>`) : ""}
${m.caveats.length ? `<section aria-labelledby="h-limits" class="caveats"><h2 id="h-limits">Limitations</h2>${m.caveats.map((c) => `<p>${esc(c)}</p>`).join("")}</section>` : ""}
${usage ? sec("h-usage", "AI usage", usage) : ""}
</main>
<footer>Prepared ${esc(fmtTime(m.meta.preparedAt, m.meta.timezone))} by ${esc(m.meta.preparedBy)}. Observations, hypotheses, and recommendations are labeled as such in every section.</footer>
</div></body></html>`;
}
