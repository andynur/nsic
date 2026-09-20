// REST M2M: Client Credentials + JWT assertion (07 §4). The EC P-256 (ES256) key is generated locally via Web Crypto,
// and the self-signed X.509 certificate is built in-house (der.ts) for upload to Setup > Integration > OAuth 2.0 Client Credentials.
// [SPIKE S-03]: confirm NetSuite accepts an EC certificate + ES256 (fallback: RSA-PSS PS256).
import { b64url } from "../lib/crypto.ts";
import { type Result, ok, appErr, errorMessage } from "../lib/result.ts";
import { getEnvironment } from "../db/repo/environments.ts";
import { bitString, ecdsaRawToDer, explicit, int, oid, pem, seq, set, utcTime, utf8 } from "./der.ts";
import { loadSecret, saveSecret } from "./credentials.ts";
import { tokenUrl } from "./urls.ts";

export type M2mSecret = { privateKeyJwk: JsonWebKey; certificatePem: string; clientId?: string; certificateId?: string; accessToken?: string; expiresAt?: number };

const ALG = { name: "ECDSA", namedCurve: "P-256" } as const;

export async function generateKeyAndCert(commonName: string, days = 730): Promise<{ privateKeyJwk: JsonWebKey; certificatePem: string }> {
  const kp = (await crypto.subtle.generateKey(ALG, true, ["sign", "verify"])) as CryptoKeyPair;
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", kp.publicKey));
  const sigAlg = seq(oid("1.2.840.10045.4.3.2")); // ecdsa-with-SHA256
  const name = seq(set(seq(oid("2.5.4.3"), utf8(commonName))), set(seq(oid("2.5.4.10"), utf8("NSIC"))));
  const now = new Date();
  const serial = crypto.getRandomValues(new Uint8Array(16));
  serial[0]! &= 0x7f;
  const tbs = seq(explicit(0, int([2])), int(serial), sigAlg, name, seq(utcTime(now), utcTime(new Date(now.getTime() + days * 86400_000))), name, spki);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, kp.privateKey, tbs as Uint8Array<ArrayBuffer>));
  const cert = seq(tbs, sigAlg, bitString(ecdsaRawToDer(sig)));
  return { privateKeyJwk: await crypto.subtle.exportKey("jwk", kp.privateKey), certificatePem: pem("CERTIFICATE", cert) };
}

export async function signJwt(privateKeyJwk: JsonWebKey, kid: string, claims: Record<string, unknown>): Promise<string> {
  const key = await crypto.subtle.importKey("jwk", privateKeyJwk, ALG, false, ["sign"]);
  const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const input = `${enc({ alg: "ES256", typ: "JWT", kid })}.${enc(claims)}`;
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(input));
  return `${input}.${b64url(sig)}`;
}

export async function createKeypair(envId: string): Promise<Result<{ certificatePem: string }>> {
  const env = getEnvironment(envId);
  if (!env) return appErr("not_found", "environment not found");
  const { privateKeyJwk, certificatePem } = await generateKeyAndCert(`nsic-${env.account_id}`);
  const s = await saveSecret(envId, "rest_m2m", { privateKeyJwk, certificatePem } satisfies M2mSecret);
  return s.ok ? ok({ certificatePem }) : s;
}

export async function saveM2mIds(envId: string, clientId: string, certificateId: string): Promise<Result<void>> {
  const cur = await loadSecret<M2mSecret>(envId, "rest_m2m", "m2m.configure");
  if (!cur.ok) return appErr("m2m_no_key", "Generate a key pair before saving the client ID & certificate ID");
  return saveSecret(envId, "rest_m2m", { ...cur.value, clientId, certificateId, accessToken: undefined, expiresAt: undefined });
}

export async function getRestAccessToken(envId: string): Promise<Result<string>> {
  const env = getEnvironment(envId);
  if (!env) return appErr("not_found", "environment not found");
  const sec = await loadSecret<M2mSecret>(envId, "rest_m2m", "rest.request");
  if (!sec.ok) return sec;
  const s = sec.value;
  if (!s.clientId || !s.certificateId) return appErr("m2m_incomplete", "M2M client ID / certificate ID not set");
  if (s.accessToken && (s.expiresAt ?? 0) - Date.now() > 5 * 60_000) return ok(s.accessToken);
  const url = tokenUrl(env.account_id);
  const iat = Math.floor(Date.now() / 1000);
  const assertion = await signJwt(s.privateKeyJwk, s.certificateId, { iss: s.clientId, scope: ["rest_webservices", "restlets"], aud: url, iat, exp: iat + 3600 });
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer", client_assertion: assertion }),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    if (!res.ok) return appErr("m2m_token", `M2M token HTTP ${res.status}: ${text.slice(0, 300)}`);
    const t = JSON.parse(text) as { access_token: string; expires_in?: number | string };
    const expiresAt = Date.now() + Number(t.expires_in ?? 3600) * 1000;
    await saveSecret(envId, "rest_m2m", { ...s, accessToken: t.access_token, expiresAt }, { expiresAt });
    return ok(t.access_token);
  } catch (e) {
    return appErr("m2m_token", errorMessage(e));
  }
}
