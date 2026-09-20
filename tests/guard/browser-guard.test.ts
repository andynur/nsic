import { describe, expect, test } from "bun:test";
import { checkClickTarget, checkRequest, checkScript, checkStep, checkUrl } from "../../src/browser/guard.ts";
import { validateDsl } from "../../src/browser/dsl.ts";

describe("production guard browser", () => {
  test("blocks edit mode and new record forms", () => {
    expect(checkUrl("/app/accounting/transactions/vendbill.nl?id=1&e=T")).toContain("e=T");
    expect(checkUrl("/app/accounting/transactions/vendbill.nl")).not.toBeNull();
    expect(checkUrl("/app/common/scripting/script.nl?id=5")).not.toBeNull();
    expect(checkUrl("/app/accounting/transactions/vendbill.nl?id=88213")).toBeNull();
    expect(checkUrl("/app/accounting/transactions/transactionlist.nl?Transaction_TYPE=VendBill")).toBeNull();
  });
  test("blocks localized write buttons and id denylist", () => {
    for (const t of ["Save", "Approve", "Simpan", "Setujui", "Delete", "Edit", "Submit"]) expect(checkClickTarget({ text: t })).not.toBeNull();
    expect(checkClickTarget({ id: "btn_multibutton_submitter" })).not.toBeNull();
    expect(checkClickTarget({ id: "spn_secondarysubmitter" })).not.toBeNull();
    expect(checkClickTarget({ tag: "input", type: "submit", text: "Go" })).not.toBeNull();
    expect(checkClickTarget({ text: "Related Records", role: "tab" } as never)).toBeNull();
  });
  test("network: non-GET to account domain is blocked", () => {
    expect(checkRequest("POST", "https://1234567.app.netsuite.com/app/accounting/transactions/vendbill.nl", "1234567")).not.toBeNull();
    expect(checkRequest("GET", "https://1234567.app.netsuite.com/app/center/card.nl", "1234567")).toBeNull();
    expect(checkRequest("POST", "https://analytics.example.com/x", "1234567")).toBeNull();
  });
  test("DSL: type/select rejected, sandboxOnly skipped in production", () => {
    const v = validateDsl({ version: 1, steps: [{ id: "a", action: "type", target: { field: "memo" }, value: "x" }, { id: "b", action: "click", target: { text: "Approve", role: "button" }, sandboxOnly: true }, { id: "c", action: "navigate", url: "/app/center/card.nl" }] });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const r = checkScript(v.value, "production");
    expect(r.violations.map((x) => x.stepId)).toEqual(["a"]);
    expect(r.skipped).toEqual(["b"]);
    expect(checkScript(v.value, "audit_only").violations).toEqual([]);
    expect(checkStep(v.value.steps[2]!)).toBeNull();
  });
});
