import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Client, GatewayIntentBits, Partials } from 'discord.js';
import type { LavalinkManager } from 'lavalink-client';
import { AccessService } from './access.js';
import type { App } from './app.js';
import { RadioCatalog, RadioNowPlayingHub } from './azuracast/service.js';
import { registerCommands, wireInteractions } from './commands/index.js';
import { createDb, runMigrations } from './db/client.js';
import { loadEnv } from './env.js';
import { startMetricsServer } from './health.js';
import { createManager, loadStoredSessionId } from './lavalink/manager.js';
import { Recovery } from './lavalink/recovery.js';
import { PgQueueStore } from './lavalink/store.js';
import { logger } from './logger.js';
import { Lifecycle } from './music/events.js';
import { NowPlayingManager } from './music/nowplaying.js';
import { MusicService } from './music/service.js';
import { SettingsService } from './settings.js';
import { buildWebServer } from './web/server.js';
import { SessionManager } from './web/sessions.js';

function readVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(path.resolve(import.meta.dirname, '../package.json'), 'utf8'),
    ) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

async function main(): Promise<void> {
  const env = loadEnv();
  logger.level = env.LOG_LEVEL;
  const log = logger;
  let shuttingDown = false;

  const { sql, db } = createDb(env.DATABASE_URL);
  await runMigrations(env.DATABASE_URL, path.resolve(import.meta.dirname, '../drizzle'), log);

  let readyClient: Client | null = null;
  let readyManager: LavalinkManager | null = null;
  const metricsServer = await startMetricsServer(
    env.METRICS_PORT,
    { client: () => readyClient, manager: () => readyManager, db },
    log,
  );

  const settings = new SettingsService(db);
  await settings.load();
  const access = new AccessService(db, log);
  await access.load();

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
    partials: [Partials.Channel],
  });
  readyClient = client;

  let webServer: Awaited<ReturnType<typeof buildWebServer>> | null = null;
  let appRef: App | null = null;
  const store = new PgQueueStore(db, log);

  client.once('clientReady', async (c) => {
    try {
      log.info({ user: c.user.tag, guilds: c.guilds.cache.size }, 'discord ready');
      await access.refreshOwners(c);
      await access.bootstrapFirstGuild(c);
      access.startOwnerRefresh(c);

      const sessionId = await loadStoredSessionId(db);
      const manager = createManager(c, env, store, sessionId);
      readyManager = manager;
      const sessions = new SessionManager(db, log);
      const catalog = new RadioCatalog(db, log);
      const hub = new RadioNowPlayingHub(log);
      const music = new MusicService({
        client: c,
        manager,
        db,
        settings,
        access,
        sessions,
        catalog,
        hub,
        log,
      });
      const np = new NowPlayingManager(music);
      const lifecycle = new Lifecycle(music, np, c, db);
      const app: App = {
        env,
        log,
        client: c,
        db,
        settings,
        access,
        music,
        np,
        lifecycle,
        sessions,
        catalog,
        hub,
        version: readVersion(),
      };
      appRef = app;

      access.setGuildDeniedHook(
        (guildId) => void music.destroyPlayer(guildId, 'guild-denied').catch(() => undefined),
      );
      sessions.on('rotated', (s) => void np.refresh(s.guildId));
      settings.onChange(() => void 0);

      lifecycle.wire();
      new Recovery(music, store, lifecycle).wire();
      await access.enforceAll(c);

      c.on('guildCreate', (g) => void access.enforceGuild(g));
      c.on(
        'guildDelete',
        (g) => void music.destroyPlayer(g.id, 'guild-removed').catch(() => undefined),
      );

      await registerCommands(app);
      wireInteractions(app, () => shuttingDown);

      await manager.init({ id: c.user.id, username: c.user.username });
      webServer = await buildWebServer(app);
      await webServer.listen({ port: env.WEB_PORT, host: '0.0.0.0' });
      log.info({ port: env.WEB_PORT }, 'web server listening');
      lifecycle.startRetentionJob();
    } catch (e) {
      log.fatal({ err: e }, 'startup failed');
      process.exit(1);
    }
  });

  client.on('error', (e) => log.error({ err: e }, 'discord client error'));

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, 'shutting down (Lavalink players are left running for session resume)');
    try {
      await webServer?.close();
      appRef?.hub.stopAll();
      if (appRef)
        for (const p of appRef.music.deps.manager.players.values())
          await appRef.lifecycle.persistState(p, true);
      await store.idle();
      await client.destroy();
      await metricsServer.close();
      await sql.end({ timeout: 5 });
    } catch (e) {
      log.error({ err: e }, 'error during shutdown');
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (e) => log.error({ err: e }, 'unhandled rejection'));

  await client.login(env.DISCORD_TOKEN);
}

main().catch((e) => {
  logger.fatal({ err: e }, 'fatal');
  process.exit(1);
});
