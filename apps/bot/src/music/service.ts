import { EventEmitter } from 'node:events';
import {
  FILTER_DEFINITIONS,
  type FilterPreset,
  type LoopMode,
  type PlayerStateDTO,
  type QueueDTO,
  type RadioNowPlaying,
  type SearchResultDTO,
  type SearchSource,
} from '@celeste/shared';
import type { Client } from 'discord.js';
import { eq } from 'drizzle-orm';
import type { LavalinkManager, Player, SearchPlatform, Track } from 'lavalink-client';
import type { AccessService } from '../access.js';
import {
  type RadioCatalog,
  type RadioNowPlayingHub,
  type RadioStation,
} from '../azuracast/service.js';
import type { Db } from '../db/client.js';
import { guildSettings, playerState } from '../db/schema.js';
import type { Logger } from '../logger.js';
import {
  canInstantSkip,
  canUseDestructive,
  castVote,
  countListeners,
  type ActorContext,
  type VoteState,
} from '../permissions.js';
import type { SettingsService } from '../settings.js';
import { moveItem, removeAt } from '../util/queueOps.js';
import type { SessionManager } from '../web/sessions.js';
import {
  itemId,
  requesterOf,
  sourceOf,
  stampTrack,
  toQueueItem,
  toTrackInfo,
  type AnyTrack,
  type Requester,
} from './track.js';

/** Error whose message is safe and meant to be shown to the user. */
export class UserError extends Error {}

export interface Actor {
  id: string;
  name: string | null;
  /** Web panel actor: full playback control. */
  web: boolean;
  hasDjRole?: boolean;
  hasManageGuild?: boolean;
}

export interface GuildRuntime {
  votes: VoteState;
  failure: { source: string; count: number } | null;
  idleTimer: NodeJS.Timeout | null;
  np: { channelId: string; messageId: string } | null;
  radioUnsub: (() => void) | null;
  radio: RadioNowPlaying | null;
  radioStation: RadioStation | null;
  lastPersist: number;
  startedBy: string;
}

export interface MusicEvents {
  player: [guildId: string];
  queue: [guildId: string];
  radio: [guildId: string, np: RadioNowPlaying];
}

export interface PlayResult {
  added: number;
  first: AnyTrack;
  playlistName: string | null;
  position: number; // 1-based position of first added track in the queue; 0 = now playing
  truncated: boolean;
}

export interface MusicDeps {
  client: Client;
  manager: LavalinkManager;
  db: Db;
  settings: SettingsService;
  access: AccessService;
  sessions: SessionManager;
  catalog: RadioCatalog;
  hub: RadioNowPlayingHub;
  log: Logger;
}

const SEARCH_PLATFORM: Record<SearchSource, SearchPlatform> = {
  youtube: 'ytsearch',
  soundcloud: 'scsearch',
  spotify: 'spsearch',
  applemusic: 'amsearch',
};

/** Split an optional `sc:` / `sp:` / `am:` / `yt:` prefix off a /play query. */
export function parseQueryPrefix(query: string): { source: SearchSource; query: string } {
  const m = /^(sc|sp|am|yt):\s*(.+)$/is.exec(query.trim());
  if (!m) return { source: 'youtube', query: query.trim() };
  const map = { sc: 'soundcloud', sp: 'spotify', am: 'applemusic', yt: 'youtube' } as const;
  return { source: map[m[1]!.toLowerCase() as keyof typeof map], query: m[2]!.trim() };
}

export class MusicService extends EventEmitter<MusicEvents> {
  readonly runtimes = new Map<string, GuildRuntime>();

  constructor(readonly deps: MusicDeps) {
    super();
  }

  private get manager(): LavalinkManager {
    return this.deps.manager;
  }

  runtime(guildId: string): GuildRuntime {
    let r = this.runtimes.get(guildId);
    if (!r) {
      r = {
        votes: { trackKey: null, voters: new Set() },
        failure: null,
        idleTimer: null,
        np: null,
        radioUnsub: null,
        radio: null,
        radioStation: null,
        lastPersist: 0,
        startedBy: 'unknown',
      };
      this.runtimes.set(guildId, r);
    }
    return r;
  }

  getPlayer(guildId: string): Player | undefined {
    return this.manager.getPlayer(guildId);
  }

