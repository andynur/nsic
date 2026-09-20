// RFC 4180 CSV parser (quotes, newlines inside cells) + delimiter detection , ; \t.
export function detectDelimiter(sample: string): string {
  const line = sample.split(/\r?\n/).slice(0, 5).join("\n");
  const counts = [",", ";", "\t", "|"].map((d) => ({ d, n: line.split(d).length }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0]!.n > 1 ? counts[0]!.d : ",";
}

export function parseCsv(text: string, delimiter = detectDelimiter(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (q) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += c;
    } else if (c === '"' && cell === "") q = true;
    else if (c === delimiter) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** Decode UTF-8, falling back to windows-1252 when there are invalid bytes. */
export function decodeText(buf: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("windows-1252").decode(buf);
  }
}
