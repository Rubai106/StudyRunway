import { z } from "zod";
import {
  getTask,
  updateTask,
  type SafeToSendEvent,
  type SafeToSendWorkflowStage,
  SafeToSendEventSchema,
  SafeToSendWorkflowStageSchema,
} from "@/lib/agent/state";
import { buildForecast } from "@/lib/forecast";
import { formatMinor } from "@/lib/currency";
import { type Obligation } from "@/lib/model";
import { assemblePlanState, ToolPlanSchema, withToolTimeout, zodIssues } from "./common";
import type { ToolDefinition, ToolResult } from "./types";
import { SAFE_TO_SEND_ACTION_ACKS } from "./safeToSendApproval";
import {
  DelayScenarioSchema,
  IncomingFundingRecordSchema,
  PaymentQuoteSchema,
  RecoveryAssumptionSchema,
  SafeToSendDraftSchema,
  describeDecision,
  evaluateSafeToSendDecision,
  getSafeToSendScenario,
  type SafeToSendDecision,
  type SafeToSendDraft,
  type SimulationRecord,
} from "@/lib/safeToSend/engine";

const SafeToSendStateSchema = z.object({
  draft: z.record(z.unknown()).nullable().default(null),
  decision: z.record(z.unknown()).nullable().default(null),
  records: z.array(z.record(z.unknown())).default([]),
  workflowStage: SafeToSendWorkflowStageSchema.default("INTAKE"),
  events: z.array(SafeToSendEventSchema).default([]),
});

const STAGE_TRANSITIONS: Record<SafeToSendWorkflowStage, SafeToSendWorkflowStage[]> = {
  INTAKE: [
    "COLLECTING_INFORMATION",
    "FUNDING_PLAN_READY",
    "SCENARIO_EVALUATED",
    "RECOVERY_REVIEW",
    "AWAITING_APPROVAL",
    "BLOCKED",
  ],
  COLLECTING_INFORMATION: [
    "COLLECTING_INFORMATION",
    "FUNDING_PLAN_READY",
    "SCENARIO_EVALUATED",
    "RECOVERY_REVIEW",
    "AWAITING_APPROVAL",
    "BLOCKED",
  ],
  FUNDING_PLAN_READY: [
    "COLLECTING_INFORMATION",
    "FUNDING_PLAN_READY",
    "SCENARIO_EVALUATED",
    "RECOVERY_REVIEW",
    "AWAITING_APPROVAL",
    "SIMULATED",
    "REVERTED",
    "BLOCKED",
  ],
  SCENARIO_EVALUATED: [
    "COLLECTING_INFORMATION",
    "FUNDING_PLAN_READY",
    "SCENARIO_EVALUATED",
    "RECOVERY_REVIEW",
    "AWAITING_APPROVAL",
    "BLOCKED",
  ],
  RECOVERY_REVIEW: [
    "COLLECTING_INFORMATION",
    "FUNDING_PLAN_READY",
    "SCENARIO_EVALUATED",
    "RECOVERY_REVIEW",
    "AWAITING_APPROVAL",
    "BLOCKED",
  ],
  AWAITING_APPROVAL: [
    "COLLECTING_INFORMATION",
    "FUNDING_PLAN_READY",
    "SCENARIO_EVALUATED",
    "RECOVERY_REVIEW",
    "AWAITING_APPROVAL",
    "SIMULATED",
    "BLOCKED",
  ],
  SIMULATED: ["SCENARIO_EVALUATED", "RECOVERY_REVIEW", "REVERTED", "SIMULATED", "BLOCKED"],
  REVERTED: ["SCENARIO_EVALUATED", "RECOVERY_REVIEW", "AWAITING_APPROVAL", "REVERTED", "BLOCKED"],
  BLOCKED: ["COLLECTING_INFORMATION", "SCENARIO_EVALUATED", "RECOVERY_REVIEW", "AWAITING_APPROVAL", "BLOCKED"],
};

function nowIso(): string {
  return new Date().toISOString();
}

function makeEventId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function stageFromDecision(decision: SafeToSendDecision): SafeToSendWorkflowStage {
  if (decision.status === "BLOCKED") return "BLOCKED";
  if (decision.timeline.selectedRecovery) return "RECOVERY_REVIEW";
  if (decision.timeline.scenario) return "SCENARIO_EVALUATED";
  if (decision.status === "READY_TO_SIMULATE") return "AWAITING_APPROVAL";
  if (decision.missingFields.length > 0) return "COLLECTING_INFORMATION";
  return "FUNDING_PLAN_READY";
}

function resolveStage(
  current: SafeToSendWorkflowStage,
  target: SafeToSendWorkflowStage,
): SafeToSendWorkflowStage {
  const allowed = STAGE_TRANSITIONS[current] ?? [];
  return allowed.includes(target) ? target : current;
}

function appendEvent(
  events: SafeToSendEvent[],
  event: Omit<SafeToSendEvent, "id" | "at">,
): SafeToSendEvent[] {
  return [
    ...events,
    {
      id: makeEventId(event.type),
      at: nowIso(),
      ...event,
    },
  ].slice(-60);
}

function moneyAmountForEvent(minor: number, currency: string): string {
  try {
    return formatMinor(minor, currency);
  } catch {
    return `${minor} ${currency}`;
  }
}

function getSafeState(sessionId: string): {
  draft: SafeToSendDraft | null;
  decision: SafeToSendDecision | null;
  records: SimulationRecord[];
  workflowStage: SafeToSendWorkflowStage;
  events: SafeToSendEvent[];
} {
  const task = getTask(sessionId);
  const parsed = SafeToSendStateSchema.parse(task?.safeToSend ?? {});
  const draft = parsed.draft ? SafeToSendDraftSchema.parse(parsed.draft) : null;
  const decision = parsed.decision ? (parsed.decision as unknown as SafeToSendDecision) : null;
  const records = parsed.records as unknown as SimulationRecord[];
  return {
    draft,
    decision,
    records,
    workflowStage: parsed.workflowStage,
    events: parsed.events,
  };
}

