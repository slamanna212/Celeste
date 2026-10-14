import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from './schema.js';
import type { Logger } from '../logger.js';

export type Db = ReturnType<typeof createDb>['db'];

export function createDb(url: string) {
  const sql = postgres(url, { max: 10, onnotice: () => {} });
  const db = drizzle(sql, { schema });
  return { sql, db };
}

/** Arbitrary constant key for pg_advisory_lock ("celeste" as ascii-ish). */
const MIGRATION_LOCK_KEY = 0x63656c65;

/**
 * Applies drizzle migrations while holding a Postgres session-level advisory lock on a
 * dedicated connection so concurrent replicas/restarts are serialized.
 */
export async function runMigrations(
  url: string,
  migrationsFolder: string,
  log: Logger,
): Promise<void> {
  const lockSql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await lockSql`select pg_advisory_lock(${MIGRATION_LOCK_KEY})`;
    const migSql = postgres(url, { max: 1, onnotice: () => {} });
    try {
      await migrate(drizzle(migSql), { migrationsFolder });
      log.info('database migrations applied');
    } finally {
      await migSql.end();
    }
  } finally {
    await lockSql`select pg_advisory_unlock(${MIGRATION_LOCK_KEY})`.catch(() => undefined);
    await lockSql.end();
  }
}
