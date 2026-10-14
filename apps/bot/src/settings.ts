import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from './db/client.js';
import { appSettings } from './db/schema.js';

/** Runtime settings schema (spec section 7). Unknown keys are rejected. */
export const settingsShape = {
  panel_base_url: z
    .string()
    .url()
    .refine((u) => /^https?:\/\//.test(u), 'must be http(s)')
    .transform((u) => u.replace(/\/+$/, '')),
  idle_disconnect_seconds: z.number().int().min(10).max(86_400),
  default_volume: z.number().int().min(0).max(150),
  max_queue_length: z.number().int().min(1).max(5000),
  history_retention_days: z.number().int().min(1).max(3650),
} as const;

export type SettingKey = keyof typeof settingsShape;
export const SETTING_KEYS = Object.keys(settingsShape) as SettingKey[];

export interface Settings {
  panel_base_url: string | undefined;
  idle_disconnect_seconds: number;
  default_volume: number;
  max_queue_length: number;
  history_retention_days: number;
}

export const SETTING_DEFAULTS: Settings = {
  panel_base_url: undefined,
  idle_disconnect_seconds: 300,
  default_volume: 80,
  max_queue_length: 500,
  history_retention_days: 90,
};

export function isSettingKey(k: string): k is SettingKey {
  return (SETTING_KEYS as string[]).includes(k);
}

/** Parse a user-entered string into the typed value for `key`. Throws ZodError / Error on invalid input. */
export function parseSettingInput(key: string, raw: string): unknown {
  if (!isSettingKey(key)) throw new Error(`Unknown setting "${key}"`);
  const schema = settingsShape[key];
  const candidate: unknown = key === 'panel_base_url' ? raw.trim() : Number(raw.trim());
  const res = schema.safeParse(candidate);
  if (!res.success)
    throw new Error(
      `Invalid value for ${key}: ${res.error.issues.map((i) => i.message).join(', ')}`,
    );
  return res.data;
}

export class SettingsService {
  private cache: Settings = { ...SETTING_DEFAULTS };
  private listeners: Array<() => void> = [];

  constructor(private readonly db: Db) {}

  get(): Settings {
    return this.cache;
  }

  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }

  async load(): Promise<void> {
    const rows = await this.db.select().from(appSettings);
    const next: Settings = { ...SETTING_DEFAULTS };
    for (const row of rows) {
      if (!isSettingKey(row.key)) continue;
      const res = settingsShape[row.key].safeParse(row.value);
      if (res.success) (next as unknown as Record<string, unknown>)[row.key] = res.data;
    }
    this.cache = next;
  }

  async set(key: string, raw: string, userId: string): Promise<unknown> {
    const value = parseSettingInput(key, raw);
    await this.db
      .insert(appSettings)
      .values({ key, value, updatedBy: userId })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value, updatedBy: userId, updatedAt: new Date() },
      });
    await this.load();
    this.listeners.forEach((l) => l());
    return value;
  }

  async reset(key: string): Promise<void> {
    if (!isSettingKey(key)) throw new Error(`Unknown setting "${key}"`);
    await this.db.delete(appSettings).where(eq(appSettings.key, key));
    await this.load();
    this.listeners.forEach((l) => l());
  }
}