  requirePlayer(guildId: string): Player {
    const p = this.getPlayer(guildId);
    if (!p) throw new UserError('Nothing is playing right now.');
    return p;
  }

  // ---- voice channel helpers ----
  humansInChannel(guildId: string): { id: string; deafened: boolean }[] {
    const p = this.getPlayer(guildId);
    if (!p?.voiceChannelId) return [];
    const ch = this.deps.client.guilds.cache.get(guildId)?.channels.cache.get(p.voiceChannelId);
    if (!ch || !ch.isVoiceBased()) return [];
    return [...ch.members.values()]
      .filter((m) => !m.user.bot)
      .map((m) => ({ id: m.id, deafened: !!(m.voice.deaf || m.voice.selfDeaf) }));
  }

  private ctx(guildId: string, actor: Actor, track?: AnyTrack | null): ActorContext {
    const humans = this.humansInChannel(guildId);
    return {
      isWeb: actor.web,
      isRequester: !!track && requesterOf(track).id === actor.id,
      hasDjRole: actor.hasDjRole,
      hasManageGuild: actor.hasManageGuild,
      aloneWithBot: humans.length === 1 && humans[0]?.id === actor.id,
    };
  }

  async getGuildSettings(guildId: string) {
    const [row] = await this.deps.db
      .select()
      .from(guildSettings)
      .where(eq(guildSettings.guildId, guildId));
    return row;
  }

  async patchGuildSettings(
    guildId: string,
    patch: Partial<typeof guildSettings.$inferInsert>,
  ): Promise<void> {
    await this.deps.db
      .insert(guildSettings)
      .values({ guildId, ...patch })
      .onConflictDoUpdate({ target: guildSettings.guildId, set: patch });
  }

  private async assertDestructive(guildId: string, actor: Actor): Promise<void> {
    const gs = await this.getGuildSettings(guildId);
    const ok = canUseDestructive({ ...this.ctx(guildId, actor), djRoleConfigured: !!gs?.djRoleId });
    if (!ok) throw new UserError('You need the DJ role or Manage Server permission to do that.');
  }

  // ---- player lifecycle ----
  async ensurePlayer(
    guildId: string,
    voiceChannelId: string,
    textChannelId: string | null,
    starter: Actor,
  ): Promise<Player> {
    let player = this.getPlayer(guildId);
    if (player) {
      if (player.voiceChannelId && player.voiceChannelId !== voiceChannelId) {
        throw new UserError(
          `I'm already playing in <#${player.voiceChannelId}>. Join that channel first.`,
        );
      }
      if (textChannelId) player.textChannelId = textChannelId;
      return player;
    }
    const gs = await this.getGuildSettings(guildId);
    const volume = gs?.volume ?? this.deps.settings.get().default_volume;
    player = this.manager.createPlayer({
      guildId,
      voiceChannelId,
      textChannelId: textChannelId ?? undefined,
      selfDeaf: true,
      volume,
    });
    await player.connect();
    this.runtime(guildId).startedBy = starter.id;
    await this.deps.sessions.start(guildId, voiceChannelId, starter.id);
    await this.patchGuildSettings(guildId, {
      lastVoiceChannelId: voiceChannelId,
      ...(textChannelId ? { lastTextChannelId: textChannelId } : {}),
    });
    const preset = gs?.defaultFilter as FilterPreset | undefined;
    if (preset && preset !== 'off' && preset in FILTER_DEFINITIONS) {
      player.setData('filter', preset);
      void this.applyFilterRaw(player, preset).catch(() => undefined);
    }
    return player;
  }

  async destroyPlayer(guildId: string, reason: string): Promise<void> {
    const p = this.getPlayer(guildId);
    if (p) await p.destroy(reason);
    else await this.cleanupGuild(guildId, reason);
  }

  /** Called from playerDestroy: tear down all per-guild state and end the web session. */
  async cleanupGuild(guildId: string, reason: string): Promise<void> {
    const r = this.runtimes.get(guildId);
    if (r) {
      if (r.idleTimer) clearTimeout(r.idleTimer);
      r.radioUnsub?.();
    }
    this.runtimes.delete(guildId);
    await this.deps.db
      .delete(playerState)
      .where(eq(playerState.guildId, guildId))
      .catch(() => undefined);
    await this.deps.sessions.end(guildId, reason);
    this.emit('player', guildId);
  }

