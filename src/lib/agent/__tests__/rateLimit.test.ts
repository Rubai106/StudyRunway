/**
 * Rate-limiter behaviour tests (Part K). Demo-grade fixed-window limiter:
 * RATE_MAX_REQUESTS per RATE_WINDOW_MS per key.
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  checkRateLimit,
  resetRateLimit,
  RATE_MAX_REQUESTS,
  RATE_WINDOW_MS,
} from "../rateLimit";

describe("checkRateLimit", () => {
  beforeEach(() => {
    resetRateLimit();
  });

  it("allows up to the max, then blocks with a retry hint", () => {
    const key = "ip-1";
    for (let i = 0; i < RATE_MAX_REQUESTS; i++) {
      expect(checkRateLimit(key, 1000 + i).allowed, `request ${i}`).toBe(true);
    }
    const blocked = checkRateLimit(key, 1000 + RATE_MAX_REQUESTS);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    expect(blocked.retryAfterMs).toBeLessThanOrEqual(RATE_WINDOW_MS);
  });

  it("recovers after the window passes", () => {
    const key = "ip-2";
    for (let i = 0; i < RATE_MAX_REQUESTS; i++) {
      checkRateLimit(key, 0);
    }
    expect(checkRateLimit(key, 0).allowed).toBe(false);
    expect(checkRateLimit(key, RATE_WINDOW_MS + 1).allowed).toBe(true);
  });

  it("tracks keys independently", () => {
    for (let i = 0; i < RATE_MAX_REQUESTS; i++) {
      checkRateLimit("ip-a", i);
    }
    expect(checkRateLimit("ip-a", RATE_MAX_REQUESTS).allowed).toBe(false);
    expect(checkRateLimit("ip-b", RATE_MAX_REQUESTS).allowed).toBe(true);
  });

  it("resetRateLimit clears all counters", () => {
    for (let i = 0; i < RATE_MAX_REQUESTS; i++) {
      checkRateLimit("ip-c", i);
    }
    resetRateLimit();
    expect(checkRateLimit("ip-c", RATE_MAX_REQUESTS).allowed).toBe(true);
  });
});
