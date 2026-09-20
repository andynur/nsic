// PDF via CDP Page.printToPDF using the Bun.WebView Chrome backend (12 §3).
import { config } from "../config.ts";
import { type Result, ok, appErr, errorMessage } from "../lib/result.ts";
import { chromePath, WebViewDriver } from "../browser/driver.ts";
import { pathToFileURL } from "node:url";

export async function htmlFileToPdf(htmlPath: string, footerLabel: string): Promise<Result<Uint8Array>> {
  const chrome = chromePath(config().chromePath);
  if (!chrome) return appErr("no_chrome", "Chrome/Chromium was not found for PDF rendering. Set CHROME_PATH.");
  let d: WebViewDriver | undefined;
  try {
    d = new WebViewDriver({ chrome, width: 1200, height: 1600 });
    await d.navigate(pathToFileURL(htmlPath).toString());
    await d.evaluate("document.fonts ? document.fonts.ready.then(() => true) : true");
    const small = 'style="font-size:8px;font-family:system-ui;color:#8F8F8F;width:100%;padding:0 16mm;display:flex;justify-content:space-between"';
    const r = await d.cdp<{ data: string }>("Page.printToPDF", {
      printBackground: true,
      paperWidth: 8.27,
      paperHeight: 11.69,
      marginTop: 0.63,
      marginBottom: 0.63,
      marginLeft: 0.63,
      marginRight: 0.63,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: `<div ${small}><span>${footerLabel.replace(/[<>&]/g, "")}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
      preferCSSPageSize: false,
    });
    return ok(new Uint8Array(Buffer.from(r.data, "base64")));
  } catch (e) {
    return appErr("pdf_failed", `Failed to create PDF: ${errorMessage(e)}`);
  } finally {
    try {
      d?.close();
    } catch {
      /* noop */
    }
  }
}
