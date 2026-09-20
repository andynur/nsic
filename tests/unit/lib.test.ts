import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { writeZip, ZipReader } from "../../src/lib/zip.ts";
import { open, seal } from "../../src/lib/crypto.ts";
import { redactSecrets } from "../../src/lib/redact-secrets.ts";
import { parseCsv } from "../../src/ingest/csv.ts";
import { parseEmail } from "../../src/ingest/eml.ts";
import { readXlsx } from "../../src/ingest/xlsx.ts";
import { writeXlsx } from "../../src/reports/xlsx.ts";
import { normalizeEntity, parseNetsuiteUrl } from "../../src/ingest/entities.ts";
import { analyzeScript } from "../../src/repo/script-analyzer.ts";
import { costOf } from "../../src/llm/usage.ts";
import { accumulate } from "../../src/llm/anthropic.ts";
import { createProject } from "../../src/db/repo/projects.ts";
import { createRepo } from "../../src/db/repo/code.ts";
import { indexRepo } from "../../src/repo/indexer.ts";
import { recordAutomation } from "../../src/repo/graph.ts";

describe("lib", () => {
  test("zip round-trip", () => {
    const z = writeZip([{ name: "a.txt", data: new TextEncoder().encode("hello ".repeat(200)) }]);
    expect(new ZipReader(z).text("a.txt")).toBe("hello ".repeat(200));
  });
  test("AES-GCM seal/open + wrong id fails", async () => {
    const k = new Uint8Array(32).fill(3);
    const s = await seal(k, "cred-1", "secret");
    expect((await open(k, "cred-1", s)).ok).toBe(true);
    expect((await open(k, "cred-2", s)).ok).toBe(false);
  });
  test("secret redaction", () => {
    expect(redactSecrets("Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456")).not.toContain("abcdefghijklmnop");
    expect(redactSecrets('{"refresh_token":"xyzxyzxyzxyz1234"}')).toContain("[REDACTED]");
  });
});

describe("ingest", () => {
  test("CSV quoting + delimiter ;", () => expect(parseCsv('a;b\n"x;1";"line\nbreak"\n')).toEqual([["a", "b"], ["x;1", "line\nbreak"]]));
  test("EML multipart + QP + attachment", () => {
    const raw = ["From: Rina <rina@acme.co>", "Subject: =?UTF-8?B?VkItMTA0MiBmYWlsZWQ=?=", 'Content-Type: multipart/mixed; boundary="b1"', "", "--b1", "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: quoted-printable", "", "Error Record has been changed =3D VB-1042", "--b1", 'Content-Type: image/png; name="s.png"', "Content-Disposition: attachment; filename=\"s.png\"", "Content-Transfer-Encoding: base64", "", "iVBORw0KGgo=", "--b1--"].join("\r\n");
    const e = parseEmail(new TextEncoder().encode(raw));
    expect(e.headers.subject).toBe("VB-1042 failed");
    expect(e.text).toContain("= VB-1042");
    expect(e.attachments[0]?.filename).toBe("s.png");
  });
  test("XLSX writer read back by reader", () => {
    const x = writeXlsx([{ name: "Evidence", header: ["ID", "Value"], rows: [["#E1", 42], ["#E2", "text & <x>"]] }]);
    const sheets = readXlsx(x);
    expect(sheets[0]?.name).toBe("Evidence");
    expect(sheets[0]?.rows).toEqual([["ID", "Value"], ["#E1", "42"], ["#E2", "text & <x>"]]);
  });
  test("entity normalization & NetSuite URL", () => {
    expect(parseNetsuiteUrl("https://1-sb1.app.netsuite.com/app/accounting/transactions/vendbill.nl?id=88213&e=T")).toEqual({ recordType: "vendorbill", id: "88213", edit: true });
    expect(normalizeEntity({ type: "error_code", value: "rcrd has been changed" }).normalized).toBe("RCRD_HAS_BEEN_CHANGED");
  });
});

describe("repo & llm", () => {
  test("SuiteScript analysis", () => {
    const a = analyzeScript(`/** @NApiVersion 2.1\n * @NScriptType UserEventScript */\ndefine(['N/record'], (record) => { const afterSubmit = (c) => { const r = record.load({type: record.Type.VENDOR_BILL, id: 1}); r.setValue({ fieldId: 'custbody_x', value: 1 }); r.save(); }; return { afterSubmit }; });`);
    expect(a.scriptType).toBe("UserEventScript");
    expect(a.entryPoints).toEqual(["afterSubmit"]);
    expect(a.writesFields).toEqual(["custbody_x"]);
  });
  test("indexer SDF fixture: vendorbill automation", async () => {
    const p = createProject({ name: "ACME Test" });
    const r = createRepo({ project_id: p.id, source: "local_path", location: join(import.meta.dir, "..", "fixtures", "sdf-repo") });
    const st = await indexRepo(r.id);
    expect(st.objects).toBe(6);
    const auto = recordAutomation([r.id], "vendorbill");
    expect(auto.items.map((i) => i.scriptid).sort()).toEqual(["customscript_acme_ue_vb_approval", "customscript_acme_ue_vb_sync_ap", "customworkflow_acme_vb_approval"]);
    expect(auto.items.find((i) => i.scriptid === "customscript_acme_ue_vb_approval")?.file).toBe("src/FileCabinet/SuiteScripts/acme/ue_vb_approval.js");
    expect(auto.fieldsWritten.map((f) => f.field)).toContain("custbody_acme_ap_synced");
  });
  test("token cost", () => {
    expect(costOf({ input_tokens: 1e6, output_tokens: 1e6, cache_creation_input_tokens: 0, cache_read_input_tokens: 1e6 }, { input_per_mtok: 2, output_per_mtok: 10, cache_write_per_mtok: 2.5, cache_read_per_mtok: 0.2 })).toBeCloseTo(12.2);
  });
  test("SSE Messages API accumulation includes tool_use", async () => {
    const ev = (d: object) => `event: x\ndata: ${JSON.stringify(d)}\n\n`;
    const body = [
      ev({ type: "message_start", message: { id: "m1", model: "claude-sonnet-5", usage: { input_tokens: 10, cache_read_input_tokens: 5 } } }),
      ev({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
      ev({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } }),
      ev({ type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "t1", name: "search_code" } }),
      ev({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"query":' } }),
      ev({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '"bill.save"}' } }),
      ev({ type: "content_block_stop", index: 1 }),
      ev({ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 7 } }),
    ].join("");
    const r = await accumulate(new Response(body).body!);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.stop_reason).toBe("tool_use");
    expect(r.value.usage).toEqual({ input_tokens: 10, output_tokens: 7, cache_creation_input_tokens: 0, cache_read_input_tokens: 5 });
    expect(r.value.content[1]).toEqual({ type: "tool_use", id: "t1", name: "search_code", input: { query: "bill.save" } });
  });
});
