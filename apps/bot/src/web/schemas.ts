import { z } from 'zod';
import {
  FILTER_PRESETS,
  LOOP_MODES,
  SEARCH_SOURCES,
  VOLUME_MAX,
  VOLUME_MIN,
} from '@celeste/shared';

const enumOf = <T extends readonly [string, ...string[]]>(v: T) => z.enum(v);

export const playBody = z.object({ query: z.string().trim().min(1).max(500) }).strict();
export const controlBody = z
  .object({
    action: z.enum(['pause', 'resume', 'skip', 'voteskip', 'stop', 'shuffle', 'loop']),
    value: enumOf(LOOP_MODES).optional(),
  })
  .strict()
  .refine((b) => b.action !== 'loop' || b.value !== undefined, {
    message: 'loop requires value',
    path: ['value'],
  });
export const seekBody = z.object({ ms: z.number().int().min(0).max(86_400_000) }).strict();
export const volumeBody = z
  .object({ value: z.number().int().min(VOLUME_MIN).max(VOLUME_MAX) })
  .strict();
export const filterBody = z.object({ preset: enumOf(FILTER_PRESETS) }).strict();
export const moveBody = z
  .object({ from: z.number().int().min(1), to: z.number().int().min(1) })
  .strict();
export const radioBody = z
  .object({ stationId: z.string().regex(/^\d+:[A-Za-z0-9_.-]{1,100}$/) })
  .strict();
export const searchQuery = z.object({
  q: z.string().trim().min(1).max(200),
  source: enumOf(SEARCH_SOURCES).default('youtube'),
});
export const historyQuery = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
export const queueIdParam = z.object({ id: z.string().min(1).max(64) });
