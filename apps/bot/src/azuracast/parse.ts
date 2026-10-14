import { z } from 'zod';

/** Minimal tolerant schemas for the public AzuraCast API (verified against demo.azuracast.com). */
const mountSchema = z.object({
  url: z.string(),
  is_default: z.boolean().optional(),
  format: z.string().optional(),
});

export const stationSchema = z.object({
  name: z.string(),
  shortcode: z.string(),
  listen_url: z.string().nullish(),
  is_public: z.boolean().optional(),
  mounts: z.array(mountSchema).optional().default([]),
});
export const stationsSchema = z.array(stationSchema);

const songSchema = z.object({
  art: z.string().nullish(),
  text: z.string().optional(),
  artist: z.string().optional().default(''),
  title: z.string().optional().default(''),
});

export const nowPlayingSchema = z.object({
  station: z.object({ name: z.string(), shortcode: z.string() }).partial().optional(),
  listeners: z.object({ current: z.number().optional(), total: z.number().optional() }).optional(),
  is_online: z.boolean().optional(),
  now_playing: z.object({ song: songSchema, duration: z.number().optional() }),
});

export interface ParsedStation {
  name: string;
  shortcode: string;
  listenUrl: string;
}

export interface ParsedNowPlaying {
  title: string;
  artist: string;
  artUrl: string | null;
  listeners: number | null;
}

export function pickListenUrl(s: z.infer<typeof stationSchema>): string | null {
  if (s.listen_url) return s.listen_url;
  const def = s.mounts.find((m) => m.is_default) ?? s.mounts[0];
  return def?.url ?? null;
}

export function parseStations(json: unknown): ParsedStation[] {
  const res = stationsSchema.safeParse(json);
  if (!res.success) throw new Error('Unexpected /api/stations response');
  const out: ParsedStation[] = [];
  for (const s of res.data) {
    if (s.is_public === false) continue;
    const listenUrl = pickListenUrl(s);
    if (listenUrl) out.push({ name: s.name, shortcode: s.shortcode, listenUrl });
  }
  return out;
}

export function parseNowPlaying(json: unknown): ParsedNowPlaying {
  const res = nowPlayingSchema.safeParse(json);
  if (!res.success) throw new Error('Unexpected now playing response');
  const song = res.data.now_playing.song;
  const title = song.title || song.text || 'Unknown';
  return {
    title,
    artist: song.artist || '',
    artUrl: song.art ?? null,
    listeners: res.data.listeners?.current ?? null,
  };
}

/** SSE `data:` payload: `connect` (initial, publications[].data.np) or `pub` (data.np). Returns the np object or null (pings etc). */
export function extractNpFromSse(payload: unknown): unknown | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const pub = p.pub?.data?.np;
  if (pub) return pub;
  const subs = p.connect?.subs;
  if (subs && typeof subs === 'object') {
    for (const sub of Object.values(subs as Record<string, { publications?: unknown }>)) {
      const pubs = sub?.publications;
      if (Array.isArray(pubs) && pubs.length > 0) {
        const np = pubs[pubs.length - 1]?.data?.np;
        if (np) return np;
      }
    }
  }
  const legacy = p.connect?.data?.[0]?.data?.np;
  return legacy ?? null;
}

export function sseUrl(baseUrl: string, shortcode: string): string {
  const cf = JSON.stringify({ subs: { [`station:${shortcode}`]: { recover: true } } });
  return `${baseUrl.replace(/\/+$/, '')}/api/live/nowplaying/sse?cf_connect=${encodeURIComponent(cf)}`;
}

/** Normalizes admin-entered base URL: http(s) only, no trailing slash, no path/query. */
export function normalizeBaseUrl(input: string): string | null {
  try {
    const u = new URL(input.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/** Matches /listen/<shortcode>/... or /public/<shortcode> URLs on a given base. */
export function matchStationUrl(url: string, baseUrl: string): string | null {
  try {
    const u = new URL(url);
    const b = new URL(baseUrl);
    if (u.host !== b.host) return null;
    const m = /^\/(?:listen|public|hls)\/([A-Za-z0-9_.-]+)/.exec(u.pathname);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}
