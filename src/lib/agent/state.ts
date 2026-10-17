/**
 * Typed agent task state — owned by the AGENT CORE workstream.
 *
 * A TaskState is the single source of truth for one user task: the goal, the
 * facts gathered, the plan, the tool-call log, evidence, pending questions,
 * and approvals. It is zod-validated on every read/write.
 *
 * STORAGE LIMITATION (demo): the store is an in-memory Map keyed by
 * sessionId. It is cleared on server restart and is not shared across
 * instances. Do not treat it as durable storage — it exists so the demo and
 * judging flow works without a database. The client can delete a session via
 * DELETE /api/agent/chat?sessionId=...
 *
 * PII: the state may hold facts the user typed. It is never sent to a model
 * provider wholesale — the orchestrator forwards only task-relevant fields.
 */
import { z } from "zod";
import { ToolPlanSchema } from "../tools/common";

export const TaskStatusSchema = z.enum([
  "understanding",
  "clarifying",
  "planning",
  "executing",
  "verifying",
  "done",
  "failed",
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const ClarifyQuestionSchema = z.object({
  id: z.string().min(1).max(80),
  kind: z.enum(["quick_replies", "date", "amount", "currency", "form"]),
  prompt: z.string().min(1).max(600),
  options: z.array(z.string().max(120)).max(40).optional(),
  fields: z
    .array(
      z.object({
        name: z.string().min(1).max(60),
        label: z.string().min(1).max(120),
        type: z.enum(["text", "number", "date", "select"]),
        options: z.array(z.string().max(120)).max(40).optional(),
        required: z.boolean(),
      })
    )
    .max(10)
    .optional(),
});
export type ClarifyQuestion = z.infer<typeof ClarifyQuestionSchema>;

const FactSchema = z.object({
  key: z.string().min(1).max(120),
  value: z.string().min(1).max(1000),
  /** Original clarification prompt, when this fact came from a user's answer. */
  question: z.string().max(300).optional(),
  /** Where the fact came from: "user" | "tool:<name>" | "model". */
  source: z.string().min(1).max(120),
});

const PlanStepSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().min(1).max(200),
  detail: z.string().max(600).optional(),
  status: z.enum(["pending", "active", "done", "skipped"]),
});

const ToolCallRecordSchema = z.object({
  id: z.string().min(1).max(80),
  tool: z.string().min(1).max(120),
  /** Redacted summary of args (never full payloads). */
  argsSummary: z.string().max(500),
  /**
   * Validated args, kept server-side so the verification step can recompute
   * the call deterministically. Never sent to the client or the provider.
   */
  args: z.record(z.unknown()).optional(),
  ok: z.boolean(),
  summary: z.string().max(1000),
  at: z.string(),
});

const ApprovalRecordSchema = z.object({
  id: z.string().min(1).max(80),
  tool: z.string().min(1).max(120),
  argsSummary: z.string().max(500),
  decision: z.enum(["approved", "denied"]),
  at: z.string(),
});

export const SafeToSendWorkflowStageSchema = z.enum([
  "INTAKE",
  "COLLECTING_INFORMATION",
  "FUNDING_PLAN_READY",
  "SCENARIO_EVALUATED",
  "RECOVERY_REVIEW",
  "AWAITING_APPROVAL",
  "SIMULATED",
  "REVERTED",
  "BLOCKED",
]);
export type SafeToSendWorkflowStage = z.infer<typeof SafeToSendWorkflowStageSchema>;

export const SafeToSendEventSchema = z.object({
  id: z.string().min(1).max(120),
  at: z.string(),
  type: z.enum([
    "input_collected",
    "timeline_calculated",
    "scenario_applied",
    "recovery_applied",
    "decision_evaluated",
    "approval_requested",
    "approval_rejected",
    "simulation_applied",
    "simulation_reverted",
    "receipt_confirmed",
    "blocked",
    "error",
  ]),
  status: z.enum(["pending", "completed", "blocked", "failed"]),
  label: z.string().min(1).max(240),
  detail: z.string().max(1000).optional(),
  data: z.record(z.unknown()).optional(),
});
export type SafeToSendEvent = z.infer<typeof SafeToSendEventSchema>;

const SafeToSendStateSchema = z.object({
  draft: z.record(z.unknown()).nullable().default(null),
  decision: z.record(z.unknown()).nullable().default(null),
  records: z.array(z.record(z.unknown())).default([]),
  workflowStage: SafeToSendWorkflowStageSchema.default("INTAKE"),
  events: z.array(SafeToSendEventSchema).default([]),
});

