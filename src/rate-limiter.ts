/**
 * Two sliding-window counters (global + per-key fingerprint), per spec §3.4. Plausible caps
 * at 600 requests/hour and doesn't document whether that's per-key or per-account; this
 * guards as if it were per-account, i.e. conservatively.
 *
 * In-memory and per-process by design: it only does its job when the deployment runs a
 * single instance (see README/Dockerfile — Cloud Run `--max-instances=1`). Consumed once per
 * outbound Plausible request, so a single exhaustive breakdown's dozens of pages count
 * individually rather than as one hit.
 */
export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds?: number;
}

export class RateLimiter {
  private globalHits: number[] = [];
  private readonly perKeyHits = new Map<string, number[]>();

  constructor(
    private readonly globalLimit: number,
    private readonly perKeyLimit: number,
    private readonly windowMs: number = 60 * 60 * 1000
  ) {}

  consume(fingerprint: string): RateLimitDecision {
    const now = Date.now();
    this.globalHits = prune(this.globalHits, now, this.windowMs);
    const keyHits = prune(this.perKeyHits.get(fingerprint) ?? [], now, this.windowMs);

    if (this.globalHits.length >= this.globalLimit) {
      return { allowed: false, retryAfterSeconds: retryAfter(this.globalHits, now, this.windowMs) };
    }
    if (keyHits.length >= this.perKeyLimit) {
      return { allowed: false, retryAfterSeconds: retryAfter(keyHits, now, this.windowMs) };
    }

    this.globalHits.push(now);
    keyHits.push(now);
    this.perKeyHits.set(fingerprint, keyHits);
    return { allowed: true };
  }
}

function prune(hits: number[], now: number, windowMs: number): number[] {
  const cutoff = now - windowMs;
  return hits.filter((t) => t > cutoff);
}

function retryAfter(hits: number[], now: number, windowMs: number): number {
  const oldest = hits[0] ?? now;
  return Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
}
