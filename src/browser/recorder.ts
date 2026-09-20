// Screen recording via CDP screencast → frame JPEG → ffmpeg MP4 + caption VTT/SRT (08 §7).
import { $ } from "bun";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.ts";
import type { BrowserDriver } from "./driver.ts";

export type CaptionCue = { stepId: string; caption: string; tStart: number; tEnd: number };

export const ffmpegPath = () => config().ffmpegPath ?? Bun.which("ffmpeg") ?? null;

export class Recorder {
  private frames: { file: string; t: number }[] = [];
  private seq = 0;
  private startedAt = 0;
  private active = false;
  readonly cues: CaptionCue[] = [];

  constructor(private readonly d: BrowserDriver, readonly dir: string) {}

  async start(size: { width: number; height: number }) {
    mkdirSync(join(this.dir, "frames"), { recursive: true });
    this.startedAt = performance.now();
    this.active = true;
    this.d.on("Page.screencastFrame", (e: { data: string; sessionId: number }) => {
      if (!this.active) return;
      const file = join(this.dir, "frames", `${String(this.seq++).padStart(6, "0")}.jpg`);
      this.frames.push({ file, t: (performance.now() - this.startedAt) / 1000 });
      void Bun.write(file, Buffer.from(e.data, "base64"));
      void this.d.cdp("Page.screencastFrameAck", { sessionId: e.sessionId }).catch(() => {});
    });
    await this.d.cdp("Page.enable");
    await this.d.cdp("Page.startScreencast", { format: "jpeg", quality: 80, maxWidth: size.width, maxHeight: size.height, everyNthFrame: 1 });
  }

  now() {
    return (performance.now() - this.startedAt) / 1000;
  }

  cue(stepId: string, caption: string, tStart: number, tEnd = this.now()) {
    if (caption) this.cues.push({ stepId, caption, tStart, tEnd: Math.max(tEnd, tStart + 1.5) });
  }

  async stop(): Promise<{ frames: number; duration: number }> {
    this.active = false;
    await this.d.cdp("Page.stopScreencast").catch(() => {});
    await Bun.sleep(300);
    return { frames: this.frames.length, duration: this.now() };
  }

  /** Write frames.txt (concat demuxer), captions.vtt/.srt; encode MP4 if ffmpeg is available. */
  async finalize(): Promise<{ mp4: string | null; vtt: string; srt: string; framesDir: string; reason?: string }> {
    const vtt = join(this.dir, "captions.vtt");
    const srt = join(this.dir, "captions.srt");
    await Bun.write(vtt, toVtt(this.cues));
    await Bun.write(srt, toSrt(this.cues));
    const framesDir = join(this.dir, "frames");
    if (!this.frames.length) return { mp4: null, vtt, srt, framesDir, reason: "no frames" };
    const lines: string[] = [];
    this.frames.forEach((f, i) => {
      const next = this.frames[i + 1]?.t ?? f.t + 1;
      lines.push(`file '${f.file.replace(/'/g, "'\\''")}'`, `duration ${Math.max(0.033, next - f.t).toFixed(3)}`);
    });
    lines.push(`file '${this.frames[this.frames.length - 1]!.file}'`);
    const list = join(this.dir, "frames.txt");
    await Bun.write(list, lines.join("\n") + "\n");
    const ff = ffmpegPath();
    if (!ff) return { mp4: null, vtt, srt, framesDir, reason: "ffmpeg is not installed: frames + captions saved, the video can be built after ffmpeg is installed" };
    const mp4 = join(this.dir, "out.mp4");
    const r = await $`${ff} -y -loglevel error -f concat -safe 0 -i ${list} -vf fps=30,format=yuv420p,scale=trunc(iw/2)*2:trunc(ih/2)*2 -c:v libx264 -preset veryfast -crf 23 -movflags +faststart ${mp4}`.nothrow().quiet();
    if (r.exitCode !== 0) return { mp4: null, vtt, srt, framesDir, reason: `ffmpeg failed: ${r.stderr.toString().slice(0, 300)}` };
    rmSync(framesDir, { recursive: true, force: true });
    rmSync(list, { force: true });
    return { mp4, vtt, srt, framesDir };
  }
}

const ts = (s: number, sep: "." | ",") => {
  const ms = Math.round(s * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}${sep}${String(ms % 1000).padStart(3, "0")}`;
};

export const toVtt = (cues: CaptionCue[]) => `WEBVTT\n\n${cues.map((c, i) => `${i + 1}\n${ts(c.tStart, ".")} --> ${ts(c.tEnd, ".")}\n${c.caption}\n`).join("\n")}`;
export const toSrt = (cues: CaptionCue[]) => cues.map((c, i) => `${i + 1}\n${ts(c.tStart, ",")} --> ${ts(c.tEnd, ",")}\n${c.caption}\n`).join("\n");

export const listFrames = (dir: string) => readdirSync(join(dir, "frames")).filter((f) => f.endsWith(".jpg")).sort();
