// Small in-house validator (AGENTS.md): validates HTTP input and LLM tool output,
// and also produces the JSON Schema for Anthropic tool definitions.
import { type Result, ok, err } from "./result.ts";

export type Issue = { path: string; message: string };
export type JsonSchema = Record<string, unknown>;

export interface Schema<T> {
  parse(v: unknown, path?: string): Result<T, Issue[]>;
  json(): JsonSchema;
  optional(): Schema<T | undefined>;
  nullable(): Schema<T | null>;
  describe(d: string): Schema<T>;
  readonly isOptional?: boolean;
}

export type Infer<S> = S extends Schema<infer T> ? T : never;
type Simplify<T> = { [K in keyof T]: T[K] } & {};
export type ObjOut<Shape extends Record<string, Schema<unknown>>> = Simplify<
  { [K in keyof Shape as undefined extends Infer<Shape[K]> ? never : K]: Infer<Shape[K]> } & {
    [K in keyof Shape as undefined extends Infer<Shape[K]> ? K : never]?: Infer<Shape[K]>;
  }
>;

function make<T>(
  parse: (v: unknown, path: string) => Result<T, Issue[]>,
  json: () => JsonSchema,
  isOptional = false,
): Schema<T> {
  const self: Schema<T> = {
    parse: (v, path = "$") => parse(v, path),
    json,
    isOptional,
    optional: () =>
      make<T | undefined>((v, p) => (v === undefined ? ok(undefined) : parse(v, p)), json, true),
    nullable: () =>
      make<T | null>(
        (v, p) => (v === null ? ok(null) : parse(v, p)),
        () => ({ anyOf: [json(), { type: "null" }] }),
        isOptional,
      ),
    describe: (d) => make(parse, () => ({ ...json(), description: d }), isOptional),
  };
  return self;
}

const fail = (path: string, message: string) => err([{ path, message }]);

export const s = {
  string(opts: { min?: number; max?: number; pattern?: RegExp } = {}): Schema<string> {
    return make(
      (v, p) => {
        if (typeof v !== "string") return fail(p, "must be a string");
        if (opts.min !== undefined && v.length < opts.min) return fail(p, `at least ${opts.min} characters`);
        if (opts.max !== undefined && v.length > opts.max) return fail(p, `at most ${opts.max} characters`);
        if (opts.pattern && !opts.pattern.test(v)) return fail(p, "invalid format");
        return ok(v);
      },
      () => ({
        type: "string",
        ...(opts.min !== undefined && { minLength: opts.min }),
        ...(opts.max !== undefined && { maxLength: opts.max }),
      }),
    );
  },
  number(opts: { min?: number; max?: number; int?: boolean } = {}): Schema<number> {
    return make(
      (v, p) => {
        if (typeof v !== "number" || Number.isNaN(v)) return fail(p, "must be a number");
        if (opts.int && !Number.isInteger(v)) return fail(p, "must be an integer");
        if (opts.min !== undefined && v < opts.min) return fail(p, `minimal ${opts.min}`);
        if (opts.max !== undefined && v > opts.max) return fail(p, `at most ${opts.max}`);
        return ok(v);
      },
      () => ({
        type: opts.int ? "integer" : "number",
        ...(opts.min !== undefined && { minimum: opts.min }),
        ...(opts.max !== undefined && { maximum: opts.max }),
      }),
    );
  },
  boolean(): Schema<boolean> {
    return make(
      (v, p) => (typeof v === "boolean" ? ok(v) : fail(p, "must be a boolean")),
      () => ({ type: "boolean" }),
    );
  },
  literal<const L extends string | number | boolean>(l: L): Schema<L> {
    return make(
      (v, p) => (v === l ? ok(l) : fail(p, `must be ${JSON.stringify(l)}`)),
      () => ({ const: l }),
    );
  },
  enum<const E extends readonly string[]>(values: E): Schema<E[number]> {
    return make(
      (v, p) =>
        typeof v === "string" && (values as readonly string[]).includes(v)
          ? ok(v as E[number])
          : fail(p, `must be one of: ${values.join(", ")}`),
      () => ({ type: "string", enum: [...values] }),
    );
  },
  array<T>(item: Schema<T>, opts: { min?: number; max?: number } = {}): Schema<T[]> {
    return make(
      (v, p) => {
        if (!Array.isArray(v)) return fail(p, "must be an array");
        if (opts.min !== undefined && v.length < opts.min) return fail(p, `minimal ${opts.min} item`);
        if (opts.max !== undefined && v.length > opts.max) return fail(p, `at most ${opts.max} items`);
        const out: T[] = [];
        const issues: Issue[] = [];
        v.forEach((x, i) => {
          const r = item.parse(x, `${p}[${i}]`);
          if (r.ok) out.push(r.value);
          else issues.push(...r.error);
        });
        return issues.length ? err(issues) : ok(out);
      },
      () => ({
        type: "array",
        items: item.json(),
        ...(opts.min !== undefined && { minItems: opts.min }),
        ...(opts.max !== undefined && { maxItems: opts.max }),
      }),
    );
  },
  object<Shape extends Record<string, Schema<unknown>>>(shape: Shape, opts: { strict?: boolean } = {}): Schema<ObjOut<Shape>> {
    type Out = ObjOut<Shape>;
    return make<Out>(
      (v, p) => {
        if (typeof v !== "object" || v === null || Array.isArray(v)) return fail(p, "must be an object");
        const rec = v as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        const issues: Issue[] = [];
        for (const [k, sch] of Object.entries(shape)) {
          const r = sch.parse(rec[k], `${p}.${k}`);
          if (r.ok) {
            if (r.value !== undefined) out[k] = r.value;
          } else issues.push(...r.error);
        }
        if (opts.strict) {
          for (const k of Object.keys(rec)) if (!(k in shape)) issues.push({ path: `${p}.${k}`, message: "unknown field" });
        }
        return issues.length ? err(issues) : ok(out as Out);
      },
      () => ({
        type: "object",
        properties: Object.fromEntries(Object.entries(shape).map(([k, sch]) => [k, sch.json()])),
        required: Object.entries(shape)
          .filter(([, sch]) => !sch.isOptional)
          .map(([k]) => k),
        additionalProperties: !opts.strict,
      }),
    );
  },
  record<T>(value: Schema<T>): Schema<Record<string, T>> {
    return make(
      (v, p) => {
        if (typeof v !== "object" || v === null || Array.isArray(v)) return fail(p, "must be an object");
        const out: Record<string, T> = {};
        const issues: Issue[] = [];
        for (const [k, x] of Object.entries(v)) {
          const r = value.parse(x, `${p}.${k}`);
          if (r.ok) out[k] = r.value;
          else issues.push(...r.error);
        }
        return issues.length ? err(issues) : ok(out);
      },
      () => ({ type: "object", additionalProperties: value.json() }),
    );
  },
  union<T extends Schema<unknown>[]>(...options: T): Schema<Infer<T[number]>> {
    return make(
      (v, p) => {
        for (const o of options) {
          const r = o.parse(v, p);
          if (r.ok) return ok(r.value as Infer<T[number]>);
        }
        return fail(p, "does not match any allowed type");
      },
      () => ({ anyOf: options.map((o) => o.json()) }),
    );
  },
  unknown(): Schema<unknown> {
    return make((v) => ok(v), () => ({}));
  },
};

export function formatIssues(issues: Issue[]): string {
  return issues.map((i) => `${i.path}: ${i.message}`).join("; ");
}
