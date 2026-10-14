import { eq } from 'drizzle-orm';
import type { QueueStoreManager, StoredQueue } from 'lavalink-client';
import type { Db } from '../db/client.js';
import { queueStore } from '../db/schema.js';
import type { Logger } from '../logger.js';

/**
 * lavalink-client QueueStoreManager backed by Postgres.
 * Interface shape (VERIFIED in node_modules/lavalink-client/dist/index.d.ts): get/set/delete are KV
 * operations on a whole StoredQueue per guild, so each guild is one JSONB row in `queue_store`.
 * Writes are serialised per guild and coalesced (only the latest pending value is written).
 */
export class PgQueueStore implements QueueStoreManager {
  private pending = new Map<string, { value: StoredQueue; running: boolean }>();
  private cache = new Map<string, StoredQueue>();

  constructor(
    private readonly db: Db,
    private readonly log: Logger,
  ) {}

  async get(guildId: string): Promise<StoredQueue | undefined> {
    const cached = this.cache.get(guildId);
    if (cached) return cached;
    const [row] = await this.db.select().from(queueStore).where(eq(queueStore.guildId, guildId));
    if (!row) return undefined;
    const data = row.data as StoredQueue;
    this.cache.set(guildId, data);
    return data;
  }

  async set(guildId: string, value: StoredQueue | string): Promise<boolean> {
    const data = (typeof value === 'string' ? JSON.parse(value) : value) as StoredQueue;
    // Deep-copy so later in-memory mutations of the live queue don't alias the cached snapshot.
    const snapshot = JSON.parse(JSON.stringify(data)) as StoredQueue;
    this.cache.set(guildId, snapshot);
    const entry = this.pending.get(guildId);
    if (entry) {
      entry.value = snapshot;
      return true;
    }
    const fresh = { value: snapshot, running: true };
    this.pending.set(guildId, fresh);
    void this.flush(guildId);
    return true;
  }

  private async flush(guildId: string): Promise<void> {
    for (;;) {
      const entry = this.pending.get(guildId);
      if (!entry) return;
      const value = entry.value;
      try {
        await this.db
          .insert(queueStore)
          .values({ guildId, data: value })
          .onConflictDoUpdate({
            target: queueStore.guildId,
            set: { data: value, updatedAt: new Date() },
          });
      } catch (e) {
        this.log.error({ err: e, guildId }, 'queue store write failed');
      }
      if (this.pending.get(guildId)?.value === value) {
        this.pending.delete(guildId);
        return;
      }
    }
  }

  async delete(guildId: string): Promise<boolean> {
    this.cache.delete(guildId);
    this.pending.delete(guildId);
    await this.db.delete(queueStore).where(eq(queueStore.guildId, guildId));
    return true;
  }

  stringify(value: StoredQueue | string): StoredQueue | string {
    return value;
  }

  parse(value: StoredQueue | string): Partial<StoredQueue> {
    return typeof value === 'string' ? (JSON.parse(value) as StoredQueue) : (value ?? {});
  }

  /** Resolves once all pending writes are flushed (used on shutdown). */
  async idle(timeoutMs = 5000): Promise<void> {
    const start = Date.now();
    while (this.pending.size > 0 && Date.now() - start < timeoutMs)
      await new Promise((r) => setTimeout(r, 50));
  }

  async guildIds(): Promise<string[]> {
    return (await this.db.select({ id: queueStore.guildId }).from(queueStore)).map((r) => r.id);
  }
}
