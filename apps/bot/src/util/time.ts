/** Parse "mm:ss", "h:mm:ss", "90", "90s" or "1m30s" into milliseconds. Returns null if invalid. */
export function parseTimeToMs(input: string): number | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s) * 1000);
  if (/^\d+:\d{1,2}(:\d{1,2})?$/.test(s)) {
    const parts = s.split(':').map(Number);
    if (parts.some((n) => Number.isNaN(n))) return null;
    let total: number;
    if (parts.length === 2) {
      const [m, sec] = parts as [number, number];
      if (sec >= 60) return null;
      total = m * 60 + sec;
    } else {
      const [h, m, sec] = parts as [number, number, number];
      if (m >= 60 || sec >= 60) return null;
      total = h * 3600 + m * 60 + sec;
    }
    return total * 1000;
  }
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(s);
  if (m && (m[1] || m[2] || m[3])) {
    return ((Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)) * 60 + Number(m[3] ?? 0)) * 1000;
  }
  return null;
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function progressBar(positionMs: number, durationMs: number, width = 16): string {
  if (durationMs <= 0) return '';
  const ratio = Math.min(1, Math.max(0, positionMs / durationMs));
  const idx = Math.min(width - 1, Math.floor(ratio * width));
  let out = '';
  for (let i = 0; i < width; i++) out += i === idx ? '\u{1F518}' : '▬';
  return out;
}
