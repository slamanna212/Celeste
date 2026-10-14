import { eq } from 'drizzle-orm';
import type { RadioNowPlaying } from '@celeste/shared';
import type { Db } from '../db/client.js';
import { radioSources } from '../db/schema.js';
import type { Logger } from '../logger.js';
import {
  extractNpFromSse,
  matchStationUrl,
  normalizeBaseUrl,
  parseNowPlaying,
  parseStations,
  sseUrl,
  type ParsedStation,
} from './parse.js';

const STATIONS_TTL_MS = 10 * 60_000;
const POLL_MS = 15_000;

export interface RadioStation {
  id: string; // "<sourceId>:<shortcode>"
  sourceId: number;
  shortcode: string;
  name: string;
  listenUrl: string;
  sourceLabel: string;
  baseUrl: string;
}

export class AzuraCastError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'Celeste-Bot' },
    signal: signal ?? AbortSignal.timeout(10_000),
  });
  if (res.status === 401 || res.status === 403) {
    throw new AzuraCastError(`Instance requires authentication (HTTP ${res.status})`, res.status);
  }
  if (!res.ok) throw new AzuraCastError(`HTTP ${res.status}`, res.status);
  return res.json();
}

export class RadioCatalog {
  private cache = new Map<number, { at: number; stations: ParsedStation[] }>();

  constructor(
    private readonly db: Db,
    private readonly log: Logger,
  ) {}

  async sources() {
    return this.db.select().from(radioSources);
  }

  refresh(): void {
    this.cache.clear();
  }

  /** Validates an instance by calling /api/stations (no API keys in v1). */
  async validate(baseUrl: string): Promise<ParsedStation[]> {
    try {
      return parseStations(await getJson(`${baseUrl}/api/stations`));
    } catch (e) {
      if (e instanceof AzuraCastError) throw e;
      throw new AzuraCastError(e instanceof Error ? e.message : 'request failed');
    }
  }

  async add(rawUrl: string, label: string | undefined, userId: string) {
    const baseUrl = normalizeBaseUrl(rawUrl);
    if (!baseUrl) throw new AzuraCastError('Invalid URL (must be http(s))');
    const stations = await this.validate(baseUrl);
    const [row] = await this.db
      .insert(radioSources)
      .values({ baseUrl, label: label?.trim() || new URL(baseUrl).host, addedBy: userId })
      .onConflictDoNothing()
      .returning();
    if (!row) throw new AzuraCastError('That instance is already registered');
    this.cache.set(row.id, { at: Date.now(), stations });
    return { row, stationCount: stations.length };
  }

  async remove(idOrLabelOrUrl: string): Promise<boolean> {
    const rows = await this.sources();
    const needle = idOrLabelOrUrl.trim().toLowerCase();
    const hit = rows.find(
      (r) =>
        String(r.id) === needle ||
        r.label.toLowerCase() === needle ||
        r.baseUrl.toLowerCase() === needle,
    );
    if (!hit) return false;
    await this.db.delete(radioSources).where(eq(radioSources.id, hit.id));
    this.cache.delete(hit.id);
    return true;
  }

  async stations(): Promise<RadioStation[]> {
    const rows = (await this.sources()).filter((r) => r.enabled);
    const out: RadioStation[] = [];
    await Promise.all(
      rows.map(async (src) => {
        let entry = this.cache.get(src.id);
        if (!entry || Date.now() - entry.at > STATIONS_TTL_MS) {
          try {
            entry = {
              at: Date.now(),
              stations: parseStations(await getJson(`${src.baseUrl}/api/stations`)),
            };
            this.cache.set(src.id, entry);
          } catch (e) {
            this.log.warn({ err: e, source: src.id }, 'radio: failed to fetch stations');
            if (!entry) return;
          }
        }
        for (const s of entry.stations) {
          out.push({
            id: `${src.id}:${s.shortcode}`,
            sourceId: src.id,
            shortcode: s.shortcode,
            name: s.name,
            listenUrl: s.listenUrl,
            sourceLabel: src.label,
            baseUrl: src.baseUrl,
          });
        }
      }),
    );
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  private npCache = new Map<
    number,
    { at: number; byShortcode: Map<string, ReturnType<typeof parseNowPlaying>> }
  >();

  /** Now-playing for every public station of every enabled source (one bulk /api/nowplaying call per source, cached 15 s). */
  async nowPlayingByStation(): Promise<Map<string, RadioNowPlaying>> {
    const out = new Map<string, RadioNowPlaying>();
    const stations = await this.stations();
    const sources = new Map(stations.map((s) => [s.sourceId, s.baseUrl]));
    await Promise.all(
      [...sources].map(async ([sourceId, baseUrl]) => {
        let entry = this.npCache.get(sourceId);
        if (!entry || Date.now() - entry.at > POLL_MS) {
          try {
            const json = await getJson(`${baseUrl}/api/nowplaying`);
            const byShortcode = new Map<string, ReturnType<typeof parseNowPlaying>>();
            for (const item of Array.isArray(json) ? json : []) {
              try {
                const code = (item as { station?: { shortcode?: string } }).station?.shortcode;
                if (code) byShortcode.set(code, parseNowPlaying(item));
              } catch {
                /* skip malformed entry */
              }
            }
            entry = { at: Date.now(), byShortcode };
            this.npCache.set(sourceId, entry);
          } catch {
            if (!entry) return;
          }
        }
        for (const st of stations) {
          if (st.sourceId !== sourceId) continue;
          const np = entry.byShortcode.get(st.shortcode);
          if (np)
            out.set(st.id, {
              stationId: st.id,
              stationName: st.name,
              title: np.title,
              artist: np.artist,
              artUrl: np.artUrl,
              listeners: np.listeners,
            });
        }
      }),
    );
    return out;
  }

  async find(stationId: string): Promise<RadioStation | undefined> {
    return (await this.stations()).find((s) => s.id === stationId);
  }

  /** If `url` is an AzuraCast listen/public URL on a known source, resolve its station. */
  async matchUrl(url: string): Promise<RadioStation | undefined> {
    const all = await this.stations();
    for (const st of all) {
      const code = matchStationUrl(url, st.baseUrl);
      if (code && code === st.shortcode) return st;
    }
    return undefined;
  }
}

type Listener = (np: RadioNowPlaying) => void;

interface Feed {
  station: RadioStation;
  listeners: Set<Listener>;
  last: RadioNowPlaying | null;
  abort: AbortController | null;
  pollTimer: NodeJS.Timeout | null;
  stopped: boolean;
}

/**
 * One shared feed per station. Prefers the instance's real-time SSE (Centrifugo)
 * endpoint; falls back to 15 s polling of /api/nowplaying/<shortcode> if SSE fails.
 * Feeds only run while at least one guild/web client is subscribed.
 */
export class RadioNowPlayingHub {
  private feeds = new Map<string, Feed>();

