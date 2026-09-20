// Browser driver abstraction (ADR-004): the runner does not depend directly on Bun.WebView.
export type ClickPoint = { x: number; y: number };
export interface BrowserDriver {
  navigate(url: string): Promise<void>;
  evaluate<T = unknown>(expr: string): Promise<T>;
  clickAt(p: ClickPoint): Promise<void>;
  typeText(text: string): Promise<void>;
  screenshot(opts?: { format?: "png" | "jpeg" | "webp"; quality?: number }): Promise<Uint8Array>;
  cdp<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  on(event: string, fn: (data: any) => void): void;
  url(): string;
  close(): void;
}

export function chromePath(configured?: string): string | undefined {
  if (configured) return configured;
  const candidates =
    process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]
      : process.platform === "win32"
        ? ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"]
        : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge"];
  for (const c of candidates) if (Bun.file(c).size > 0) return c;
  return Bun.which("google-chrome") ?? Bun.which("chromium") ?? Bun.which("chrome") ?? undefined;
}

export class WebViewDriver implements BrowserDriver {
  private view: Bun.WebView;
  constructor(opts: { chrome: string; profileDir?: string; width?: number; height?: number }) {
    this.view = new Bun.WebView({
      backend: { type: "chrome", path: opts.chrome, url: false, argv: ["--no-first-run", "--disable-features=Translate"] },
      width: opts.width ?? 1440,
      height: opts.height ?? 900,
      ...(opts.profileDir ? { dataStore: { directory: opts.profileDir } } : {}),
    });
  }
  navigate(url: string) {
    return this.view.navigate(url);
  }
  evaluate<T>(expr: string) {
    return this.view.evaluate<T>(expr);
  }
  clickAt(p: ClickPoint) {
    return this.view.click(p.x, p.y);
  }
  async typeText(text: string) {
    await (this.view as unknown as { type(t: string): Promise<void> }).type(text);
  }
  async screenshot(opts: { format?: "png" | "jpeg" | "webp"; quality?: number } = {}) {
    const b = await this.view.screenshot({ encoding: "buffer", format: opts.format ?? "png", ...(opts.quality !== undefined && { quality: opts.quality }) });
    return new Uint8Array(b);
  }
  cdp<T>(method: string, params?: Record<string, unknown>) {
    return this.view.cdp<T>(method, params);
  }
  on(event: string, fn: (data: any) => void) {
    this.view.addEventListener(event, ((e: Event) => fn((e as unknown as { data: unknown }).data)) as EventListener);
  }
  url() {
    return this.view.url;
  }
  close() {
    this.view.close();
  }
}
