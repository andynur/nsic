// NSIC server entry (02 §2): Bun.serve routes + WebSocket + HTML import + dispatcher + cron. Binds to 127.0.0.1 only.
import index from "../web/index.html";
import { join, normalize } from "node:path";
import { config } from "./config.ts";
import { db } from "./db/db.ts";
import { log } from "./lib/log.ts";
import { listPricing, upsertPricing } from "./db/repo/settings.ts";
import { DEFAULT_PRICING } from "./llm/models.ts";
import { setEventSink, type IpcMessage } from "./realtime/events.ts";
import { Dispatcher, setDispatcher } from "./jobs/dispatcher.ts";
import { startCron } from "./jobs/cron.ts";
import { projectRoutes } from "./routes/projects.ts";
import { issueRoutes } from "./routes/issues.ts";
import { agentRoutes } from "./routes/agent.ts";
import { systemRoutes } from "./routes/system.ts";
import { checkRequest, errorJson, HttpError } from "./routes/http.ts";
import { completeOAuth } from "./netsuite/oauth-pkce.ts";
import { writeTerminal } from "./netsuite/terminal.ts";
import { enqueueJob } from "./jobs/enqueue.ts";
import { esc } from "./reports/html.ts";

const cfg = config();
if (!["127.0.0.1", "localhost", "::1"].includes(cfg.host)) {
  console.error(`HOST=${cfg.host} rejected: NSIC may only bind to 127.0.0.1 (NFR-01).`);
  process.exit(1);
}

const t0 = performance.now();
db();
if (listPricing().length === 0) for (const p of DEFAULT_PRICING) upsertPricing({ ...p, note: "default price 2026-09-18" });

type WsData = { topics: Set<string> };

const oauthPage = (title: string, body: string) =>
  new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><title>${esc(title)}</title><body style="font:14px/22px system-ui;padding:48px;max-width:560px"><h1 style="font-size:20px;font-weight:600">${esc(title)}</h1><p>${esc(body)}</p></body></html>`, { headers: { "content-type": "text/html; charset=utf-8" } });

const server = Bun.serve<WsData>({
  hostname: cfg.host,
  port: cfg.port,
  development: process.env.NODE_ENV !== "production" ? { hmr: true, console: true } : false,
  routes: {
    ...projectRoutes,
    ...issueRoutes,
    ...agentRoutes,
    ...systemRoutes,
    "/api/*": () => errorJson(404, "not_found", "endpoint not found"),
    "/oauth/callback": async (req: Request) => {
      const u = new URL(req.url);
      const err = u.searchParams.get("error");
      if (err) return oauthPage("Connection failed", `NetSuite returned an error: ${err} ${u.searchParams.get("error_description") ?? ""}`);
      const r = await completeOAuth(u.searchParams.get("state") ?? "", u.searchParams.get("code") ?? "");
      if (!r.ok) return oauthPage("Connection failed", r.error.message);
      enqueueJob("probe_env", { environmentId: r.value.environmentId }, { priority: 8, maxAttempts: 1 });
      return oauthPage("Connected", "The MCP token is stored encrypted. You can close this tab; the capability probe is running.");
    },
    "/fonts/*": (req: Request) => {
      const rel = normalize(decodeURIComponent(new URL(req.url).pathname.slice("/fonts/".length))).replace(/^([/\\.])+/, "");
      const f = Bun.file(join(cfg.rootDir, "web", "fonts", rel));
      return new Response(f, { headers: { "cache-control": "public, max-age=31536000, immutable" } });
    },
    "/ws": (req: Request, srv: Bun.Server<WsData>) => {
      try {
        checkRequest(req);
      } catch (e) {
        return errorJson(403, e instanceof HttpError ? e.code : "forbidden", "WebSocket rejected");
      }
      return srv.upgrade(req, { data: { topics: new Set<string>() } }) ? undefined : errorJson(400, "ws", "upgrade failed");
    },
    "/*": index,
  },
  websocket: {
    open(ws) {
      ws.subscribe("global");
      ws.data.topics.add("global");
    },
    message(ws, raw) {
      let m: { type?: string; topics?: string[]; terminalId?: string; data?: string };
      try {
        m = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (m.type === "subscribe" && Array.isArray(m.topics)) {
        for (const t of m.topics) {
          if (typeof t === "string" && /^(global|issue:[\w-]+|env:[\w-]+|terminal:[\w-]+)$/.test(t)) {
            ws.subscribe(t);
            ws.data.topics.add(t);
          }
        }
      } else if (m.type === "unsubscribe" && Array.isArray(m.topics)) {
        for (const t of m.topics) {
          ws.unsubscribe(t);
          ws.data.topics.delete(t);
        }
      } else if (m.type === "terminal.input" && m.terminalId && typeof m.data === "string") {
        writeTerminal(m.terminalId, m.data);
      } else if (m.type === "ping") ws.send(JSON.stringify({ type: "pong" }));
    },
  },
  error(e) {
    log.error("server error", { error: String(e) });
    return errorJson(500, "internal", "server error");
  },
});

setEventSink((topic, payload) => server.publish(topic, payload));
const dispatcherInst = new Dispatcher({
  inProcess: process.env.NSIC_INPROCESS_JOBS === "1",
  onIpc: (m: IpcMessage) => {
    if (m.kind === "ws") for (const t of m.topics) server.publish(t, m.payload);
  },
});
setDispatcher(dispatcherInst);
dispatcherInst.start();
const crons = startCron();

process.on("unhandledRejection", (e) => log.error("unhandledRejection", { error: String(e) }));
const shutdown = () => {
  dispatcherInst.stop();
  for (const c of crons) c.stop();
  server.stop();
  db().close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

log.info("NSIC ready", { url: `http://${cfg.host}:${server.port}`, startupMs: Math.round(performance.now() - t0), dataDir: cfg.dataDir });
