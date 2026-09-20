// Static SuiteScript analysis (07 §6): JSDoc tags, define([...]) modules, entry points, field access.
export type ScriptInfo = {
  apiVersion: string | null;
  scriptType: string | null;
  moduleScope: string | null;
  modules: string[];
  entryPoints: string[];
  readsFields: string[];
  writesFields: string[];
  recordTypesTouched: string[];
};

const ENTRY_POINTS = [
  "beforeLoad", "beforeSubmit", "afterSubmit", "pageInit", "fieldChanged", "postSourcing", "sublistChanged", "lineInit",
  "validateField", "validateLine", "validateInsert", "validateDelete", "saveRecord", "localizationContextEnter", "localizationContextExit",
  "execute", "getInputData", "map", "reduce", "summarize", "onRequest", "get", "post", "put", "delete", "onAction", "each", "fireTrigger",
];

export function analyzeScript(src: string): ScriptInfo {
  const tag = (t: string) => new RegExp(`@${t}\\s+([\\w.]+)`).exec(src)?.[1] ?? null;
  const modules = new Set<string>();
  const def = /\bdefine\s*\(\s*\[([^\]]*)\]/.exec(src);
  if (def) for (const m of def[1]!.matchAll(/['"]([^'"]+)['"]/g)) modules.add(m[1]!);
  for (const m of src.matchAll(/\brequire\s*\(\s*\[?\s*['"](N\/[\w/]+)['"]/g)) modules.add(m[1]!);
  for (const m of src.matchAll(/\bimport\s+(?:[\w*{}\s,]+\s+from\s+)?['"](N\/[\w/]+)['"]/g)) modules.add(m[1]!);

  const entry = new Set<string>();
  const ret = /return\s*\{([\s\S]*?)\}\s*;?\s*\}\s*\)\s*;?\s*$/m.exec(src) ?? /return\s*\{([^{}]*)\}/.exec(src);
  if (ret) for (const m of ret[1]!.matchAll(/\b(\w+)\s*(?::|,|\n|$)/g)) if (ENTRY_POINTS.includes(m[1]!)) entry.add(m[1]!);
  for (const ep of ENTRY_POINTS) if (new RegExp(`export\\s+(?:const|function|async function)\\s+${ep}\\b`).test(src)) entry.add(ep);

  const fid = /fieldId\s*:\s*['"]([\w]+)['"]/;
  const reads = new Set<string>();
  const writes = new Set<string>();
  for (const m of src.matchAll(/\.(getValue|getText|getSublistValue|getCurrentSublistValue|getSublistText|getField)\s*\(\s*(\{[^}]*\}|['"][\w]+['"])/g)) {
    const f = m[2]!.startsWith("{") ? fid.exec(m[2]!)?.[1] : m[2]!.replace(/['"]/g, "");
    if (f) reads.add(f.toLowerCase());
  }
  for (const m of src.matchAll(/\.(setValue|setText|setSublistValue|setCurrentSublistValue|setSublistText)\s*\(\s*(\{[^}]*\}|['"][\w]+['"])/g)) {
    const f = m[2]!.startsWith("{") ? fid.exec(m[2]!)?.[1] : m[2]!.replace(/['"]/g, "");
    if (f) writes.add(f.toLowerCase());
  }
  for (const m of src.matchAll(/submitFields\s*\(\s*\{[\s\S]*?values\s*:\s*\{([^}]*)\}/g)) for (const k of m[1]!.matchAll(/['"]?(\w+)['"]?\s*:/g)) writes.add(k[1]!.toLowerCase());

  const recs = new Set<string>();
  for (const m of src.matchAll(/record\.Type\.([A-Z_]+)/g)) recs.add(m[1]!.toLowerCase().replace(/_/g, ""));
  for (const m of src.matchAll(/\btype\s*:\s*['"]([a-z_]+)['"]/g)) recs.add(m[1]!);

  return {
    apiVersion: tag("NApiVersion"),
    scriptType: tag("NScriptType"),
    moduleScope: tag("NModuleScope"),
    modules: [...modules].sort(),
    entryPoints: [...entry],
    readsFields: [...reads].sort(),
    writesFields: [...writes].sort(),
    recordTypesTouched: [...recs].sort(),
  };
}
