export const j = (v: unknown): string | null => (v === undefined || v === null ? null : JSON.stringify(v));
export function pj<T>(v: unknown, fallback: T): T {
  if (typeof v !== "string") return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}
export const bool = (v: unknown): boolean => v === 1 || v === true;

/** Build a SET clause for PATCH from a column whitelist. */
export function buildPatch(patch: Record<string, unknown>, allowed: readonly string[], jsonCols: readonly string[] = []) {
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  for (const k of allowed) {
    if (!(k in patch)) continue;
    const v = patch[k];
    sets.push(`${k} = ?`);
    if (jsonCols.includes(k)) vals.push(j(v));
    else if (typeof v === "boolean") vals.push(v ? 1 : 0);
    else vals.push((v as string | number | null) ?? null);
  }
  return { sets, vals };
}
