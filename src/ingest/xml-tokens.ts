// Sequential XML tokenizer. Bun.XML.parse groups repeated tags, so the order of mixed content
// (e.g. w:r / w:hyperlink in DOCX) is lost; DOCX/XLSX need the original order.
export type XmlToken = { kind: "open" | "close" | "self"; name: string; attrs: string } | { kind: "text"; text: string };

const RE = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[^>]*?)?)(\/?)>|<!\[CDATA\[([\s\S]*?)\]\]>|<[?!][\s\S]*?>|([^<]+)/g;

export function* xmlTokens(xml: string): Generator<XmlToken> {
  RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE.exec(xml))) {
    if (m[2]) {
      const self = m[4] === "/" || (m[3] ?? "").trimEnd().endsWith("/");
      yield { kind: m[1] ? "close" : self ? "self" : "open", name: m[2], attrs: m[3] ?? "" };
    } else if (m[5] !== undefined) yield { kind: "text", text: m[5] };
    else if (m[6] !== undefined) yield { kind: "text", text: decodeEntities(m[6]) };
  }
}

export function attr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)${name.replace(/[.:]/g, "\\$&")}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(attrs);
  return m ? decodeEntities(m[2] ?? m[3] ?? "") : undefined;
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    const l = e.toLowerCase();
    if (l === "amp") return "&";
    if (l === "lt") return "<";
    if (l === "gt") return ">";
    if (l === "quot") return '"';
    if (l === "apos") return "'";
    const code = l.startsWith("#x") ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : "";
  });
}
