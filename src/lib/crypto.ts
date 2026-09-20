// Credential envelope encryption (06 §5):
// HKDF(masterKey, salt=credentialId, info="nsic:v{key_version}") → AES-GCM 256, random 12-byte IV.
import { type Result, ok, appErr, errorMessage } from "./result.ts";

export type Bytes = Uint8Array<ArrayBuffer>;
export type Sealed = { ciphertext: Bytes; iv: Bytes; keyVersion: number };

export function decodeMasterKey(b64: string | undefined): Result<Bytes> {
  if (!b64) return appErr("master_key_missing", "NSIC_MASTER_KEY is not set in .env");
  const raw = new Uint8Array(Buffer.from(b64, "base64"));
  if (raw.length !== 32) return appErr("master_key_invalid", "NSIC_MASTER_KEY must be 32 bytes (base64)");
  return ok(raw);
}

export function generateMasterKeyB64(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
}

async function deriveKey(master: Bytes, credentialId: string, keyVersion: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", master, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode(credentialId), info: new TextEncoder().encode(`nsic:v${keyVersion}`) },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function seal(master: Bytes, credentialId: string, plaintext: string, keyVersion = 1): Promise<Sealed> {
  const key = await deriveKey(master, credentialId, keyVersion);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(credentialId) },
    key,
    new TextEncoder().encode(plaintext),
  );
  return { ciphertext: new Uint8Array(ct), iv, keyVersion };
}

export async function open(master: Bytes, credentialId: string, sealed: Sealed): Promise<Result<string>> {
  try {
    const key = await deriveKey(master, credentialId, sealed.keyVersion);
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: sealed.iv, additionalData: new TextEncoder().encode(credentialId) },
      key,
      sealed.ciphertext,
    );
    return ok(new TextDecoder().decode(pt));
  } catch (e) {
    return appErr("decrypt_failed", `Failed to decrypt credential: ${errorMessage(e)}`);
  }
}

export const b64url = (bytes: Uint8Array | ArrayBuffer): string =>
  Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString("base64url");

export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}
