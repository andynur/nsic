// Minimal MCP client: JSON-RPC 2.0 over Streamable HTTP (07 §2, ADR-006).
import { type Result, ok, appErr, errorMessage } from "../lib/result.ts";
import { parseSse } from "../llm/sse.ts";
import { getEnvironment, defaultMcpUrl } from "../db/repo/environments.ts";
import { getMcpAccessToken } from "./oauth-pkce.ts";

export type McpTool = { name: string; description?: string; inputSchema?: Record<string, unknown>; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } };
type RpcResponse = { jsonrpc: "2.0"; id?: number | string; result?: unknown; error?: { code: number; message: string; data?: unknown } };

export type McpFetch = (url: string, init: RequestInit) => Promise<Response>;

export class McpClient {
  private sessionId: string | null = null;
  private nextId = 1;
  private initialized = false;

  constructor(
    private readonly url: string,
    private readonly token: () => Promise<Result<string>>,
    private readonly fetchImpl: McpFetch = fetch,
  ) {}

  static async forEnvironment(envId: string): Promise<Result<McpClient>> {
    const env = getEnvironment(envId);
    if (!env) return appErr("not_found", "environment not found");
    return ok(new McpClient(env.mcp_url ?? defaultMcpUrl(env.account_id), () => getMcpAccessToken(envId)));
  }

  private async post(body: Record<string, unknown>, notification = false): Promise<Result<unknown>> {
    const tok = await this.token();
    if (!tok.ok) return tok;
    let res: Response;
    try {
      res = await this.fetchImpl(this.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${tok.value}`,
          "mcp-protocol-version": "2025-06-18",
          ...(this.sessionId ? { "mcp-session-id": this.sessionId } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (e) {
      return appErr("mcp_network", errorMessage(e));
    }
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;
    if (notification) return ok(null);
    if (!res.ok) return appErr("mcp_http", `MCP HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`, { status: res.status });
    const ct = res.headers.get("content-type") ?? "";
    let msg: RpcResponse | null = null;
    if (ct.includes("text/event-stream") && res.body) {
      for await (const ev of parseSse(res.body)) {
        try {
          const d = JSON.parse(ev.data) as RpcResponse;
          if (d.id === body.id) {
            msg = d;
            break;
          }
        } catch {
          /* ignore non-JSON events */
        }
      }
    } else msg = (await res.json()) as RpcResponse;
    if (!msg) return appErr("mcp_empty", "No JSON-RPC response");
    if (msg.error) return appErr("mcp_rpc", `MCP error ${msg.error.code}: ${msg.error.message}`, msg.error.data);
    return ok(msg.result);
  }

  async rpc(method: string, params: Record<string, unknown> = {}): Promise<Result<unknown>> {
    if (!this.initialized && method !== "initialize") {
      const i = await this.initialize();
      if (!i.ok) return i;
    }
    return this.post({ jsonrpc: "2.0", id: this.nextId++, method, params });
  }

  async initialize(): Promise<Result<unknown>> {
    const r = await this.post({ jsonrpc: "2.0", id: this.nextId++, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "nsic", version: "0.1.0" } } });
    if (!r.ok) return r;
    this.initialized = true;
    await this.post({ jsonrpc: "2.0", method: "notifications/initialized" }, true);
    return r;
  }

  async listTools(): Promise<Result<McpTool[]>> {
    const tools: McpTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const r = await this.rpc("tools/list", cursor ? { cursor } : {});
      if (!r.ok) return r;
      const v = r.value as { tools?: McpTool[]; nextCursor?: string };
      tools.push(...(v.tools ?? []));
      if (!v.nextCursor) break;
      cursor = v.nextCursor;
    }
    return ok(tools);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<Result<{ text: string; isError: boolean; raw: unknown }>> {
    const r = await this.rpc("tools/call", { name, arguments: args });
    if (!r.ok) return r;
    const v = r.value as { content?: { type: string; text?: string }[]; isError?: boolean; structuredContent?: unknown };
    const text = (v.content ?? []).map((c) => (c.type === "text" ? c.text ?? "" : `[${c.type}]`)).join("\n") || JSON.stringify(v.structuredContent ?? v);
    return ok({ text, isError: !!v.isError, raw: v });
  }
}

/** Heuristic write detection from tool name and annotations (06 §4 prod_write_exposed). */
export function isWriteTool(t: McpTool): boolean {
  if (t.annotations?.destructiveHint) return true;
  if (t.annotations?.readOnlyHint === true) return false;
  return /(create|update|delete|upsert|insert|remove|transform|submit|save|patch|write|set)/i.test(t.name);
}
