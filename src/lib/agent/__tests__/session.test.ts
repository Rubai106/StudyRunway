/**
 * Session-ID validation + isolation tests (Part K).
 *
 * - The allowlist (letters/digits/dash/underscore, 1–128 chars) rejects
 *   everything else with a clear message.
 * - One session cannot read or delete another's state: unknown ids resolve to
 *   nothing, never to someone else's task.
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  isValidSessionId,
  sessionIdError,
  SESSION_ID_MAX_LENGTH,
  requestOriginError,
} from "../session";
import { createTask, getTask, deleteSession, clearStore } from "../state";

describe("session ID validation", () => {
  it("accepts well-formed ids", () => {
    expect(isValidSessionId("abc-123_XYZ")).toBe(true);
    expect(isValidSessionId("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(sessionIdError("abc-123_XYZ")).toBeNull();
  });

  it("rejects empty, over-long, and bad-charset ids with clear messages", () => {
    expect(sessionIdError("")).toBe("sessionId is required");
    expect(sessionIdError(undefined)).toBe("sessionId is required");
    expect(sessionIdError(123)).toBe("sessionId is required");
    const tooLong = "a".repeat(SESSION_ID_MAX_LENGTH + 1);
    expect(isValidSessionId(tooLong)).toBe(false);
    expect(sessionIdError(tooLong)).toMatch(/too long/);
    for (const bad of ["a b", "a/b", "a?b=1", "a;b", "../x", "a$b", "é"]) {
      expect(isValidSessionId(bad), bad).toBe(false);
      expect(sessionIdError(bad), bad).toMatch(/may only contain/);
    }
  });

  it("caps length at exactly 128", () => {
    expect(isValidSessionId("a".repeat(128))).toBe(true);
    expect(isValidSessionId("a".repeat(129))).toBe(false);
  });
});

describe("session isolation", () => {
  beforeEach(() => {
    clearStore();
  });

  it("one session cannot read another's state", () => {
    createTask("session-a");
    expect(getTask("session-a")).toBeDefined();
    // A mismatched id resolves to nothing — never to session-a's task.
    expect(getTask("session-b")).toBeUndefined();
    expect(getTask("session-a;DROP")).toBeUndefined();
  });

  it("one session cannot delete another's state", () => {
    createTask("session-a");
    // Deleting a different (valid-format) id removes nothing and reports it.
    expect(deleteSession("session-b")).toBe(false);
    expect(getTask("session-a")).toBeDefined();
    // Deleting the right id works.
    expect(deleteSession("session-a")).toBe(true);
    expect(getTask("session-a")).toBeUndefined();
  });
});


describe("request origin validation", () => {
  it("allows same-origin and origin-less requests, rejects cross-origin requests", () => {
    expect(requestOriginError(new Request("http://localhost/api/agent/chat"))).toBeNull();
    expect(requestOriginError(new Request("http://localhost/api/agent/chat", {
      headers: { origin: "http://localhost" },
    }))).toBeNull();
    expect(requestOriginError(new Request("http://localhost/api/agent/chat", {
      headers: { origin: "http://127.0.0.1" },
    }))).toBeNull();
    expect(requestOriginError(new Request("http://127.0.0.1/api/agent/chat", {
      headers: { origin: "http://localhost" },
    }))).toBeNull();
    expect(requestOriginError(new Request("http://localhost/api/agent/chat", {
      headers: { origin: "https://studyrunway-agent-dnwlfigpsa-el.a.run.app" },
    }))).toMatch(/origin not allowed/i);
    expect(requestOriginError(new Request("http://localhost/api/agent/chat", {
      headers: { origin: "https://attacker.example" },
    }))).toMatch(/origin not allowed/i);
    expect(requestOriginError(new Request("http://localhost/api/agent/chat", {
      headers: { origin: "not a url" },
    }))).toMatch(/origin not allowed/i);
  });
});
