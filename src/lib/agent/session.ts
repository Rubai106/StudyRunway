/**
 * Session-ID validation (competition-demo mitigation).
 *
 * Session IDs are client-supplied, so the API routes validate them against a
 * strict allowlist: 1–128 chars of letters, digits, dash, underscore. Anything
 * else is rejected with a clear 400 before any state is touched. Combined with
 * per-session keying in the store, one session cannot read or delete another's
 * state (unknown ids → 404, never a leak).
 */

export const SESSION_ID_MAX_LENGTH = 128;

const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/** True when `id` is a well-formed session id. */
export function isValidSessionId(id: unknown): id is string {
  return typeof id === "string" && SESSION_ID_RE.test(id);
}

/** Human-readable rejection reason, or null when the id is valid. */
export function sessionIdError(id: unknown): string | null {
  if (typeof id !== "string" || id.length === 0) {
    return "sessionId is required";
  }
  if (id.length > SESSION_ID_MAX_LENGTH) {
    return `sessionId is too long (max ${SESSION_ID_MAX_LENGTH} characters)`;
  }
  if (!SESSION_ID_RE.test(id)) {
    return "sessionId may only contain letters, numbers, dash (-) and underscore (_)";
  }
  return null;
}

/**
 * Reject cross-origin browser requests to state-changing API routes. Requests
 * without Origin are allowed for non-browser clients and test harnesses; this
 * is a CSRF mitigation, not authentication or a substitute for production auth.
 */
export function requestOriginError(req: Request): string | null {
  const origin = req.headers.get("origin");
  if (!origin) return null;
  try {
    const originUrl = new URL(origin);
    const requestUrl = new URL(req.url);
    return originUrl.origin === requestUrl.origin
      ? null
      : "origin not allowed for this request";
  } catch {
    return "origin not allowed for this request";
  }
}
