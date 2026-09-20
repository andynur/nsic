// Minimal Messages API types (the subset NSIC uses).
export type CacheControl = { type: "ephemeral"; ttl?: "5m" | "1h" };
export type TextBlock = { type: "text"; text: string; cache_control?: CacheControl };
export type ImageBlock = { type: "image"; source: { type: "base64"; media_type: string; data: string }; cache_control?: CacheControl };
export type DocumentBlock = { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string }; title?: string; cache_control?: CacheControl };
export type ToolUseBlock = { type: "tool_use"; id: string; name: string; input: unknown };
export type ToolResultBlock = { type: "tool_result"; tool_use_id: string; content: string | (TextBlock | ImageBlock)[]; is_error?: boolean; cache_control?: CacheControl };
export type ThinkingBlock = { type: "thinking"; thinking: string; signature?: string };
export type ContentBlock = TextBlock | ImageBlock | DocumentBlock | ToolUseBlock | ToolResultBlock | ThinkingBlock;

export type MessageParam = { role: "user" | "assistant"; content: string | ContentBlock[] };

export type ToolDef = { name: string; description: string; input_schema: Record<string, unknown>; cache_control?: CacheControl; strict?: boolean };

export type MessagesRequest = {
  model: string;
  max_tokens: number;
  system?: string | TextBlock[];
  messages: MessageParam[];
  tools?: ToolDef[];
  tool_choice?: { type: "auto" | "any" | "none" } | { type: "tool"; name: string };
  temperature?: number;
  thinking?: { type: "adaptive" } | { type: "disabled" };
  output_config?: { effort?: "low" | "medium" | "high" | "xhigh" | "max" };
  metadata?: { user_id?: string };
};

export type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
};

export type MessagesResponse = {
  id: string;
  model: string;
  role: "assistant";
  content: ContentBlock[];
  stop_reason: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | "pause_turn" | "refusal" | null;
  usage: Usage;
};

export const textOf = (r: MessagesResponse): string =>
  r.content.filter((b): b is TextBlock => b.type === "text").map((b) => b.text).join("");

export const toolUses = (r: MessagesResponse): ToolUseBlock[] => r.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
