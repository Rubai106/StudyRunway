/**
 * Demo-grade in-memory per-IP rate limiter for the chat API route.
 *
 * Fixed window: MAX_REQUESTS requests per RATE_WINDOW_MS per key. This is a
 * competition-demo mitigation, NOT production rate limiting — it is
 * process-local, has no persistence, and keys on the client IP as reported by
 * proxy headers (spoofable). Documented as such in
 * docs/SECURITY_SELF_ASSESSMENT.md.
 */

export const RATE_WINDOW_MS = 60_000;
export const RATE_MAX_REQUESTS = 30;

const hits = new Map<string, number[]>();

export interface RateLimitDecision {
  allowed: boolean;
  /** Milliseconds until the window resets (0 when allowed). */
  retryAfterMs: number;
}

export function checkRateLimit(key: string, now: number = Date.now()): RateLimitDecision {
  const windowStart = now - RATE_WINDOW_MS;
  const prev = hits.get(key) ?? [];
  const recent = prev.filter((t) => t > windowStart);
  if (recent.length >= RATE_MAX_REQUESTS) {
    const oldest = Math.min(...recent);
    return { allowed: false, retryAfterMs: Math.max(0, oldest + RATE_WINDOW_MS - now) };
  }
  recent.push(now);
  hits.set(key, recent);
  // Opportunistic cleanup so the map cannot grow without bound.
  if (hits.size > 10_000) {
    for (const [k, v] of hits) {
      if (v.every((t) => t <= windowStart)) hits.delete(k);
    }
  }
  return { allowed: true, retryAfterMs: 0 };
}

/** Reset all counters (tests). */
export function resetRateLimit(): void {
  hits.clear();
}
