// Type detection: magic bytes + extension (09 §2).
export type FileKind = "image" | "pdf" | "docx" | "xlsx" | "csv" | "eml" | "text" | "msg" | "xls" | "archive" | "unsupported";

const EXT_TEXT = new Set(["txt", "log", "json", "xml", "js", "ts", "md", "sql", "html", "htm", "yaml", "yml"]);

export function detectKind(filename: string, head: Uint8Array): { kind: FileKind; mime: string } {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  const b = head;
  const starts = (...xs: number[]) => xs.every((x, i) => b[i] === x);
  if (starts(0x89, 0x50, 0x4e, 0x47)) return { kind: "image", mime: "image/png" };
  if (starts(0xff, 0xd8, 0xff)) return { kind: "image", mime: "image/jpeg" };
  if (starts(0x47, 0x49, 0x46, 0x38)) return { kind: "image", mime: "image/gif" };
  if (starts(0x52, 0x49, 0x46, 0x46) && b[8] === 0x57 && b[9] === 0x45) return { kind: "image", mime: "image/webp" };
  if (starts(0x25, 0x50, 0x44, 0x46)) return { kind: "pdf", mime: "application/pdf" };
  if (starts(0xd0, 0xcf, 0x11, 0xe0)) return ext === "msg" ? { kind: "msg", mime: "application/vnd.ms-outlook" } : { kind: "xls", mime: "application/vnd.ms-excel" };
  if (starts(0x50, 0x4b, 0x03, 0x04)) {
    if (ext === "docx") return { kind: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
    if (ext === "xlsx" || ext === "xlsm") return { kind: "xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
    return { kind: "archive", mime: "application/zip" };
  }
  if (ext === "heic" || ext === "avif") return { kind: "image", mime: `image/${ext}` };
  if (ext === "eml") return { kind: "eml", mime: "message/rfc822" };
  if (ext === "csv" || ext === "tsv") return { kind: "csv", mime: "text/csv" };
  if (EXT_TEXT.has(ext)) return { kind: "text", mime: ext === "json" ? "application/json" : ext === "xml" ? "application/xml" : "text/plain" };
  // text without a known extension: check for control bytes
  const sample = b.subarray(0, 512);
  const binary = sample.some((c) => c === 0);
  if (!binary && sample.length) return { kind: "text", mime: "text/plain" };
  return { kind: "unsupported", mime: "application/octet-stream" };
}

export const UNSUPPORTED_HINT: Partial<Record<FileKind, string>> = {
  msg: "Outlook .msg files aren't supported yet. Save the email as .eml and upload it again.",
  xls: "Legacy .xls files aren't supported yet. Save as .xlsx or .csv and upload it again.",
  archive: "Archives aren't extracted automatically for security. Extract it yourself and upload the relevant files.",
  unsupported: "Unrecognized file type.",
};
