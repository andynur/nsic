import { expect, test } from "bun:test";
import { currentCsrf } from "../../src/routes/http.ts";
import { systemRoutes } from "../../src/routes/system.ts";
import { defaultModels, llmEngine, llmSettings, modelFor, modelSettings, saveLlmSettings } from "../../src/llm/models.ts";
import { llmStatus } from "../../src/llm/anthropic.ts";

const route = systemRoutes["/api/settings/llm"];
const token = currentCsrf();
const request = (method: string, data?: unknown) => new Request("http://127.0.0.1:4317/api/settings/llm", {
  method,
  headers: { "content-type": "application/json", "x-nsic-csrf": token, cookie: `nsic_csrf=${token}` },
  ...(data === undefined ? {} : { body: JSON.stringify(data) }),
}) as Request & { params: Record<string, string> };

test("Settings switches engines and restores each saved model profile", async () => {
  const original = llmSettings();
  try {
    const codex = { ...modelSettings("codex"), triage: "gpt-5.6-terra" };
    const response = await route.PUT(request("PUT", { engine: "codex", models: codex }));
    expect(response.status).toBe(200);
    expect(llmEngine()).toBe("codex");
    expect(modelFor("triage")).toBe("gpt-5.6-terra");
    expect(llmStatus().engine).toBe("codex");
    saveLlmSettings("claude-code", modelSettings("claude-code"));
    expect(modelFor("triage")).toBe("claude-haiku-4-5");
    saveLlmSettings("codex", modelSettings("codex"));
    expect(modelFor("triage")).toBe("gpt-5.6-terra");
  } finally {
    for (const engine of ["api", "claude-code", "codex"] as const) saveLlmSettings(engine, original.profiles[engine]);
    saveLlmSettings(original.engine, original.profiles[original.engine]);
  }
});

test("New Codex profiles show specific GPT models for each role", () => {
  const models = defaultModels("codex");
  expect(models.agent_main).toBe("gpt-5.6-terra");
  expect(models.agent_escalation).toBe("gpt-5.6-sol");
  expect(models.triage).toBe("gpt-5.6-luna");
  expect(models.report_writer).toBe("gpt-5.6-terra");
});

test("Settings rejects invalid model values before changing the engine", async () => {
  const before = llmEngine();
  const models = { ...modelSettings("codex"), triage: "bad model; rm -rf /" };
  const response = await route.PUT(request("PUT", { engine: "codex", models }));
  expect(response.status).toBe(422);
  expect(llmEngine()).toBe(before);
});
