/**
 * Session-ID validation (competition-demo mitigation).
 *
 * Session IDs are client-supplied, so the API routes validate them against a
 * strict allowlist: 1–128 chars of letters, digits, dash, underscore. Anything
 * else is rejected with a clear 400 before any state is touched. Combined with
 * per-session keying in the store, one session cannot read or delete another's
 * state (unknown ids → 404, never a leak).
 */
import { sessionPersistenceError } from "./state";

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

    // Reverse proxies such as Cloud Run terminate HTTPS before the request
    // reaches Next.js. In that case req.url can reflect the internal HTTP
    // address while the browser Origin contains the public HTTPS origin.
    // Compare against the externally visible Host and forwarded protocol when
    // available, then fall back to the request URL for local/test runtimes.
    const host = req.headers.get("host")?.split(",")[0].trim();
    const forwardedProtocol = req.headers
      .get("x-forwarded-proto")
      ?.split(",")[0]
      .trim()
      .replace(/:$/, "");
    const protocol = forwardedProtocol
      ? `${forwardedProtocol}:`
      : requestUrl.protocol;
    const requestOrigin = host && (protocol === "http:" || protocol === "https:")
      ? new URL(`${protocol}//${host}`).origin
      : requestUrl.origin;

    const isLoopback = (url: URL): boolean =>
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]" || url.hostname === "::1");
    const requestOriginUrl = new URL(requestOrigin);
    const sameOrigin = originUrl.origin === requestOrigin;
    const localDevelopmentPair = isLoopback(originUrl) && isLoopback(requestOriginUrl);

    return sameOrigin || localDevelopmentPair
      ? null
      : "origin not allowed for this request";
  } catch {
    return "origin not allowed for this request";
  }
}

/** Return a safe 503 instead of silently using process-local state in production. */
export function sessionPersistenceResponse(): Response | null {
  const error = sessionPersistenceError();
  return error
    ? Response.json({ error, code: "SESSION_PERSISTENCE_UNAVAILABLE" }, { status: 503 })
    : null;
}