  // ---- resolving & enqueueing ----
  async resolve(
    player: Player,
    rawQuery: string,
    requester: Requester,
    forcedSource?: SearchSource,
  ): Promise<{ tracks: AnyTrack[]; playlistName: string | null }> {
    const parsed = parseQueryPrefix(rawQuery);
    const source = forcedSource ?? parsed.source;
    const isUrl = /^https?:\/\//i.test(parsed.query);
    const res = await player.search(
      isUrl ? { query: parsed.query } : { query: parsed.query, source: SEARCH_PLATFORM[source] },
      requester,
    );
    if (res.loadType === 'error') {
      throw new UserError(`Could not load that: ${res.exception?.message ?? 'unknown error'}`);
    }
    const tracks = res.tracks as Track[];
    if (res.loadType === 'empty' || tracks.length === 0) throw new UserError('No results found.');
    if (res.loadType === 'playlist')
      return { tracks, playlistName: res.playlist?.name ?? 'playlist' };
    return { tracks: [tracks[0]!], playlistName: null };
  }

  async play(
    guildId: string,
    actor: Actor,
    query: string,
    opts: { next?: boolean; voiceChannelId: string; textChannelId: string | null },
  ): Promise<PlayResult | { radio: RadioStation }> {
    const q = query.trim();
    // AzuraCast listen / public URL on a known source is treated as /radio.
    if (/^https?:\/\//i.test(q)) {
      const station = await this.deps.catalog.matchUrl(q);
      if (station) {
        await this.playRadio(guildId, actor, station, opts);
        return { radio: station };
      }
    }
    const player = await this.ensurePlayer(guildId, opts.voiceChannelId, opts.textChannelId, actor);
    const requester: Requester = { id: actor.id, name: actor.name };
    const { tracks, playlistName } = await this.resolve(player, q, requester);
    return this.enqueue(player, tracks, requester, playlistName, !!opts.next);
  }

  private async enqueue(
    player: Player,
    tracks: AnyTrack[],
    requester: Requester,
    playlistName: string | null,
    next: boolean,
  ): Promise<PlayResult> {
    const max = this.deps.settings.get().max_queue_length;
    const room = Math.max(0, max - player.queue.tracks.length);
    if (room === 0) throw new UserError(`The queue is full (${max} tracks).`);
    const truncated = tracks.length > room;
    const toAdd = tracks.slice(0, room).map((t) => stampTrack(t, requester));
    const idle = !player.queue.current;
    if (next) await player.queue.add(toAdd, 0);
    else await player.queue.add(toAdd);
    const position = idle ? 0 : next ? 1 : player.queue.tracks.length - toAdd.length + 1;
    this.emit('queue', player.guildId);
    if (idle) {
      await player.play({ volume: player.volume });
    }
    this.emit('player', player.guildId);
    return { added: toAdd.length, first: toAdd[0]!, playlistName, position, truncated };
  }

  async playRadio(
    guildId: string,
    actor: Actor,
    station: RadioStation,
    opts: { voiceChannelId: string; textChannelId: string | null },
  ): Promise<PlayResult> {
    const player = await this.ensurePlayer(guildId, opts.voiceChannelId, opts.textChannelId, actor);
    const requester: Requester = { id: actor.id, name: actor.name };
    const res = await player.search({ query: station.listenUrl }, requester);
    const track = res.tracks[0] as Track | undefined;
    if (!track) throw new UserError(`Could not load ${station.name}'s stream.`);
    track.info.isStream = true;
    track.info.title = station.name;
    track.info.author = station.sourceLabel;
    track.userData = { ...(track.userData ?? {}), radioStationId: station.id };
    return this.enqueue(player, [track], requester, null, false);
  }

  async search(
    guildId: string | null,
    q: string,
    source: SearchSource,
    requester: Requester,
  ): Promise<SearchResultDTO[]> {
    const player = guildId ? this.getPlayer(guildId) : undefined;
    const node = player?.node ?? this.manager.nodeManager.leastUsedNodes()[0];
    if (!node) throw new UserError('Music backend is unavailable.');
    const res = await node.search({ query: q, source: SEARCH_PLATFORM[source] }, requester);
    return (res.tracks as Track[]).slice(0, 10).map((t) => {
      const info = toTrackInfo(t);
      return {
        title: info.title,
        author: info.author,
        uri: info.uri ?? '',
        durationMs: info.durationMs,
        artworkUrl: info.artworkUrl,
        source: info.source,
        isStream: info.isStream,
      };
    });
  }

