// Screenshot all UI screens (light + dark) for design review. Requires `bun run ui` running.
// Usage: bun run ui:shots [baseUrl] [--width=1440]
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromePath } from "../../src/browser/driver.ts";

const base = process.argv.find((a) => a.startsWith("http")) ?? "http://127.0.0.1:4318";
const width = Number(process.argv.find((a) => a.startsWith("--width="))?.slice(8) ?? 1440);
const out = join(import.meta.dir, "..", "..", "data", "screens");
mkdirSync(out, { recursive: true });

const PAGES: [string, string, string?][] = [
  ["inbox", "/"],
  ["issue-acme-42", "/issues/ACME-42"],
  ["issue-acme-42-consultant", "/issues/ACME-42", "consultant"],
  ["issue-acme-43-running", "/issues/ACME-43"],
  ["issue-acme-44-budget", "/issues/ACME-44"],
  ["issue-nus-8-ingesting", "/issues/NUS-8"],
  ["issue-acme-46-approval", "/issues/ACME-46"],
  ["new-issue", "/issues/new"],
  ["projects", "/projects"],
  ["project-acme", "/projects/p-acme"],
  ["env-sb1", "/projects/p-acme/env/e-acme-sb1"],
  ["env-prod", "/projects/p-acme/env/e-acme-prod"],
  ["report", "/issues/ACME-42/report"],
  ["usage", "/usage"],
  ["settings", "/settings"],
];

const chrome = chromePath(process.env.CHROME_PATH);
if (!chrome) throw new Error("Chrome not found");
const view = new Bun.WebView({ backend: { type: "chrome", path: chrome, url: false }, width, height: 1000 });
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
for (const scheme of ["light", "dark"] as const) {
  // Same mechanism as the in-app toggle (web/app/theme.ts): a stored preference, light by default.
  await view.navigate(base + "/");
  await view.evaluate(`localStorage.setItem("nsic.theme", ${JSON.stringify(scheme)})`);
  for (const [name, path, action] of PAGES) {
    if (only && !name.includes(only)) continue;
    await view.navigate(base + path);
    await Bun.sleep(900);
    if (action === "consultant") {
      await view.evaluate(`[...document.querySelectorAll('[role=tab]')].find(b => b.textContent.includes('Consultant'))?.click()`);
      await Bun.sleep(600);
    }
    if (name === "report") {
      await view.evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Build preview'))?.click()`);
      await Bun.sleep(1500);
    }
    const fold = process.argv.includes("--fold");
    const h = fold ? 1000 : await view.evaluate<number>("Math.min(4000, document.documentElement.scrollHeight)");
    await view.cdp("Emulation.setDeviceMetricsOverride", { width, height: h, deviceScaleFactor: 1, mobile: false });
    await Bun.sleep(200);
    const png = await view.screenshot({ format: "png" });
    await Bun.write(join(out, `${name}-${scheme}${fold ? "-fold" : ""}.png`), png);
    await view.cdp("Emulation.clearDeviceMetricsOverride");
    console.log(`${name}-${scheme}${fold ? "-fold" : ""}.png (${h}px)`);
  }
}
view.close();
process.exit(0);
