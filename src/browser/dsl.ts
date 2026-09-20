// Repro DSL v1 (08 §3, config/repro-dsl.schema.json): types + validation.
import { s, type Infer, formatIssues } from "../lib/schema.ts";
import { type Result, ok, appErr } from "../lib/result.ts";

const Target = s.object(
  {
    selector: s.string({ max: 500 }).optional(),
    field: s.string({ max: 100, pattern: /^[a-z0-9_]+$/i }).optional(),
    text: s.string({ max: 200 }).optional(),
    role: s.enum(["button", "link", "tab", "menuitem", "checkbox", "row"] as const).optional(),
    nth: s.number({ int: true, min: 0 }).optional(),
  },
  { strict: true },
);

export const ACTIONS = ["navigate", "wait", "click", "type", "select", "scroll", "assert", "expectError", "screenshot", "evaluate", "note"] as const;
export const READ_FNS = ["readField", "readSublist", "readUrl", "readPageErrors"] as const;

const Step = s.object(
  {
    id: s.string({ min: 1, max: 40 }),
    action: s.enum(ACTIONS),
    url: s.string({ max: 2000 }).optional(),
    target: Target.optional(),
    value: s.string({ max: 2000 }).optional(),
    for: s.object({ selector: s.string().optional(), text: s.string().optional(), networkIdle: s.boolean().optional(), ms: s.number({ int: true, min: 0, max: 60000 }).optional() }, { strict: true }).optional(),
    expect: s.object({ textIncludes: s.string().optional(), valueEquals: s.string().optional(), visible: s.boolean().optional() }, { strict: true }).optional(),
    match: s.string({ max: 300 }).optional(),
    fn: s.enum(READ_FNS).optional(),
    args: s.record(s.unknown()).optional(),
    screenshot: s.enum(["viewport", "fullPage", "element"] as const).optional(),
    caption: s.string({ max: 160 }).optional(),
    timeoutMs: s.number({ int: true, min: 1000, max: 120000 }).optional(),
    sandboxOnly: s.boolean().optional(),
  },
  { strict: true },
);

export const ReproScriptSchema = s.object(
  {
    version: s.literal(1),
    environment: s.string().optional(),
    role_hint: s.string().optional(),
    viewport: s.object({ width: s.number({ int: true, min: 800, max: 2560 }), height: s.number({ int: true, min: 600, max: 1600 }) }, { strict: true }).optional(),
    redact: s.object({ selectors: s.array(s.string()).optional(), patterns: s.array(s.string()).optional() }, { strict: true }).optional(),
    steps: s.array(Step, { min: 1, max: 60 }),
  },
  { strict: true },
);

export type ReproScript = Infer<typeof ReproScriptSchema>;
export type ReproStep = ReproScript["steps"][number];
export type StepTarget = NonNullable<ReproStep["target"]>;

export function validateDsl(v: unknown): Result<ReproScript> {
  const r = ReproScriptSchema.parse(v);
  if (!r.ok) return appErr("dsl_invalid", formatIssues(r.error), r.error);
  const ids = new Set<string>();
  for (const st of r.value.steps) {
    if (ids.has(st.id)) return appErr("dsl_invalid", `duplicate step id: ${st.id}`);
    ids.add(st.id);
    const need: Partial<Record<ReproStep["action"], keyof ReproStep>> = { navigate: "url", click: "target", type: "target", select: "target", assert: "expect", expectError: "match", evaluate: "fn" };
    const k = need[st.action];
    if (k && st[k] === undefined) return appErr("dsl_invalid", `step ${st.id}: action ${st.action} requires '${k}'`);
    if ((st.action === "type" || st.action === "select") && st.value === undefined) return appErr("dsl_invalid", `step ${st.id}: action ${st.action} requires 'value'`);
    for (const p of r.value.redact?.patterns ?? []) {
      try {
        new RegExp(p);
      } catch {
        return appErr("dsl_invalid", `invalid redaction pattern: ${p}`);
      }
    }
  }
  return ok(r.value);
}
