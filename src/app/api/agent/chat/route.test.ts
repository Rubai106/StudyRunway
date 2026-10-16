/**
 * API route security tests (Part K): session-ID validation, body-size caps,
 * per-IP rate limiting, DELETE isolation (404 for unknown, never a leak) and
 * the Origin check on the state-changing DELETE.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { POST as chatPOST, DELETE as chatDELETE } from "@/app/api/agent/chat/route";
import { createTask, clearStore } from "@/lib/agent/state";
import { resetRateLimit } from "@/lib/agent/rateLimit";

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/agent/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function del(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { method: "DELETE", headers });
}

describe("POST /api/agent/chat protections", () => {
  beforeEach(() => {
    clearStore();
    resetRateLimit();
  });

  it("rejects invalid sessionIds with 400 before any work", async () => {
    for (const bad of ["", "a b", "../x", "a".repeat(200)]) {
      const res = await chatPOST(post({ sessionId: bad, message: "hi" }));
      expect(res.status, String(bad).slice(0, 10)).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/sessionId/);
    }
  });

  it("rejects oversized bodies with 413", async () => {
    const res = await chatPOST(
      post({ sessionId: "ok-session", message: "hi" }, { "content-length": String(300 * 1024) })
    );
    expect(res.status).toBe(413);
  });

  it("rate-limits per IP with 429 after the window is exhausted", async () => {
    const headers = { "x-forwarded-for": "203.0.113.7" };
    let last: Response | null = null;
    for (let i = 0; i < 31; i++) {
      last = await chatPOST(post({ sessionId: "bad id", message: "hi" }, headers));
    }
    expect(last!.status).toBe(429);
    expect(last!.headers.get("Retry-After")).toBeTruthy();
    const body = (await last!.json()) as { error: string };
    expect(body.error).toMatch(/rate limit/);
  });
});

describe("DELETE /api/agent/chat session handling", () => {
  beforeEach(() => {
    clearStore();
    resetRateLimit();
  });

  it("rejects invalid sessionIds with 400", async () => {
    const res = await chatDELETE(del("http://localhost/api/agent/chat?sessionId=a%20b"));
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown sessions — never another session's state", async () => {
    createTask("real-session");
    const res = await chatDELETE(
      del("http://localhost/api/agent/chat?sessionId=other-session")
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(false);
  });

  it("deletes the caller's own session", async () => {
    createTask("mine-123");
    const res = await chatDELETE(del("http://localhost/api/agent/chat?sessionId=mine-123"));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
    const again = await chatDELETE(del("http://localhost/api/agent/chat?sessionId=mine-123"));
    expect(again.status).toBe(404);
  });

  it("rejects a mismatched Origin on the state-changing DELETE", async () => {
    createTask("origin-session");
    const evil = await chatDELETE(
      del("http://localhost/api/agent/chat?sessionId=origin-session", {
        origin: "https://evil.example",
      })
    );
    expect(evil.status).toBe(403);
    const same = await chatDELETE(
      del("http://localhost/api/agent/chat?sessionId=origin-session", {
        origin: "http://localhost",
      })
    );
    expect(same.status).toBe(200);
  });
});
