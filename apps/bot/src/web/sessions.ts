import { EventEmitter } from 'node:events';
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { webSessions } from '../db/schema.js';
import type { Logger } from '../logger.js';
import { webSessionsActive } from '../metrics.js';
import { generateToken, hashToken, isWellFormedToken } from './tokens.js';

export interface ActiveSession {
  id: string;
  guildId: string;
  voiceChannelId: string;
  startedBy: string;
  createdAt: Date;
  /** Plaintext token is only kept in memory so it can be put on NP embed buttons. */
  token: string;
}

export interface SessionEvents {
  ended: [session: ActiveSession, reason: string];
  rotated: [session: ActiveSession];
  /** Re-attached after a bot restart with a fresh token; links posted before the restart are dead. */
  restored: [session: ActiveSession];
}

/** One playback session per guild: starts when the bot joins voice, ends when it leaves. */
export class SessionManager extends EventEmitter<SessionEvents> {
  private byGuild = new Map<string, ActiveSession>();
  private byId = new Map<string, ActiveSession>();

  constructor(
    private readonly db: Db,
    private readonly log: Logger,
  ) {
    super();
  }

  forGuild(guildId: string): ActiveSession | undefined {
    return this.byGuild.get(guildId);
  }
  byIdActive(id: string): ActiveSession | undefined {
    return this.byId.get(id);
  }
  all(): ActiveSession[] {
    return [...this.byGuild.values()];
  }

  private track(s: ActiveSession): void {
    this.byGuild.set(s.guildId, s);
    this.byId.set(s.id, s);
    webSessionsActive.set(this.byGuild.size);
  }
  private untrack(s: ActiveSession): void {
    this.byGuild.delete(s.guildId);
    this.byId.delete(s.id);
    webSessionsActive.set(this.byGuild.size);
  }

  async start(guildId: string, voiceChannelId: string, startedBy: string): Promise<ActiveSession> {
    const existing = this.byGuild.get(guildId);
    if (existing) return existing;
    const token = generateToken();
    const [row] = await this.db
      .insert(webSessions)
      .values({ tokenHash: hashToken(token), guildId, voiceChannelId, startedBy })
      .returning();
    if (!row) throw new Error('failed to create web session');
    const s: ActiveSession = {
      id: row.id,
      guildId,
      voiceChannelId,
      startedBy,
      createdAt: row.createdAt,
      token,
    };
    this.track(s);
    this.log.info({ guildId, sessionId: s.id }, 'web session started');
    return s;
  }

  /** Invalidate current token and issue a new one for the same session (the `/web` command). */
  async rotate(guildId: string): Promise<ActiveSession | undefined> {
    const s = this.byGuild.get(guildId);
    if (!s) return undefined;
    const token = generateToken();
    await this.db
      .update(webSessions)
      .set({ tokenHash: hashToken(token) })
      .where(eq(webSessions.id, s.id));
    s.token = token;
    this.emit('rotated', s);
    return s;
  }

  async end(guildId: string, reason: string): Promise<void> {
    const s = this.byGuild.get(guildId);
    if (!s) return;
    this.untrack(s);
    await this.db.update(webSessions).set({ endedAt: new Date() }).where(eq(webSessions.id, s.id));
    this.log.info({ guildId, sessionId: s.id, reason }, 'web session ended');
    this.emit('ended', s, reason);
  }

  async endAll(reason: string): Promise<number> {
    const list = this.all();
    for (const s of list) await this.end(s.guildId, reason);
    // Also close any rows left open (e.g. from a crashed process).
    await this.db
      .update(webSessions)
      .set({ endedAt: new Date() })
      .where(isNull(webSessions.endedAt));
    return list.length;
  }

  /** Resolve a `/s/:token` link to a live session. */
  async lookupToken(token: string): Promise<ActiveSession | undefined> {
    if (!isWellFormedToken(token)) return undefined;
    const hash = hashToken(token);
    const [row] = await this.db
      .select()
      .from(webSessions)
      .where(and(eq(webSessions.tokenHash, hash), isNull(webSessions.endedAt)));
    if (!row) return undefined;
    return this.byId.get(row.id);
  }

  /**
   * On startup: sessions that are still open in the DB are re-attached when the guild still
   * has a player (token is rotated since plaintext is not recoverable); otherwise they are ended.
   */
  async restore(activeGuilds: Map<string, string>): Promise<void> {
    const open = await this.db.select().from(webSessions).where(isNull(webSessions.endedAt));
    for (const row of open) {
      if (this.byId.has(row.id)) continue; // live session, nothing to restore
      const vc = activeGuilds.get(row.guildId);
      if (!vc || this.byGuild.has(row.guildId)) {
        await this.db
          .update(webSessions)
          .set({ endedAt: new Date() })
          .where(eq(webSessions.id, row.id));
        continue;
      }
      const token = generateToken();
      await this.db
        .update(webSessions)
        .set({ tokenHash: hashToken(token), voiceChannelId: vc })
        .where(eq(webSessions.id, row.id));
      const s: ActiveSession = {
        id: row.id,
        guildId: row.guildId,
        voiceChannelId: vc,
        startedBy: row.startedBy,
        createdAt: row.createdAt,
        token,
      };
      this.track(s);
      this.log.info({ guildId: s.guildId, sessionId: s.id }, 'web session restored');
      this.emit('restored', s);
    }
  }
}
