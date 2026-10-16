/**
 * Privacy-limited structured audit records for server-side agent activity.
 *
 * Keep this schema deliberately narrow: prompts, answers, document contents,
 * tool arguments/results, session IDs, and provider error bodies must never be
 * added here. JSON lines on stdout can be ingested by Cloud Logging on Google
 * Cloud deployments; retention and access controls are configured there.
 */
import type { TaskStatus } from "./state";

type QuestionKind = "quick_replies" | "date" | "amount" | "currency" | "form";

export type AgentAuditEvent =
  | { type: "agent.turn.started"; taskId: string; resumed: boolean }
  | {
      type: "agent.turn.finished";
      taskId: string;
      status: TaskStatus;
      toolCallCount: number;
    }
  | {
      type: "agent.clarification.requested";
      taskId: string;
      questionCount: number;
      questionKinds: QuestionKind[];
    }
  | {
      type: "agent.answer.submitted";
      taskId: string;
      questionKind: QuestionKind;
      answerFieldCount: number;
    }
  | {
      type: "agent.approval.decided";
      taskId: string;
      tool: string;
      decision: "approved" | "denied";
    }
  | {
      type: "agent.tool.completed";
      taskId: string;
      tool: string;
      ok: boolean;
      durationMs: number;
    }
  | { type: "agent.session.deleted"; taskId: string };

/** Emit one JSON object per line for structured log ingestion. */
export function writeAuditEvent(event: AgentAuditEvent): void {
  const record: Record<string, unknown> = {
    severity: "INFO",
    logName: "studyrunway-audit",
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    event: event.type,
  };

  // Copy fields one by one. Never spread caller objects into an audit record:
  // runtime payloads can contain more than their TypeScript type declares.
  if ("taskId" in event) record.taskId = safeTaskId(event.taskId);
  switch (event.type) {
    case "agent.turn.started":
      record.resumed = Boolean(event.resumed);
      break;
    case "agent.turn.finished":
      record.status = safeStatus(event.status);
      record.toolCallCount = safeCount(event.toolCallCount, 100);
      break;
    case "agent.clarification.requested":
      record.questionCount = safeCount(event.questionCount, 10);
      record.questionKinds = event.questionKinds.filter(isQuestionKind);
      break;
    case "agent.answer.submitted":
      record.questionKind = isQuestionKind(event.questionKind)
        ? event.questionKind
        : "form";
      record.answerFieldCount = safeCount(event.answerFieldCount, 10);
      break;
    case "agent.approval.decided":
      record.tool = safeToolName(event.tool);
      record.decision = event.decision === "approved" ? "approved" : "denied";
      break;
    case "agent.tool.completed":
      record.tool = safeToolName(event.tool);
      record.ok = Boolean(event.ok);
      record.durationMs = safeCount(event.durationMs, 86_400_000);
      break;
    case "agent.session.deleted":
      break;
  }

  try {
    console.info(JSON.stringify(record));
  } catch {
    // Audit output must not break a user's financial-planning request.
  }
}

function safeToolName(value: string): string {
  return /^[a-z][a-z0-9_]{0,63}$/.test(value) ? value : "unknown";
}

function safeTaskId(value: string): string {
  return /^task_[a-z0-9_]{1,80}$/.test(value) ? value : "invalid";
}

function safeCount(value: number, maximum: number): number {
  return Number.isFinite(value)
    ? Math.min(maximum, Math.max(0, Math.trunc(value)))
    : 0;
}

function safeStatus(value: TaskStatus): TaskStatus {
  return ["understanding", "clarifying", "planning", "executing", "verifying", "done", "failed"].includes(value)
    ? value
    : "failed";
}

function isQuestionKind(value: string): value is QuestionKind {
  return ["quick_replies", "date", "amount", "currency", "form"].includes(value);
}
