// Browser session & Login Assist (08 §2). Bun.WebView is headless only, so Login Assist launches
// a headed Chrome directly with --user-data-dir on the environment's profile; the runner uses the same profile (headless).
import type { Subprocess } from "bun";
import { mkdirSync } from "node:fs";
import { config } from "../config.ts";
import { dataPath } from "../lib/fs.ts";
import { type Result, ok, appErr, errorMessage } from "../lib/result.ts";
import { getEnvironment } from "../db/repo/environments.ts";
import { audit } from "../db/repo/audit.ts";
import { saveSecret } from "../netsuite/credentials.ts";
import { chromePath, WebViewDriver, type BrowserDriver } from "./driver.ts";

export const profileDir = (envId: string) => dataPath("profiles", envId);

const LOGIN_URL = /\/app\/login\/|\/pages\/customerlogin|system\.netsuite\.com\/pages\/login|\/app\/login\/secure|login\.jsp|\/saml|\/sso\//i;

export const isLoginPage = (url: string) => LOGIN_URL.test(url);

export const LOGIN_FORM_PROBE = `(() => !!(document.querySelector('input#email, input[name=email]') && document.querySelector('input[type=password]')))()`;

const assists = new Map<string, Subprocess>();

export function startLoginAssist(envId: string): Result<{ pid: number }> {
  const env = getEnvironment(envId);
  if (!env?.ui_base_url) return appErr("env_no_url", "environment UI base URL is not set");
  const chrome = chromePath(config().chromePath);
  if (!chrome) return appErr("no_chrome", "Chrome/Chromium not found. Set CHROME_PATH in .env");
  if (assists.has(envId)) return appErr("assist_running", "Login Assist is already running for this environment");
  const dir = profileDir(envId);
  mkdirSync(dir, { recursive: true });
  const p = Bun.spawn([chrome, `--user-data-dir=${dir}`, "--no-first-run", "--no-default-browser-check", "--new-window", `${env.ui_base_url}/app/center/card.nl`], { stdout: "ignore", stderr: "ignore" });
  assists.set(envId, p);
  void p.exited.then(() => assists.delete(envId));
  audit("user", "browser.login_assist.start", { environmentId: envId });
  return ok({ pid: p.pid });
}

/** Close the headed Chrome (so cookies flush), verify the headless session, back up encrypted cookies. */
export async function finishLoginAssist(envId: string): Promise<Result<{ loggedIn: boolean; url: string }>> {
  const p = assists.get(envId);
  if (p) {
    p.kill("SIGTERM");
    await Promise.race([p.exited, Bun.sleep(8000)]);
    assists.delete(envId);
  }
  const r = await withSession(envId, async (d, env) => {
    await d.navigate(`${env.ui_base_url}/app/center/card.nl`);
    const url = d.url();
    const loggedIn = !isLoginPage(url) && !(await d.evaluate<boolean>(LOGIN_FORM_PROBE).catch(() => false));
    if (loggedIn) {
      const c = await d.cdp<{ cookies: unknown[] }>("Storage.getCookies", {});
      await saveSecret(envId, "browser_session", { cookies: c.cookies, savedAt: Date.now() });
    }
    return { loggedIn, url };
  });
  if (r.ok) audit("user", "browser.login_assist.finish", { environmentId: envId, detail: { loggedIn: r.value.loggedIn } });
  return r;
}

export async function withSession<T>(envId: string, fn: (d: BrowserDriver, env: NonNullable<ReturnType<typeof getEnvironment>>) => Promise<T>, opts: { width?: number; height?: number } = {}): Promise<Result<T>> {
  const env = getEnvironment(envId);
  if (!env?.ui_base_url) return appErr("env_no_url", "environment UI base URL is not set");
  const chrome = chromePath(config().chromePath);
  if (!chrome) return appErr("no_chrome", "Chrome/Chromium not found. Set CHROME_PATH in .env");
  let d: BrowserDriver | undefined;
  try {
    d = new WebViewDriver({ chrome, profileDir: profileDir(envId), ...opts });
    return ok(await fn(d, env));
  } catch (e) {
    return appErr("browser_error", errorMessage(e));
  } finally {
    try {
      d?.close();
    } catch {
      /* already closed */
    }
  }
}

export async function checkBrowserSession(envId: string): Promise<{ ok: boolean; log: string }> {
  const env = getEnvironment(envId);
  if (!env?.ui_base_url) return { ok: false, log: "browser: UI base URL is empty" };
  if (!(await Bun.file(`${profileDir(envId)}/Local State`).exists())) return { ok: false, log: "browser: no profile yet (run Login Assist)" };
  const r = await withSession(envId, async (d) => {
    await d.navigate(`${env.ui_base_url}/app/center/card.nl`);
    return !isLoginPage(d.url()) && !(await d.evaluate<boolean>(LOGIN_FORM_PROBE).catch(() => false));
  });
  if (!r.ok) return { ok: false, log: `browser: ${r.error.message}` };
  return { ok: r.value, log: r.value ? "browser: session active" : "browser: session expired, re-login required" };
}
