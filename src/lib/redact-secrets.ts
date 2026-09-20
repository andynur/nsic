// Secret patterns that must never reach logs, LLM context, reports, or consultant drafts (06 §5, 11 §2).
export const SECRET_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "bearer", re: /\bBearer\s+[A-Za-z0-9\-._~+/]{16,}=*/g },
  { name: "jwt", re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { name: "oauth_field", re: /\b(access_token|refresh_token|client_secret|id_token|api[_-]?key)\b["']?\s*[:=]\s*["']?[^\s"',}]{8,}/gi },
  { name: "anthropic_key", re: /\bsk-ant-[A-Za-z0-9_-]{16,}/g },
  { name: "pem", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { name: "aws_key", re: /\bAKIA[0-9A-Z]{16}\b/g },
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const { re } of SECRET_PATTERNS) out = out.replace(re, "[REDACTED]");
  return out;
}

export function findSecrets(text: string): string[] {
  const hits: string[] = [];
  for (const { name, re } of SECRET_PATTERNS) {
    re.lastIndex = 0;
    if (re.test(text)) hits.push(name);
    re.lastIndex = 0;
  }
  return hits;
}
