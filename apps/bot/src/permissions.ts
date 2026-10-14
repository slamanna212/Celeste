/** Pure permission and vote-skip rules (spec section 7). */

export interface VoiceMemberLike {
  bot: boolean;
  deafened: boolean;
}

/** Listeners = non-bot, non-deafened members in the bot's channel. */
export function countListeners(members: readonly VoiceMemberLike[]): number {
  return members.filter((m) => !m.bot && !m.deafened).length;
}

/** Needed = ceil(listeners * 0.5), minimum 1. */
export function votesNeeded(listeners: number): number {
  return Math.max(1, Math.ceil(listeners * 0.5));
}

export interface VoteState {
  trackKey: string | null;
  voters: Set<string>;
}

export function castVote(
  state: VoteState,
  trackKey: string,
  userId: string,
  listeners: number,
): { state: VoteState; votes: number; needed: number; passed: boolean; alreadyVoted: boolean } {
  const s: VoteState = state.trackKey === trackKey ? state : { trackKey, voters: new Set() };
  const alreadyVoted = s.voters.has(userId);
  s.voters.add(userId);
  const needed = votesNeeded(listeners);
  return { state: s, votes: s.voters.size, needed, passed: s.voters.size >= needed, alreadyVoted };
}

export interface ActorContext {
  /** Web panel actors have full playback control. */
  isWeb?: boolean;
  isRequester?: boolean;
  hasDjRole?: boolean;
  hasManageGuild?: boolean;
  /** Only non-bot human in the bot's channel. */
  aloneWithBot?: boolean;
  /** Guild has a DJ role configured. */
  djRoleConfigured?: boolean;
}

/** /skip is instant for requester, DJ, Manage Guild, alone-with-bot, or the web panel. */
export function canInstantSkip(a: ActorContext): boolean {
  return !!(a.isWeb || a.isRequester || a.hasDjRole || a.hasManageGuild || a.aloneWithBot);
}

/**
 * Destructive commands (/stop /clear /remove /move /filter /volume): if no DJ role is configured
 * everyone in the voice channel may use them; otherwise DJ, Manage Guild, or alone with the bot.
 */
export function canUseDestructive(a: ActorContext): boolean {
  if (a.isWeb) return true;
  if (!a.djRoleConfigured) return true;
  return !!(a.hasDjRole || a.hasManageGuild || a.aloneWithBot);
}

/** /web rotation: DJ, Manage Guild, or the session starter. */
export function canRotateLink(a: ActorContext & { isSessionStarter?: boolean }): boolean {
  return !!(a.hasDjRole || a.hasManageGuild || a.isSessionStarter);
}
