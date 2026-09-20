// Reader/writer ZIP minimal (03 §2): stored + deflate, CRC via Bun.hash.crc32, deflate via Bun.deflateSync/inflateSync.
// Enough for DOCX/XLSX and issue bundles. No ZIP64, encryption, or multi-disk support.

export type ZipEntry = { name: string; data: Uint8Array };

const u16 = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);
const u32 = (b: Uint8Array, o: number) => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;

export class ZipReader {
  private entries = new Map<string, { method: number; compSize: number; size: number; localOffset: number }>();

  constructor(private readonly buf: Uint8Array) {
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
      if (u32(buf, i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error("not a ZIP file (EOCD not found)");
    const count = u16(buf, eocd + 10);
    let p = u32(buf, eocd + 16);
    const dec = new TextDecoder();
    for (let i = 0; i < count; i++) {
      if (u32(buf, p) !== 0x02014b50) throw new Error("corrupt central directory");
      const method = u16(buf, p + 10);
      const compSize = u32(buf, p + 20);
      const size = u32(buf, p + 24);
      const nameLen = u16(buf, p + 28);
      const extraLen = u16(buf, p + 30);
      const commentLen = u16(buf, p + 32);
      const localOffset = u32(buf, p + 42);
      const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
      this.entries.set(name, { method, compSize, size, localOffset });
      p += 46 + nameLen + extraLen + commentLen;
    }
  }

  names(): string[] {
    return [...this.entries.keys()];
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  read(name: string): Uint8Array | null {
    const e = this.entries.get(name);
    if (!e) return null;
    const o = e.localOffset;
    if (u32(this.buf, o) !== 0x04034b50) throw new Error(`corrupt local header: ${name}`);
    const start = o + 30 + u16(this.buf, o + 26) + u16(this.buf, o + 28);
    const raw = this.buf.subarray(start, start + e.compSize);
    if (e.method === 0) return raw.slice();
    if (e.method === 8) return Bun.inflateSync(raw as Uint8Array<ArrayBuffer>);
    throw new Error(`compression method ${e.method} is not supported (${name})`);
  }

  text(name: string): string | null {
    const d = this.read(name);
    return d ? new TextDecoder().decode(d) : null;
  }
}

function dosTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** Write a ZIP. Small or poorly compressible entries are 'stored'. */
export function writeZip(entries: ZipEntry[], opts: { now?: Date } = {}): Uint8Array {
  const enc = new TextEncoder();
  const { time, date } = dosTime(opts.now ?? new Date());
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const crc = Bun.hash.crc32(e.data) >>> 0;
    const deflated = e.data.length > 64 ? Bun.deflateSync(e.data as Uint8Array<ArrayBuffer>) : null;
    const useDeflate = deflated !== null && deflated.length < e.data.length;
    const body = useDeflate ? deflated! : e.data;
    const method = useDeflate ? 8 : 0;

    const lh = new Uint8Array(30 + name.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, method, true);
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, e.data.length, true);
    lv.setUint16(26, name.length, true);
    lh.set(name, 30);

    const ch = new Uint8Array(46 + name.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, e.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    ch.set(name, 46);

    locals.push(lh, body);
    centrals.push(ch);
    offset += lh.length + body.length;
  }
  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cdSize + 22);
  let p = 0;
  for (const part of [...locals, ...centrals, eocd]) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

export const isZip = (b: Uint8Array) => b.length > 4 && u32(b, 0) === 0x04034b50;
