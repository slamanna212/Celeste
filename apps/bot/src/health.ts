import Fastify from 'fastify';
import type { Client } from 'discord.js';
import type { LavalinkManager } from 'lavalink-client';
import type { Db } from './db/client.js';
import { sql } from 'drizzle-orm';
import type { Logger } from './logger.js';
import { registry } from './metrics.js';

export interface ReadinessProbe {
  client: () => Client | null;
  manager: () => LavalinkManager | null;
  db: Db;
}

/** Separate port (not routed by the tunnel): /healthz /readyz /metrics. */
export async function startMetricsServer(port: number, probe: ReadinessProbe, log: Logger) {
  const app = Fastify({ logger: false });
  app.get('/healthz', async () => ({ status: 'ok' }));
  app.get('/readyz', async (_req, reply) => {
    const client = probe.client();
    const manager = probe.manager();
    const checks = {
      gateway: !!client?.isReady(),
      lavalink: !!manager && [...manager.nodeManager.nodes.values()].some((n) => n.connected),
      database: await probe.db.execute(sql`select 1`).then(
        () => true,
        () => false,
      ),
    };
    const ready = Object.values(checks).every(Boolean);
    return reply.code(ready ? 200 : 503).send({ ready, checks });
  });
  app.get('/metrics', async (_req, reply) => {
    reply.header('Content-Type', registry.contentType);
    return registry.metrics();
  });
  await app.listen({ port, host: '0.0.0.0' });
  log.info({ port }, 'metrics/health server listening');
  return app;
}
