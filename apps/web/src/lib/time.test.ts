import { describe, expect, it } from 'vitest';
import { clamp, formatDuration, formatTotal, interpolatePosition, moveItem, timeAgo } from './time';

describe('formatDuration', () => {
  it('formats minutes and hours', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65_000)).toBe('1:05');
    expect(formatDuration(3_725_000)).toBe('1:02:05');
  });
  it('guards bad input', () => {
    expect(formatDuration(-5)).toBe('0:00');
    expect(formatDuration(NaN)).toBe('0:00');
  });
});

describe('formatTotal', () => {
  it('formats', () => {
    expect(formatTotal(3_900_000)).toBe('1h 5m');
    expect(formatTotal(720_000)).toBe('12m');
  });
});

describe('interpolatePosition', () => {
  const at = '2025-01-01T00:00:00.000Z';
  const base = Date.parse(at);
  it('advances while playing', () => {
    expect(
      interpolatePosition({ positionMs: 1000, positionAt: at, paused: false }, base + 2500),
    ).toBe(3500);
  });
  it('holds while paused', () => {
    expect(
      interpolatePosition({ positionMs: 1000, positionAt: at, paused: true }, base + 9000),
    ).toBe(1000);
  });
  it('clamps to duration', () => {
    const current = { track: { isStream: false, durationMs: 4000 } } as never;
    expect(
      interpolatePosition(
        { positionMs: 1000, positionAt: at, paused: false, current },
        base + 60000,
      ),
    ).toBe(4000);
  });
  it('does not go backwards on clock skew', () => {
    expect(
      interpolatePosition({ positionMs: 1000, positionAt: at, paused: false }, base - 5000),
    ).toBe(1000);
  });
});

describe('misc', () => {
  it('clamp', () => expect(clamp(200, 0, 150)).toBe(150));
  it('moveItem', () => expect(moveItem([1, 2, 3, 4], 0, 2)).toEqual([2, 3, 1, 4]));
  it('timeAgo', () =>
    expect(timeAgo('2025-01-01T00:00:00Z', Date.parse('2025-01-01T02:10:00Z'))).toBe('2h ago'));
});
