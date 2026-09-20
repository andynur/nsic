// API client: CSRF header + cookie, uniform errors, WebSocket with reconnect & subscribe.
export type ApiError = { code: string; message: string; details?: unknown; status: number };

let csrf: string | null = null;
let modePromise: Promise<"live" | "mock"> | null = null;
let mockFlag = false;
type MockMod = typeof import("./mock/handler.ts");
let mockMod: MockMod | null = null;

/** Static mode: the UI server (bun run ui) answers /api/session with { mock: true }; all API calls are served from local fixtures. */
export function mode(): Promise<"live" | "mock"> {
  modePromise ??= fetch("/api/session", { credentials: "same-origin" })
    .then((r) => r.json() as Promise<{ csrf?: string; mock?: boolean }>)
    .then(async (j) => {
      if (j.mock) {
        mockFlag = true;
        mockMod = await import("./mock/handler.ts");
        return "mock" as const;
      }
      csrf = j.csrf ?? null;
      return "live" as const;
    })
    .catch(() => "live" as const);
  return modePromise;
}
export const isMock = () => mockFlag;

async function ensureSession() {
  if (csrf) return csrf;
  const r = await fetch("/api/session", { credentials: "same-origin" });
  const j = (await r.json()) as { csrf: string };
  csrf = j.csrf;
  return csrf;
}

/** Artifact file URL; in static mode this uses a placeholder from the fixtures. */
export function artifactSrc(id: string, download = false): string {
  if (mockFlag) return mockMod?.mockArtifactSrc(id) ?? "data:text/plain,Sample%20file%20(static%20mode)";
  return `/api/artifacts/${id}/file${download ? "?download=1" : ""}`;
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  if ((await mode()) === "mock") {
    try {
      return (await mockMod!.mockRequest(method, path, init.json ?? init.body, emitLocal)) as T;
    } catch (e) {
      throw { code: "http", message: "Static mode error", status: 500, ...(e as object) } as ApiError;
    }
  }
  const headers = new Headers(init.headers);
  if (method !== "GET") headers.set("x-nsic-csrf", await ensureSession());
  let bodyInit = init.body;
  if (init.json !== undefined) {
    headers.set("content-type", "application/json");
    bodyInit = JSON.stringify(init.json);
  }
  let res: Response;
  try {
    res = await fetch(path, { ...init, method, headers, body: bodyInit, credentials: "same-origin" });
  } catch {
    throw { code: "offline", message: "Server disconnected", status: 0 } satisfies ApiError;
  }
  if (res.status === 403 && method !== "GET") csrf = null;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw { ...(data?.error ?? { code: "http", message: `HTTP ${res.status}` }), status: res.status } as ApiError;
  return data as T;
}

export const errMsg = (e: unknown) => (e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e));

// ───────── WebSocket ─────────
type Listener = (ev: Record<string, unknown> & { type: string }) => void;
const listeners = new Set<Listener>();
const topics = new Set<string>(["global"]);
const statusListeners = new Set<(online: boolean) => void>();
let ws: WebSocket | null = null;
let online = true;
let retry = 0;

function setOnline(v: boolean) {
  if (online === v) return;
  online = v;
  for (const l of statusListeners) l(v);
}

function emitLocal(ev: Record<string, unknown> & { type: string }) {
  queueMicrotask(() => {
    for (const l of listeners) l(ev);
  });
}

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => {
    retry = 0;
    setOnline(true);
    ws!.send(JSON.stringify({ type: "subscribe", topics: [...topics] }));
    for (const l of listeners) l({ type: "ws.reconnected" });
  };
  ws.onmessage = (m) => {
    try {
      const ev = JSON.parse(String(m.data));
      for (const l of listeners) l(ev);
    } catch {
      /* ignore */
    }
  };
  ws.onclose = () => {
    setOnline(false);
    setTimeout(connect, Math.min(10_000, 500 * 2 ** retry++));
  };
}

export function wsStart() {
  void mode().then((m) => {
    if (m === "live" && !ws) connect();
  });
}
export function subscribe(topic: string) {
  topics.add(topic);
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "subscribe", topics: [topic] }));
}
export function unsubscribe(topic: string) {
  topics.delete(topic);
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "unsubscribe", topics: [topic] }));
}
export function wsSend(msg: unknown) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}
export function onEvent(l: Listener) {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function onOnline(l: (v: boolean) => void) {
  statusListeners.add(l);
  return () => statusListeners.delete(l);
}
