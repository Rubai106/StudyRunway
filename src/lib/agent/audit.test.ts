import { afterEach, describe, expect, it, vi } from "vitest";
import { writeAuditEvent, type AgentAuditEvent } from "./audit";

describe("agent audit logging", () => {
  afterEach(() => vi.restoreAllMocks());

  it("emits structured records without copying unapproved payload fields", () => {
    const output = vi.spyOn(console, "info").mockImplementation(() => undefined);

    writeAuditEvent({
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

  it("bounds and sanitizes values included in audit records", () => {
    const output = vi.spyOn(console, "info").mockImplementation(() => undefined);

    writeAuditEvent({
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
});
