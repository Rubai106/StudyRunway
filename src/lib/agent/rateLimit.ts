/**
 * Demo-grade in-memory per-IP rate limiter for the chat API route.
 *
 * Fixed window: MAX_REQUESTS requests per RATE_WINDOW_MS per key. This is a
 * competition-demo mitigation, NOT production rate limiting — it is
 * process-local and has no persistence. Proxy headers are used only when the
 * deployment explicitly sets STUDYRUNWAY_TRUST_PROXY_HEADERS=true; otherwise
 * requests share a conservative fallback bucket. Documented as such in
 * docs/SECURITY_SELF_ASSESSMENT.md.
 */

export const RATE_WINDOW_MS = 60_000;
export const RATE_MAX_REQUESTS = 30;
export const FUNDING_ANALYSIS_RATE_MAX_REQUESTS = 10;
export const WISE_RATE_MAX_REQUESTS = 15;

const hits = new Map<string, number[]>();

export interface RateLimitDecision {
  allowed: boolean;
  /** Milliseconds until the window resets (0 when allowed). */
  retryAfterMs: number;
}

export function checkRateLimit(
  key: string,
  now: number = Date.now(),
  maxRequests: number = RATE_MAX_REQUESTS,
  windowMs: number = RATE_WINDOW_MS,
): RateLimitDecision {
  const windowStart = now - windowMs;
  const prev = hits.get(key) ?? [];
  const recent = prev.filter((t) => t > windowStart);
  if (recent.length >= maxRequests) {
    const oldest = Math.min(...recent);
    return { allowed: false, retryAfterMs: Math.max(0, oldest + windowMs - now) };
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

/** Use proxy identity only when the deployment explicitly trusts its proxy. */
export function requestClientKey(req: Request): string {
  if (process.env.STUDYRUNWAY_TRUST_PROXY_HEADERS?.trim().toLowerCase() !== "true") {
    return "untrusted-network";
  }
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return req.headers.get("x-real-ip")?.trim() || forwarded || "unknown-proxy-client";
}

/** Reset all counters (tests). */
export function resetRateLimit(): void {
  hits.clear();
}
