/**
 * Tests for the typed task state: validation, store behaviour, and the
 * protected-field rule (model output can never write orchestrator-owned fields).
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  createTask,
  getTask,
  updateTask,
  deleteSession,
  clearStore,
  applyModelUnderstanding,
  applyModelPlan,
  completeStep,
  recordToolCall,
  addEvidence,
  TaskStateSchema,
  ModelUnderstandingSchema,
  InMemoryTaskStore,
  sessionPersistenceError,
} from "../state";
import { DEMO_LABEL } from "../orchestrator";

beforeEach(() => {
  clearStore();
});

const originalSessionStore = process.env.STUDYRUNWAY_SESSION_STORE;
const originalDemoMode = process.env.STUDYRUNWAY_DEMO_MODE;
const originalFirestoreProjectId = process.env.FIRESTORE_PROJECT_ID;

afterEach(() => {
  vi.unstubAllEnvs();
  process.env.STUDYRUNWAY_SESSION_STORE = originalSessionStore;
  process.env.STUDYRUNWAY_DEMO_MODE = originalDemoMode;
  if (originalFirestoreProjectId === undefined) delete process.env.FIRESTORE_PROJECT_ID;
  else process.env.FIRESTORE_PROJECT_ID = originalFirestoreProjectId;
});

describe("task state store", () => {
  it("round-trips a task through create/get/update", () => {
    const created = createTask("sess-1");
    expect(created.sessionId).toBe("sess-1");
    expect(created.status).toBe("understanding");
    const loaded = getTask("sess-1");
    expect(loaded?.taskId).toBe(created.taskId);
    const updated = updateTask("sess-1", { status: "planning" });
    expect(updated.status).toBe("planning");
    expect(updated.taskId).toBe(created.taskId);
  });

  it("returns undefined for unknown sessions and deletes cleanly", () => {
    expect(getTask("nope")).toBeUndefined();
    createTask("sess-del");
    expect(deleteSession("sess-del")).toBe(true);
    expect(getTask("sess-del")).toBeUndefined();
  });

  it("supports isolated local stores for separate handlers", () => {
    const firstHandler = new InMemoryTaskStore();
    const secondHandler = new InMemoryTaskStore();
    const task = createTask("local-handler");
    firstHandler.set(task.sessionId, task);
    expect(firstHandler.get(task.sessionId)?.taskId).toBe(task.taskId);
    expect(secondHandler.get(task.sessionId)).toBeUndefined();
  });

  it("fails closed for production memory storage unless explicitly demo-only", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.STUDYRUNWAY_SESSION_STORE = "memory";
    delete process.env.STUDYRUNWAY_DEMO_MODE;
    expect(sessionPersistenceError()).toContain("Durable session storage is not configured");
    process.env.STUDYRUNWAY_DEMO_MODE = "true";
    expect(sessionPersistenceError()).toBeNull();
  });

  it("allows production Firestore storage when the project is configured", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.STUDYRUNWAY_SESSION_STORE = "firestore";
    delete process.env.FIRESTORE_PROJECT_ID;
    expect(sessionPersistenceError()).toContain("FIRESTORE_PROJECT_ID");
    process.env.FIRESTORE_PROJECT_ID = "studyrunway-test-project";
    expect(sessionPersistenceError()).toBeNull();
  });

  it("rejects invalid status values", () => {
    const base = createTask("sess-bad");
    expect(() =>
      TaskStateSchema.parse({ ...base, status: "teleporting" })
    ).toThrow();
  });

  it("never lets a patch change taskId or sessionId", () => {
    const created = createTask("sess-lock");
    const updated = updateTask("sess-lock", {
      taskId: "hacked",
      sessionId: "hacked",
    } as never);
    expect(updated.taskId).toBe(created.taskId);
    expect(updated.sessionId).toBe("sess-lock");
  });
});

describe("protected fields", () => {
  it("applyModelUnderstanding only writes whitelisted fields", () => {
    const state = createTask("sess-prot");
    const before = getTask("sess-prot")!;
    const parsed = ModelUnderstandingSchema.parse({
      summary: "User wants a runway forecast.",
      keyFacts: ["starts Sep 2027"],
      assumptions: ["tuition paid yearly"],
      missingInfo: ["currency"],
      currencies: ["GBP"],
      // hostile extras a model might try — must be stripped
      taskId: "hacked",
      toolCalls: [{ id: "x", tool: "y", argsSummary: "", ok: true, summary: "", at: "" }],
      status: "done",
    });
    const after = applyModelUnderstanding(state, parsed);
    expect(after.taskId).toBe(before.taskId);
    expect(after.toolCalls).toEqual([]);
    expect(after.status).toBe("understanding");
    expect(after.userGoal).toBe("User wants a runway forecast.");
    expect(after.confirmedFacts[0]).toMatchObject({ source: "model" });
    expect(after.currencies).toEqual(["GBP"]);
  });

  it("applyModelPlan resets step statuses and sets the cursor", () => {
    const state = createTask("sess-plan");
    const after = applyModelPlan(state, {
      steps: [
        { id: "s1", title: "Gather facts" },
        { id: "s2", title: "Run forecast" },
      ],
    });
    expect(after.planSteps[0].status).toBe("active");
    expect(after.planSteps[1].status).toBe("pending");
    expect(after.currentStepId).toBe("s1");
    const done = completeStep("sess-plan", "s1");
    expect(done.planSteps[0].status).toBe("done");
    expect(done.planSteps[1].status).toBe("active");
  });

  it("recordToolCall and addEvidence append orchestrator-owned records", () => {
    createTask("sess-rec");
    recordToolCall("sess-rec", {
      id: "tc1",
      tool: "forecast",
      argsSummary: "currency=GBP",
      ok: true,
      summary: "runway is 14 months",
    });
    addEvidence("sess-rec", [{ label: "tuition invoice" }]);
    const state = getTask("sess-rec")!;
    expect(state.toolCalls).toHaveLength(1);
    expect(state.toolCalls[0].at).toBeTruthy();
    expect(state.evidence).toHaveLength(1);
  });

  it("demo label constant is the honest fallback string", () => {
    expect(DEMO_LABEL).toBe("Demo mode — no model provider configured");
  });
});
