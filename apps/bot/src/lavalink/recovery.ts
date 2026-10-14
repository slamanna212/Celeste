import { FILTER_DEFINITIONS, type FilterPreset, type LoopMode } from '@celeste/shared';
import { eq } from 'drizzle-orm';
import type { LavalinkNode, LavalinkPlayer, Player } from 'lavalink-client';
import { guildSettings, playerState } from '../db/schema.js';
import type { Lifecycle } from '../music/events.js';
import type { MusicService } from '../music/service.js';
import { RESUME_TIMEOUT_SECONDS, saveSessionId } from './manager.js';
import type { PgQueueStore } from './store.js';

/** Handles Lavalink session persistence, bot-restart resume, and Lavalink-restart recovery. */
export class Recovery {
  constructor(
    private readonly music: MusicService,
    private readonly store: PgQueueStore,
    private readonly lifecycle: Lifecycle,
  ) {}

  private get log() {
    return this.music.deps.log;
  }

  wire(): void {
    const nm = this.music.deps.manager.nodeManager;
    nm.on('connect', (node) => this.log.info({ node: node.id }, 'lavalink node connected'));
    nm.on('disconnect', (node, reason) =>
      this.log.warn({ node: node.id, reason }, 'lavalink node disconnected'),
    );
    nm.on('error', (node, err) => this.log.error({ node: node.id, err }, 'lavalink node error'));
    nm.on('raw', (node, payload) => {
      const p = payload as { op?: string; resumed?: boolean; sessionId?: string };
      if (p.op !== 'ready' || !p.sessionId) return;
      const sessionId = p.sessionId;
      // The client library assigns node.sessionId right after this event; defer.
      setTimeout(() => {
        void this.onReady(node, sessionId, !!p.resumed);
      }, 0);
    });
    nm.on('resumed', (node, _payload, players) => {
      void this.restoreResumed(node, Array.isArray(players) ? players : []);
    });
  }

  private async onReady(node: LavalinkNode, sessionId: string, resumed: boolean): Promise<void> {
    try {
      await saveSessionId(this.music.deps.db, sessionId);
      await node.updateSession(true, RESUME_TIMEOUT_SECONDS);
      this.log.info(
        { resumed, sessionId: `${sessionId.slice(0, 4)}...` },
        'lavalink session ready; resuming enabled',
      );
      if (!resumed) await this.recoverAll();
    } catch (e) {
      this.log.error({ err: e }, 'lavalink ready handling failed');
    }
  }

  /** Lavalink restarted (or the resume window elapsed): rebuild every guild that has a queue. */
  async recoverAll(): Promise<void> {
    const ids = await this.store.guildIds();
    for (const guildId of ids) {
      try {
        await this.recoverGuild(guildId);
      } catch (e) {
        this.log.error({ err: e, guildId }, 'failed to recover guild');
      }
    }
    await this.reattachSessions();
  }

  private async recoverGuild(guildId: string): Promise<void> {
    const guild = this.music.deps.client.guilds.cache.get(guildId);
    const stored = await this.store.get(guildId);
    const [gs] = await this.music.deps.db
      .select()
      .from(guildSettings)
      .where(eq(guildSettings.guildId, guildId));
    const [st] = await this.music.deps.db
      .select()
      .from(playerState)
      .where(eq(playerState.guildId, guildId));
    const hasWork = !!stored?.current || (stored?.tracks?.length ?? 0) > 0;
    if (
      !guild ||
      !this.music.deps.access.isGuildAllowed(guildId) ||
      !gs?.lastVoiceChannelId ||
      !hasWork
    ) {
      if (!hasWork) await this.store.delete(guildId);
      return;
    }
    let player = this.music.getPlayer(guildId);
    const existed = !!player;
    const position = existed ? Math.round(player!.lastPosition) : (st?.positionMs ?? 0);
    const paused = existed ? player!.paused : (st?.paused ?? false);
    if (!player) {
      player = this.music.deps.manager.createPlayer({
        guildId,
        voiceChannelId: gs.lastVoiceChannelId,
        textChannelId: gs.lastTextChannelId ?? undefined,
        selfDeaf: true,
        volume: gs.volume ?? this.music.deps.settings.get().default_volume,
      });
      await player.queue.utils.sync(true, false);
    }
    await player.connect();
    await this.applyPersisted(player, st?.filter, st?.loopMode);
    if (player.queue.current) {
      const dur = player.queue.current.info.duration;
      const pos = player.queue.current.info.isStream || position >= dur ? 0 : position;
      await player.play({ position: pos, paused, volume: player.volume });
    } else if (player.queue.tracks.length) {
      await player.play({ volume: player.volume });
    }
    this.log.info({ guildId, position, existed }, 'recovered player after Lavalink restart');
  }

  private async applyPersisted(player: Player, filter?: string, loop?: string): Promise<void> {
    if (loop === 'track' || loop === 'queue') await player.setRepeatMode(loop as LoopMode);
    if (filter && filter !== 'off' && filter in FILTER_DEFINITIONS) {
      player.setData('filter', filter as FilterPreset);
      await player.node
        .updatePlayer({
          guildId: player.guildId,
          playerOptions: { filters: FILTER_DEFINITIONS[filter as FilterPreset].filters as never },
        })
        .catch(() => undefined);
    }
  }

  /** Bot restarted within the resume window: Lavalink still has the players; rebuild our side. */
  private async restoreResumed(node: LavalinkNode, lp: LavalinkPlayer[]): Promise<void> {
    this.log.info({ players: lp.length }, 'lavalink session resumed');
    for (const remote of lp) {
      const guildId = remote.guildId;
      try {
        const [gs] = await this.music.deps.db
          .select()
          .from(guildSettings)
          .where(eq(guildSettings.guildId, guildId));
        const [st] = await this.music.deps.db
          .select()
          .from(playerState)
          .where(eq(playerState.guildId, guildId));
        const stored = await this.store.get(guildId);
        const guild = this.music.deps.client.guilds.cache.get(guildId);
        if (
          !guild ||
          !this.music.deps.access.isGuildAllowed(guildId) ||
          !gs?.lastVoiceChannelId ||
          !stored?.current
        ) {
          await node.destroyPlayer(guildId).catch(() => undefined);
          await this.store.delete(guildId);
          continue;
        }
        const player = this.music.deps.manager.createPlayer({
          guildId,
          voiceChannelId: gs.lastVoiceChannelId,
          textChannelId: gs.lastTextChannelId ?? undefined,
          selfDeaf: true,
          volume: gs.volume ?? remote.volume,
          node: node.id,
        });
        await player.queue.utils.sync(true, false);
        player.connected = remote.state.connected;
        player.playing = !!remote.track && !remote.paused;
        player.paused = remote.paused;
        player.lastPosition = remote.state.position;
        player.lastPositionChange = Date.now();
        player.voice = { ...remote.voice, channelId: gs.lastVoiceChannelId } as never;
        await this.applyPersisted(player, st?.filter, st?.loopMode);
        // Re-sync our Discord voice state so the voice session is valid for the new gateway session.
        await player.connect().catch(() => undefined);
        void this.lifecycle.checkIdle(guildId);
      } catch (e) {
        this.log.error({ err: e, guildId }, 'failed to restore resumed player');
      }
    }
    await this.reattachSessions();
  }

  private async reattachSessions(): Promise<void> {
    const active = new Map<string, string>();
    for (const [gid, p] of this.music.deps.manager.players)
      if (p.voiceChannelId) active.set(gid, p.voiceChannelId);
    await this.music.deps.sessions.restore(active);
  }
}
