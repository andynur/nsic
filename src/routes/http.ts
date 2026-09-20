// HTTP helpers: JSON responses, uniform errors (13), body validation, CSRF + Host/Origin checks (06 §7-8).
import { formatIssues, type Schema } from "../lib/schema.ts";
import { errorMessage, type AppError } from "../lib/result.ts";
import { log } from "../lib/log.ts";
import { config } from "../config.ts";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });

export const errorJson = (status: number, code: string, message: string, details?: unknown) => json({ error: { code, message, ...(details !== undefined && { details }) } }, status);

export function fromAppError(e: AppError, status = 400): never {
  throw new HttpError(status, e.code, e.message, e.details);
}

export async function body<T>(req: Request, schema: Schema<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, "bad_json", "Body must be JSON");
  }
  const r = schema.parse(raw);
  if (!r.ok) throw new HttpError(422, "validation", formatIssues(r.error), r.error);
  return r.value;
}

export const notFound = (what = "resource"): never => {
  throw new HttpError(404, "not_found", `${what} not found`);
};

export const CSRF_COOKIE = "nsic_csrf";
let csrfToken: string | undefined;
export const currentCsrf = () => (csrfToken ??= crypto.randomUUID().replace(/-/g, ""));

function cookieValue(req: Request, name: string): string | undefined {
  const c = req.headers.get("cookie") ?? "";
  return c.split(/;\s*/).find((x) => x.startsWith(`${name}=`))?.slice(name.length + 1);
}

/** Reject foreign Host/Origin (DNS rebinding / LAN) and mutations without CSRF. */
export function checkRequest(req: Request): void {
  const port = config().port;
  const okHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  const host = req.headers.get("host") ?? "";
  if (process.env.NODE_ENV !== "test" && !okHosts.has(host)) throw new HttpError(403, "bad_host", "Host not allowed");
  const origin = req.headers.get("origin");
  if (origin && process.env.NODE_ENV !== "test") {
    try {
      if (!okHosts.has(new URL(origin).host)) throw new HttpError(403, "bad_origin", "Origin not allowed");
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(403, "bad_origin", "Invalid Origin");
    }
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const h = req.headers.get("x-nsic-csrf");
    const c = cookieValue(req, CSRF_COOKIE);
    if (!h || h !== currentCsrf() || c !== h) throw new HttpError(403, "csrf", "Invalid X-NSIC-CSRF header. Reload the page.");
  }
}

type Handler = (req: Request & { params: Record<string, string> }) => Response | Promise<Response>;

/** Wrap a handler: security checks + turn errors into JSON. */
export function h(fn: Handler): Handler {
  return async (req) => {
    try {
      checkRequest(req);
      return await fn(req);
    } catch (e) {
      if (e instanceof HttpError) return errorJson(e.status, e.code, e.message, e.details);
      log.error("route error", { path: new URL(req.url).pathname, error: errorMessage(e), stack: e instanceof Error ? e.stack : undefined });
      return errorJson(500, "internal", errorMessage(e));
    }
  };
}

export const q = (req: Request) => new URL(req.url).searchParams;

/** Stream a file with Range support (video seeking). */
export function fileResponse(req: Request, path: string, mime: string, downloadName?: string): Response {
  const f = Bun.file(path);
  const size = f.size;
  const headers: Record<string, string> = { "content-type": mime, "accept-ranges": "bytes", "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" };
  if (downloadName) headers["content-disposition"] = `attachment; filename="${downloadName.replace(/"/g, "")}"`;
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.get("range") ?? "");
  if (range && size > 0) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    return new Response(f.slice(start, end + 1), { status: 206, headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) } });
  }
  return new Response(f, { headers: { ...headers, "content-length": String(size) } });
}