  constructor(private readonly log: Logger) {}

  latest(stationId: string): RadioNowPlaying | null {
    return this.feeds.get(stationId)?.last ?? null;
  }

  subscribe(station: RadioStation, cb: Listener): () => void {
    let feed = this.feeds.get(station.id);
    if (!feed) {
      feed = {
        station,
        listeners: new Set(),
        last: null,
        abort: null,
        pollTimer: null,
        stopped: false,
      };
      this.feeds.set(station.id, feed);
      void this.run(feed);
    }
    feed.listeners.add(cb);
    if (feed.last) cb(feed.last);
    return () => {
      const f = this.feeds.get(station.id);
      if (!f) return;
      f.listeners.delete(cb);
      if (f.listeners.size === 0) this.stop(f);
    };
  }

  /** One-off fetch (used by the station grid in the web panel). */
  async fetchOnce(station: RadioStation): Promise<RadioNowPlaying | null> {
    const cached = this.latest(station.id);
    if (cached) return cached;
    try {
      return this.toDto(
        station,
        parseNowPlaying(await getJson(`${station.baseUrl}/api/nowplaying/${station.shortcode}`)),
      );
    } catch {
      return null;
    }
  }

  stopAll(): void {
    for (const f of this.feeds.values()) this.stop(f);
  }

  private stop(feed: Feed): void {
    feed.stopped = true;
    feed.abort?.abort();
    if (feed.pollTimer) clearTimeout(feed.pollTimer);
    this.feeds.delete(feed.station.id);
  }

  private toDto(station: RadioStation, np: ReturnType<typeof parseNowPlaying>): RadioNowPlaying {
    return {
      stationId: station.id,
      stationName: station.name,
      title: np.title,
      artist: np.artist,
      artUrl: np.artUrl,
      listeners: np.listeners,
    };
  }

  private emit(feed: Feed, rawNp: unknown): void {
    let dto: RadioNowPlaying;
    try {
      dto = this.toDto(feed.station, parseNowPlaying(rawNp));
    } catch {
      return;
    }
    const prev = feed.last;
    feed.last = dto;
    // Listener-count-only changes still propagate (cheap), listeners decide whether to edit embeds.
    if (
      prev &&
      prev.title === dto.title &&
      prev.artist === dto.artist &&
      prev.listeners === dto.listeners
    )
      return;
    for (const l of feed.listeners) {
      try {
        l(dto);
      } catch (e) {
        this.log.warn({ err: e }, 'radio listener failed');
      }
    }
  }

  private async run(feed: Feed): Promise<void> {
    let sseFailures = 0;
    while (!feed.stopped && sseFailures < 3) {
      try {
        await this.runSse(feed);
        sseFailures = 0; // clean close (server recycles connections): reconnect
      } catch (e) {
        sseFailures++;
        this.log.debug({ err: e, station: feed.station.id }, 'radio SSE failed');
      }
      if (!feed.stopped) await new Promise((r) => setTimeout(r, 2000));
    }
    if (!feed.stopped) {
      this.log.info(
        { station: feed.station.id },
        'radio: SSE unavailable, falling back to 15s polling',
      );
      void this.poll(feed);
    }
  }

  private async runSse(feed: Feed): Promise<void> {
    const ac = new AbortController();
    feed.abort = ac;
    const res = await fetch(sseUrl(feed.station.baseUrl, feed.station.shortcode), {
      headers: { accept: 'text/event-stream', 'user-agent': 'Celeste-Bot' },
      signal: ac.signal,
    });
    if (!res.ok || !res.body) throw new Error(`SSE HTTP ${res.status}`);
    const decoder = new TextDecoder();
    let buf = '';
    let gotData = false;
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buf += decoder.decode(chunk, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        try {
          const np = extractNpFromSse(JSON.parse(line.slice(5).trim()));
          if (np) {
            gotData = true;
            this.emit(feed, np);
          }
        } catch {
          /* ping / malformed */
        }
      }
    }
    if (!gotData) throw new Error('SSE closed without data');
  }

  private async poll(feed: Feed): Promise<void> {
    if (feed.stopped) return;
    try {
      this.emit(
        feed,
        await getJson(`${feed.station.baseUrl}/api/nowplaying/${feed.station.shortcode}`),
      );
    } catch (e) {
      this.log.debug({ err: e, station: feed.station.id }, 'radio poll failed');
    }
    if (!feed.stopped) feed.pollTimer = setTimeout(() => void this.poll(feed), POLL_MS);
  }
}
