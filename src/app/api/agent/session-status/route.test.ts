import { beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/agent/session-status/route";
import { clearStore, createTask } from "@/lib/agent/state";

function get(sessionId?: string): Request {
  const url = new URL("http://localhost/api/agent/session-status");
  if (sessionId !== undefined) url.searchParams.set("sessionId", sessionId);
  return new Request(url);
}

describe("GET /api/agent/session-status", () => {
  beforeEach(() => clearStore());

  it("rejects a missing or invalid session id", async () => {
    expect((await GET(get())).status).toBe(400);
    expect((await GET(get("bad id"))).status).toBe(400);
  });

  it("reports an active server-side task", async () => {
    createTask("active-session-1");
    const res = await GET(get("active-session-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ active: true, status: "understanding" });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("reports a missing task as inactive instead of throwing", async () => {
    const res = await GET(get("expired-session-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ active: false, status: null });
  });
});
