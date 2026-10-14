import type { PlayerStateDTO } from '@celeste/shared';

/** 3725000 -> "1:02:05", 65000 -> "1:05". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Total duration for queue summaries: "1h 5m" / "12m" / "0m". */
export function formatTotal(ms: number): string {
  const mins = Math.floor(Math.max(0, ms) / 60000);
  const h = Math.floor(mins / 60);
  return h > 0 ? `${h}h ${mins % 60}m` : `${mins}m`;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Client-side position: positionMs + elapsed since positionAt while playing; clamped to duration. */
export function interpolatePosition(
  p: Pick<PlayerStateDTO, 'positionMs' | 'positionAt' | 'paused'> & {
    current?: PlayerStateDTO['current'];
  },
  nowMs: number,
): number {
  let pos = p.positionMs;
  if (!p.paused) {
    const at = Date.parse(p.positionAt);
    if (Number.isFinite(at)) pos += Math.max(0, nowMs - at);
  }
  const track = p.current?.track;
  if (track && !track.isStream && track.durationMs > 0) pos = Math.min(pos, track.durationMs);
  return Math.max(0, pos);
}

/** Relative time like "5m ago". */
export function timeAgo(iso: string, nowMs: number = Date.now()): string {
  const diff = Math.max(0, nowMs - Date.parse(iso));
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Move an item in a 0-based array (used for optimistic queue reorder). */
export function moveItem<T>(arr: readonly T[], from: number, to: number): T[] {
  const copy = arr.slice();
  if (from < 0 || from >= copy.length || to < 0 || to >= copy.length) return copy;
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item as T);
  return copy;
}