function saveSafeState(
  sessionId: string,
  patch: {
    draft?: SafeToSendDraft | null;
    decision?: SafeToSendDecision | null;
    records?: SimulationRecord[];
    workflowStage?: SafeToSendWorkflowStage;
    events?: SafeToSendEvent[];
  },
): void {
  const state = getSafeState(sessionId);
  updateTask(sessionId, {
    safeToSend: {
      draft: (patch.draft === undefined ? state.draft : patch.draft) as unknown as Record<string, unknown> | null,
      decision: (patch.decision === undefined ? state.decision : patch.decision) as unknown as Record<string, unknown> | null,
      records: (patch.records === undefined ? state.records : patch.records) as unknown as Record<string, unknown>[],
      workflowStage: patch.workflowStage === undefined ? state.workflowStage : patch.workflowStage,
      events: patch.events === undefined ? state.events : patch.events,
    },
  });
}

function toCardData(
  draft: SafeToSendDraft,
  decision: SafeToSendDecision,
  records: SimulationRecord[],
  workflowStage: SafeToSendWorkflowStage,
  events: SafeToSendEvent[],
): Record<string, unknown> {
  const quote = decision.selectedQuote;
  return {
    status: decision.status,
    decisionId: decision.decisionId,
    draft,
    decision,
    simulationApproval:
      quote && decision.payment.expectedReceiveMinor != null && decision.payment.dueDate
        ? {
            decisionId: decision.decisionId,
            expectedSendCurrency: quote.sendCurrency,
            expectedSendAmountMinor: quote.sendAmountMinor ?? null,
            expectedFeeMinor: quote.feeMinor ?? null,
            expectedReceiveCurrency: quote.targetCurrency,
            expectedReceiveMinor: decision.payment.expectedReceiveMinor,
            expectedDueDate: decision.payment.dueDate,
          }
        : null,
    latestSimulation: records[records.length - 1] ?? null,
    workflowStage,
    events,
    scenarios: [
      "A_AFFORDABLE",
      "B_LIVING_SHORTFALL",
      "C_MISSING_RATE",
      "D_DEADLINE_RISK",
      "E_INSTRUCTIONS_MISSING",
      "F_MANIPULATED_AFTER_APPROVAL",
    ],
    disclaimer:
      "Sandbox only. StudyRunway does not send real payments. Quotes may be user-provided and unverified.",
  };
}

const SafeToSendDraftPatchSchema = z.record(z.unknown());

const UpsertDraftParams = z.object({
  patch: SafeToSendDraftPatchSchema,
  replaceQuotes: z.boolean().default(false),
});

const AddQuoteParams = z.object({
  quote: PaymentQuoteSchema,
  select: z.boolean().default(false),
});

const RecalculateParams = z.object({
  workingPlanOverride: ToolPlanSchema.optional(),
});

const LoadScenarioParams = z.object({
  scenarioId: z.enum([
    "A_AFFORDABLE",
    "B_LIVING_SHORTFALL",
    "C_MISSING_RATE",
    "D_DEADLINE_RISK",
    "E_INSTRUCTIONS_MISSING",
    "F_MANIPULATED_AFTER_APPROVAL",
  ]),
});

const SimulateParams = z.object({
  decisionId: z.string().min(1),
  expectedSendCurrency: z.string().length(3).transform((v) => v.toUpperCase()),
  expectedSendAmountMinor: z.number().int().nonnegative(),
  expectedFeeMinor: z.number().int().nonnegative(),
  expectedReceiveCurrency: z.string().length(3).transform((v) => v.toUpperCase()),
  expectedReceiveMinor: z.number().int().nonnegative(),
  expectedDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().max(500).optional(),
});

const RevertSimulationParams = z.object({
  simulationId: z.string().min(1).optional(),
});

const UpsertFundingRecordParams = z.object({
  record: IncomingFundingRecordSchema,
});

