import { db } from "../db.ts";
import { now } from "../../lib/ids.ts";
import { pj } from "./_util.ts";

export function getSetting<T>(key: string, fallback: T): T {
  const r = db().query("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | null;
  return r ? pj<T>(r.value, fallback) : fallback;
}

export function putSetting(key: string, value: unknown) {
  db()
    .query("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .run(key, JSON.stringify(value), now());
}

export type Pricing = {
  model: string;
  input_per_mtok: number;
  output_per_mtok: number;
  cache_write_per_mtok: number;
  cache_read_per_mtok: number;
  effective_from: number;
  note: string | null;
};

export const listPricing = (): Pricing[] => db().query("SELECT * FROM model_pricing ORDER BY model").all() as Pricing[];
export const getPricing = (model: string): Pricing | null =>
  db().query("SELECT * FROM model_pricing WHERE model = ?").get(model) as Pricing | null;

export function upsertPricing(p: Omit<Pricing, "effective_from" | "note"> & { note?: string | null }) {
  db()
    .query(
      `INSERT INTO model_pricing (model, input_per_mtok, output_per_mtok, cache_write_per_mtok, cache_read_per_mtok, effective_from, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(model) DO UPDATE SET input_per_mtok=excluded.input_per_mtok, output_per_mtok=excluded.output_per_mtok,
         cache_write_per_mtok=excluded.cache_write_per_mtok, cache_read_per_mtok=excluded.cache_read_per_mtok,
         effective_from=excluded.effective_from, note=excluded.note`,
    )
    .run(p.model, p.input_per_mtok, p.output_per_mtok, p.cache_write_per_mtok, p.cache_read_per_mtok, now(), p.note ?? null);
}

export const deletePricing = (model: string) => db().query("DELETE FROM model_pricing WHERE model = ?").run(model);
