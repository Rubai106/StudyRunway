import { afterEach, describe, expect, it, vi } from "vitest";
import { writeAuditEvent, type AgentAuditEvent } from "./audit";

vi.mock("google-auth-library", () => ({
  GoogleAuth: vi.fn(() => ({
    getClient: async () => ({ getAccessToken: async () => ({ token: "test-access-token" }) }),
  })),
}));

describe("agent audit logging", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("emits structured stdout records without copying unapproved payload fields", async () => {
    vi.stubEnv("STUDYRUNWAY_AUDIT_STORE", "stdout");
    const output = vi.spyOn(console, "info").mockImplementation(() => undefined);

    await writeAuditEvent({
      type: "agent.tool.completed",
      taskId: "task_mabc_123xyz",
      tool: "compare_transfers",
      ok: true,
      durationMs: 42,
      // Runtime objects can carry more fields than their declared type.
      sessionId: "private-session-id",
      prompt: "My tuition is USD 12,345",
      arguments: { amount: 12345, bankAccount: "private" },
    } as AgentAuditEvent);

    expect(output).toHaveBeenCalledOnce();
    const record = JSON.parse(output.mock.calls[0][0] as string);
    expect(record).toMatchObject({
      severity: "INFO",
      logName: "studyrunway-audit",
      event: "agent.tool.completed",
      taskId: "task_mabc_123xyz",
      tool: "compare_transfers",
      ok: true,
      durationMs: 42,
    });
    expect(record).not.toHaveProperty("sessionId");
    expect(record).not.toHaveProperty("prompt");
    expect(record).not.toHaveProperty("arguments");
    expect(JSON.stringify(record)).not.toContain("12,345");
  });

  it("writes sanitized audit data to the Cloud Logging API", async () => {
    vi.stubEnv("STUDYRUNWAY_AUDIT_STORE", "cloud-logging");
    vi.stubEnv("VERTEX_AI_PROJECT", "test-project");
    vi.stubEnv("K_SERVICE", "studyrunway-agent");
    vi.stubEnv("K_REVISION", "studyrunway-agent-00001-test");
    vi.stubEnv("K_REGION", "asia-south1");
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await writeAuditEvent({
      type: "agent.plan.changed",
      taskId: "task_mabc_123xyz",
      action: "budget_apply",
      ok: true,
      prompt: "private amount USD 12345",
    } as AgentAuditEvent);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://logging.googleapis.com/v2/entries:write");
    expect((request.headers as Record<string, string>).authorization).toBe("Bearer test-access-token");
    const payload = JSON.parse(request.body as string);
    expect(payload).toMatchObject({
      logName: "projects/test-project/logs/studyrunway-audit",
      resource: {
        type: "cloud_run_revision",
        labels: { project_id: "test-project", location: "asia-south1", service_name: "studyrunway-agent" },
      },
      entries: [{ jsonPayload: { schemaVersion: 1, event: "agent.plan.changed", taskId: "task_mabc_123xyz", action: "budget_apply", ok: true } }],
    });
    expect(JSON.stringify(payload)).not.toContain("private amount");
    expect(JSON.stringify(payload)).not.toContain("12345");
  });

  it("falls back to structured stdout if the Cloud Logging write fails", async () => {
    vi.stubEnv("STUDYRUNWAY_AUDIT_STORE", "cloud-logging");
    vi.stubEnv("VERTEX_AI_PROJECT", "test-project");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 403 })));
    const output = vi.spyOn(console, "info").mockImplementation(() => undefined);

    await expect(writeAuditEvent({
      type: "agent.session.deleted",
      taskId: "task_mabc_123xyz",
    })).resolves.toBeUndefined();

    expect(output).toHaveBeenCalledOnce();
    const record = JSON.parse(output.mock.calls[0][0] as string);
    expect(record.auditStoreFallback).toBe(true);
    expect(record.event).toBe("agent.session.deleted");
  });

  it("bounds and sanitizes values included in audit records", async () => {
    vi.stubEnv("STUDYRUNWAY_AUDIT_STORE", "stdout");
    const output = vi.spyOn(console, "info").mockImplementation(() => undefined);

    await writeAuditEvent({
      type: "agent.approval.decided",
      taskId: "user-controlled-private-value",
      tool: "draft_email\nINJECTED",
      decision: "approved",
    });

    const record = JSON.parse(output.mock.calls[0][0] as string);
    expect(record.taskId).toBe("invalid");
    expect(record.tool).toBe("unknown");
    expect(JSON.stringify(record)).not.toContain("INJECTED");
  });

  it("records safe-action outcomes even before a task exists", async () => {
    vi.stubEnv("STUDYRUNWAY_AUDIT_STORE", "stdout");
    const output = vi.spyOn(console, "info").mockImplementation(() => undefined);

    await writeAuditEvent({
      type: "agent.safe_action.completed",
      action: "simulate",
      ok: false,
    });

    const record = JSON.parse(output.mock.calls[0][0] as string);
    expect(record).toMatchObject({ event: "agent.safe_action.completed", action: "simulate", ok: false });
    expect(record).not.toHaveProperty("taskId");
  });
});
