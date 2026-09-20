// SDF object parser (Objects/*.xml) using Bun.XML.parse (07 §6).
export type SdfEdge = { src: string; dst: string; rel: string };
export type ParsedObject = { scriptid: string; objectType: string; attrs: Record<string, unknown>; edges: SdfEdge[]; children: { scriptid: string; objectType: string; attrs: Record<string, unknown> }[] };

type Node = Record<string, unknown>;
const asArray = <T>(v: T | T[] | undefined | null): T[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const text = (v: unknown): string | undefined => (typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : v && typeof v === "object" && "#text" in v ? String((v as Node)["#text"]) : undefined);

/** '[/SuiteScripts/x.js]' → '/SuiteScripts/x.js'; '[scriptid=customrecord_x]' → 'customrecord_x'. */
export function unref(v: string | undefined): string | undefined {
  if (!v) return v;
  const m = /^\[(?:scriptid=)?([^\]]+)\]$/.exec(v.trim());
  return m ? m[1] : v.trim();
}

const SCRIPT_TYPES = new Set(["usereventscript", "clientscript", "mapreducescript", "scheduledscript", "suitelet", "restlet", "workflowactionscript", "massupdatescript", "portlet", "bundleinstallationscript", "sdfinstallationscript"]);

export const recNode = (recordType: string) => `rec:${recordType.toLowerCase()}`;

export function parseSdfObject(xml: string): ParsedObject | null {
  const doc = Bun.XML.parse(xml) as Node;
  const objectType = Object.keys(doc).find((k) => !k.startsWith("?") && !k.startsWith("#"));
  if (!objectType) return null;
  const root = (doc[objectType] ?? {}) as Node;
  const scriptid = text(root["@scriptid"]);
  if (!scriptid) return null;
  const obj = `obj:${scriptid}`;
  const edges: SdfEdge[] = [];
  const children: ParsedObject["children"] = [];
  const attrs: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(root)) {
    const t = text(v);
    if (t !== undefined && !k.startsWith("@")) attrs[k] = t;
  }

  if (SCRIPT_TYPES.has(objectType)) {
    const file = unref(text(root.scriptfile));
    if (file) {
      attrs.scriptfile = file;
      edges.push({ src: obj, dst: `fc:${file}`, rel: "implements" });
    }
    const deps = asArray((root.scriptdeployments as Node | undefined)?.scriptdeployment as Node | Node[] | undefined);
    for (const d of deps) {
      const did = text(d["@scriptid"]);
      if (!did) continue;
      const da: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(d)) {
        const t = text(v);
        if (t !== undefined && !k.startsWith("@")) da[k] = t;
      }
      da.script = scriptid;
      children.push({ scriptid: did, objectType: "scriptdeployment", attrs: da });
      edges.push({ src: obj, dst: `obj:${did}`, rel: "deploys" });
      const rt = text(d.recordtype);
      if (rt) {
        const rec = recNode(unref(rt)!);
        edges.push({ src: `obj:${did}`, dst: rec, rel: "applies_to" });
        edges.push({ src: obj, dst: rec, rel: "applies_to" });
      }
    }
    attrs.deployments = deps.length;
  } else if (objectType === "workflow") {
    for (const rt of String(text(root.recordtypes) ?? "").split("|").filter(Boolean)) edges.push({ src: obj, dst: recNode(unref(rt)!), rel: "applies_to" });
    // custom action script inside a state
    const scan = (n: unknown) => {
      if (!n || typeof n !== "object") return;
      for (const [k, v] of Object.entries(n as Node)) {
        if (k === "scripttype" || k === "script") {
          const sid = unref(text(v));
          if (sid && sid.startsWith("customscript")) edges.push({ src: obj, dst: `obj:${sid}`, rel: "triggers" });
        } else for (const c of asArray(v as unknown)) scan(c);
      }
    };
    scan(root.workflowstates);
    const states = asArray(((root.workflowstates as Node | undefined)?.workflowstate) as Node | Node[] | undefined);
    attrs.states = states.map((s) => text(s.name) ?? text(s["@scriptid"])).filter(Boolean);
  } else if (objectType === "savedsearch") {
    attrs.searchtype = text(root.searchtype) ?? text((root.definition as Node | undefined)?.searchtype);
  } else if (/^(transactionbodycustomfield|transactioncolumncustomfield|entitycustomfield|itemcustomfield|crmcustomfield|othercustomfield|itemnumbercustomfield)$/.test(objectType)) {
    edges.push({ src: `fld:${scriptid}`, dst: obj, rel: "defined_by" });
    for (const [k, v] of Object.entries(root)) {
      if (k.startsWith("applyto") || k.startsWith("appliesto")) {
        if (text(v) === "T") edges.push({ src: `fld:${scriptid}`, dst: recNode(k.replace(/^appl(y|ies)to/, "")), rel: "on_record" });
      }
    }
    const src = unref(text(root.selectrecordtype));
    if (src) attrs.selectrecordtype = src;
  } else if (objectType === "customrecordtype") {
    edges.push({ src: obj, dst: recNode(scriptid), rel: "defines" });
    const fields = asArray(((root.customrecordcustomfields as Node | undefined)?.customrecordcustomfield) as Node | Node[] | undefined);
    for (const f of fields) {
      const fid = text(f["@scriptid"]);
      if (fid) edges.push({ src: `fld:${fid}`, dst: recNode(scriptid), rel: "on_record" });
    }
    attrs.fields = fields.length;
  }
  return { scriptid, objectType, attrs, edges, children };
}