export const TaskStateSchema = z.object({
  taskId: z.string().min(1),
  sessionId: z.string().min(1),
  /** Original user request retained so clarification resumes do not lose intent. */
  originalRequest: z.string().max(4000).default(""),
  userGoal: z.string().max(2000).default(""),
  confirmedFacts: z.array(FactSchema).default([]),
  /** Model/user hypotheses, always labelled as unconfirmed. */
  assumptions: z.array(FactSchema).default([]),
  missingInfo: z.array(z.string().max(300)).default([]),
  currencies: z.array(z.string().max(8)).default([]),
  deadlines: z
    .array(z.object({ label: z.string().max(200), date: z.string().max(40) }))
    .default([]),
  planSteps: z.array(PlanStepSchema).default([]),
  currentStepId: z.string().max(80).nullable().default(null),
  toolCalls: z.array(ToolCallRecordSchema).default([]),
  evidence: z
    .array(z.object({ label: z.string().max(300), detail: z.string().max(600).optional() }))
    .default([]),
  pendingQuestions: z.array(ClarifyQuestionSchema).default([]),
  /** An approval gate the orchestrator is currently paused on. */
  pendingApproval: z
    .object({
      id: z.string().min(1).max(80),
      tool: z.string().min(1).max(120),
      label: z.string().max(300),
      argsSummary: z.string().max(500),
      args: z.record(z.unknown()),
    })
    .nullable()
    .default(null),
  /** Tool calls the user approved via /api/agent/answer, queued for execution. */
  approvedCalls: z
    .array(
      z.object({
        id: z.string().min(1).max(80),
        tool: z.string().min(1).max(120),
        args: z.record(z.unknown()),
      })
    )
    .default([]),
  approvals: z.array(ApprovalRecordSchema).default([]),
  /**
   * The user's current working financial plan (funding sources + obligations
   * + planning currency + FX). Seeded from the sample plan when a budget is
   * applied with no plan yet (demo behaviour); the model flow passes its own
   * plan objects to the tools instead.
   */
  workingPlan: ToolPlanSchema.nullable().default(null),
  /**
   * Record of a destination budget applied via planToObligations (see
   * src/lib/budgetApply.ts). The obligations themselves live inside
   * workingPlan.obligations with "lcp-" prefixed ids; this record is the
   * idempotency guard and the revert manifest.
   */
  appliedBudget: z
    .object({
      destinationId: z.string().min(1),
      destinationLabel: z.string().min(1),
      appliedAt: z.string(),
      obligationIds: z.array(z.string().min(1)),
      startDate: z.string(),
      studyMonths: z.number().int().min(1).max(60),
    })
    .nullable()
    .default(null),
  /** Safe-to-Send tuition-payment workflow state (deterministic sandbox). */
  safeToSend: SafeToSendStateSchema.default({
    draft: null,
    decision: null,
    records: [],
    workflowStage: "INTAKE",
    events: [],
  }),
  status: TaskStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TaskState = z.infer<typeof TaskStateSchema>;

// ---------------------------------------------------------------------------
// In-memory store (demo limitation — see header comment).
// ---------------------------------------------------------------------------

// Use a globalThis-backed map so Next.js development hot reloads do not wipe
// live task state when an API route recompiles. The map is still process-local:
// a true process restart clears it, and production instances are not shared.
type StoreGlobal = typeof globalThis & {
  __studyrunwayAgentTaskStore?: Map<string, TaskState>;
};
const storeGlobal = globalThis as StoreGlobal;
const store =
  storeGlobal.__studyrunwayAgentTaskStore ??
  (storeGlobal.__studyrunwayAgentTaskStore = new Map<string, TaskState>());

function nowIso(): string {
  return new Date().toISOString();
}

function newTaskId(): string {
  return `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createTask(sessionId: string): TaskState {
  const state = TaskStateSchema.parse({
    taskId: newTaskId(),
    sessionId,
    status: "understanding",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  store.set(sessionId, state);
  return state;
}

/** Load and re-validate a task. Returns undefined when unknown. */
export function getTask(sessionId: string): TaskState | undefined {
  const raw = store.get(sessionId);
  if (!raw) return undefined;
  return TaskStateSchema.parse(raw);
}

/** Merge a partial update into a task (validated). */
export function updateTask(
  sessionId: string,
  patch: Partial<TaskState>
): TaskState {
  const current = getTask(sessionId) ?? createTask(sessionId);
  const next = TaskStateSchema.parse({
    ...current,
    ...patch,
    taskId: current.taskId,
    sessionId: current.sessionId,
    updatedAt: nowIso(),
  });
  store.set(sessionId, next);
  return next;
}

/** Delete a session's state (client-initiated data deletion). */
export function deleteSession(sessionId: string): boolean {
  return store.delete(sessionId);
}

/** Clear the whole store (tests / restart simulation). */
export function clearStore(): void {
  store.clear();
}

// ---------------------------------------------------------------------------
// Protected fields: model output may ONLY write the whitelisted fields below.
// taskId, sessionId, toolCalls, evidence, approvals, pendingApproval and
// status transitions are owned by the orchestrator and can never be set from
// model JSON.
// ---------------------------------------------------------------------------

const ModelUnderstandingSchema = z.object({
  summary: z.string().min(1).max(2000),
  keyFacts: z.array(z.string().max(400)).max(20).default([]),
  assumptions: z.array(z.string().max(400)).max(20).default([]),
  missingInfo: z.array(z.string().max(300)).max(20).default([]),
  currencies: z.array(z.string().max(8)).max(6).default([]),
});
export type ModelUnderstanding = z.infer<typeof ModelUnderstandingSchema>;

export { ModelUnderstandingSchema };

/**
 * Merge validated model understanding into state. Only whitelisted fields are
 * touched; everything the model produced is labelled with source "model" so
 * downstream code treats it as unconfirmed until a tool verifies it.
 */
export function applyModelUnderstanding(
  state: TaskState,
  parsed: ModelUnderstanding
): TaskState {
  const newFacts = parsed.keyFacts.map((value, i) => ({
    key: `model_fact_${i + 1}`,
    value,
    source: "model",
  }));
  const newAssumptions = parsed.assumptions.map((value, i) => ({
    key: `assumption_${i + 1}`,
    value,
    source: "model",
  }));
  return updateTask(state.sessionId, {
    userGoal: parsed.summary,
    confirmedFacts: [...state.confirmedFacts, ...newFacts],
    assumptions: [...state.assumptions, ...newAssumptions],
    missingInfo: parsed.missingInfo,
    currencies:
      parsed.currencies.length > 0 ? parsed.currencies : state.currencies,
  });
}

const ModelPlanSchema = z.object({
  steps: z
    .array(
      z.object({
        id: z.string().min(1).max(80),
        title: z.string().min(1).max(200),
        detail: z.string().max(600).optional(),
      })
    )
    .min(1)
    .max(10),
});
export { ModelPlanSchema };
export type ModelPlan = z.infer<typeof ModelPlanSchema>;

/** Replace the plan steps from validated model output (statuses reset). */
export function applyModelPlan(state: TaskState, parsed: ModelPlan): TaskState {
  return updateTask(state.sessionId, {
    planSteps: parsed.steps.map((s, i) => ({
      id: s.id,
      title: s.title,
      detail: s.detail,
      status: (i === 0 ? "active" : "pending") as
        | "pending"
        | "active"
        | "done"
        | "skipped",
    })),
    currentStepId: parsed.steps[0]?.id ?? null,
  });
}

/** Mark a plan step done and advance the cursor. */
export function completeStep(sessionId: string, stepId: string): TaskState {
  const state = getTask(sessionId);
  if (!state) return createTask(sessionId);
  const steps = state.planSteps.map((s) =>
    s.id === stepId ? { ...s, status: "done" as const } : s
  );
  const next = steps.find((s) => s.status === "pending");
  return updateTask(sessionId, {
    planSteps: next
      ? steps.map((s) =>
          s.id === next.id ? { ...s, status: "active" as const } : s
        )
      : steps,
    currentStepId: next ? next.id : null,
  });
}

/** Append a tool-call record — orchestrator-only, never from model output. */
export function recordToolCall(
  sessionId: string,
  record: Omit<z.infer<typeof ToolCallRecordSchema>, "at">
): TaskState {
  const state = getTask(sessionId) ?? createTask(sessionId);
  return updateTask(sessionId, {
    toolCalls: [...state.toolCalls, { ...record, at: nowIso() }],
  });
}

/** Append evidence refs — orchestrator-only, never from model output. */
export function addEvidence(
  sessionId: string,
  refs: { label: string; detail?: string }[]
): TaskState {
  const state = getTask(sessionId) ?? createTask(sessionId);
  return updateTask(sessionId, {
    evidence: [...state.evidence, ...refs],
  });
}
