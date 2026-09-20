export const newId = (): string => Bun.randomUUIDv7();
export const now = (): number => Date.now();

export async function sha256Hex(data: ArrayBuffer | Uint8Array | string): Promise<string> {
  const h = new Bun.CryptoHasher("sha256");
  h.update(data);
  return h.digest("hex");
}
