import { describe, expect, it } from 'vitest';
import { SessionRateLimiter } from './ratelimit.js';
import {
  controlBody,
  filterBody,
  historyQuery,
  moveBody,
  playBody,
  radioBody,
  searchQuery,
  seekBody,
  volumeBody,
} from './schemas.js';
import {
  generateToken,
  hashToken,
  hashesEqual,
  isSessionUsable,
  isWellFormedToken,
  originAllowed,
} from './tokens.js';

describe('tokens', () => {
  it('generates 32-byte base64url tokens and hashes with SHA-256', () => {
    const t = generateToken();
    expect(t).toHaveLength(43);
    expect(isWellFormedToken(t)).toBe(true);
    expect(generateToken()).not.toBe(t);
    const h = hashToken(t);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(t)).toBe(h);
    expect(hashToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(hashesEqual(h, hashToken(t))).toBe(true);
    expect(hashesEqual(h, hashToken('x'))).toBe(false);
  });
  it('rejects malformed tokens', () => {
    expect(isWellFormedToken('short')).toBe(false);
    expect(isWellFormedToken('a'.repeat(43) + '!')).toBe(false);
  });
});

describe('session validation', () => {
  it('requires active session and allowed guild', () => {
    const live = { endedAt: null, guildId: '1' };
    expect(isSessionUsable(live, true)).toBe(true);
    expect(isSessionUsable(live, false)).toBe(false);
    expect(isSessionUsable({ ...live, endedAt: new Date() }, true)).toBe(false);
    expect(isSessionUsable(null, true)).toBe(false);
  });
  it('checks Origin against panel_base_url', () => {
    expect(originAllowed('https://celeste.example.com', 'https://celeste.example.com/')).toBe(true);
    expect(originAllowed('https://evil.example.com', 'https://celeste.example.com')).toBe(false);
    expect(originAllowed(undefined, 'https://celeste.example.com')).toBe(false);
    expect(originAllowed('https://celeste.example.com', undefined)).toBe(false);
    expect(originAllowed('null', 'https://celeste.example.com')).toBe(false);
  });
});

describe('rate limiter', () => {
  it('allows a burst of 10 then blocks, refilling over time', () => {
    let now = 0;
    const rl = new SessionRateLimiter(10, 60, () => now);
    for (let i = 0; i < 10; i++) expect(rl.allow('s', false)).toBe(true);
    expect(rl.allow('s', false)).toBe(false);
    now += 1000;
    expect(rl.allow('s', false)).toBe(true);
  });
  it('caps mutating calls at 60 per minute', () => {
    let now = 0;
    const rl = new SessionRateLimiter(10, 60, () => now);
    let ok = 0;
    for (let sec = 0; sec < 30; sec++) {
      now = sec * 1000;
      for (let i = 0; i < 5; i++) if (rl.allow('s', true)) ok++;
    }
    expect(ok).toBeLessThanOrEqual(60);
    expect(ok).toBeGreaterThan(50);
    expect(rl.allow('other', true)).toBe(true);
  });
});

describe('API zod schemas', () => {
  it('play', () => {
    expect(playBody.parse({ query: '  hello ' })).toEqual({ query: 'hello' });
    expect(() => playBody.parse({ query: '' })).toThrow();
    expect(() => playBody.parse({ query: 'x', extra: 1 })).toThrow();
  });
  it('control', () => {
    expect(controlBody.parse({ action: 'skip' })).toEqual({ action: 'skip' });
    expect(controlBody.parse({ action: 'loop', value: 'queue' })).toEqual({
      action: 'loop',
      value: 'queue',
    });
    expect(() => controlBody.parse({ action: 'loop' })).toThrow();
    expect(() => controlBody.parse({ action: 'explode' })).toThrow();
  });
  it('seek / volume / filter / move / radio', () => {
    expect(seekBody.parse({ ms: 1000 })).toEqual({ ms: 1000 });
    expect(() => seekBody.parse({ ms: -1 })).toThrow();
    expect(() => seekBody.parse({ ms: 1.5 })).toThrow();
    expect(volumeBody.parse({ value: 150 })).toEqual({ value: 150 });
    expect(() => volumeBody.parse({ value: 151 })).toThrow();
    expect(filterBody.parse({ preset: '8d' })).toEqual({ preset: '8d' });
    expect(() => filterBody.parse({ preset: 'loud' })).toThrow();
    expect(moveBody.parse({ from: 1, to: 2 })).toEqual({ from: 1, to: 2 });
    expect(() => moveBody.parse({ from: 0, to: 2 })).toThrow();
    expect(radioBody.parse({ stationId: '3:my_station' })).toEqual({ stationId: '3:my_station' });
    expect(() => radioBody.parse({ stationId: 'nope' })).toThrow();
  });
  it('query params', () => {
    expect(searchQuery.parse({ q: 'abc' })).toEqual({ q: 'abc', source: 'youtube' });
    expect(searchQuery.parse({ q: 'abc', source: 'spotify' }).source).toBe('spotify');
    expect(() => searchQuery.parse({ q: 'abc', source: 'tidal' })).toThrow();
    expect(historyQuery.parse({})).toEqual({ page: 1 });
    expect(historyQuery.parse({ page: '3' })).toEqual({ page: 3 });
    expect(() => historyQuery.parse({ page: '0' })).toThrow();
  });
});
