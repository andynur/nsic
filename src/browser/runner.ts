// Repro DSL runner (08 §4): guard → action → wait for stability → redaction → (highlight) → screenshot → error detection.
import { join } from "node:path";
import { dataPath, issueDir, relData, writeData } from "../lib/fs.ts";
import { errorMessage } from "../lib/result.ts";
import { audit } from "../db/repo/audit.ts";
import { insertArtifact } from "../db/repo/artifacts.ts";
import { emit } from "../realtime/events.ts";
import type { Environment } from "../db/repo/environments.ts";
import type { RunMode } from "../db/repo/artifacts.ts";
import type { BrowserDriver } from "./driver.ts";
import type { ReproScript, ReproStep } from "./dsl.ts";
import { checkClickTarget, checkRequest, checkStep, checkUrl, DOM_GUARD_SCRIPT, guardModeFor, type GuardMode } from "./guard.ts";
import { DEFAULT_REDACT_PATTERNS, DEFAULT_REDACT_SELECTORS, redactScript } from "./redact.ts";
import { DIALOG_CAPTURE_SCRIPT, LOADING_IDLE_SCRIPT, READ_FNS, highlightScript, locateScript, readPageErrorsScript, unhighlightScript } from "./page-scripts.ts";
import { isLoginPage, LOGIN_FORM_PROBE } from "./session.ts";
import { Recorder } from "./recorder.ts";

export type StepStatus = "passed" | "failed" | "blocked" | "skipped";
export type StepResult = { index: number; id: string; action: string; status: StepStatus; caption?: string; note?: string; errors?: { messages: string[]; codes: string[]; dialogs: unknown[] }; value?: unknown; screenshotArtifactId?: string; durationMs: number };
export type RunResult = { status: "passed" | "failed" | "blocked"; steps: StepResult[]; blocked: { reason: string; target: string }[]; errorsSeen: string[]; video?: { artifactId?: string; captionsArtifactId?: string; reason?: string }; loginRequired?: boolean };

export type RunCtx = {
  driver: BrowserDriver;
  env: Pick<Environment, "id" | "kind" | "ui_base_url" | "account_id">;
  issueId: string;
  runId: string;
  mode: RunMode;
  record: boolean;
  projectRedact?: { selectors?: string[]; patterns?: string[] };
  signal?: AbortSignal;
};

const FULL = { width: 1440, height: 900 };

async function waitStable(d: BrowserDriver, timeoutMs: number) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await d.evaluate<boolean>(LOADING_IDLE_SCRIPT).catch(() => true)) return true;
    await Bun.sleep(200);
  }
  return false;
}

function resolveUrl(url: string, base: string | null): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `${(base ?? "").replace(/\/$/, "")}/${url.replace(/^\//, "")}`;
}

