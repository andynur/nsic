// Minimal SSE parser (used by the Anthropic client & MCP Streamable HTTP).
export type SseEvent = { event: string; data: string };

export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let event = "message";
  let data: string[] = [];
  const flush = (): SseEvent | null => {
    if (!data.length) {
      event = "message";
      return null;
    }
    const e = { event, data: data.join("\n") };
    event = "message";
    data = [];
    return e;
  };
  while (true) {
    const { value, done } = await reader.read();
    if (value) buf += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.search(/\r?\n/)) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + (buf[idx] === "\r" ? 2 : 1));
      if (line === "") {
        const e = flush();
        if (e) yield e;
      } else if (line.startsWith(":")) {
        continue;
      } else {
        const c = line.indexOf(":");
        const field = c < 0 ? line : line.slice(0, c);
        const val = c < 0 ? "" : line.slice(c + 1).replace(/^ /, "");
        if (field === "event") event = val;
        else if (field === "data") data.push(val);
      }
    }
    if (done) {
      if (buf) {
        if (buf.startsWith("data:")) data.push(buf.slice(5).replace(/^ /, ""));
      }
      const e = flush();
      if (e) yield e;
      return;
    }
  }
}
