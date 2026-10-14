import type { Client } from 'discord.js';
import { eq } from 'drizzle-orm';
import { LavalinkManager } from 'lavalink-client';
import type { Env } from '../env.js';
import type { Db } from '../db/client.js';
import { lavalinkSession } from '../db/schema.js';
import type { PgQueueStore } from './store.js';

/** Lavalink session resume timeout in seconds (REST `timeout` is seconds: https://lavalink.dev/api/rest.html#update-session). */
export const RESUME_TIMEOUT_SECONDS = 120;

export async function loadStoredSessionId(db: Db): Promise<string | undefined> {
  const [row] = await db.select().from(lavalinkSession).where(eq(lavalinkSession.id, 1));
  return row?.sessionId;
}

export async function saveSessionId(db: Db, sessionId: string): Promise<void> {
  await db
    .insert(lavalinkSession)
    .values({ id: 1, sessionId })
    .onConflictDoUpdate({ target: lavalinkSession.id, set: { sessionId, updatedAt: new Date() } });
}

export function createManager(
  client: Client<true>,
  env: Env,
  store: PgQueueStore,
  sessionId: string | undefined,
): LavalinkManager {
  const manager = new LavalinkManager({
    nodes: [
      {
        id: 'main',
        host: env.LAVALINK_HOST,
        port: env.LAVALINK_PORT,
        authorization: env.LAVALINK_PASSWORD,
        secure: false,
        sessionId,
        retryAmount: 1_000_000,
        retryDelay: 5000,
        heartBeatInterval: 30_000,
        enablePingOnStatsCheck: true,
        requestSignalTimeoutMS: 15_000,
        // The YouTube source manager name differs per backend (ytdlp vs plugin), so skip the client-side source check.
        autoChecks: { sourcesValidations: false, pluginValidations: false },
      },
    ],
    sendToShard: (guildId, payload) => {
      client.guilds.cache.get(guildId)?.shard?.send(payload);
    },
    client: { id: client.user.id, username: client.user.username },
    autoSkip: true,
    autoSkipOnResolveError: true,
    queueOptions: { maxPreviousTracks: 5, queueStore: store },
    playerOptions: {
      // Kicked / disconnected from voice => destroy the player (ends the web session).
      onDisconnect: { destroyPlayer: true },
    },
  });
  client.on('raw', (d) => {
    void manager.sendRawData(d).catch(() => undefined);
  });
  return manager;
}
