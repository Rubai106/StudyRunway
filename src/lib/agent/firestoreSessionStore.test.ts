import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearStore, getTask, updateTask } from "./state";
import { withPersistentSession } from "./firestoreSessionStore";

vi.mock("google-auth-library", () => ({
  GoogleAuth: class {
    async getAccessToken() {
      return "test-access-token";
    }
  },
}));

interface StoredDocument {
  updateTime: string;
  fields: Record<string, { stringValue?: string; timestampValue?: string }>;
}

const documents = new Map<string, StoredDocument>();
let nextVersion = 0;

function documentId(url: URL): string {
  return decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
}

beforeEach(() => {
  clearStore();
  documents.clear();
  nextVersion = 0;
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("STUDYRUNWAY_SESSION_STORE", "firestore");
  vi.stubEnv("FIRESTORE_PROJECT_ID", "studyrunway-test-project");
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const id = documentId(url);
    const method = init?.method ?? "GET";
    const current = documents.get(id);

    if (method === "GET") {
      return current ? Response.json(current) : new Response(null, { status: 404 });
    }
    if (method === "DELETE") {
      const expected = url.searchParams.get("currentDocument.updateTime");
      if (!current) return new Response(null, { status: 404 });
      if (expected !== current.updateTime) return new Response(null, { status: 412 });
      documents.delete(id);
      return new Response(null, { status: 200 });
    }
    if (method === "PATCH") {
      const expected = url.searchParams.get("currentDocument.updateTime");
      const mustNotExist = url.searchParams.get("currentDocument.exists") === "false";
      if ((mustNotExist && current) || (expected && expected !== current?.updateTime)) {
        return new Response(null, { status: 412 });
      }
      const body = JSON.parse(String(init?.body)) as { fields: StoredDocument["fields"] };
      const document = {
        updateTime: `2026-10-20T00:00:${String(++nextVersion).padStart(2, "0")}Z`,
        fields: body.fields,
      };
      documents.set(id, document);
      return Response.json(document);
    }
    return new Response(null, { status: 405 });
  }));
});

afterEach(() => {
  clearStore();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Firestore-backed task state", () => {
  it("commits before returning JSON and restores a task after a process reset", async () => {
    const first = await withPersistentSession("user_session_one", async () => {
      updateTask("user_session_one", { originalRequest: "plan for tuition" });
      return Response.json({ saved: true });
    });
    expect(first.status).toBe(200);
    expect(documents.has("user_session_one")).toBe(true);

    clearStore();
    const restored = await withPersistentSession("user_session_one", async () =>
      Response.json({ request: getTask("user_session_one")?.originalRequest }),
    );
    expect(await restored.json()).toEqual({ request: "plan for tuition" });
  });

  it("rejects a stale concurrent write instead of overwriting the newer task", async () => {
    const id = "user_session_two";
    await withPersistentSession(id, async () => {
      updateTask(id, { originalRequest: "initial" });
      return Response.json({ saved: true });
    });
    clearStore();

    const baseFetch = globalThis.fetch;
    let readCount = 0;
    let releaseReads!: () => void;
    const bothRead = new Promise<void>((resolve) => { releaseReads = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await baseFetch(input, init);
      if ((init?.method ?? "GET") === "GET") {
        readCount += 1;
        if (readCount === 2) releaseReads();
        await bothRead;
      }
      return response;
    }));

    const results = await Promise.all([
      withPersistentSession(id, async () => {
        updateTask(id, { userGoal: "first concurrent edit" });
        return Response.json({ saved: "first" });
      }),
      withPersistentSession(id, async () => {
        updateTask(id, { userGoal: "second concurrent edit" });
        return Response.json({ saved: "second" });
      }),
    ]);
    expect(results.map((response) => response.status).sort()).toEqual([200, 409]);
  });

  it("returns a storage error when Firestore is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 403 })));
    const response = await withPersistentSession("user_session_three", async () =>
      Response.json({ shouldNotRun: true }),
    );
    expect(response.status).toBe(503);
  });
});
