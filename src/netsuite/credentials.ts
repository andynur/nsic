// Encrypted credential storage. Decryption may only be called from src/netsuite/* and src/browser/session.ts.
import { config } from "../config.ts";
import { decodeMasterKey, open, seal, type Bytes } from "../lib/crypto.ts";
import { type Result, ok, appErr } from "../lib/result.ts";
import { credentialIdFor, getCredentialRow, upsertCredentialRow, type CredentialKind } from "../db/repo/credentials.ts";
import { audit } from "../db/repo/audit.ts";

export const CURRENT_KEY_VERSION = 1;

function master(): Result<Bytes> {
  return decodeMasterKey(config().masterKeyB64);
}

export async function saveSecret(envId: string, kind: CredentialKind, value: unknown, opts: { label?: string; expiresAt?: number | null } = {}): Promise<Result<void>> {
  const m = master();
  if (!m.ok) return m;
  const id = credentialIdFor(envId, kind, opts.label);
  const sealed = await seal(m.value, id, JSON.stringify(value), CURRENT_KEY_VERSION);
  upsertCredentialRow({ id, environment_id: envId, kind, label: opts.label ?? "default", ciphertext: sealed.ciphertext, iv: sealed.iv, key_version: sealed.keyVersion, expires_at: opts.expiresAt ?? null });
  audit("system", "credential.save", { environmentId: envId, detail: { kind } });
  return ok(undefined);
}

export async function loadSecret<T>(envId: string, kind: CredentialKind, purpose: string, label = "default"): Promise<Result<T>> {
  const row = getCredentialRow(envId, kind, label);
  if (!row) return appErr("credential_missing", `No ${kind} credential for this environment yet`);
  const m = master();
  if (!m.ok) return m;
  const r = await open(m.value, row.id, { ciphertext: new Uint8Array(row.ciphertext), iv: new Uint8Array(row.iv), keyVersion: row.key_version });
  audit("system", "credential.decrypt", { environmentId: envId, detail: { kind, purpose } });
  if (!r.ok) return r;
  return ok(JSON.parse(r.value) as T);
}

/** Master key rotation: re-encrypt every credential with the new key (06 §5). */
export async function rotateAll(oldKeyB64: string, newKeyB64: string, newVersion: number): Promise<Result<number>> {
  const oldK = decodeMasterKey(oldKeyB64);
  const newK = decodeMasterKey(newKeyB64);
  if (!oldK.ok) return oldK;
  if (!newK.ok) return newK;
  const { allCredentialRows } = await import("../db/repo/credentials.ts");
  let n = 0;
  for (const row of allCredentialRows()) {
    const pt = await open(oldK.value, row.id, { ciphertext: new Uint8Array(row.ciphertext), iv: new Uint8Array(row.iv), keyVersion: row.key_version });
    if (!pt.ok) return appErr("rotate_failed", `Failed to decrypt credential ${row.id}`);
    const s = await seal(newK.value, row.id, pt.value, newVersion);
    upsertCredentialRow({ id: row.id, environment_id: row.environment_id, kind: row.kind, label: row.label ?? "default", ciphertext: s.ciphertext, iv: s.iv, key_version: newVersion, expires_at: row.expires_at });
    n++;
  }
  audit("user", "credential.rotate", { detail: { count: n, keyVersion: newVersion } });
  return ok(n);
}
