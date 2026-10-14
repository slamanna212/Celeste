import { describe, expect, it } from 'vitest';
import { moveItem, removeAt } from './queueOps.js';
import { formatDuration, parseTimeToMs, progressBar } from './time.js';

describe('parseTimeToMs', () => {
  it.each([
    ['90', 90_000],
    ['1:30', 90_000],
    ['01:05:03', 3_903_000],
    ['0:05', 5000],
    ['90s', 90_000],
    ['1m30s', 90_000],
    ['2h', 7_200_000],
    ['12.5', 12_500],
  ])('%s -> %i', (input, ms) => expect(parseTimeToMs(input)).toBe(ms));
  it.each(['', 'abc', '1:75', '-5', '1:2:3:4', '1:60'])('rejects %j', (input) =>
    expect(parseTimeToMs(input)).toBeNull(),
  );
});

describe('formatDuration', () => {
  it('formats', () => {
    expect(formatDuration(65_000)).toBe('1:05');
    expect(formatDuration(3_661_000)).toBe('1:01:01');
    expect(formatDuration(-5)).toBe('0:00');
  });
  it('progress bar has fixed width', () => {
    expect([...progressBar(50, 100, 10)]).toHaveLength(10);
    expect(progressBar(1, 0)).toBe('');
  });
});

describe('queue ops (1-based)', () => {
  const q = ['a', 'b', 'c', 'd'];
  it('moves forward and backward', () => {
    expect(moveItem(q, 1, 3)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(q, 4, 1)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveItem(q, 2, 2)).toEqual(q);
  });
  it('does not mutate and rejects out of range', () => {
    moveItem(q, 1, 2);
    expect(q).toEqual(['a', 'b', 'c', 'd']);
    expect(moveItem(q, 0, 2)).toBeNull();
    expect(moveItem(q, 1, 5)).toBeNull();
    expect(moveItem(q, 1.5, 2)).toBeNull();
  });
  it('removes', () => {
    expect(removeAt(q, 2)).toEqual({ items: ['a', 'c', 'd'], removed: 'b' });
    expect(removeAt(q, 5)).toBeNull();
    expect(removeAt([], 1)).toBeNull();
  });
});