  // ---- controls ----
  async pause(guildId: string): Promise<void> {
    const p = this.requirePlayer(guildId);
    if (!p.queue.current) throw new UserError('Nothing is playing.');
    if (p.paused) throw new UserError('Already paused.');
    await p.pause();
    this.emit('player', guildId);
  }
  async resume(guildId: string): Promise<void> {
    const p = this.requirePlayer(guildId);
    if (!p.paused) throw new UserError('Not paused.');
    await p.resume();
    this.emit('player', guildId);
  }

  /** /skip: instant for requester/DJ/Manage Guild/alone/web, otherwise a vote. */
  async skip(
    guildId: string,
    actor: Actor,
  ): Promise<{ skipped: boolean; votes?: number; needed?: number; title: string }> {
    const p = this.requirePlayer(guildId);
    const cur = p.queue.current;
    if (!cur) throw new UserError('Nothing is playing.');
    if (canInstantSkip(this.ctx(guildId, actor, cur))) {
      await this.doSkip(p);
      return { skipped: true, title: cur.info.title };
    }
    return this.voteSkip(guildId, actor);
  }

  async voteSkip(
    guildId: string,
    actor: Actor,
  ): Promise<{ skipped: boolean; votes: number; needed: number; title: string }> {
    const p = this.requirePlayer(guildId);
    const cur = p.queue.current;
    if (!cur) throw new UserError('Nothing is playing.');
    const humans = this.humansInChannel(guildId);
    if (!actor.web && !humans.some((h) => h.id === actor.id))
      throw new UserError('Join my voice channel to vote.');
    const rt = this.runtime(guildId);
    const listeners = countListeners(humans.map((h) => ({ bot: false, deafened: h.deafened })));
    const key = itemId(cur) || cur.info.identifier;
    const r = castVote(rt.votes, key, actor.id, listeners);
    rt.votes = r.state;
    if (r.passed) {
      await this.doSkip(p);
      return { skipped: true, votes: r.votes, needed: r.needed, title: cur.info.title };
    }
    return { skipped: false, votes: r.votes, needed: r.needed, title: cur.info.title };
  }

  private async doSkip(p: Player): Promise<void> {
    await p.skip(0, false);
    this.emit('player', p.guildId);
  }

  async stop(guildId: string, actor: Actor): Promise<void> {
    this.requirePlayer(guildId);
    await this.assertDestructive(guildId, actor);
    await this.destroyPlayer(guildId, 'stop');
  }

  async seek(guildId: string, ms: number): Promise<void> {
    const p = this.requirePlayer(guildId);
    const cur = p.queue.current;
    if (!cur) throw new UserError('Nothing is playing.');
    if (cur.info.isStream || !cur.info.isSeekable)
      throw new UserError('This track cannot be seeked.');
    if (ms < 0 || ms >= cur.info.duration)
      throw new UserError('That position is outside the track.');
    await p.seek(ms);
    this.emit('player', guildId);
  }

  async setVolume(guildId: string, actor: Actor, value: number): Promise<void> {
    const p = this.requirePlayer(guildId);
    await this.assertDestructive(guildId, actor);
    await p.setVolume(value);
    await this.patchGuildSettings(guildId, { volume: value });
    this.emit('player', guildId);
  }

  private async applyFilterRaw(p: Player, preset: FilterPreset): Promise<void> {
    const def = FILTER_DEFINITIONS[preset];
    // Lavalink replaces the whole filters object on update, so presets never stack.
    await p.node.updatePlayer({
      guildId: p.guildId,
      playerOptions: { filters: def.filters as never },
    });
  }

  async setFilter(guildId: string, actor: Actor, preset: FilterPreset): Promise<void> {
    const p = this.requirePlayer(guildId);
    await this.assertDestructive(guildId, actor);
    await this.applyFilterRaw(p, preset);
    p.setData('filter', preset);
    await this.patchGuildSettings(guildId, { defaultFilter: preset });
    this.emit('player', guildId);
  }

  async setLoop(guildId: string, mode: LoopMode): Promise<void> {
    const p = this.requirePlayer(guildId);
    await p.setRepeatMode(mode);
    this.emit('player', guildId);
  }

