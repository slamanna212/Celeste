import type { Client } from 'discord.js';
import { lt } from 'drizzle-orm';
import type { Player, Track } from 'lavalink-client';
import type { Db } from '../db/client.js';
import { playHistory, playerState } from '../db/schema.js';
import { activePlayers, queueSize, trackFailures } from '../metrics.js';
import type { NowPlayingManager } from './nowplaying.js';
import type { MusicService } from './service.js';
import { itemId, requesterOf, sourceOf, toTrackInfo } from './track.js';

export const FAILURE_LIMIT = 3;
const PERSIST_INTERVAL_MS = 5000;

/** Pure: next consecutive-failure state. */
export function nextFailureState(
  prev: { source: string; count: number } | null,
  source: string,
): { source: string; count: number } {
  return prev && prev.source === source ? { source, count: prev.count + 1 } : { source, count: 1 };
}

export class Lifecycle {
  constructor(
    private readonly music: MusicService,
    private readonly np: NowPlayingManager,
    private readonly client: Client,
    private readonly db: Db,
  ) {}

  private get log() {
    return this.music.deps.log;
  }

  async notify(guildId: string, text: string): Promise<void> {
    const p = this.music.getPlayer(guildId);
    const gs = await this.music.getGuildSettings(guildId);
    const id = p?.textChannelId ?? gs?.lastTextChannelId;
    if (!id) return;
    const ch = await this.client.channels.fetch(id).catch(() => null);
    if (ch?.isSendable())
      await ch.send({ content: text, allowedMentions: { parse: [] } }).catch(() => undefined);
  }

  /** (Re)evaluate whether the guild's player is idle and arm/disarm the disconnect timer. */
  checkIdle(guildId: string): void {
    const p = this.music.getPlayer(guildId);
    const rt = this.music.runtimes.get(guildId);
    if (!p || !rt) return;
    const empty = !p.queue.current && p.queue.tracks.length === 0;
    const alone = this.music.humansInChannel(guildId).length === 0;
    if (!empty && !alone) {
      if (rt.idleTimer) clearTimeout(rt.idleTimer);
      rt.idleTimer = null;
      return;
    }
    if (rt.idleTimer) return; // already armed
    const ms = this.music.deps.settings.get().idle_disconnect_seconds * 1000;
    rt.idleTimer = setTimeout(() => {
      rt.idleTimer = null;
      const pl = this.music.getPlayer(guildId);
      if (!pl) return;
      const stillEmpty = !pl.queue.current && pl.queue.tracks.length === 0;
      const stillAlone = this.music.humansInChannel(guildId).length === 0;
      if (stillEmpty || stillAlone) {
        this.log.info({ guildId, stillEmpty, stillAlone }, 'idle disconnect');
        void this.music.destroyPlayer(guildId, 'idle');
      }
    }, ms);
    rt.idleTimer.unref();
  }

  async persistState(p: Player, force = false): Promise<void> {
    const rt = this.music.runtime(p.guildId);
    const now = Date.now();
    if (!force && now - rt.lastPersist < PERSIST_INTERVAL_MS) return;
    rt.lastPersist = now;
    const cur = p.queue.current;
    const values = {
      guildId: p.guildId,
      currentItemId: cur ? itemId(cur) : null,
      positionMs: this.music.positionOf(p),
      paused: p.paused,
      loopMode: p.repeatMode,
      filter: (p.getData('filter') as string | undefined) ?? 'off',
      updatedAt: new Date(),
    };
    await this.db
      .insert(playerState)
      .values(values)
      .onConflictDoUpdate({ target: playerState.guildId, set: values })
      .catch((e) => this.log.warn({ err: e }, 'player_state write failed'));
  }

  private clearRadio(guildId: string): void {
    const rt = this.music.runtimes.get(guildId);
    if (!rt) return;
    rt.radioUnsub?.();
    rt.radioUnsub = null;
    rt.radio = null;
    rt.radioStation = null;
  }

  private async subscribeRadio(guildId: string, stationId: string): Promise<void> {
    this.clearRadio(guildId);
    const station = await this.music.deps.catalog.find(stationId);
    if (!station) return;
    const rt = this.music.runtime(guildId);
    rt.radioStation = station;
    rt.radioUnsub = this.music.deps.hub.subscribe(station, (np) => {
      rt.radio = np;
      this.music.emit('radio', guildId, np);
      this.music.emit('player', guildId);
      void this.np.refresh(guildId);
    });
  }

