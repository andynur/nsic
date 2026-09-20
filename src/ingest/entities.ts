// Entity normalization (09 §4) + deterministic extractor (fallback without an LLM, and a complement to it).
export const ENTITY_TYPES = ["transaction_no", "internal_id", "error_code", "error_message", "script_id", "user", "role", "subsidiary", "timestamp", "url", "record_type"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];
export type RawEntity = { type: string; value: string; locator?: string; confidence?: number };
export type NormEntity = { type: string; value: string; normalized: string; locator: string | null; confidence: number };

const NS_URL = /https?:\/\/[\w.-]*netsuite\.com\/app\/[^\s"'<>)]+/gi;
const SCRIPT_ID = /\b(customscript|customdeploy|custbody|custcol|custentity|custitem|custrecord|customrecord|customlist|customsearch|customworkflow|custevent|custitemnumber|customform|custtmpl)_[a-z0-9_]+\b/gi;
const ERROR_CODE = /\b(SSS_[A-Z_]+|RCRD_[A-Z_]+|INVALID_[A-Z_]+|USER_ERROR|UNEXPECTED_ERROR|INSUFFICIENT_PERMISSION|UNIQUE_CUST_ID_REQD|DUP_[A-Z_]+|CANT_[A-Z_]+|FIELD_[A-Z_]+|MISSING_[A-Z_]+|SSS_MISSING_REQD_ARGUMENT)\b/g;
const TXN_NO = /\b(?:SO|PO|VB|INV|IF|IR|JE|CM|RA|TO|WO|BILL|VEND|CASH|EST|DEP|CHK|PMT)[-#]?\d{2,}\b/g;
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?\b/g;

/** URL NetSuite → record type + internal id (09 §4). */
export function parseNetsuiteUrl(url: string): { recordType?: string; id?: string; edit: boolean } {
  try {
    const u = new URL(url);
    const file = u.pathname.split("/").pop() ?? "";
    const map: Record<string, string> = {
      "salesord.nl": "salesorder", "purchord.nl": "purchaseorder", "vendbill.nl": "vendorbill", "custinvc.nl": "invoice",
      "itemship.nl": "itemfulfillment", "itemrcpt.nl": "itemreceipt", "journal.nl": "journalentry", "custpymt.nl": "customerpayment",
      "vendpymt.nl": "vendorpayment", "custcred.nl": "creditmemo", "rtnauth.nl": "returnauthorization", "trnfrord.nl": "transferorder",
      "workord.nl": "workorder", "estimate.nl": "estimate", "custjob.nl": "customer", "vendor.nl": "vendor", "employee.nl": "employee",
      "scriptrecord.nl": "script", "scriptdeployment.nl": "scriptdeployment", "custrecordentry.nl": "customrecord",
    };
    return { recordType: map[file] ?? (u.searchParams.get("rectype") ? `customrecord:${u.searchParams.get("rectype")}` : undefined), id: u.searchParams.get("id") ?? undefined, edit: u.searchParams.get("e") === "T" };
  } catch {
    return { edit: false };
  }
}

export function normalizeEntity(e: RawEntity): NormEntity {
  const v = e.value.trim();
  let n = v;
  switch (e.type) {
    case "error_code":
      n = v.toUpperCase().replace(/\s+/g, "_");
      break;
    case "script_id":
    case "record_type":
      n = v.toLowerCase();
      break;
    case "transaction_no":
      n = v.toUpperCase().replace(/\s+/g, "");
      break;
    case "timestamp": {
      const d = new Date(v);
      n = Number.isNaN(d.getTime()) ? v : d.toISOString().slice(0, v.length > 10 ? 19 : 10);
      break;
    }
    case "url": {
      const p = parseNetsuiteUrl(v);
      n = p.recordType ? `${p.recordType}:${p.id ?? "?"}` : v;
      break;
    }
    default:
      n = v.replace(/\s+/g, " ");
  }
  return { type: e.type, value: v.slice(0, 500), normalized: n.slice(0, 500), locator: e.locator ?? null, confidence: e.confidence ?? 0.5 };
}

export function extractEntitiesRegex(text: string, locator: string): RawEntity[] {
  const out: RawEntity[] = [];
  const add = (type: string, re: RegExp, conf: number) => {
    for (const m of text.matchAll(re)) out.push({ type, value: m[0], locator, confidence: conf });
  };
  add("url", NS_URL, 0.95);
  add("script_id", SCRIPT_ID, 0.9);
  add("error_code", ERROR_CODE, 0.85);
  add("transaction_no", TXN_NO, 0.6);
  add("timestamp", ISO_DATE, 0.6);
  for (const m of text.matchAll(NS_URL)) {
    const p = parseNetsuiteUrl(m[0]);
    if (p.id) out.push({ type: "internal_id", value: p.id, locator, confidence: 0.9 });
    if (p.recordType) out.push({ type: "record_type", value: p.recordType, locator, confidence: 0.9 });
  }
  const seen = new Set<string>();
  return out.filter((e) => {
    const k = `${e.type}:${e.value.toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
