import {
  type Client,
  type Guild,
  Team,
  TeamMemberMembershipState,
  TeamMemberRole,
  User,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import type { Db } from './db/client.js';
import { admins, guilds } from './db/schema.js';
import type { Logger } from './logger.js';

/** Pure: which team members count as owners (accepted members with admin/developer role, plus the team owner). */
export function teamOwnerIds(
  ownerId: string | null,
  members: Array<{ id: string; state: number; role: string }>,
): string[] {
  const ids = new Set<string>();
  if (ownerId) ids.add(ownerId);
  for (const m of members) {
    if (
      m.state === TeamMemberMembershipState.Accepted &&
      (m.role === TeamMemberRole.Admin || m.role === TeamMemberRole.Developer)
    ) {
      ids.add(m.id);
    }
  }
  return [...ids];
}

export class AccessService {
  private owners = new Set<string>();
  private adminIds = new Set<string>();
  private allowedGuilds = new Set<string>();
  private refreshTimer: NodeJS.Timeout | null = null;
  private onGuildDenied: ((guildId: string) => void) | null = null;

  constructor(
    private readonly db: Db,
    private readonly log: Logger,
  ) {}

  setGuildDeniedHook(fn: (guildId: string) => void): void {
    this.onGuildDenied = fn;
  }

  async load(): Promise<void> {
    this.adminIds = new Set((await this.db.select().from(admins)).map((r) => r.userId));
    this.allowedGuilds = new Set(
      (await this.db.select().from(guilds)).filter((g) => g.allowed).map((g) => g.id),
    );
  }

  async refreshOwners(client: Client<true>): Promise<void> {
    try {
      const app = await client.application.fetch();
      const owner = app.owner;
      const next = new Set<string>();
      if (owner instanceof Team) {
        const ids = teamOwnerIds(
          owner.ownerId,
          owner.members.map((m) => ({ id: m.id, state: m.membershipState, role: m.role })),
        );
        ids.forEach((i) => next.add(i));
      } else if (owner instanceof User) {
        next.add(owner.id);
      }
      if (next.size > 0) this.owners = next;
      this.log.info({ owners: this.owners.size }, 'application owners refreshed');
    } catch (e) {
      this.log.error({ err: e }, 'failed to refresh application owners');
    }
  }

  startOwnerRefresh(client: Client<true>): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = setInterval(() => void this.refreshOwners(client), 60 * 60_000);
    this.refreshTimer.unref();
  }

  stop(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  isOwner(userId: string): boolean {
    return this.owners.has(userId);
  }
  isAdmin(userId: string): boolean {
    return this.owners.has(userId) || this.adminIds.has(userId);
  }
  ownerIds(): string[] {
    return [...this.owners];
  }
  adminList(): string[] {
    return [...this.adminIds];
  }

  async addAdmin(userId: string, by: string): Promise<boolean> {
    if (this.adminIds.has(userId) || this.owners.has(userId)) return false;
    await this.db.insert(admins).values({ userId, addedBy: by }).onConflictDoNothing();
    this.adminIds.add(userId);
    return true;
  }
  async removeAdmin(userId: string): Promise<boolean> {
    if (!this.adminIds.has(userId)) return false;
    await this.db.delete(admins).where(eq(admins.userId, userId));
    this.adminIds.delete(userId);
    return true;
  }

  isGuildAllowed(guildId: string): boolean {
    return this.allowedGuilds.has(guildId);
  }
  async allowGuild(guildId: string, by: string): Promise<void> {
    await this.db
      .insert(guilds)
      .values({ id: guildId, allowed: true, addedBy: by })
      .onConflictDoUpdate({ target: guilds.id, set: { allowed: true } });
    this.allowedGuilds.add(guildId);
  }
  async denyGuild(guildId: string, by: string): Promise<void> {
    await this.db
      .insert(guilds)
      .values({ id: guildId, allowed: false, addedBy: by })
      .onConflictDoUpdate({ target: guilds.id, set: { allowed: false } });
    this.allowedGuilds.delete(guildId);
    this.onGuildDenied?.(guildId);
  }
  async listGuilds() {
    return this.db.select().from(guilds);
  }
  allowedCount(): number {
    return this.allowedGuilds.size;
  }

  /** Leave the guild if not allowlisted. Returns true if the bot left. */
  async enforceGuild(guild: Guild): Promise<boolean> {
    if (this.isGuildAllowed(guild.id)) return false;
    this.log.warn(
      { guildId: guild.id, name: guild.name },
      'leaving guild that is not on the allowlist',
    );
    this.onGuildDenied?.(guild.id);
    await guild
      .leave()
      .catch((e) => this.log.error({ err: e, guildId: guild.id }, 'failed to leave guild'));
    return true;
  }

  /**
   * First-boot fallback (spec 7.5): if no guild has ever been allowed and DMs with the bot may
   * not be possible (a shared guild may be required), auto-allow the first guild the bot is in
   * that is owned by / contains an owner.
   */
  async bootstrapFirstGuild(client: Client<true>): Promise<void> {
    if (this.allowedGuilds.size > 0 || (await this.listGuilds()).length > 0) return;
    for (const guild of client.guilds.cache.values()) {
      let hit = this.owners.has(guild.ownerId);
      if (!hit) {
        for (const ownerId of this.owners) {
          hit = await guild.members.fetch(ownerId).then(
            () => true,
            () => false,
          );
          if (hit) break;
        }
      }
      if (hit) {
        await this.allowGuild(guild.id, 'bootstrap');
        this.log.warn(
          { guildId: guild.id, name: guild.name },
          'guild allowlist was empty: auto-allowed first guild containing an owner',
        );
        return;
      }
    }
  }

  async enforceAll(client: Client<true>): Promise<void> {
    for (const guild of [...client.guilds.cache.values()]) await this.enforceGuild(guild);
  }
}