export async function runRepro(script: ReproScript, ctx: RunCtx): Promise<RunResult> {
  const { driver: d, env } = ctx;
  const mode: GuardMode = guardModeFor(env.kind);
  const accountHost = env.account_id.toLowerCase().replace(/_/g, "-");
  const shotsRel = issueDir(ctx.issueId, "screenshots", ctx.runId);
  const result: RunResult = { status: "passed", steps: [], blocked: [], errorsSeen: [] };
  const redactSel = [...DEFAULT_REDACT_SELECTORS, ...(ctx.projectRedact?.selectors ?? []), ...(script.redact?.selectors ?? [])];
  const redactPat = [...DEFAULT_REDACT_PATTERNS, ...(ctx.projectRedact?.patterns ?? []), ...(script.redact?.patterns ?? [])];
  const shouldShoot = ctx.mode !== "explore";
  const shotFormat = ctx.mode === "reproduce" ? ({ format: "jpeg", quality: 60 } as const) : ({ format: "png" } as const);

  const block = (reason: string, target: string, stepId?: string) => {
    result.blocked.push({ reason, target });
    audit("agent", "browser.blocked", { environmentId: env.id, issueId: ctx.issueId, detail: { runId: ctx.runId, stepId, reason, target } });
    emit({ type: "browser.blocked", issueId: ctx.issueId, runId: ctx.runId, reason, target });
  };

  // DOM + network layer only in production; dialogs are logged in all envs.
  await d.navigate("about:blank");
  await d.cdp("Page.enable").catch(() => {});
  await d.cdp("Page.addScriptToEvaluateOnNewDocument", { source: DIALOG_CAPTURE_SCRIPT }).catch(() => {});
  d.on("Page.javascriptDialogOpening", (e: { message: string; type: string }) => {
    void d.cdp("Page.handleJavaScriptDialog", { accept: mode !== "production" }).catch(() => {});
    audit("agent", "browser.dialog", { environmentId: env.id, issueId: ctx.issueId, detail: { type: e.type, message: e.message.slice(0, 300), accepted: mode !== "production" } });
  });
  if (mode === "production") {
    await d.cdp("Page.addScriptToEvaluateOnNewDocument", { source: DOM_GUARD_SCRIPT });
    d.on("Fetch.requestPaused", (e: { requestId: string; request: { method: string; url: string } }) => {
      const why = checkRequest(e.request.method, e.request.url, accountHost);
      if (why) {
        block(why, `${e.request.method} ${e.request.url.slice(0, 200)}`);
        void d.cdp("Fetch.failRequest", { requestId: e.requestId, errorReason: "BlockedByClient" }).catch(() => {});
      } else void d.cdp("Fetch.continueRequest", { requestId: e.requestId }).catch(() => {});
    });
    await d.cdp("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
  }

  const recorder = ctx.record ? new Recorder(d, dataPath(issueDir(ctx.issueId, "videos", ctx.runId))) : null;
  if (recorder) await recorder.start(script.viewport ?? FULL);

  for (const [index, st] of script.steps.entries()) {
    if (ctx.signal?.aborted) break;
    const t0 = performance.now();
    const tStart = recorder?.now() ?? 0;
    const sr: StepResult = { index: index + 1, id: st.id, action: st.action, status: "passed", ...(st.caption && { caption: st.caption }), durationMs: 0 };
    try {
      if (mode === "production") {
        const g = checkStep(st);
        if (g === "skip") {
          sr.status = "skipped";
          sr.note = "sandboxOnly: skipped in production";
          audit("agent", "browser.skipped", { environmentId: env.id, issueId: ctx.issueId, detail: { runId: ctx.runId, stepId: st.id } });
        } else if (g) {
          sr.status = "blocked";
          sr.note = `Blocked: ${g}`;
          block(g, `${st.action} ${st.url ?? JSON.stringify(st.target ?? {})}`, st.id);
        }
      }
      if (sr.status === "passed") await execStep(st, sr);
      // login session expired → stop
      if (isLoginPage(d.url()) || (await d.evaluate<boolean>(LOGIN_FORM_PROBE).catch(() => false))) {
        sr.status = "failed";
        sr.note = "Login session expired. Run Login Assist again.";
        result.loginRequired = true;
      }
      // automatic error detection
      if (sr.status !== "skipped" && sr.status !== "blocked") {
        const pe = await d.evaluate<{ messages: string[]; codes: string[]; dialogs: unknown[] }>(readPageErrorsScript).catch(() => null);
        if (pe && (pe.messages.length || pe.codes.length || pe.dialogs.length)) {
          sr.errors = pe;
          result.errorsSeen.push(...pe.codes, ...pe.messages.map((m) => m.slice(0, 120)));
        }
        if (st.action === "expectError") {
          const hay = [...(pe?.messages ?? []), ...(pe?.codes ?? []), ...((pe?.dialogs ?? []) as { message?: string }[]).map((x) => x.message ?? "")].join("\n");
          const ok = new RegExp(st.match!, "i").test(hay) || hay.toLowerCase().includes(st.match!.toLowerCase());
          if (!ok) {
            sr.status = "failed";
            sr.note = `Error "${st.match}" did not appear`;
          }
        }
      }
      if (shouldShoot && sr.status !== "skipped") sr.screenshotArtifactId = await shoot(st, sr, index + 1);
    } catch (e) {
      sr.status = "failed";
      sr.note = errorMessage(e).slice(0, 300);
    }
    sr.durationMs = Math.round(performance.now() - t0);
    recorder?.cue(st.id, `${index + 1}. ${st.caption ?? st.action}`, tStart);
    result.steps.push(sr);
    audit("agent", `browser.${st.action}`, { environmentId: env.id, issueId: ctx.issueId, detail: { runId: ctx.runId, stepId: st.id, status: sr.status } });
    emit({ type: "run.step", issueId: ctx.issueId, runId: ctx.runId, index: index + 1, status: sr.status, ...(sr.screenshotArtifactId && { screenshotArtifactId: sr.screenshotArtifactId }), ...(st.caption && { caption: st.caption }) });
    if (result.loginRequired) break;
    if (sr.status === "failed" && st.action !== "expectError" && st.action !== "assert") break;
  }

  if (recorder) {
    await recorder.stop();
    const fin = await recorder.finalize();
    result.video = fin.reason ? { reason: fin.reason } : {};
    if (fin.mp4) {
      const f = Bun.file(fin.mp4);
      result.video.artifactId = insertArtifact({ issue_id: ctx.issueId, run_id: ctx.runId, kind: "video", step_index: null, caption: `Recording ${ctx.mode}`, storage_path: relData(fin.mp4), mime: "video/mp4", size_bytes: f.size, redacted: true }).id;
    }
    result.video.captionsArtifactId = insertArtifact({ issue_id: ctx.issueId, run_id: ctx.runId, kind: "captions", step_index: null, caption: "WebVTT captions", storage_path: relData(fin.vtt), mime: "text/vtt", size_bytes: Bun.file(fin.vtt).size, redacted: true }).id;
  }
  if (mode === "production") await d.cdp("Fetch.disable").catch(() => {});

  const anyBlocked = result.steps.some((s) => s.status === "blocked");
  const anyFailed = result.steps.some((s) => s.status === "failed");
  result.status = result.loginRequired ? "blocked" : anyFailed ? "failed" : anyBlocked ? "blocked" : "passed";
  return result;

  async function execStep(st: ReproStep, sr: StepResult) {
    const timeout = st.timeoutMs ?? 30_000;
    switch (st.action) {
      case "navigate": {
        const url = resolveUrl(st.url!, env.ui_base_url);
        if (mode === "production") {
          const why = checkUrl(url, accountHost);
          if (why) {
            sr.status = "blocked";
            sr.note = `Blocked: ${why}`;
            block(why, url, st.id);
            return;
          }
        }
        await d.navigate(url);
        await waitStable(d, timeout);
        return;
      }
      case "wait": {
        const until = Date.now() + Math.min(st.for?.ms ?? timeout, 60_000);
        if (st.for?.ms && !st.for.selector && !st.for.text) return void (await Bun.sleep(st.for.ms));
        while (Date.now() < until) {
          const ok = st.for?.selector
            ? await d.evaluate<boolean>(`!!document.querySelector(${JSON.stringify(st.for.selector)})`)
            : st.for?.text
              ? await d.evaluate<boolean>(`(document.body?.innerText || '').includes(${JSON.stringify(st.for.text)})`)
              : await d.evaluate<boolean>(LOADING_IDLE_SCRIPT);
          if (ok) return;
          await Bun.sleep(250);
        }
        sr.status = "failed";
        sr.note = "timeout waiting for condition";
        return;
      }
      case "click":
      case "type":
      case "select":
      case "scroll": {
        const info = await d.evaluate<{ x: number; y: number; rect: { x: number; y: number; w: number; h: number }; id: string | null; name: string | null; text: string; value: string; tag: string; type: string | null; href: string | null } | null>(locateScript(st.target!));
        if (!info) {
          sr.status = "failed";
          sr.note = "target element not found";
          return;
        }
        if (mode === "production" && st.action === "click") {
          const why = checkClickTarget(info);
          if (why) {
            sr.status = "blocked";
            sr.note = `Blocked: ${why}`;
            block(why, info.id || info.name || info.text, st.id);
            return;
          }
        }
        if (st.action === "scroll") return;
        if (ctx.mode === "capture") await d.evaluate(highlightScript(info.rect, String(sr.index)));
        await d.clickAt({ x: info.x, y: info.y });
        if (st.action === "type" || st.action === "select") {
          await d.evaluate(`(() => { const e = document.activeElement; if (e && 'value' in e) { e.select?.(); } return true; })()`);
          await d.typeText(st.value!);
          if (st.action === "select") await d.cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 }).catch(() => {});
        }
        await waitStable(d, timeout);
        return;
      }
      case "assert": {
        const t = st.target ? await d.evaluate<{ text: string; value: string } | null>(locateScript(st.target)) : { text: await d.evaluate<string>("document.body?.innerText || ''"), value: "" };
        if (!t) {
          sr.status = "failed";
          sr.note = "assert element not found";
          return;
        }
        const hay = `${t.text} ${t.value}`;
        const e = st.expect!;
        const pass = (e.textIncludes === undefined || hay.toLowerCase().includes(e.textIncludes.toLowerCase())) && (e.valueEquals === undefined || t.value === e.valueEquals || t.text.trim() === e.valueEquals);
        sr.value = hay.slice(0, 300);
        if (!pass) {
          sr.status = "failed";
          sr.note = `assert failed: found "${hay.slice(0, 120)}"`;
        }
        return;
      }
      case "evaluate": {
        const fn = READ_FNS[st.fn!];
        sr.value = fn ? await d.evaluate(fn(st.args ?? {})) : null;
        return;
      }
      case "expectError":
      case "screenshot":
      case "note":
        return;
    }
  }

  async function shoot(st: ReproStep, sr: StepResult, index: number): Promise<string | undefined> {
    await d.evaluate(redactScript(redactSel, redactPat)).catch(() => 0);
    const png = await d.screenshot(shotFormat);
    await d.evaluate(unhighlightScript).catch(() => {});
    const ext = shotFormat.format === "jpeg" ? "jpg" : "png";
    const rel = join(shotsRel, `${String(index).padStart(2, "0")}-${st.id}.${ext}`);
    await writeData(rel, png);
    return insertArtifact({ issue_id: ctx.issueId, run_id: ctx.runId, kind: "screenshot", step_index: index, caption: st.caption ?? `${st.action}`, storage_path: rel, mime: ext === "jpg" ? "image/jpeg" : "image/png", size_bytes: png.length, redacted: true }).id;
  }
}
