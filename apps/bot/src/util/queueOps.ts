/** 1-based queue editing helpers operating on plain arrays (pure). */

export function isValidPosition(pos: number, length: number): boolean {
  return Number.isInteger(pos) && pos >= 1 && pos <= length;
}

/** Returns a new array with the item at 1-based `from` moved to 1-based `to`; null if out of range. */
export function moveItem<T>(arr: readonly T[], from: number, to: number): T[] | null {
  if (!isValidPosition(from, arr.length) || !isValidPosition(to, arr.length)) return null;
  const copy = arr.slice();
  const [item] = copy.splice(from - 1, 1);
  copy.splice(to - 1, 0, item as T);
  return copy;
}

/** Returns { items, removed } with the 1-based position removed; null if out of range. */
export function removeAt<T>(arr: readonly T[], pos: number): { items: T[]; removed: T } | null {
  if (!isValidPosition(pos, arr.length)) return null;
  const copy = arr.slice();
  const [removed] = copy.splice(pos - 1, 1);
  return { items: copy, removed: removed as T };
}
