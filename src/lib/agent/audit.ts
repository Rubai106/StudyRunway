/**
 * Privacy-limited structured audit records for server-side agent activity.
 *
 * Keep this schema deliberately narrow: prompts, answers, document contents,
 * tool arguments/results, session IDs, and provider error bodies must never be
 * added here. Google Cloud deployments can send these records directly to
 * Cloud Logging. Local development keeps using structured stdout.
 */
import { GoogleAuth } from "google-auth-library";
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
  | {
      type: "agent.plan.changed";
      taskId: string;
      action: "funding_check" | "budget_apply" | "budget_revert";
      ok: boolean;
    }
  | {
      type: "agent.safe_action.completed";
      taskId?: string;
      action: string;
      ok: boolean;
    }
  | { type: "agent.session.deleted"; taskId: string };

type SafeAuditRecord = Record<string, unknown> & {
  severity: "INFO";
  logName: "studyrunway-audit";
  schemaVersion: 1;
  timestamp: string;
  event: AgentAuditEvent["type"];
};

/** Create only the approved, privacy-limited fields for an audit event. */
function createAuditRecord(event: AgentAuditEvent): SafeAuditRecord {
  const record: Record<string, unknown> = {
    severity: "INFO",
    logName: "studyrunway-audit",
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    event: event.type,
  };

  // Copy fields one by one. Never spread caller objects into an audit record:
  // runtime payloads can contain more than their TypeScript type declares.
  if ("taskId" in event && typeof event.taskId === "string") {
    record.taskId = safeTaskId(event.taskId);
  }
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
    case "agent.plan.changed":
      record.action = isPlanAction(event.action) ? event.action : "funding_check";
      record.ok = Boolean(event.ok);
      break;
    case "agent.safe_action.completed":
      record.action = safeToolName(event.action);
      record.ok = Boolean(event.ok);
      break;
    case "agent.session.deleted":
      break;
  }

  return record as SafeAuditRecord;
}

/**
 * Persist an approved audit record. Cloud Logging write failures fall back to
 * structured stdout so normal planning requests still work; Cloud Run also
 * ingests stdout, and an explicit marker makes the fallback visible.
 */
export async function writeAuditEvent(event: AgentAuditEvent): Promise<void> {
  const record = createAuditRecord(event);
  const store = (process.env.STUDYRUNWAY_AUDIT_STORE ?? "stdout").trim().toLowerCase();

  try {
    if (store === "cloud-logging") {
      await writeCloudLoggingRecord(record);
      return;
    }
  } catch {
    emitStdoutFallback(record, true);
    return;
  }

  // Unknown store values fail safely to stdout and are not treated as durable.
  emitStdoutFallback(record, store !== "stdout");
}

/** Build a Cloud Logging entry from fields supplied by the trusted runtime. */
function cloudLoggingPayload(record: SafeAuditRecord, projectId: string) {
  return {
    logName: `projects/${projectId}/logs/studyrunway-audit`,
    resource: cloudRunResource(projectId),
    entries: [
      {
        timestamp: record.timestamp,
        severity: record.severity,
        insertId: crypto.randomUUID(),
        jsonPayload: {
          schemaVersion: record.schemaVersion,
          event: record.event,
          ...auditFields(record),
        },
      },
    ],
  };
}

function auditFields(record: SafeAuditRecord): Record<string, unknown> {
  const { severity: _severity, logName: _logName, schemaVersion: _schemaVersion, timestamp: _timestamp, event: _event, ...fields } = record;
  void _severity;
  void _logName;
  void _schemaVersion;
  void _timestamp;
  void _event;
  return fields;
}

function cloudRunResource(projectId: string) {
  const service = process.env.K_SERVICE;
  const revision = process.env.K_REVISION;
  const location = process.env.K_REGION;
  if (service && revision && location) {
    return {
      type: "cloud_run_revision",
      labels: {
        project_id: projectId,
        location,
        service_name: service,
        revision_name: revision,
        configuration_name: process.env.K_CONFIGURATION ?? "",
      },
    };
  }
  return { type: "global", labels: { project_id: projectId } };
}

async function writeCloudLoggingRecord(record: SafeAuditRecord): Promise<void> {
  const projectId = (
    process.env.GOOGLE_CLOUD_PROJECT ??
    process.env.GCLOUD_PROJECT ??
    process.env.VERTEX_AI_PROJECT
  )?.trim();
  if (!projectId) throw new Error("Cloud Logging project is not configured");

  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/logging.write"],
  });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  if (!token) throw new Error("Cloud Logging credentials are unavailable");

  const response = await fetch("https://logging.googleapis.com/v2/entries:write", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(cloudLoggingPayload(record, projectId)),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error("Cloud Logging rejected the audit record");
}

function emitStdoutFallback(record: SafeAuditRecord, misconfigured = false): void {
  try {
    console.info(JSON.stringify(misconfigured ? { ...record, auditStoreFallback: true } : record));
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

function isPlanAction(value: string): value is Extract<AgentAuditEvent, { type: "agent.plan.changed" }>["action"] {
  return ["funding_check", "budget_apply", "budget_revert"].includes(value);
}
