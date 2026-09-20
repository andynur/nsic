// Ciphertext only. Decryption happens in src/netsuite/* and src/browser/session.ts (AGENTS.md rule 3).
import { db } from "../db.ts";
import { newId, now } from "../../lib/ids.ts";

export type CredentialKind = "mcp_oauth" | "rest_m2m" | "sdf_auth_id" | "browser_session";
export type CredentialRow = {
  id: string;
  environment_id: string;
  kind: CredentialKind;
  label: string | null;
  ciphertext: Uint8Array;
  iv: Uint8Array;
  key_version: number;
  expires_at: number | null;
  created_at: number;
  updated_at: number;
};

export const getCredentialRow = (envId: string, kind: CredentialKind, label = "default"): CredentialRow | null =>
  db().query("SELECT * FROM credentials WHERE environment_id = ? AND kind = ? AND label = ?").get(envId, kind, label) as CredentialRow | null;

export const listCredentialMeta = (envId: string) =>
  db().query("SELECT id, kind, label, key_version, expires_at, updated_at FROM credentials WHERE environment_id = ?").all(envId) as Omit<CredentialRow, "ciphertext" | "iv">[];

export const allCredentialRows = (): CredentialRow[] => db().query("SELECT * FROM credentials").all() as CredentialRow[];

/** Stable credential id per (env, kind, label) so the HKDF salt stays fixed. */
export function credentialIdFor(envId: string, kind: CredentialKind, label = "default"): string {
  return getCredentialRow(envId, kind, label)?.id ?? newId();
}

export function upsertCredentialRow(row: {
  id: string;
  environment_id: string;
  kind: CredentialKind;
  label?: string;
  ciphertext: Uint8Array;
  iv: Uint8Array;
  key_version: number;
  expires_at?: number | null;
}) {
  const t = now();
  db()
    .query(
      `INSERT INTO credentials (id, environment_id, kind, label, ciphertext, iv, key_version, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(environment_id, kind, label) DO UPDATE SET ciphertext=excluded.ciphertext, iv=excluded.iv,
         key_version=excluded.key_version, expires_at=excluded.expires_at, updated_at=excluded.updated_at`,
    )
    .run(row.id, row.environment_id, row.kind, row.label ?? "default", row.ciphertext, row.iv, row.key_version, row.expires_at ?? null, t, t);
}

export const deleteCredential = (envId: string, kind: CredentialKind) =>
  db().query("DELETE FROM credentials WHERE environment_id = ? AND kind = ?").run(envId, kind);
