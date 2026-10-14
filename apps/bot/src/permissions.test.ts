import { describe, expect, it } from 'vitest';
import {
  canInstantSkip,
  canRotateLink,
  canUseDestructive,
  castVote,
  countListeners,
  votesNeeded,
} from './permissions.js';

describe('vote skip math', () => {
  it('needs ceil(listeners * 0.5), at least 1', () => {
    expect(votesNeeded(0)).toBe(1);
    expect(votesNeeded(1)).toBe(1);
    expect(votesNeeded(2)).toBe(1);
    expect(votesNeeded(3)).toBe(2);
    expect(votesNeeded(4)).toBe(2);
    expect(votesNeeded(5)).toBe(3);
  });
  it('counts non-bot, non-deafened members', () => {
    expect(
      countListeners([
        { bot: true, deafened: false },
        { bot: false, deafened: true },
        { bot: false, deafened: false },
        { bot: false, deafened: false },
      ]),
    ).toBe(2);
  });
  it('dedupes voters and resets on track change', () => {
    let state = { trackKey: null as string | null, voters: new Set<string>() };
    let r = castVote(state, 't1', 'u1', 4);
    expect(r).toMatchObject({ votes: 1, needed: 2, passed: false, alreadyVoted: false });
    state = r.state;
    r = castVote(state, 't1', 'u1', 4);
    expect(r).toMatchObject({ votes: 1, alreadyVoted: true, passed: false });
    r = castVote(r.state, 't1', 'u2', 4);
    expect(r).toMatchObject({ votes: 2, passed: true });
    r = castVote(r.state, 't2', 'u1', 4);
    expect(r.votes).toBe(1);
  });
});

describe('permissions', () => {
  it('instant skip rules', () => {
    expect(canInstantSkip({})).toBe(false);
    expect(canInstantSkip({ isRequester: true })).toBe(true);
    expect(canInstantSkip({ hasDjRole: true })).toBe(true);
    expect(canInstantSkip({ hasManageGuild: true })).toBe(true);
    expect(canInstantSkip({ aloneWithBot: true })).toBe(true);
    expect(canInstantSkip({ isWeb: true })).toBe(true);
  });
  it('destructive: open without DJ role, restricted with one', () => {
    expect(canUseDestructive({ djRoleConfigured: false })).toBe(true);
    expect(canUseDestructive({ djRoleConfigured: true })).toBe(false);
    expect(canUseDestructive({ djRoleConfigured: true, hasDjRole: true })).toBe(true);
    expect(canUseDestructive({ djRoleConfigured: true, hasManageGuild: true })).toBe(true);
    expect(canUseDestructive({ djRoleConfigured: true, aloneWithBot: true })).toBe(true);
    expect(canUseDestructive({ djRoleConfigured: true, isWeb: true })).toBe(true);
  });
  it('link rotation', () => {
    expect(canRotateLink({})).toBe(false);
    expect(canRotateLink({ isSessionStarter: true })).toBe(true);
    expect(canRotateLink({ hasDjRole: true })).toBe(true);
  });
});