const ConfirmFundingReceiptParams = z.object({
  fundingId: z.string().min(1),
  receivedAmountMinor: z.number().int().nonnegative(),
  receivedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const SetDelayScenarioParams = z.object({
  scenario: DelayScenarioSchema,
});

const ClearDelayScenarioParams = z.object({
  fundingId: z.string().min(1).optional(),
});

const ApplyRecoveryAssumptionParams = z.object({
  assumption: RecoveryAssumptionSchema,
});

const ClearRecoveryAssumptionParams = z.object({});

function mergeDraft(
  current: SafeToSendDraft | null,
  patch: z.infer<typeof SafeToSendDraftPatchSchema>,
  replaceQuotes: boolean,
): SafeToSendDraft {
  const base: SafeToSendDraft = current ?? SafeToSendDraftSchema.parse({});
  const nextRaw: Record<string, unknown> = {
    ...base,
    ...patch,
  };
  // Delay/recovery scenarios belong to the existing simulate_scenario planner.
  // Keep these legacy engine fields out of the Safe-to-Send workflow surface.
  delete nextRaw["activeDelayScenario"];
  delete nextRaw["selectedRecoveryAssumption"];
  const maybeQuotes = nextRaw["quotes"];
  if (Array.isArray(maybeQuotes)) {
    nextRaw["quotes"] = replaceQuotes ? maybeQuotes : [...base.quotes, ...maybeQuotes];
  }
  return SafeToSendDraftSchema.parse(nextRaw);
}

function recomputeDecision(sessionId: string, draft: SafeToSendDraft, overridePlan?: z.infer<typeof ToolPlanSchema>): SafeToSendDecision {
  const task = getTask(sessionId);
  const plan = overridePlan ?? task?.workingPlan ?? null;
  return evaluateSafeToSendDecision(draft, plan);
}

function ensureUniqueSimulationReference(records: SimulationRecord[], decisionId: string): string {
  const n = records.filter((r) => r.decisionId === decisionId).length + 1;
  return `sim_sts_${Date.now().toString(36)}_${n}`;
}

function refreshDecisionForDraft(
  sessionId: string,
  draft: SafeToSendDraft,
  event?: Omit<SafeToSendEvent, "id" | "at">,
  forcedStage?: SafeToSendWorkflowStage,
): {
  draft: SafeToSendDraft;
  decision: SafeToSendDecision;
  records: SimulationRecord[];
  workflowStage: SafeToSendWorkflowStage;
  events: SafeToSendEvent[];
} {
  const state = getSafeState(sessionId);
  const decision = recomputeDecision(sessionId, draft);
  const desired = forcedStage ?? stageFromDecision(decision);
  const stage = resolveStage(state.workflowStage, desired);
  let events = event ? appendEvent(state.events, event) : state.events;
  if (stage === "AWAITING_APPROVAL") {
    const last = events[events.length - 1];
    const lastDecisionId =
      last && typeof last.data?.["decisionId"] === "string"
        ? (last.data["decisionId"] as string)
        : null;
    if (last?.type !== "approval_requested" || lastDecisionId !== decision.decisionId) {
      events = appendEvent(events, {
        type: "approval_requested",
        status: "pending",
        label: "Simulation approval required",
        detail: `Decision ${decision.decisionId} is ready for explicit user approval.`,
        data: { decisionId: decision.decisionId },
      });
    }
  }
  saveSafeState(sessionId, {
    draft,
    decision,
    records: state.records,
    workflowStage: stage,
    events,
  });
  return { draft, decision, records: state.records, workflowStage: stage, events };
}

function applySimulation(
  sessionId: string,
  approval: z.infer<typeof SimulateParams>,
): {
  record: SimulationRecord;
  planningCurrency: string;
  beforeMinBalanceMinor: number;
  afterMinBalanceMinor: number;
  obligationId: string;
} {
  const task = getTask(sessionId);
  if (!task) throw new Error("Unknown session");

  const state = getSafeState(sessionId);
  if (!state.draft) throw new Error("No Safe-to-Send draft exists yet");

  const fresh = evaluateSafeToSendDecision(state.draft, task.workingPlan ?? null);
  if (fresh.decisionId !== approval.decisionId) {
    throw new Error(
      "Approval is stale: financial inputs changed after the reviewed decision. Recalculate and approve again.",
    );
  }
  if (fresh.status !== "READY_TO_SIMULATE") {
    throw new Error(
      `Simulation is not permitted: decision status is ${fresh.status}.`,
    );
  }
  if (!fresh.selectedQuote || !fresh.payment.dueDate) {
    throw new Error("Missing selected quote or due date for simulation");
  }
  if (fresh.payment.paymentRequirementMinorInPlanning == null) {
    throw new Error("Cannot apply simulation: planning-currency payment impact is unavailable");
  }

  const existingApplied = state.records.find(
    (r) => r.decisionId === approval.decisionId && r.status === "applied",
  );
  if (existingApplied) {
    throw new Error(
      `This decision has already been simulated (${existingApplied.simulationId}). Duplicate apply prevented.`,
    );
  }

  const planningCurrency =
    task.workingPlan?.planningCurrency ?? state.draft.fundingCurrency ?? "GBP";

  const basePlan = task.workingPlan ?? {
    fundingSources: [],
    obligations: [],
    planningCurrency,
    asOfDate: null,
    fx: {
      rates: {},
      asOf: fresh.evaluatedAt.slice(0, 10),
      source: "Safe-to-Send draft",
    },
    evidence: [],
    quotes: [],
  };

  const before = buildForecast(assemblePlanState(basePlan));

  if (
    fresh.selectedQuote.sendCurrency !== approval.expectedSendCurrency ||
    (fresh.selectedQuote.sendAmountMinor ?? -1) !== approval.expectedSendAmountMinor ||
    (fresh.selectedQuote.feeMinor ?? -1) !== approval.expectedFeeMinor ||
    fresh.selectedQuote.targetCurrency !== approval.expectedReceiveCurrency ||
    (fresh.payment.expectedReceiveMinor ?? -1) !== approval.expectedReceiveMinor ||
    fresh.payment.dueDate !== approval.expectedDueDate
  ) {
    throw new Error(
      "Approval details do not match the current reviewed action. Re-open the decision, review updated values, and approve again.",
    );
  }

  const simId = ensureUniqueSimulationReference(state.records, approval.decisionId);
  const obligationId = `sts-pay-${simId}`;

  const obligation: Obligation = {
    id: obligationId,
    label: `SIMULATED tuition transfer (${fresh.selectedQuote.providerName})`,
    kind: "tuition",
    amountMinor: fresh.payment.paymentRequirementMinorInPlanning,
    currency: planningCurrency,
    dueDate: fresh.payment.dueDate,
    recurring: null,
    status: "planned",
    notes:
      `SIMULATED SANDBOX action ${simId}; decision ${fresh.decisionId}; ` +
      `expected receive ${fresh.payment.expectedReceiveMinor != null && fresh.payment.receiveCurrency
        ? formatMinor(fresh.payment.expectedReceiveMinor, fresh.payment.receiveCurrency)
        : "unknown"}` +
      (approval.note ? `; note: ${approval.note}` : ""),
    evidenceIds: [],
  };

  const nextPlan = {
    ...basePlan,
    obligations: [...basePlan.obligations, obligation],
  };

  const after = buildForecast(assemblePlanState(nextPlan));

  const record: SimulationRecord = {
    simulationId: simId,
    decisionId: fresh.decisionId,
    createdAt: new Date().toISOString(),
    status: "applied",
    reason: "Simulated and applied to sandbox forecast",
    sessionId,
    institutionName: state.draft.institutionName ?? null,
    destinationCountry: state.draft.destinationCountry ?? null,
    quote: fresh.selectedQuote,
    draftSnapshot: state.draft,
    decisionSnapshot: fresh,
    appliedObligationId: obligationId,
  };

  const stage = resolveStage(state.workflowStage, "SIMULATED");
  const events = appendEvent(state.events, {
    type: "simulation_applied",
    status: "completed",
    label: `Sandbox simulation ${simId} applied`,
    detail:
      `Applied simulated tuition obligation ${obligationId}. ` +
      `Forecast min balance changed from ${formatMinor(before.minBalanceMinor, planningCurrency)} ` +
      `to ${formatMinor(after.minBalanceMinor, planningCurrency)}.`,
    data: {
      simulationId: simId,
      obligationId,
      decisionId: fresh.decisionId,
      planningCurrency,
      beforeMinBalanceMinor: before.minBalanceMinor,
      afterMinBalanceMinor: after.minBalanceMinor,
    },
  });

  updateTask(sessionId, {
    workingPlan: nextPlan,
    safeToSend: {
      draft: state.draft as unknown as Record<string, unknown>,
      decision: fresh as unknown as Record<string, unknown>,
      records: [...state.records, record] as unknown as Record<string, unknown>[],
      workflowStage: stage,
      events,
    },
  });

  return {
    record,
    planningCurrency,
    beforeMinBalanceMinor: before.minBalanceMinor,
    afterMinBalanceMinor: after.minBalanceMinor,
    obligationId,
  };
}

export const upsertSafeToSendDraftTool: ToolDefinition = {
  name: "upsert_safe_to_send_draft",
  description:
    "Create or update the structured Safe-to-Send tuition-payment draft (institution, tuition due details, funding amounts, reserve assumptions, and quote set). Use this whenever new user information arrives.",
  parameters: UpsertDraftParams,
  requiresApproval: false,
  handler: async (args, ctx) =>
    withToolTimeout("upsert_safe_to_send_draft", (): ToolResult => {
      const parsed = UpsertDraftParams.safeParse(args);
      if (!parsed.success) {
        return {
          ok: false,
          summary: `upsert_safe_to_send_draft: invalid parameters — ${zodIssues(parsed.error)}`,
        };
      }
      const state = getSafeState(ctx.sessionId);
      const draft = mergeDraft(state.draft, parsed.data.patch, parsed.data.replaceQuotes);
      const refreshed = refreshDecisionForDraft(ctx.sessionId, draft, {
        type: "input_collected",
        status: "completed",
        label: "Safe-to-Send inputs updated",
        detail: `Updated draft fields and recomputed decision (${draft.quotes.length} quote(s)).`,
      });
      return {
        ok: true,
        summary:
          `Saved Safe-to-Send draft (${draft.quotes.length} quote(s)); ` +
          describeDecision(refreshed.decision),
        data: toCardData(
          refreshed.draft,
          refreshed.decision,
          refreshed.records,
          refreshed.workflowStage,
          refreshed.events,
        ),
      };
    }),
};

export const addSafeToSendQuoteTool: ToolDefinition = {
  name: "add_safe_to_send_quote",
  description:
    "Add or replace one structured payment quote in the Safe-to-Send draft. Use when the user provides a manual quote or source-backed quote details.",
  parameters: AddQuoteParams,
  requiresApproval: false,
  handler: async (args, ctx) =>
    withToolTimeout("add_safe_to_send_quote", (): ToolResult => {
      const parsed = AddQuoteParams.safeParse(args);
      if (!parsed.success) {
        return {
          ok: false,
          summary: `add_safe_to_send_quote: invalid parameters — ${zodIssues(parsed.error)}`,
        };
      }
      const state = getSafeState(ctx.sessionId);
      const draft = state.draft ?? SafeToSendDraftSchema.parse({});
      const kept = draft.quotes.filter((q) => q.id !== parsed.data.quote.id);
      const next: SafeToSendDraft = {
        ...draft,
        quotes: [...kept, parsed.data.quote],
        selectedQuoteId: parsed.data.select
          ? parsed.data.quote.id
          : (draft.selectedQuoteId === parsed.data.quote.id ? draft.selectedQuoteId : draft.selectedQuoteId),
      };
      const validated = SafeToSendDraftSchema.parse(next);
      const refreshed = refreshDecisionForDraft(ctx.sessionId, validated, {
        type: "input_collected",
        status: "completed",
        label: `Quote updated: ${parsed.data.quote.providerName}`,
        detail: `Quote ${parsed.data.quote.id} captured and selected quote state recalculated.`,
        data: {
          quoteId: parsed.data.quote.id,
          selected: parsed.data.select,
          verificationStatus: parsed.data.quote.verificationStatus,
        },
      });
      return {
        ok: true,
        summary:
          `Quote ${parsed.data.quote.providerName} captured (${parsed.data.quote.id}). ` +
          describeDecision(refreshed.decision),
        data: toCardData(
          refreshed.draft,
          refreshed.decision,
          refreshed.records,
          refreshed.workflowStage,
          refreshed.events,
        ),
        evidence: parsed.data.quote.sourceUrl
          ? [{ label: `Quote source: ${parsed.data.quote.sourceLabel ?? parsed.data.quote.providerName}`, detail: parsed.data.quote.sourceUrl }]
          : [{ label: "Quote source", detail: "User-provided quote — not independently verified." }],
      };
    }),
};

export const upsertSafeToSendFundingRecordTool: ToolDefinition = {
  name: "upsert_safe_to_send_funding_record",
  description:
    "Create or update one incoming funding record (expected/received/delayed/cancelled) used by the deterministic funding timeline and shortfall projection.",
  parameters: UpsertFundingRecordParams,
  requiresApproval: false,
  handler: async (args, ctx) =>
    withToolTimeout("upsert_safe_to_send_funding_record", (): ToolResult => {
      const parsed = UpsertFundingRecordParams.safeParse(args);
      if (!parsed.success) {
        return {
          ok: false,
          summary: `upsert_safe_to_send_funding_record: invalid parameters — ${zodIssues(parsed.error)}`,
        };
      }
      const state = getSafeState(ctx.sessionId);
      const draft = state.draft ?? SafeToSendDraftSchema.parse({});
      const kept = draft.fundingRecords.filter((r) => r.id !== parsed.data.record.id);
      const next: SafeToSendDraft = SafeToSendDraftSchema.parse({
        ...draft,
        fundingRecords: [...kept, parsed.data.record],
      });
      const refreshed = refreshDecisionForDraft(ctx.sessionId, next, {
        type: "input_collected",
        status: "completed",
        label: `Funding record updated: ${parsed.data.record.label}`,
        detail: `Status is ${parsed.data.record.status} with expected date ${parsed.data.record.expectedDate}.`,
        data: {
          fundingId: parsed.data.record.id,
          fundingStatus: parsed.data.record.status,
        },
      });
      return {
        ok: true,
        summary:
          `Funding record ${parsed.data.record.label} updated (${parsed.data.record.status}). ` +
          describeDecision(refreshed.decision),
        data: toCardData(
          refreshed.draft,
          refreshed.decision,
          refreshed.records,
          refreshed.workflowStage,
          refreshed.events,
        ),
      };
    }),
};

export const confirmSafeToSendFundingReceiptTool: ToolDefinition = {
  name: "confirm_safe_to_send_funding_receipt",
  description:
    "Explicitly confirm a funding receipt (amount/date). This does NOT happen automatically when expected date passes.",
  parameters: ConfirmFundingReceiptParams,
  requiresApproval: true,
  handler: async (args, ctx) =>
    withToolTimeout("confirm_safe_to_send_funding_receipt", (): ToolResult => {
      const parsed = ConfirmFundingReceiptParams.safeParse(args);
      if (!parsed.success) {
        return {
          ok: false,
          summary: `confirm_safe_to_send_funding_receipt: invalid parameters — ${zodIssues(parsed.error)}`,
        };
      }
      const state = getSafeState(ctx.sessionId);
      if (!state.draft) {
        return { ok: false, summary: "No Safe-to-Send draft exists yet." };
      }
      const record = state.draft.fundingRecords.find((r) => r.id === parsed.data.fundingId);
      if (!record) {
        return { ok: false, summary: `Unknown funding record: ${parsed.data.fundingId}` };
      }
      const received = parsed.data.receivedAmountMinor;
      const nextStatus = received >= record.expectedAmountMinor ? "RECEIVED" : "PARTIALLY_RECEIVED";
      const updated = {
        ...record,
        receivedAmountMinor: received,
        receivedDate: parsed.data.receivedDate,
        status: nextStatus,
        updatedAt: new Date().toISOString(),
      };
      const draft = SafeToSendDraftSchema.parse({
        ...state.draft,
        fundingRecords: state.draft.fundingRecords.map((r) =>
          r.id === record.id ? updated : r,
        ),
      });
      const refreshed = refreshDecisionForDraft(ctx.sessionId, draft, {
        type: "receipt_confirmed",
        status: "completed",
        label: `Funding receipt confirmed: ${record.label}`,
        detail: `${moneyAmountForEvent(received, record.currency)} received on ${parsed.data.receivedDate}.`,
        data: {
          fundingId: record.id,
          receivedAmountMinor: received,
          receivedDate: parsed.data.receivedDate,
          nextStatus,
        },
      });
      return {
        ok: true,
        summary: `Receipt confirmed for ${record.label}: ${nextStatus}. ${describeDecision(refreshed.decision)}`,
        data: toCardData(
          refreshed.draft,
          refreshed.decision,
          refreshed.records,
          refreshed.workflowStage,
          refreshed.events,
        ),
      };
    }),
};

export const setSafeToSendDelayScenarioTool: ToolDefinition = {
  name: "set_safe_to_send_delay_scenario",
  description:
    "Apply a hypothetical delay/cancellation scenario to one funding record and recompute timeline, earliest shortfall, and Safe-to-Send status.",
  parameters: SetDelayScenarioParams,
  requiresApproval: false,
  handler: async (args, ctx) =>
    withToolTimeout("set_safe_to_send_delay_scenario", (): ToolResult => {
      const parsed = SetDelayScenarioParams.safeParse(args);
      if (!parsed.success) {
        return {
          ok: false,
          summary: `set_safe_to_send_delay_scenario: invalid parameters — ${zodIssues(parsed.error)}`,
        };
      }
      const state = getSafeState(ctx.sessionId);
      if (!state.draft) {
        return { ok: false, summary: "No Safe-to-Send draft exists yet." };
      }
      const exists = state.draft.fundingRecords.some((r) => r.id === parsed.data.scenario.fundingId);
      if (!exists) {
        return {
          ok: false,
          summary: `Cannot apply delay scenario: unknown funding id ${parsed.data.scenario.fundingId}.`,
        };
      }
      const draft = SafeToSendDraftSchema.parse({
        ...state.draft,
        activeDelayScenario: parsed.data.scenario,
      });
      const refreshed = refreshDecisionForDraft(ctx.sessionId, draft, {
        type: "scenario_applied",
        status: "completed",
        label: `Delay scenario applied (${parsed.data.scenario.mode})`,
        detail: `Funding ${parsed.data.scenario.fundingId} now uses scenario date ${parsed.data.scenario.revisedExpectedDate}.`,
        data: parsed.data.scenario,
      }, "SCENARIO_EVALUATED");
      return {
        ok: true,
        summary: `Delay scenario applied (${parsed.data.scenario.mode}). ${describeDecision(refreshed.decision)}`,
        data: toCardData(
          refreshed.draft,
          refreshed.decision,
          refreshed.records,
          refreshed.workflowStage,
          refreshed.events,
        ),
      };
    }),
};

export const clearSafeToSendDelayScenarioTool: ToolDefinition = {
  name: "clear_safe_to_send_delay_scenario",
  description:
    "Clear hypothetical funding delay/cancellation scenario and restore baseline timeline projection.",
  parameters: ClearDelayScenarioParams,
  requiresApproval: false,
  handler: async (args, ctx) =>
    withToolTimeout("clear_safe_to_send_delay_scenario", (): ToolResult => {
      const parsed = ClearDelayScenarioParams.safeParse(args);
      if (!parsed.success) {
        return {
          ok: false,
          summary: `clear_safe_to_send_delay_scenario: invalid parameters — ${zodIssues(parsed.error)}`,
        };
      }
      const state = getSafeState(ctx.sessionId);
      if (!state.draft) {
        return { ok: false, summary: "No Safe-to-Send draft exists yet." };
      }
      const shouldClear =
        !state.draft.activeDelayScenario ||
        !parsed.data.fundingId ||
        state.draft.activeDelayScenario.fundingId === parsed.data.fundingId;
      const draft = SafeToSendDraftSchema.parse({
        ...state.draft,
        activeDelayScenario: shouldClear ? { mode: "none", fundingId: parsed.data.fundingId ?? "none" } : state.draft.activeDelayScenario,
      });
      const refreshed = refreshDecisionForDraft(ctx.sessionId, draft, {
        type: "scenario_applied",
        status: "completed",
        label: "Delay scenario cleared",
        detail: "Timeline projection restored to baseline funding expectations.",
      }, "FUNDING_PLAN_READY");
      return {
        ok: true,
        summary: `Delay scenario cleared. ${describeDecision(refreshed.decision)}`,
        data: toCardData(
          refreshed.draft,
          refreshed.decision,
          refreshed.records,
          refreshed.workflowStage,
          refreshed.events,
        ),
      };
    }),
};

export const applySafeToSendRecoveryAssumptionTool: ToolDefinition = {
  name: "apply_safe_to_send_recovery_assumption",
  description:
    "Apply one hypothetical recovery assumption and recompute timeline/shortfall and Safe-to-Send decision.",
  parameters: ApplyRecoveryAssumptionParams,
  requiresApproval: false,
  handler: async (args, ctx) =>
    withToolTimeout("apply_safe_to_send_recovery_assumption", (): ToolResult => {
      const parsed = ApplyRecoveryAssumptionParams.safeParse(args);
      if (!parsed.success) {
        return {
          ok: false,
          summary: `apply_safe_to_send_recovery_assumption: invalid parameters — ${zodIssues(parsed.error)}`,
        };
      }
      const state = getSafeState(ctx.sessionId);
      if (!state.draft) return { ok: false, summary: "No Safe-to-Send draft exists yet." };
      const draft = SafeToSendDraftSchema.parse({
        ...state.draft,
        selectedRecoveryAssumption: parsed.data.assumption,
      });
      const refreshed = refreshDecisionForDraft(ctx.sessionId, draft, {
        type: "recovery_applied",
        status: "completed",
        label: `Recovery assumption applied: ${parsed.data.assumption.label}`,
        detail: parsed.data.assumption.note,
        data: parsed.data.assumption,
      }, "RECOVERY_REVIEW");
      return {
        ok: true,
        summary: `Recovery assumption applied: ${parsed.data.assumption.label}. ${describeDecision(refreshed.decision)}`,
        data: toCardData(
          refreshed.draft,
          refreshed.decision,
          refreshed.records,
          refreshed.workflowStage,
          refreshed.events,
        ),
      };
    }),
};

export const clearSafeToSendRecoveryAssumptionTool: ToolDefinition = {
  name: "clear_safe_to_send_recovery_assumption",
  description:
    "Clear hypothetical recovery assumption and recompute baseline/scenario decision.",
  parameters: ClearRecoveryAssumptionParams,
  requiresApproval: false,
  handler: async (args, ctx) =>
    withToolTimeout("clear_safe_to_send_recovery_assumption", (): ToolResult => {
      const parsed = ClearRecoveryAssumptionParams.safeParse(args);
      if (!parsed.success) {
        return {
          ok: false,
          summary: `clear_safe_to_send_recovery_assumption: invalid parameters — ${zodIssues(parsed.error)}`,
        };
      }
      const state = getSafeState(ctx.sessionId);
      if (!state.draft) return { ok: false, summary: "No Safe-to-Send draft exists yet." };
      const draft = SafeToSendDraftSchema.parse({
        ...state.draft,
        selectedRecoveryAssumption: undefined,
      });
      const refreshed = refreshDecisionForDraft(ctx.sessionId, draft, {
        type: "recovery_applied",
        status: "completed",
        label: "Recovery assumption cleared",
      }, "SCENARIO_EVALUATED");
      return {
        ok: true,
        summary: `Recovery assumption cleared. ${describeDecision(refreshed.decision)}`,
        data: toCardData(
          refreshed.draft,
          refreshed.decision,
          refreshed.records,
          refreshed.workflowStage,
          refreshed.events,
        ),
      };
    }),
};

export const recalculateSafeToSendDecisionTool: ToolDefinition = {
  name: "recalculate_safe_to_send_decision",
  description:
    "Run the deterministic Safe-to-Send engine and return one status: READY_TO_SIMULATE, RISK_DETECTED, MORE_INFORMATION_REQUIRED, or BLOCKED, with a full calculation breakdown.",
  parameters: RecalculateParams,
  requiresApproval: false,
  handler: async (args, ctx) =>
    withToolTimeout("recalculate_safe_to_send_decision", (): ToolResult => {
      const parsed = RecalculateParams.safeParse(args);
      if (!parsed.success) {
        return {
          ok: false,
          summary: `recalculate_safe_to_send_decision: invalid parameters — ${zodIssues(parsed.error)}`,
        };
      }
      const state = getSafeState(ctx.sessionId);
      if (!state.draft) {
        return {
          ok: false,
          summary:
            "No Safe-to-Send draft found yet. First capture tuition, funding, reserve, and quote details.",
        };
      }
      const decision = recomputeDecision(
        ctx.sessionId,
        state.draft,
        parsed.data.workingPlanOverride,
      );
      const nextStage = resolveStage(state.workflowStage, stageFromDecision(decision));
      const events = appendEvent(state.events, {
        type: "decision_evaluated",
        status: "completed",
        label: `Safe-to-Send decision evaluated: ${decision.status}`,
        detail: describeDecision(decision),
        data: { decisionId: decision.decisionId, status: decision.status },
      });
      saveSafeState(ctx.sessionId, { draft: state.draft, decision, workflowStage: nextStage, events });
      return {
        ok: true,
        summary: describeDecision(decision),
        data: toCardData(state.draft, decision, state.records, nextStage, events),
      };
    }),
};

export const getSafeToSendDecisionTool: ToolDefinition = {
  name: "get_safe_to_send_decision",
  description:
    "Fetch the latest Safe-to-Send draft, deterministic decision, and sandbox simulation audit records for the current session.",
  parameters: z.object({}),
  requiresApproval: false,
  handler: async (_args, ctx) =>
    withToolTimeout("get_safe_to_send_decision", (): ToolResult => {
      const state = getSafeState(ctx.sessionId);
      if (!state.draft || !state.decision) {
        return {
          ok: false,
          summary: "No Safe-to-Send decision exists yet for this session.",
        };
      }
      return {
        ok: true,
        summary: describeDecision(state.decision),
        data: toCardData(
          state.draft,
          state.decision,
          state.records,
          state.workflowStage,
          state.events,
        ),
      };
    }),
};

export const loadSafeToSendScenarioTool: ToolDefinition = {
  name: "load_safe_to_send_demo_scenario",
  description:
    "Load one deterministic demonstration scenario (A-F) into Safe-to-Send state so the student can inspect real rule outcomes without live integrations.",
  parameters: LoadScenarioParams,
  requiresApproval: false,
  handler: async (args, ctx) =>
    withToolTimeout("load_safe_to_send_demo_scenario", (): ToolResult => {
      const parsed = LoadScenarioParams.safeParse(args);
      if (!parsed.success) {
        return {
          ok: false,
          summary: `load_safe_to_send_demo_scenario: invalid parameters — ${zodIssues(parsed.error)}`,
        };
      }
      const scenario = getSafeToSendScenario(parsed.data.scenarioId);
      if (!scenario) {
        return {
          ok: false,
          summary: `Unknown scenario id: ${parsed.data.scenarioId}`,
        };
      }
      const draft = SafeToSendDraftSchema.parse(scenario.draft);
      const state = getSafeState(ctx.sessionId);
      const decision = recomputeDecision(ctx.sessionId, draft);
      const stage = resolveStage(state.workflowStage, stageFromDecision(decision));
      const events = appendEvent(state.events, {
        type: "timeline_calculated",
        status: "completed",
        label: `Demo scenario loaded: ${scenario.label}`,
        detail: scenario.description,
        data: { scenarioId: scenario.id, decisionStatus: decision.status },
      });
      saveSafeState(ctx.sessionId, { draft, decision, workflowStage: stage, events });
      return {
        ok: true,
        summary: `${scenario.label} loaded. ${describeDecision(decision)}`,
        data: {
          ...toCardData(draft, decision, state.records, stage, events),
          scenarioId: scenario.id,
          scenarioLabel: scenario.label,
          scenarioDescription: scenario.description,
          demoDataLabel:
            "All providers, quotes, rates, and references in this scenario are fictitious demonstration data.",
        },
      };
    }),
};

export const simulateSafeToSendPaymentTool: ToolDefinition = {
  name: "simulate_safe_to_send_payment",
  description:
    "Apply a SAFE-TO-SEND sandbox-only simulated tuition-payment action to the current forecast. Requires explicit approval. Pass the exact simulationApproval fields from the reviewed decision card; the server revalidates and rejects stale/tampered approvals.",
  parameters: SimulateParams,
  requiresApproval: true,
  handler: async (args, ctx) =>
    withToolTimeout("simulate_safe_to_send_payment", (): ToolResult => {
      const parsed = SimulateParams.safeParse(args);
      if (!parsed.success) {
        return {
          ok: false,
          summary: `simulate_safe_to_send_payment: invalid parameters — ${zodIssues(parsed.error)}`,
        };
      }
      try {
        const applied = applySimulation(ctx.sessionId, parsed.data);
        const state = getSafeState(ctx.sessionId);
        if (!state.draft || !state.decision) {
          throw new Error("Safe-to-Send state disappeared after apply");
        }
        return {
          ok: true,
          summary:
            `SIMULATED SANDBOX action ${applied.record.simulationId} applied. ` +
            `Forecast min balance changed from ${formatMinor(applied.beforeMinBalanceMinor, applied.planningCurrency)} ` +
            `to ${formatMinor(applied.afterMinBalanceMinor, applied.planningCurrency)}.`,
          data: {
            ...toCardData(
              state.draft,
              state.decision,
              state.records,
              state.workflowStage,
              state.events,
            ),
            simulationApplied: true,
            simulationId: applied.record.simulationId,
            appliedObligationId: applied.obligationId,
            beforeMinBalanceMinor: applied.beforeMinBalanceMinor,
            afterMinBalanceMinor: applied.afterMinBalanceMinor,
            planningCurrency: applied.planningCurrency,
          },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "simulation failed";
        const state = getSafeState(ctx.sessionId);
        if (state.draft && state.decision) {
          const rejectedRecord: SimulationRecord = {
            simulationId: `sim_sts_rejected_${Date.now().toString(36)}`,
            decisionId: parsed.data.decisionId,
            createdAt: new Date().toISOString(),
            status: "rejected",
            reason: msg,
            sessionId: ctx.sessionId,
            institutionName: state.draft.institutionName ?? null,
            destinationCountry: state.draft.destinationCountry ?? null,
            quote: state.decision.selectedQuote,
            draftSnapshot: state.draft,
            decisionSnapshot: state.decision,
            appliedObligationId: null,
          };
          const stage = resolveStage(state.workflowStage, "BLOCKED");
          const events = appendEvent(state.events, {
            type: "approval_rejected",
            status: "blocked",
            label: "Sandbox simulation rejected",
            detail: msg,
            data: { decisionId: parsed.data.decisionId },
          });
          saveSafeState(ctx.sessionId, {
            draft: state.draft,
            decision: state.decision,
            records: [...state.records, rejectedRecord],
            workflowStage: stage,
            events,
          });
        }
        return {
          ok: false,
          summary: `Simulation rejected: ${msg}`,
        };
      }
    }),
};

export const revertSafeToSendSimulationTool: ToolDefinition = {
  name: "revert_safe_to_send_simulation",
  description:
    "Revert a previously applied Safe-to-Send sandbox simulation by removing its planned obligation from the working forecast and recording a reverted audit status.",
  parameters: RevertSimulationParams,
  requiresApproval: true,
  handler: async (args, ctx) =>
    withToolTimeout("revert_safe_to_send_simulation", (): ToolResult => {
      const parsed = RevertSimulationParams.safeParse(args);
      if (!parsed.success) {
        return {
          ok: false,
          summary: `revert_safe_to_send_simulation: invalid parameters — ${zodIssues(parsed.error)}`,
        };
      }
      const task = getTask(ctx.sessionId);
      if (!task?.workingPlan) {
        return { ok: false, summary: "No working forecast is available to revert." };
      }
      const state = getSafeState(ctx.sessionId);
      const target = parsed.data.simulationId
        ? state.records.find((r) => r.simulationId === parsed.data.simulationId)
        : [...state.records].reverse().find((r) => r.status === "applied");
      if (!target) {
        return { ok: false, summary: "No matching applied simulation record was found." };
      }
      if (!target.appliedObligationId) {
        return { ok: false, summary: "Selected simulation has no obligation reference to revert." };
      }
      const before = buildForecast(assemblePlanState(task.workingPlan));
      let removed = false;
      const obligations = task.workingPlan.obligations.filter((o) => {
        if (o.id === target.appliedObligationId && o.status === "planned") {
          removed = true;
          return false;
        }
        return true;
      });
      if (!removed) {
        return {
          ok: false,
          summary:
            "Simulation revert was not applied because the obligation is missing or no longer in planned status.",
        };
      }
      const nextPlan = { ...task.workingPlan, obligations };
      const after = buildForecast(assemblePlanState(nextPlan));
      const records = state.records.map((r) =>
        r.simulationId === target.simulationId
          ? { ...r, status: "reverted" as const, reason: "Reverted from sandbox forecast" }
          : r,
      );
      const stage = resolveStage(state.workflowStage, "REVERTED");
      const events = appendEvent(state.events, {
        type: "simulation_reverted",
        status: "completed",
        label: `Sandbox simulation reverted: ${target.simulationId}`,
        detail:
          `Forecast min balance changed from ${formatMinor(before.minBalanceMinor, before.planningCurrency)} ` +
          `to ${formatMinor(after.minBalanceMinor, after.planningCurrency)}.`,
        data: {
          simulationId: target.simulationId,
          obligationId: target.appliedObligationId,
        },
      });
      updateTask(ctx.sessionId, {
        workingPlan: nextPlan,
        safeToSend: {
          draft: state.draft as unknown as Record<string, unknown> | null,
          decision: state.decision as unknown as Record<string, unknown> | null,
          records: records as unknown as Record<string, unknown>[],
          workflowStage: stage,
          events,
        },
      });
      return {
        ok: true,
        summary:
          `Reverted simulation ${target.simulationId}. Min balance changed from ${formatMinor(before.minBalanceMinor, before.planningCurrency)} to ${formatMinor(after.minBalanceMinor, after.planningCurrency)}.`,
        data:
          state.draft && state.decision
            ? toCardData(state.draft, state.decision, records, stage, events)
            : {},
      };
    }),
};

export const safeToSendTools: ToolDefinition[] = [
  upsertSafeToSendDraftTool,
  addSafeToSendQuoteTool,
  upsertSafeToSendFundingRecordTool,
  confirmSafeToSendFundingReceiptTool,
  recalculateSafeToSendDecisionTool,
  getSafeToSendDecisionTool,
  loadSafeToSendScenarioTool,
  simulateSafeToSendPaymentTool,
  revertSafeToSendSimulationTool,
];

const ACTIONS: Record<string, ToolDefinition> = {
  get_state: getSafeToSendDecisionTool,
  upsert_draft: upsertSafeToSendDraftTool,
  add_quote: addSafeToSendQuoteTool,
  upsert_funding_record: upsertSafeToSendFundingRecordTool,
  confirm_funding_receipt: confirmSafeToSendFundingReceiptTool,
  recalculate: recalculateSafeToSendDecisionTool,
  load_demo_scenario: loadSafeToSendScenarioTool,
  simulate: simulateSafeToSendPaymentTool,
  revert_simulation: revertSafeToSendSimulationTool,
};

export function getSafeToSendApprovalActions(): string[] {
  return Object.entries(ACTIONS)
    .filter(([, tool]) => tool.requiresApproval)
    .map(([action]) => action)
    .sort();
}

export function getSafeToSendActionApprovalAck(action: string): string | null {
  const tool = ACTIONS[action];
  if (!tool?.requiresApproval) return null;
  return SAFE_TO_SEND_ACTION_ACKS[action as keyof typeof SAFE_TO_SEND_ACTION_ACKS]
    ?? `I_APPROVE_${action.toUpperCase()}`;
}

export function getSafeToSendExecutionRecord(
  sessionId: string,
  simulationId?: string,
):
  | {
      ok: true;
      record: Record<string, unknown>;
    }
  | {
      ok: false;
      error: string;
    } {
  const state = getSafeState(sessionId);
  if (!state.records.length) {
    return { ok: false, error: "No safe-to-send simulation records exist for this session." };
  }

  const target = simulationId
    ? state.records.find((r) => r.simulationId === simulationId)
    : [...state.records].reverse().find((r) => r.status === "applied" || r.status === "reverted") ??
      state.records[state.records.length - 1];

  if (!target) {
    return { ok: false, error: "No matching simulation record was found." };
  }

  const decision = target.decisionSnapshot;
  const forecast = decision.forecastImpact;
  const quote = target.quote;
  const exportPayload: Record<string, unknown> = {
    kind: "studyrunway_safe_to_send_sandbox_receipt",
    generatedAt: nowIso(),
    sessionId,
    workflowStage: state.workflowStage,
    simulation: {
      simulationId: target.simulationId,
      decisionId: target.decisionId,
      createdAt: target.createdAt,
      status: target.status.toUpperCase(),
      reason: target.reason,
      reverted: target.status === "reverted",
      appliedObligationId: target.appliedObligationId,
    },
    institution: {
      name: target.institutionName,
      destinationCountry: target.destinationCountry,
    },
    payment: {
      tuitionAmountMinor: decision.payment.tuitionAmountMinor,
      tuitionCurrency: decision.payment.tuitionCurrency,
      dueDate: decision.payment.dueDate,
      expectedArrivalDate: decision.payment.expectedArrivalDate,
      expectedReceiveMinor: decision.payment.expectedReceiveMinor,
      expectedReceiveCurrency: decision.payment.receiveCurrency,
    },
    quote: quote
      ? {
          id: quote.id,
          providerName: quote.providerName,
          sendCurrency: quote.sendCurrency,
          sendAmountMinor: quote.sendAmountMinor,
          feeMinor: quote.feeMinor,
          targetCurrency: quote.targetCurrency,
          expectedReceiveMinor: quote.expectedReceiveMinor,
          quoteTimestamp: quote.quoteTimestamp,
          quoteExpiry: quote.quoteExpiry,
          sourceLabel: quote.sourceLabel,
          sourceUrl: quote.sourceUrl,
          verificationStatus: quote.verificationStatus,
          verificationBasis: quote.verificationBasis,
        }
      : null,
    decision: {
      status: decision.status,
      reasons: decision.reasons,
      warnings: decision.warnings,
      missingFields: decision.missingFields,
      assumptions: decision.assumptions,
    },
    forecastImpact: forecast
      ? {
          planningCurrency: forecast.planningCurrency,
          beforeMinBalanceMinor: forecast.beforeMinBalanceMinor,
          afterMinBalanceMinor: forecast.afterMinBalanceMinor,
          beforeGapDate: forecast.beforeGapDate,
          afterGapDate: forecast.afterGapDate,
          incompleteCountAfter: forecast.incompleteCountAfter,
        }
      : null,
    timeline: {
      scenarioLabel: decision.timeline.scenarioLabel,
      baselineEarliestShortfall: decision.timeline.baseline.earliestShortfall,
      scenarioEarliestShortfall: decision.timeline.scenario?.earliestShortfall ?? null,
      selectedRecovery: decision.timeline.selectedRecovery,
    },
    approval: {
      explicitAckRequired: true,
      approvedForSimulation: target.status === "applied" || target.status === "reverted",
    },
    storageLimitation:
      "Session-scoped in-memory record only; data is not durable across server restarts.",
  };

  return { ok: true, record: exportPayload };
}

export async function runSafeToSendAction(
  sessionId: string,
  action: string,
  payload: Record<string, unknown>,
): Promise<ToolResult> {
  const tool = ACTIONS[action];
  if (!tool) {
    return { ok: false, summary: `Unknown safe-to-send action: ${action}` };
  }
  return tool.handler(payload, { sessionId, taskId: `safe_action_${sessionId}` });
}
