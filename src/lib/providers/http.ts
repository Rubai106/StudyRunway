/**
 * Shared HTTP helper for provider adapters.
 * Throws HttpError on non-2xx; throws on timeout. Never logs request bodies
 * (they may contain user data) and never logs API keys.
 */

/** Thrown for non-2xx provider responses. `status` drives retry decisions. */
export class HttpError extends Error {
  readonly status: number;
  readonly bodySnippet: string;
  constructor(status: number, bodySnippet: string) {
    super(`provider HTTP ${status}: ${bodySnippet.slice(0, 200)}`);
    this.name = "HttpError";
    this.status = status;
    this.bodySnippet = bodySnippet;
  }
}

export interface PostJsonOptions {
  headers: Record<string, string>;
  /** Body is JSON-serialised. */
  body: unknown;
  /** Per-call timeout in ms. */
  timeoutMs: number;
}

/** POST JSON and parse the JSON response. */
export async function postJson(
  url: string,
  opts: PostJsonOptions
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...opts.headers },
      body: JSON.stringify(opts.body),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new HttpError(res.status, text);
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error("provider returned non-JSON response");
    }
  } catch (err) {
    if (
      err instanceof Error &&
      err.name === "AbortError"
    ) {
      throw new Error(`provider request timed out after ${opts.timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
