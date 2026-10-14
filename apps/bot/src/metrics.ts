import client from 'prom-client';

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

export const commandsTotal = new client.Counter({
  name: 'celeste_commands_total',
  help: 'Commands handled by name and outcome',
  labelNames: ['command', 'outcome'] as const,
  registers: [registry],
});
export const activePlayers = new client.Gauge({
  name: 'celeste_active_players',
  help: 'Active Lavalink players',
  registers: [registry],
});
export const queueSize = new client.Gauge({
  name: 'celeste_queue_size',
  help: 'Queue length per guild',
  labelNames: ['guild'] as const,
  registers: [registry],
});
export const trackFailures = new client.Counter({
  name: 'celeste_track_failures_total',
  help: 'Track exceptions/stuck events by source',
  labelNames: ['source', 'kind'] as const,
  registers: [registry],
});
export const webSessionsActive = new client.Gauge({
  name: 'celeste_web_sessions_active',
  help: 'Active web panel sessions',
  registers: [registry],
});
