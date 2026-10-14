import { TeamMemberMembershipState } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { teamOwnerIds } from './access.js';
import { buildCommandDefinitions } from './commands/definitions.js';
import { loadEnv } from './env.js';
import { nextFailureState } from './music/events.js';
import { parseQueryPrefix } from './music/service.js';

describe('env', () => {
  const base = {
    DISCORD_TOKEN: 't',
    LAVALINK_HOST: 'lavalink',
    LAVALINK_PASSWORD: 'p',
    DATABASE_URL: 'postgres://x',
    WEB_SESSION_SECRET: 'a'.repeat(32),
  };
  it('applies defaults', () => {
    expect(loadEnv(base)).toMatchObject({
      LAVALINK_PORT: 2333,
      WEB_PORT: 8080,
      METRICS_PORT: 9090,
      YOUTUBE_BACKEND: 'ytdlp',
      LOG_LEVEL: 'info',
    });
  });
  it('fails on missing/short secrets', () => {
    expect(() => loadEnv({ ...base, DISCORD_TOKEN: undefined })).toThrow(/DISCORD_TOKEN/);
    expect(() => loadEnv({ ...base, WEB_SESSION_SECRET: 'short' })).toThrow(/WEB_SESSION_SECRET/);
    expect(() => loadEnv({ ...base, YOUTUBE_BACKEND: 'nope' })).toThrow();
  });
});

describe('teamOwnerIds', () => {
  it('includes team owner and accepted admin/developer members only', () => {
    const A = TeamMemberMembershipState.Accepted;
    const I = TeamMemberMembershipState.Invited;
    expect(
      teamOwnerIds('o', [
        { id: 'a', state: A, role: 'admin' },
        { id: 'd', state: A, role: 'developer' },
        { id: 'r', state: A, role: 'read_only' },
        { id: 'i', state: I, role: 'admin' },
      ]).sort(),
    ).toEqual(['a', 'd', 'o']);
    expect(teamOwnerIds(null, [])).toEqual([]);
  });
});

describe('query prefixes', () => {
  it('parses sc: sp: am: yt:', () => {
    expect(parseQueryPrefix('sc: lofi beats')).toEqual({
      source: 'soundcloud',
      query: 'lofi beats',
    });
    expect(parseQueryPrefix('SP:daft punk')).toEqual({ source: 'spotify', query: 'daft punk' });
    expect(parseQueryPrefix('am: x')).toEqual({ source: 'applemusic', query: 'x' });
    expect(parseQueryPrefix('plain text')).toEqual({ source: 'youtube', query: 'plain text' });
    expect(parseQueryPrefix('https://youtu.be/abc').source).toBe('youtube');
  });
});

describe('consecutive failures', () => {
  it('counts same source and resets on change', () => {
    let s = nextFailureState(null, 'youtube');
    s = nextFailureState(s, 'youtube');
    expect(s).toEqual({ source: 'youtube', count: 2 });
    expect(nextFailureState(s, 'soundcloud')).toEqual({ source: 'soundcloud', count: 1 });
    expect(nextFailureState(s, 'youtube').count).toBe(3);
  });
});

describe('command definitions', () => {
  const defs = buildCommandDefinitions();
  it('registers all guild commands plus /admin', () => {
    const names = defs.map((d) => d.name);
    for (const n of [
      'play',
      'playnext',
      'radio',
      'pause',
      'resume',
      'skip',
      'voteskip',
      'stop',
      'queue',
      'nowplaying',
      'seek',
      'volume',
      'filter',
      'loop',
      'shuffle',
      'remove',
      'move',
      'clear',
      'disconnect',
      'web',
      'settings',
      'admin',
    ]) {
      expect(names).toContain(n);
    }
  });
  it('/admin is bot-DM only and guild-install; others are guild-only', () => {
    const admin = defs.find((d) => d.name === 'admin')!;
    expect(admin.contexts).toEqual([1]);
    expect(admin.integration_types).toEqual([0]);
    for (const d of defs.filter((x) => x.name !== 'admin')) expect(d.contexts).toEqual([0]);
  });
  it('/settings requires Manage Guild', () => {
    expect(defs.find((d) => d.name === 'settings')!.default_member_permissions).toBe('32');
  });
});
