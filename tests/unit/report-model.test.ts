import { describe, expect, test } from "bun:test";
import { splitRootCause, stripLeadingHeading } from "../../src/reports/model.ts";

describe("report model text", () => {
  test("splits the trailing limitations list off the root cause", () => {
    const r = splitRootCause("Claim.\n\nMechanism with #E2.\n\n**Limitations**\n- No logs yet\n- Not reproduced");
    expect(r.body).toBe("Claim.\n\nMechanism with #E2.");
    expect(r.limitations).toEqual(["No logs yet", "Not reproduced"]);
    expect(splitRootCause("Claim only.")).toEqual({ body: "Claim only.", limitations: [] });
  });
  test("drops a leading Cause heading only", () => {
    expect(stripLeadingHeading("## Root cause\nText")).toBe("Text");
    expect(stripLeadingHeading("### Cause\n\nText")).toBe("Text");
    expect(stripLeadingHeading("## Mechanism\nText")).toBe("## Mechanism\nText");
  });
});

import { clipWords } from "../../src/reports/html.ts";
describe("clipWords", () => {
  test("cuts at a word boundary with an ellipsis", () => {
    expect(clipWords("short", 10)).toBe("short");
    expect(clipWords("the second save happens inside the same request", 30)).toBe("the second save happens…");
  });
});