  async cycleLoop(guildId: string): Promise<LoopMode> {
    const p = this.requirePlayer(guildId);
    const next: LoopMode =
      p.repeatMode === 'off' ? 'track' : p.repeatMode === 'track' ? 'queue' : 'off';
    await p.setRepeatMode(next);
    this.emit('player', guildId);
    return next;
  }

  async shuffle(guildId: string): Promise<void> {
    const p = this.requirePlayer(guildId);
    if (p.queue.tracks.length < 2) throw new UserError('Not enough tracks to shuffle.');
    await p.queue.shuffle();
    this.emit('queue', guildId);
  }

  async remove(guildId: string, actor: Actor, pos: number): Promise<AnyTrack> {
    const p = this.requirePlayer(guildId);
    await this.assertDestructive(guildId, actor);
    const res = removeAt(p.queue.tracks, pos);
    if (!res) throw new UserError(`Position must be between 1 and ${p.queue.tracks.length}.`);
    p.queue.tracks.splice(0, p.queue.tracks.length, ...res.items);
    await p.queue.utils.save();
    this.emit('queue', guildId);
    return res.removed;
  }

  async removeById(guildId: string, actor: Actor, id: string): Promise<AnyTrack> {
    const p = this.requirePlayer(guildId);
    const idx = p.queue.tracks.findIndex((t) => itemId(t) === id);
    if (idx < 0) throw new UserError('That queue item no longer exists.');
    return this.remove(guildId, actor, idx + 1);
  }

  async move(guildId: string, actor: Actor, from: number, to: number): Promise<AnyTrack> {
    const p = this.requirePlayer(guildId);
    await this.assertDestructive(guildId, actor);
    const moved = moveItem(p.queue.tracks, from, to);
    if (!moved) throw new UserError(`Positions must be between 1 and ${p.queue.tracks.length}.`);
    const track = p.queue.tracks[from - 1]!;
    p.queue.tracks.splice(0, p.queue.tracks.length, ...moved);
    await p.queue.utils.save();
    this.emit('queue', guildId);
    return track;
  }

  async clear(guildId: string, actor: Actor): Promise<number> {
    const p = this.requirePlayer(guildId);
    await this.assertDestructive(guildId, actor);
    const n = p.queue.tracks.length;
    p.queue.tracks.splice(0, n);
    await p.queue.utils.save();
    this.emit('queue', guildId);
    return n;
  }

  // ---- snapshots (shared by embeds and the web API) ----
  positionOf(p: Player): number {
    const raw = p.paused ? p.lastPosition : p.position;
    const dur = p.queue.current?.info.duration ?? 0;
    const pos = Math.max(0, Math.round(raw));
    return p.queue.current?.info.isStream || dur <= 0 ? pos : Math.min(pos, dur);
  }

  snapshot(guildId: string): PlayerStateDTO {
    const p = this.getPlayer(guildId);
    const rt = this.runtimes.get(guildId);
    const guild = this.deps.client.guilds.cache.get(guildId);
    const vcId = p?.voiceChannelId ?? null;
    const vc = vcId ? guild?.channels.cache.get(vcId) : undefined;
    const cur = p?.queue.current ?? null;
    return {
      guildId,
      connected: !!p?.connected,
      voiceChannel: vcId ? { id: vcId, name: vc?.name ?? 'voice' } : null,
      current: cur ? toQueueItem(cur, 0) : null,
      positionMs: p ? this.positionOf(p) : 0,
      positionAt: new Date().toISOString(),
      paused: !!p?.paused,
      volume: p?.volume ?? this.deps.settings.get().default_volume,
      filter: (p?.getData('filter') as FilterPreset | undefined) ?? 'off',
      loop: (p?.repeatMode as LoopMode | undefined) ?? 'off',
      radio: rt?.radio ?? null,
    };
  }

  queueDto(guildId: string): QueueDTO {
    const p = this.getPlayer(guildId);
    const tracks = p?.queue.tracks ?? [];
    return {
      items: tracks.map((t, i) => toQueueItem(t, i + 1)),
      total: tracks.length,
      totalDurationMs: tracks.reduce(
        (s, t) => s + (t.info.isStream ? 0 : (t.info.duration ?? 0)),
        0,
      ),
    };
  }

  sourceName(track: AnyTrack | null | undefined): string {
    return sourceOf(track);
  }
}
