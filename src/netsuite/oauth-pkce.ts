// OAuth 2.0 Authorization Code + PKCE for MCP (07 §3). [SPIKE S-02]: scope & redirect 127.0.0.1.
import { b64url, randomToken } from "../lib/crypto.ts";
import { type Result, ok, appErr, errorMessage } from "../lib/result.ts";
import { putOauthState, takeOauthState } from "../db/repo/reports.ts";
import { getEnvironment } from "../db/repo/environments.ts";
import { authorizeUrl, tokenUrl } from "./urls.ts";
import { loadSecret, saveSecret } from "./credentials.ts";
import { config } from "../config.ts";

export type McpOAuthSecret = { clientId: string; scope: string; accessToken?: string; refreshToken?: string; expiresAt?: number; refreshExpiresAt?: number };

export const DEFAULT_MCP_SCOPE = "mcp";
export const redirectUri = () => `http://127.0.0.1:${config().port}/oauth/callback`;

export async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomToken(32);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(digest) };
}

export async function startOAuth(envId: string, clientId: string, scope = DEFAULT_MCP_SCOPE): Promise<Result<{ authorizeUrl: string }>> {
  const env = getEnvironment(envId);
  if (!env) return appErr("not_found", "environment not found");
  const saved = await saveSecret(envId, "mcp_oauth", { clientId, scope } satisfies McpOAuthSecret);
  if (!saved.ok) return saved;
  const { verifier, challenge } = await pkcePair();
  const state = randomToken(24);
  putOauthState(state, envId, verifier);
  const u = new URL(authorizeUrl(env.account_id));
  u.search = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirectUri(), scope, state, code_challenge: challenge, code_challenge_method: "S256" }).toString();
  return ok({ authorizeUrl: u.toString() });
}

type TokenResponse = { access_token: string; refresh_token?: string; expires_in?: number | string; token_type?: string };

async function postToken(accountId: string, body: Record<string, string>): Promise<Result<TokenResponse>> {
  try {
    const res = await fetch(tokenUrl(accountId), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: new URLSearchParams(body), signal: AbortSignal.timeout(30_000) });
    const text = await res.text();
    if (!res.ok) return appErr("oauth_token", `Token endpoint HTTP ${res.status}: ${text.slice(0, 300)}`);
    return ok(JSON.parse(text) as TokenResponse);
  } catch (e) {
    return appErr("oauth_token", errorMessage(e));
  }
}

export async function completeOAuth(state: string, code: string): Promise<Result<{ environmentId: string }>> {
  const st = takeOauthState(state);
  if (!st) return appErr("oauth_state", "Invalid or expired OAuth state. Run Connect again.");
  const env = getEnvironment(st.environment_id);
  if (!env) return appErr("not_found", "environment not found");
  const sec = await loadSecret<McpOAuthSecret>(env.id, "mcp_oauth", "oauth.callback");
  if (!sec.ok) return sec;
  const t = await postToken(env.account_id, { grant_type: "authorization_code", code, redirect_uri: redirectUri(), client_id: sec.value.clientId, code_verifier: st.code_verifier });
  if (!t.ok) return t;
  const expiresAt = Date.now() + Number(t.value.expires_in ?? 3600) * 1000;
  const saved = await saveSecret(env.id, "mcp_oauth", { ...sec.value, accessToken: t.value.access_token, refreshToken: t.value.refresh_token, expiresAt, refreshExpiresAt: Date.now() + 7 * 24 * 3600_000 } satisfies McpOAuthSecret, { expiresAt });
  if (!saved.ok) return saved;
  return ok({ environmentId: env.id });
}

/** A valid access token; refreshed automatically when < 5 minutes remain. */
export async function getMcpAccessToken(envId: string): Promise<Result<string>> {
  const env = getEnvironment(envId);
  if (!env) return appErr("not_found", "environment not found");
  const sec = await loadSecret<McpOAuthSecret>(envId, "mcp_oauth", "mcp.request");
  if (!sec.ok) return sec;
  const s = sec.value;
  if (s.accessToken && (s.expiresAt ?? 0) - Date.now() > 5 * 60_000) return ok(s.accessToken);
  if (!s.refreshToken) return appErr("oauth_expired", "The MCP token expired and there is no refresh token. Reconnect (Connect).");
  const t = await postToken(env.account_id, { grant_type: "refresh_token", refresh_token: s.refreshToken, client_id: s.clientId });
  if (!t.ok) return appErr("oauth_refresh", `Token refresh failed: ${t.error.message}. Reconnect.`);
  const expiresAt = Date.now() + Number(t.value.expires_in ?? 3600) * 1000;
  await saveSecret(envId, "mcp_oauth", { ...s, accessToken: t.value.access_token, refreshToken: t.value.refresh_token ?? s.refreshToken, expiresAt }, { expiresAt });
  return ok(t.value.access_token);
}
