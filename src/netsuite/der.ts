// Minimal DER encoder to create a self-signed X.509 certificate (NetSuite M2M) without openssl/npm.
const len = (n: number): number[] => {
  if (n < 0x80) return [n];
  const b: number[] = [];
  while (n > 0) {
    b.unshift(n & 0xff);
    n >>= 8;
  }
  return [0x80 | b.length, ...b];
};
const tlv = (tag: number, body: Uint8Array | number[]): Uint8Array => {
  const b = body instanceof Uint8Array ? [...body] : body;
  return new Uint8Array([tag, ...len(b.length), ...b]);
};
const cat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
export const seq = (...p: Uint8Array[]) => tlv(0x30, cat(...p));
export const set = (...p: Uint8Array[]) => tlv(0x31, cat(...p));
export const int = (bytes: Uint8Array | number[]): Uint8Array => {
  let b = [...bytes];
  while (b.length > 1 && b[0] === 0 && b[1]! < 0x80) b = b.slice(1);
  if (b[0]! >= 0x80) b = [0, ...b];
  return tlv(0x02, b);
};
export const oid = (s: string): Uint8Array => {
  const parts = s.split(".").map(Number);
  const out = [parts[0]! * 40 + parts[1]!];
  for (const p of parts.slice(2)) {
    const enc: number[] = [p & 0x7f];
    let v = p >> 7;
    while (v > 0) {
      enc.unshift((v & 0x7f) | 0x80);
      v >>= 7;
    }
    out.push(...enc);
  }
  return tlv(0x06, out);
};
export const utf8 = (s: string) => tlv(0x0c, [...new TextEncoder().encode(s)]);
export const bitString = (b: Uint8Array) => tlv(0x03, [0, ...b]);
export const explicit = (n: number, body: Uint8Array) => tlv(0xa0 + n, body);
export const utcTime = (d: Date): Uint8Array => {
  const p = (x: number) => String(x).padStart(2, "0");
  const s = `${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  return tlv(0x17, [...new TextEncoder().encode(s)]);
};

/** ECDSA raw (r||s) → DER SEQUENCE { r, s }. */
export const ecdsaRawToDer = (raw: Uint8Array): Uint8Array => seq(int(raw.subarray(0, raw.length / 2)), int(raw.subarray(raw.length / 2)));

export const pem = (label: string, der: Uint8Array) => `-----BEGIN ${label}-----\n${Buffer.from(der).toString("base64").match(/.{1,64}/g)!.join("\n")}\n-----END ${label}-----\n`;