  private async onFailure(
    player: Player,
    track: Track | null,
    kind: 'exception' | 'stuck',
    detail: string,
  ): Promise<void> {
    const guildId = player.guildId;
    const rt = this.music.runtime(guildId);
    const source = sourceOf(track);
    trackFailures.inc({ source, kind });
    rt.failure = nextFailureState(rt.failure, source);
    const title = track?.info.title ?? 'track';
    this.log.warn({ guildId, source, kind, detail, title }, 'track failure');
    if (rt.failure.count >= FAILURE_LIMIT) {
      const n = rt.failure.count;
      rt.failure = null;
      await player.stopPlaying(true, false).catch(() => undefined);
      await this.notify(
        guildId,
        `Source problem: ${n} tracks in a row failed to play from **${source}**. Playback stopped. ` +
          `If this is YouTube, the extraction backend may be broken (check the resolver / switch backend).`,
      );
      return;
    }
    await this.notify(guildId, `Skipping **${title}**: playback failed (${source}).`);
  }

  wire(): void {
    const m = this.music.deps.manager;
    m.on('trackStart', (player, track) => {
      const rt = this.music.runtime(player.guildId);
      rt.votes = { trackKey: null, voters: new Set() };
      if (rt.idleTimer) clearTimeout(rt.idleTimer);
      rt.idleTimer = null;
      if (track) {
        const r = requesterOf(track);
        void this.db
          .insert(playHistory)
          .values({
            guildId: player.guildId,
            track: toTrackInfo(track),
            requesterId: r.id,
            requesterName: r.name,
          })
          .catch((e) => this.log.warn({ err: e }, 'history write failed'));
        const stationId = track.userData?.radioStationId;
        if (typeof stationId === 'string') void this.subscribeRadio(player.guildId, stationId);
        else this.clearRadio(player.guildId);
      }
      void this.np.post(player.guildId);
      void this.persistState(player, true);
      this.music.emit('player', player.guildId);
      this.music.emit('queue', player.guildId);
    });

    m.on('trackEnd', (player, _track, payload) => {
      if (payload.reason === 'finished') this.music.runtime(player.guildId).failure = null;
      this.music.emit('queue', player.guildId);
    });

    m.on('queueEnd', (player, _track, payload) => {
      if (
        payload.type === 'TrackEndEvent' &&
        (payload as { reason?: string }).reason === 'finished'
      ) {
        this.music.runtime(player.guildId).failure = null;
      }
      this.clearRadio(player.guildId);
      void this.persistState(player, true);
      this.checkIdle(player.guildId);
      this.music.emit('player', player.guildId);
      this.music.emit('queue', player.guildId);
    });

    m.on('trackError', (player, track, payload) => {
      void this.onFailure(
        player,
        (track as Track | null) ?? null,
        'exception',
        payload.exception?.message ?? 'unknown',
      );
    });
    m.on('trackStuck', (player, track, payload) => {
      void this.onFailure(player, track, 'stuck', `stuck ${payload.thresholdMs}ms`);
    });

    m.on('playerUpdate', (_old, player) => {
      void this.persistState(player);
      this.music.emit('player', player.guildId);
    });

    m.on('playerMove', (player, _old, next) => {
      void this.music.patchGuildSettings(player.guildId, { lastVoiceChannelId: next });
      this.music.emit('player', player.guildId);
    });

    m.on('playerDestroy', (player, reason) => {
      const guildId = player.guildId;
      void this.np.detach(guildId).finally(() => {
        void this.music.cleanupGuild(guildId, String(reason ?? 'destroyed'));
      });
      activePlayers.set(m.players.size);
    });
    m.on('playerCreate', () => activePlayers.set(m.players.size));

    this.client.on('voiceStateUpdate', (oldS, newS) => {
      const guildId = newS.guild.id;
      if (!this.music.getPlayer(guildId)) return;
      if (oldS.channelId !== newS.channelId || oldS.selfDeaf !== newS.selfDeaf) {
        this.checkIdle(guildId);
        this.music.emit('player', guildId);
      }
    });

    setInterval(() => {
      for (const [gid, p] of m.players) queueSize.set({ guild: gid }, p.queue.tracks.length);
    }, 15_000).unref();
  }

  startRetentionJob(): void {
    const run = async () => {
      const days = this.music.deps.settings.get().history_retention_days;
      const cutoff = new Date(Date.now() - days * 86_400_000);
      try {
        await this.db.delete(playHistory).where(lt(playHistory.startedAt, cutoff));
        this.log.info({ days }, 'history retention cleanup done');
      } catch (e) {
        this.log.error({ err: e }, 'history retention cleanup failed');
      }
    };
    void run();
    setInterval(() => void run(), 24 * 60 * 60_000).unref();
  }
}
