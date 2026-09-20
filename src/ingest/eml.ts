// Parser MIME minimal (03 §2): header, multipart, base64, quoted-printable, RFC 2047, charset.
export type MimePart = { headers: Map<string, string>; contentType: string; params: Record<string, string>; body: Uint8Array; parts: MimePart[] };
export type ParsedEmail = { headers: Record<string, string>; text: string; attachments: { filename: string; mime: string; data: Uint8Array }[] };

const latin1 = (b: Uint8Array) => new TextDecoder("latin1").decode(b);

function splitHeaderBody(raw: Uint8Array): { head: string; body: Uint8Array } {
  const s = latin1(raw);
  const m = /\r?\n\r?\n/.exec(s);
  if (!m) return { head: s, body: new Uint8Array() };
  return { head: s.slice(0, m.index), body: raw.subarray(m.index + m[0].length) };
}

function parseHeaders(head: string): Map<string, string> {
  const h = new Map<string, string>();
  const unfolded = head.replace(/\r?\n[ \t]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) {
      const k = line.slice(0, i).trim().toLowerCase();
      if (!h.has(k)) h.set(k, line.slice(i + 1).trim());
    }
  }
  return h;
}

export function parseParams(v: string): { value: string; params: Record<string, string> } {
  const [value, ...rest] = v.split(";");
  const params: Record<string, string> = {};
  for (const p of rest) {
    const i = p.indexOf("=");
    if (i > 0) params[p.slice(0, i).trim().toLowerCase().replace(/\*$/, "")] = p.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/^utf-8''/i, "");
  }
  return { value: (value ?? "").trim().toLowerCase(), params };
}

export function decodeQP(s: string): Uint8Array {
  const clean = s.replace(/=\r?\n/g, "");
  const out: number[] = [];
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i]!;
    if (c === "=" && /^[0-9A-F]{2}$/i.test(clean.slice(i + 1, i + 3))) {
      out.push(parseInt(clean.slice(i + 1, i + 3), 16));
      i += 2;
    } else out.push(clean.charCodeAt(i) & 0xff);
  }
  return new Uint8Array(out);
}

function decodeCharset(b: Uint8Array, charset = "utf-8"): string {
  try {
    return new TextDecoder(charset.toLowerCase()).decode(b);
  } catch {
    return new TextDecoder("utf-8").decode(b);
  }
}

/** RFC 2047: =?charset?B|Q?text?= */
export function decodeWords(s: string): string {
  return s
    .replace(/\?=\s+=\?/g, "?==?")
    .replace(/=\?([^?]+)\?([BQbq])\?([^?]*)\?=/g, (_, cs: string, enc: string, txt: string) => {
      const bytes = enc.toUpperCase() === "B" ? new Uint8Array(Buffer.from(txt, "base64")) : decodeQP(txt.replace(/_/g, " "));
      return decodeCharset(bytes, cs);
    });
}

function decodeBody(body: Uint8Array, cte: string | undefined): Uint8Array {
  const e = (cte ?? "").toLowerCase();
  if (e === "base64") return new Uint8Array(Buffer.from(latin1(body).replace(/\s+/g, ""), "base64"));
  if (e === "quoted-printable") return decodeQP(latin1(body));
  return body;
}

export function parseMime(raw: Uint8Array, depth = 0): MimePart {
  const { head, body } = splitHeaderBody(raw);
  const headers = parseHeaders(head);
  const ct = parseParams(headers.get("content-type") ?? "text/plain; charset=utf-8");
  const part: MimePart = { headers, contentType: ct.value, params: ct.params, body: new Uint8Array(), parts: [] };
  if (ct.value.startsWith("multipart/") && ct.params.boundary && depth < 8) {
    const s = latin1(body);
    const delim = `--${ct.params.boundary}`;
    const chunks = s.split(delim).slice(1);
    for (const ch of chunks) {
      if (ch.startsWith("--")) break;
      const content = ch.replace(/^\r?\n/, "").replace(/\r?\n$/, "");
      part.parts.push(parseMime(new Uint8Array(Buffer.from(content, "latin1")), depth + 1));
    }
  } else if (ct.value === "message/rfc822" && depth < 8) {
    part.parts.push(parseMime(decodeBody(body, headers.get("content-transfer-encoding")), depth + 1));
  } else {
    part.body = decodeBody(body, headers.get("content-transfer-encoding"));
  }
  return part;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d|table)>/gi, "\n")
    .replace(/<td[^>]*>/gi, " | ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

/** Drop repeated reply quotes, including localized reply-header blocks. */
export function stripQuoted(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (const l of lines) {
    if (/^(On|Pada) .+(wrote|menulis):\s*$/i.test(l.trim()) || /^-{2,}\s*Original Message/i.test(l.trim()) || /^From: .+/.test(l) && out.length > 5) break;
    if (!l.startsWith(">")) out.push(l);
  }
  return out.join("\n").trim();
}

export function parseEmail(raw: Uint8Array): ParsedEmail {
  const root = parseMime(raw);
  let plain = "";
  let html = "";
  const attachments: ParsedEmail["attachments"] = [];
  const walk = (p: MimePart) => {
    if (p.parts.length) return p.parts.forEach(walk);
    const disp = parseParams(p.headers.get("content-disposition") ?? "");
    const filename = decodeWords(disp.params.filename ?? p.params.name ?? "");
    const isAttachment = disp.value === "attachment" || (!!filename && !p.contentType.startsWith("text/"));
    if (isAttachment) {
      attachments.push({ filename: filename || `part-${attachments.length + 1}`, mime: p.contentType, data: p.body });
    } else if (p.contentType === "text/plain" && !plain) plain = decodeCharset(p.body, p.params.charset);
    else if (p.contentType === "text/html" && !html) html = decodeCharset(p.body, p.params.charset);
  };
  walk(root);
  const headers: Record<string, string> = {};
  for (const k of ["from", "to", "cc", "date", "subject", "message-id"]) {
    const v = root.headers.get(k);
    if (v) headers[k] = decodeWords(v);
  }
  const text = stripQuoted(plain || htmlToText(html));
  return { headers, text, attachments };
}
