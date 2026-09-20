// Static UI server (prototype mode): HTML import + fixtures only. No DB, jobs, LLM, or NetSuite.
// Run: bun run ui  → http://127.0.0.1:4318
import index from "./index.html";
import { join, normalize } from "node:path";
import { renderReportHtml } from "../src/reports/html.ts";
import { applyOverrides } from "../src/reports/narrative.ts";
import { sampleReportModel } from "./app/mock/report-model.ts";
import { mockSrc } from "./app/mock/fixtures.ts";

const port = Number(process.env.UI_PORT ?? 4318);
const overrides: Record<string, string> = {};

const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  development: process.env.NODE_ENV !== "production" ? { hmr: true, console: true } : false,
  routes: {
    "/api/session": () => Response.json({ mock: true, csrf: "mock" }),
    "/api/issues/:id/reports/preview": (req) => {
      const u = new URL(req.url);
      const audience = u.searchParams.get("audience") === "client" ? "client" : "internal";
      const html = renderReportHtml(applyOverrides(sampleReportModel(audience), overrides), (id) => mockSrc[id] ?? "", { editable: u.searchParams.get("edit") === "1" });
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    },
    "/api/*": () => Response.json({ error: { code: "static_mode", message: "Static mode: API is served by fixtures in the browser" } }, { status: 404 }),
    "/fonts/*": (req) => {
      const rel = normalize(decodeURIComponent(new URL(req.url).pathname.slice("/fonts/".length))).replace(/^([/\\.])+/, "");
      return new Response(Bun.file(join(import.meta.dir, "fonts", rel)));
    },
    "/*": index,
  },
});

console.log(`NSIC static UI: http://127.0.0.1:${server.port}`);
