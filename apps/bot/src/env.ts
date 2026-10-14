import { z } from 'zod';

export const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  LAVALINK_HOST: z.string().min(1),
  LAVALINK_PORT: z.coerce.number().int().positive().default(2333),
  LAVALINK_PASSWORD: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  WEB_SESSION_SECRET: z.string().min(16, 'WEB_SESSION_SECRET must be at least 16 characters'),
  WEB_PORT: z.coerce.number().int().positive().default(8080),
  METRICS_PORT: z.coerce.number().int().positive().default(9090),
  YOUTUBE_BACKEND: z.enum(['ytdlp', 'plugin']).default('ytdlp'),
  RESOLVER_URL: z.string().url().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /** Directory holding the built web SPA. Default: ../web/dist relative to the bot package. */
  WEB_STATIC_DIR: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${msg}`);
  }
  return parsed.data;
}
