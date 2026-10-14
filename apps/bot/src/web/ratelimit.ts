/** Per-key limiter: token bucket for bursts (default 10/s) plus a rolling window (default 60/min) for mutating calls. */
export class SessionRateLimiter {
  private readonly buckets = new Map<string, { tokens: number; last: number; window: number[] }>();

  constructor(
    private readonly burst = 10,
    private readonly perMinute = 60,
    private readonly now: () => number = Date.now,
  ) {}

  /** Returns true if allowed. `mutating` calls are also subject to the per-minute cap. */
  allow(key: string, mutating: boolean): boolean {
    const t = this.now();
    const b = this.buckets.get(key) ?? { tokens: this.burst, last: t, window: [] };
    b.tokens = Math.min(this.burst, b.tokens + ((t - b.last) / 1000) * this.burst);
    b.last = t;
    this.buckets.set(key, b);
    if (b.tokens < 1) return false;
    if (mutating) {
      b.window = b.window.filter((x) => t - x < 60_000);
      if (b.window.length >= this.perMinute) return false;
      b.window.push(t);
    }
    b.tokens -= 1;
    return true;
  }

  forget(key: string): void {
    this.buckets.delete(key);
  }
}
