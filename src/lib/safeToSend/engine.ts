import { createHash } from "crypto";
import { z } from "zod";
import { buildForecast, resolveRate } from "@/lib/forecast";
import { buildSamplePlan } from "@/lib/sample";
import { convertMinor } from "@/lib/money";
import { formatMinor, isSupportedCurrency } from "@/lib/currency";
import { addDaysISO, ISO_DATE, type Obligation } from "@/lib/model";
import { assemblePlanState, type ToolPlanInput } from "@/lib/tools/common";

const SafeMinor = z.number().int().nonnegative().refine(Number.isSafeInteger, "Must be a safe integer minor-unit amount");
const CurrencyCode = z
  .string()
  .length(3)
  .transform((v) => v.toUpperCase())
  .refine(isSupportedCurrency, "Unsupported currency code");

const QuoteRateDirectionSchema = z.enum(["TARGET_PER_SOURCE", "SOURCE_PER_TARGET"]);
const QuoteVerificationSchema = z.enum([
  "user_provided_unverified",
  "sourced_unverified",
  "verified",
]);

export const PaymentQuoteSchema = z.object({
  id: z.string().min(1).max(120),
  providerName: z.string().min(1).max(160),
  sendCurrency: CurrencyCode,
  sendAmountMinor: SafeMinor.optional(),
  feeMinor: SafeMinor.optional(),
  feeCurrency: CurrencyCode.optional(),
  exchangeRate: z.number().positive().finite().optional(),
  rateDirection: QuoteRateDirectionSchema.optional(),
  fxMarkupMinor: SafeMinor.optional(),
  targetCurrency: CurrencyCode,
  expectedReceiveMinor: SafeMinor.optional(),
  expectedDeliveryDate: ISO_DATE.optional(),
  expectedDeliveryDays: z.number().int().min(0).max(90).optional(),
  quoteTimestamp: z.string().datetime().optional(),
  quoteExpiry: z.string().datetime().optional(),
  sourceLabel: z.string().max(200).optional(),
  sourceUrl: z.string().url().max(1000).optional(),
  acceptedByRecipient: z.boolean().nullable().optional(),
  verificationStatus: QuoteVerificationSchema.default("user_provided_unverified"),
  verificationBasis: z.string().max(500).optional(),
});

const PrioritySchema = z.enum(["minimize_cost", "meet_deadline", "balanced"]);
const FundingRecordStatusSchema = z.enum([
  "EXPECTED",
  "AT_RISK",
  "DELAYED",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "CANCELLED",
]);
const FundingRecordTypeSchema = z.enum([
  "scholarship",
  "family_transfer",
  "loan_disbursement",
  "savings_transfer",
  "other",
]);

export const IncomingFundingRecordSchema = z.object({
  id: z.string().min(1).max(120),
  type: FundingRecordTypeSchema,
  label: z.string().min(1).max(200),
  expectedAmountMinor: SafeMinor,
  currency: CurrencyCode,
  expectedDate: ISO_DATE,
  receivedAmountMinor: SafeMinor.optional(),
  receivedDate: ISO_DATE.optional(),
  status: FundingRecordStatusSchema,
  reference: z.string().max(500).optional(),
  evidenceNote: z.string().max(500).optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

export const TimelineObligationSchema = z.object({
  id: z.string().min(1).max(120),
  label: z.string().min(1).max(200),
  kind: z.enum(["tuition", "rent", "living", "other"]),
  amountMinor: SafeMinor,
  currency: CurrencyCode,
  dueDate: ISO_DATE,
  status: z.enum(["planned", "committed", "paid"]).default("planned"),
});

export const DelayScenarioSchema = z.object({
  mode: z.enum(["none", "delay", "cancel"]),
  fundingId: z.string().min(1).max(120),
  revisedExpectedDate: ISO_DATE.optional(),
  note: z.string().max(500).optional(),
});

export const RecoveryAssumptionSchema = z.object({
  id: z.string().min(1).max(120),
  label: z.string().min(1).max(200),
  type: z.enum(["extra_inflow", "expense_reduction"]),
  amountMinor: SafeMinor,
  currency: CurrencyCode,
  effectiveDate: ISO_DATE,
  note: z.string().max(500).optional(),
});

export const SafeToSendDraftSchema = z.object({
  institutionName: z.string().min(1).max(200).optional(),
  destinationCountry: z.string().min(1).max(120).optional(),
  tuitionAmountMinor: SafeMinor.optional(),
  tuitionCurrency: CurrencyCode.optional(),
  tuitionDueDate: ISO_DATE.optional(),
  officialInstructionsProvided: z.boolean().optional(),
  officialInstructionsReference: z.string().max(500).optional(),

  fundingSourceCountry: z.string().min(1).max(120).optional(),
  availableFundsMinor: SafeMinor.optional(),
  fundingCurrency: CurrencyCode.optional(),
  fundsReservedForTuitionMinor: SafeMinor.optional(),
  knownObligationsMinor: SafeMinor.optional(),
  requiredLivingReserveMinor: SafeMinor.optional(),
  desiredEmergencyReserveMinor: SafeMinor.optional(),

  sendPerFundingRate: z.number().positive().finite().optional(),
  sendPerFundingRateSource: z.string().max(200).optional(),
  sendPerFundingRateTimestamp: z.string().datetime().optional(),

  priority: PrioritySchema.optional(),
  selectedQuoteId: z.string().max(120).optional(),
  quotes: z.array(PaymentQuoteSchema).max(20).default([]),
  fundingRecords: z.array(IncomingFundingRecordSchema).max(100).default([]),
  timelineObligations: z.array(TimelineObligationSchema).max(100).default([]),
  openingAvailableMinor: SafeMinor.optional(),
  activeDelayScenario: DelayScenarioSchema.optional(),
  selectedRecoveryAssumption: RecoveryAssumptionSchema.optional(),
  notes: z.string().max(1000).optional(),
}).superRefine((draft, ctx) => {
  for (const rec of draft.fundingRecords) {
    if (rec.status === "RECEIVED" && (rec.receivedAmountMinor == null || !rec.receivedDate)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Funding record ${rec.id} is RECEIVED but lacks received amount/date.`,
        path: ["fundingRecords"],
      });
    }
    if (rec.status === "PARTIALLY_RECEIVED") {
      if (rec.receivedAmountMinor == null || !rec.receivedDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Funding record ${rec.id} is PARTIALLY_RECEIVED but lacks received amount/date.`,
          path: ["fundingRecords"],
        });
      } else if (rec.receivedAmountMinor >= rec.expectedAmountMinor) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Funding record ${rec.id} PARTIALLY_RECEIVED amount must be lower than expected amount.`,
          path: ["fundingRecords"],
        });
      }
    }
    if (rec.status === "CANCELLED" && rec.receivedAmountMinor != null && rec.receivedAmountMinor > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Funding record ${rec.id} cannot be CANCELLED with received funds. Use PARTIALLY_RECEIVED or RECEIVED.`,
        path: ["fundingRecords"],
      });
    }
  }
});

export type PaymentQuote = z.infer<typeof PaymentQuoteSchema>;
export type IncomingFundingRecord = z.infer<typeof IncomingFundingRecordSchema>;
export type TimelineObligation = z.infer<typeof TimelineObligationSchema>;
export type DelayScenario = z.infer<typeof DelayScenarioSchema>;
export type RecoveryAssumption = z.infer<typeof RecoveryAssumptionSchema>;
export type SafeToSendDraft = z.infer<typeof SafeToSendDraftSchema>;
export type SafeToSendDraftInput = z.input<typeof SafeToSendDraftSchema>;

export const SafeToSendStatusSchema = z.enum([
  "READY_TO_SIMULATE",
  "RISK_DETECTED",
  "MORE_INFORMATION_REQUIRED",
  "BLOCKED",
]);

export type SafeToSendStatus = z.infer<typeof SafeToSendStatusSchema>;

export interface DecisionReason {
  code: string;
  severity: "info" | "warning" | "risk" | "blocked";
  message: string;
}

export interface SafeToSendTimelineEvent {
  id: string;
  date: string;
  kind: "inflow" | "outflow";
  sourceType: "funding" | "obligation" | "recovery";
  label: string;
  amountMinor: number;
  currency: string;
  amountInFundingMinor: number | null;
  uncertain: boolean;
  hypothetical: boolean;
  status: string;
}

export interface EarliestShortfall {
  date: string;
  thresholdMinor: number;
  balanceMinor: number;
  shortfallMinor: number;
  eventId: string;
  eventLabel: string;
}

export interface TimelineProjection {
  currency: string;
  openingMinor: number;
  reserveThresholdMinor: number;
  events: Array<SafeToSendTimelineEvent & { balanceAfterMinor: number }>;
  earliestShortfall: EarliestShortfall | null;
  incompleteItems: string[];
  assumptions: string[];
}

export interface RecoveryOption {
  id: string;
  label: string;
  rationale: string;
  assumption: RecoveryAssumption;
}

export interface SafeToSendDecision {
  decisionId: string;
  status: SafeToSendStatus;
  evaluatedAt: string;
  selectedQuoteId: string | null;
  missingFields: string[];
  reasons: DecisionReason[];
  warnings: string[];
  assumptions: string[];
  comparisonCurrency: string;
  payment: {
    tuitionAmountMinor: number | null;
    tuitionCurrency: string | null;
    dueDate: string | null;
    expectedArrivalDate: string | null;
    expectedReceiveMinor: number | null;
    receiveCurrency: string | null;
    paymentRequirementMinorInFunding: number | null;
    paymentRequirementMinorInPlanning: number | null;
  };
  affordability: {
    availableFundsMinor: number | null;
    knownObligationsMinor: number | null;
    requiredLivingReserveMinor: number | null;
    desiredEmergencyReserveMinor: number | null;
    remainingAfterPaymentMinor: number | null;
    shortfallMinor: number | null;
  };
  forecastImpact: {
    planningCurrency: string;
    beforeMinBalanceMinor: number | null;
    afterMinBalanceMinor: number | null;
    beforeGapDate: string | null;
    afterGapDate: string | null;
    incompleteCountAfter: number;
  } | null;
  timeline: {
    baseline: TimelineProjection;
    scenario: TimelineProjection | null;
    scenarioLabel: string | null;
    selectedRecovery: RecoveryAssumption | null;
    recoveryOptions: RecoveryOption[];
  };
  selectedQuote: PaymentQuote | null;
}

export interface SimulationRecord {
  simulationId: string;
  decisionId: string;
  createdAt: string;
  status: "applied" | "rejected" | "reverted";
  reason: string;
  sessionId: string;
  institutionName: string | null;
  destinationCountry: string | null;
  quote: PaymentQuote | null;
  draftSnapshot: SafeToSendDraft;
  decisionSnapshot: SafeToSendDecision;
  appliedObligationId: string | null;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(",")}}`;
}

function hashId(prefix: string, value: unknown): string {
  const hash = createHash("sha256").update(canonical(value)).digest("hex").slice(0, 16);
  return `${prefix}_${hash}`;
}

function chooseQuote(draft: SafeToSendDraft): PaymentQuote | null {
  if (draft.selectedQuoteId) {
    return draft.quotes.find((q) => q.id === draft.selectedQuoteId) ?? null;
  }
  return draft.quotes.length === 1 ? draft.quotes[0] : null;
}

function asDateOnly(isoDateTime: string): string {
  return isoDateTime.slice(0, 10);
}

function quoteArrival(quote: PaymentQuote): string | null {
  if (quote.expectedDeliveryDate) return quote.expectedDeliveryDate;
  if (quote.expectedDeliveryDays != null && quote.quoteTimestamp) {
    return addDaysISO(asDateOnly(quote.quoteTimestamp), quote.expectedDeliveryDays);
  }
  return null;
}

function deriveWorkingPlan(
  base: ToolPlanInput | null,
  fundingCurrency: string,
  draft?: SafeToSendDraft,
): ToolPlanInput {
  if (base && base.fundingSources.length > 0) return base;
  const s = buildSamplePlan();
  const fundingSources: ToolPlanInput["fundingSources"] = [];
  const obligations: ToolPlanInput["obligations"] = [];

  if (draft) {
    if (draft.openingAvailableMinor != null && draft.openingAvailableMinor > 0) {
      fundingSources.push({
        id: "fs-draft-opening",
        label: "Opening available funds",
        kind: "savings",
        amountMinor: draft.openingAvailableMinor,
        currency: draft.fundingCurrency ?? fundingCurrency,
        status: "confirmed_available",
        availableDate: draft.tuitionDueDate ? addDaysISO(draft.tuitionDueDate, -30) : null,
        expectedDate: null,
        notes: "Opening balance for Safe-to-Send projection",
        evidenceIds: [],
      });
    }
    for (const r of draft.fundingRecords) {
      if (r.status === "CANCELLED") continue;
      const amount =
        r.status === "RECEIVED"
          ? (r.receivedAmountMinor ?? r.expectedAmountMinor)
          : r.expectedAmountMinor;
      fundingSources.push({
        id: `fs-draft-${r.id}`,
        label: r.label,
        kind: r.type === "scholarship" ? "scholarship" : r.type === "family_transfer" ? "family" : "savings",
        amountMinor: amount,
        currency: r.currency,
        status: r.status === "RECEIVED" ? "confirmed_available" : "confirmed_pending",
        availableDate: r.status === "RECEIVED" ? (r.receivedDate ?? r.expectedDate) : null,
        expectedDate: r.expectedDate,
        notes: r.reference ?? r.label,
        evidenceIds: [],
      });
    }
    for (const o of draft.timelineObligations) {
      obligations.push({
        id: `obl-draft-${o.id}`,
        label: o.label,
        kind: o.kind,
        amountMinor: o.amountMinor,
        currency: o.currency,
        dueDate: o.dueDate,
        recurring: null,
        status: o.status,
        notes: "Timeline obligation",
        evidenceIds: [],
      });
    }
  }

  const rates: Record<string, number> = { ...s.fx.rates };
  if (draft?.sendPerFundingRate && draft.fundingCurrency && draft.tuitionCurrency) {
    rates[`${draft.fundingCurrency}>${draft.tuitionCurrency}`] = draft.sendPerFundingRate;
  }

  const extraBaseObligations = (base?.obligations ?? []).filter(
    (bo) => !obligations.some((o) => o.id === `obl-draft-${bo.id}` || o.id === bo.id),
  );

  return {
    fundingSources: fundingSources.length > 0 ? fundingSources : (base?.fundingSources ?? []),
    obligations: [...obligations, ...extraBaseObligations],
    planningCurrency: fundingCurrency,
    asOfDate: s.profile.asOfDate,
    fx: {
      rates,
      asOf: s.fx.asOf,
      source: "Derived Safe-to-Send projection plan",
    },
    evidence: base?.evidence ?? [],
    quotes: base?.quotes ?? [],
  };
}

function convertToFundingCurrency(
  amountMinor: number,
  fromCurrency: string,
  fundingCurrency: string,
  draft: SafeToSendDraft,
  plan: ToolPlanInput,
): { value: number | null; assumption?: string; missing?: string } {
  if (fromCurrency === fundingCurrency) return { value: amountMinor };
  if (
    draft.sendPerFundingRate &&
    draft.sendPerFundingRate > 0 &&
    draft.fundingCurrency === fundingCurrency
  ) {
    // explicit rate only applies funding<->send conversions; still better than inventing.
    return { value: null, missing: `No explicit conversion for ${fromCurrency} -> ${fundingCurrency}` };
  }
  const resolved = resolveRate(plan.fx, fromCurrency, fundingCurrency);
  if (!resolved) {
    return {
      value: null,
      missing: `Missing FX rate ${fromCurrency}->${fundingCurrency} for timeline item`,
    };
  }
  return {
    value: convertMinor(amountMinor, fromCurrency, fundingCurrency, resolved.rate),
    assumption: `${resolved.pair}=${resolved.rate} (${plan.fx.source}, ${plan.fx.asOf})`,
  };
}

function applyFundingScenario(
  record: IncomingFundingRecord,
  scenario: DelayScenario | undefined,
): IncomingFundingRecord {
  if (!scenario || scenario.fundingId !== record.id || scenario.mode === "none") return record;
  if (scenario.mode === "cancel") {
    return { ...record, status: "CANCELLED", updatedAt: new Date().toISOString() };
  }
  if (scenario.mode === "delay" && scenario.revisedExpectedDate) {
    return {
      ...record,
      expectedDate: scenario.revisedExpectedDate,
      status: record.status === "RECEIVED" ? "RECEIVED" : "DELAYED",
      updatedAt: new Date().toISOString(),
    };
  }
  return record;
}

function buildTimelineProjection(
  draft: SafeToSendDraft,
  plan: ToolPlanInput,
  includeScenario: boolean,
): TimelineProjection {
  const currency = draft.fundingCurrency ?? plan.planningCurrency;
  const thresholdMinor =
    (draft.requiredLivingReserveMinor ?? 0) + (draft.desiredEmergencyReserveMinor ?? 0);
  const openingMinor = draft.openingAvailableMinor ?? draft.availableFundsMinor ?? 0;
  const events: SafeToSendTimelineEvent[] = [];
  const incompleteItems: string[] = [];
  const assumptions = new Set<string>();

  const maybeScenario = includeScenario ? draft.activeDelayScenario : undefined;
  for (const rawRecord of draft.fundingRecords) {
    const record = applyFundingScenario(rawRecord, maybeScenario);
    const isHypothetical = Boolean(
      maybeScenario && maybeScenario.fundingId === rawRecord.id && maybeScenario.mode !== "none",
    );

    if (record.status === "CANCELLED") {
      events.push({
        id: `fund-${record.id}-cancelled`,
        date: record.expectedDate,
        kind: "inflow",
        sourceType: "funding",
        label: `${record.label} (cancelled)` ,
        amountMinor: 0,
        currency: record.currency,
        amountInFundingMinor: 0,
        uncertain: true,
        hypothetical: isHypothetical,
        status: record.status,
      });
      continue;
    }

    if (record.status === "RECEIVED" || record.status === "PARTIALLY_RECEIVED") {
      const receivedMinor =
        record.receivedAmountMinor ??
        (record.status === "RECEIVED" ? record.expectedAmountMinor : 0);
      const receivedDate = record.receivedDate ?? record.expectedDate;
      const conv = convertToFundingCurrency(receivedMinor, record.currency, currency, draft, plan);
      if (conv.value == null) {
        incompleteItems.push(conv.missing ?? `${record.label} received conversion missing`);
      }
      if (conv.assumption) assumptions.add(conv.assumption);
      events.push({
        id: `fund-${record.id}-received`,
        date: receivedDate,
        kind: "inflow",
        sourceType: "funding",
        label: `${record.label} (received)`,
        amountMinor: receivedMinor,
        currency: record.currency,
        amountInFundingMinor: conv.value,
        uncertain: false,
        hypothetical: false,
        status: record.status,
      });
      if (record.status === "PARTIALLY_RECEIVED") {
        const outstanding = Math.max(0, record.expectedAmountMinor - receivedMinor);
        if (outstanding > 0) {
          const expConv = convertToFundingCurrency(outstanding, record.currency, currency, draft, plan);
          if (expConv.value == null) {
            incompleteItems.push(expConv.missing ?? `${record.label} outstanding conversion missing`);
          }
          if (expConv.assumption) assumptions.add(expConv.assumption);
          events.push({
            id: `fund-${record.id}-outstanding`,
            date: record.expectedDate,
            kind: "inflow",
            sourceType: "funding",
            label: `${record.label} (outstanding expected)`,
            amountMinor: outstanding,
            currency: record.currency,
            amountInFundingMinor: expConv.value,
            uncertain: true,
            hypothetical: isHypothetical,
            status: record.status,
          });
        }
      }
      continue;
    }

    const conv = convertToFundingCurrency(
      record.expectedAmountMinor,
      record.currency,
      currency,
      draft,
      plan,
    );
    if (conv.value == null) {
      incompleteItems.push(conv.missing ?? `${record.label} conversion missing`);
    }
    if (conv.assumption) assumptions.add(conv.assumption);
    events.push({
      id: `fund-${record.id}-expected`,
      date: record.expectedDate,
      kind: "inflow",
      sourceType: "funding",
      label: `${record.label} (${record.status.toLowerCase().replace("_", " ")})`,
      amountMinor: record.expectedAmountMinor,
      currency: record.currency,
      amountInFundingMinor: conv.value,
      uncertain: record.status !== "EXPECTED",
      hypothetical: isHypothetical,
      status: record.status,
    });
  }

  const addOutflow = (id: string, label: string, amountMinor: number, currencyCode: string, date: string, status: string, hypothetical = false) => {
    const conv = convertToFundingCurrency(amountMinor, currencyCode, currency, draft, plan);
    if (conv.value == null) {
      incompleteItems.push(conv.missing ?? `${label} conversion missing`);
    }
    if (conv.assumption) assumptions.add(conv.assumption);
    events.push({
      id,
      date,
      kind: "outflow",
      sourceType: "obligation",
      label,
      amountMinor,
      currency: currencyCode,
      amountInFundingMinor: conv.value,
      uncertain: false,
      hypothetical,
      status,
    });
  };

  for (const o of draft.timelineObligations) {
    if (o.status === "paid") continue;
    addOutflow(`obl-draft-${o.id}`, o.label, o.amountMinor, o.currency, o.dueDate, o.status);
  }
  for (const o of plan.obligations) {
    if (o.status === "paid" || o.amountMinor == null || !o.dueDate) continue;
    if (
      o.id.startsWith("obl-draft-") ||
      draft.timelineObligations.some((d) => `obl-draft-${d.id}` === o.id || d.id === o.id)
    ) {
      continue;
    }
    addOutflow(`obl-plan-${o.id}`, o.label, o.amountMinor, o.currency, o.dueDate, o.status);
  }

  if (draft.selectedRecoveryAssumption) {
    const r = draft.selectedRecoveryAssumption;
    const conv = convertToFundingCurrency(r.amountMinor, r.currency, currency, draft, plan);
    if (conv.value == null) {
      incompleteItems.push(conv.missing ?? `${r.label} conversion missing`);
    }
    if (conv.assumption) assumptions.add(conv.assumption);
    events.push({
      id: `recovery-${r.id}`,
      date: r.effectiveDate,
      kind: r.type === "extra_inflow" ? "inflow" : "outflow",
      sourceType: "recovery",
      label: r.label,
      amountMinor: r.amountMinor,
      currency: r.currency,
      amountInFundingMinor: conv.value,
      uncertain: true,
      hypothetical: true,
      status: "recovery_assumption",
    });
  }

  events.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.kind !== b.kind) return a.kind === "inflow" ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });

  let balance = openingMinor;
  let earliestShortfall: EarliestShortfall | null = null;
  const withBalance = events.map((ev) => {
    const delta = ev.amountInFundingMinor ?? 0;
    balance += ev.kind === "inflow" ? delta : -delta;
    if (!earliestShortfall && balance < thresholdMinor) {
      earliestShortfall = {
        date: ev.date,
        thresholdMinor,
        balanceMinor: balance,
        shortfallMinor: thresholdMinor - balance,
        eventId: ev.id,
        eventLabel: ev.label,
      };
    }
    return { ...ev, balanceAfterMinor: balance };
  });

  return {
    currency,
    openingMinor,
    reserveThresholdMinor: thresholdMinor,
    events: withBalance,
    earliestShortfall,
    incompleteItems,
    assumptions: [...assumptions],
  };
}

function recoveryOptionsForProjection(
  draft: SafeToSendDraft,
  projection: TimelineProjection,
): RecoveryOption[] {
  if (!projection.earliestShortfall) return [];
  const sf = projection.earliestShortfall;
  const needed = sf.shortfallMinor;
  const currency = projection.currency;
  const date = sf.date;
  const options: RecoveryOption[] = [
    {
      id: "recovery-bridge-family",
      label: "Bridge funding from family transfer",
      rationale:
        "A temporary family transfer before the shortfall date can close a timing gap while waiting for delayed funding.",
      assumption: {
        id: "recovery-bridge-family",
        label: "Hypothetical bridge family transfer",
        type: "extra_inflow",
        amountMinor: needed,
        currency,
        effectiveDate: date,
        note: "Hypothetical recovery assumption — not confirmed funding.",
      },
    },
    {
      id: "recovery-cut-discretionary",
      label: "Reduce discretionary costs temporarily",
      rationale:
        "A temporary spending reduction may preserve reserve until delayed funds arrive; confirm practical impact before relying on it.",
      assumption: {
        id: "recovery-cut-discretionary",
        label: "Hypothetical temporary expense reduction",
        type: "expense_reduction",
        amountMinor: Math.max(1, Math.floor(needed * 0.6)),
        currency,
        effectiveDate: date,
        note: "Hypothetical reduction assumption only.",
      },
    },
    {
      id: "recovery-extension-request",
      label: "Model payment-extension impact",
      rationale:
        "Contact the university finance office for an extension/installment; this option models only the financial impact once terms are confirmed.",
      assumption: {
        id: "recovery-extension-request",
        label: "Hypothetical extension-related inflow/relief",
        type: "extra_inflow",
        amountMinor: Math.max(1, Math.floor(needed * 0.4)),
        currency,
        effectiveDate: date,
        note: "Assumption placeholder pending confirmed extension terms.",
      },
    },
  ];

  // If we can identify a delayed/cancelled funding record, include a targeted option.
  const delayed = draft.fundingRecords.find((r) => r.status === "DELAYED" || r.status === "AT_RISK");
  if (delayed) {
    options.unshift({
      id: `recovery-expedite-${delayed.id}`,
      label: `Expedite ${delayed.label}`,
      rationale:
        "If the funding administrator confirms earlier disbursement, the shortfall can shrink or disappear. Re-enter the confirmed date when available.",
      assumption: {
        id: `recovery-expedite-${delayed.id}`,
        label: `Hypothetical expedited ${delayed.label}`,
        type: "extra_inflow",
        amountMinor: Math.min(needed, delayed.expectedAmountMinor),
        currency: delayed.currency,
        effectiveDate: date,
        note: "Hypothetical until payer confirms revised disbursement date.",
      },
    });
  }
  return options;
}

export function evaluateSafeToSendDecision(
  draftInput: unknown,
  workingPlan: ToolPlanInput | null,
  nowIso = new Date().toISOString(),
): SafeToSendDecision {
  const parsed = SafeToSendDraftSchema.parse(draftInput);
  const draft = parsed;
  const missingFields: string[] = [];
  const reasons: DecisionReason[] = [];
  const warnings: string[] = [];
  const assumptions: string[] = [];

  const quote = chooseQuote(draft);
  if (!quote) missingFields.push("selected_quote");

  if (!draft.institutionName) missingFields.push("institution_name");
  if (!draft.destinationCountry) missingFields.push("destination_country");
  if (draft.tuitionAmountMinor == null) missingFields.push("tuition_amount");
  if (!draft.tuitionCurrency) missingFields.push("tuition_currency");
  if (!draft.tuitionDueDate) missingFields.push("tuition_due_date");
  if (!draft.fundingSourceCountry) missingFields.push("funding_source_country");
  if (draft.availableFundsMinor == null) missingFields.push("available_funds");
  if (!draft.fundingCurrency) missingFields.push("funding_currency");
  if (draft.requiredLivingReserveMinor == null) missingFields.push("required_living_reserve");
  if (draft.desiredEmergencyReserveMinor == null) {
    missingFields.push("desired_emergency_reserve");
    reasons.push({
      code: "EMERGENCY_RESERVE_MISSING",
      severity: "warning",
      message:
        "No emergency reserve was provided. Safe-to-send remains incomplete until a reserve assumption is supplied.",
    });
  }
  if (draft.officialInstructionsProvided == null) missingFields.push("official_payment_instructions_status");
  if (draft.officialInstructionsProvided === false) {
    reasons.push({
      code: "RECIPIENT_INSTRUCTIONS_UNKNOWN",
      severity: "warning",
      message:
        "Official university payment instructions are not confirmed. Route compatibility cannot be verified.",
    });
  }

  if (draft.fundingRecords.length === 0) {
    missingFields.push("funding_records");
  }
  if (draft.timelineObligations.length === 0 && (!workingPlan || workingPlan.obligations.length === 0)) {
    missingFields.push("timeline_obligations");
  }

  let blocked = false;
  let risk = false;

  const fundingCurrency = draft.fundingCurrency ?? quote?.sendCurrency ?? "GBP";
  const plan = deriveWorkingPlan(workingPlan, fundingCurrency, draft);
  const comparisonCurrency = fundingCurrency;

  const baselineTimeline = buildTimelineProjection(draft, plan, false);
  const scenarioTimeline = draft.activeDelayScenario && draft.activeDelayScenario.mode !== "none"
    ? buildTimelineProjection(draft, plan, true)
    : null;
  const activeTimeline = scenarioTimeline ?? baselineTimeline;
  const recoveryOptions = recoveryOptionsForProjection(draft, activeTimeline);

  if (draft.activeDelayScenario && draft.activeDelayScenario.mode !== "none") {
    reasons.push({
      code: "DELAY_SCENARIO_ACTIVE",
      severity: "warning",
      message:
        draft.activeDelayScenario.mode === "cancel"
          ? `Stress scenario active: funding ${draft.activeDelayScenario.fundingId} is hypothetically cancelled.`
          : `Delay scenario active: funding ${draft.activeDelayScenario.fundingId} moved to ${draft.activeDelayScenario.revisedExpectedDate ?? "unknown date"}.`,
    });
  }

  if (activeTimeline.incompleteItems.length > 0) {
    warnings.push(...activeTimeline.incompleteItems);
  }
  assumptions.push(...activeTimeline.assumptions.map((a) => `Timeline conversion: ${a}`));

  let expectedReceiveMinor: number | null = null;
  let expectedArrivalDate: string | null = null;
  let paymentRequirementInFunding: number | null = null;
  let paymentRequirementInPlanning: number | null = null;

  if (quote) {
    if (quote.quoteExpiry && quote.quoteExpiry < nowIso) {
      blocked = true;
      reasons.push({
        code: "QUOTE_EXPIRED",
        severity: "blocked",
        message: "The selected quote is expired and cannot be treated as current.",
      });
    }

    const feeCurrency = quote.feeCurrency ?? quote.sendCurrency;
    if (quote.sendAmountMinor == null) missingFields.push("quote_send_amount");
    if (quote.feeMinor == null) missingFields.push("quote_fee");

    if (quote.expectedReceiveMinor != null) {
      expectedReceiveMinor = quote.expectedReceiveMinor;
    } else if (
      quote.sendAmountMinor != null &&
      quote.feeMinor != null &&
      quote.exchangeRate != null &&
      quote.rateDirection
    ) {
      if (feeCurrency !== quote.sendCurrency) {
        missingFields.push("quote_fee_currency_conversion");
      } else {
        const netSend = quote.sendAmountMinor - quote.feeMinor - (quote.fxMarkupMinor ?? 0);
        if (netSend <= 0) {
          blocked = true;
          reasons.push({
            code: "QUOTE_NET_SEND_NON_POSITIVE",
            severity: "blocked",
            message: "Fees and markups consume the transfer amount; nothing would be received.",
          });
        } else {
          const rate =
            quote.rateDirection === "TARGET_PER_SOURCE"
              ? quote.exchangeRate
              : 1 / quote.exchangeRate;
          if (!(rate > 0) || !Number.isFinite(rate)) {
            blocked = true;
            reasons.push({
              code: "QUOTE_RATE_INVALID",
              severity: "blocked",
              message: "The quote exchange-rate direction/value is invalid.",
            });
          } else {
            expectedReceiveMinor = convertMinor(
              netSend,
              quote.sendCurrency,
              quote.targetCurrency,
              rate,
            );
            assumptions.push(
              `Expected receive uses quote rate (${quote.rateDirection}) and visible fees/markup only.`,
            );
          }
        }
      }
    } else {
      missingFields.push("quote_expected_receive_or_rate");
    }

    expectedArrivalDate = quoteArrival(quote);
    if (!expectedArrivalDate) {
      missingFields.push("quote_delivery_estimate");
      warnings.push("Delivery estimate is missing, so on-time arrival cannot be asserted.");
    }

    if (
      draft.tuitionDueDate &&
      expectedArrivalDate &&
      expectedArrivalDate > draft.tuitionDueDate
    ) {
      risk = true;
      reasons.push({
        code: "DEADLINE_RISK",
        severity: "risk",
        message: `Expected arrival (${expectedArrivalDate}) is after tuition due date (${draft.tuitionDueDate}).`,
      });
    }

    if (
      draft.tuitionAmountMinor != null &&
      draft.tuitionCurrency &&
      expectedReceiveMinor != null
    ) {
      if (quote.targetCurrency !== draft.tuitionCurrency) {
        missingFields.push("tuition_vs_quote_currency_alignment");
      } else if (expectedReceiveMinor < draft.tuitionAmountMinor) {
        risk = true;
        reasons.push({
          code: "INSUFFICIENT_RECEIVE_AMOUNT",
          severity: "risk",
          message: "Expected received amount is below the tuition amount due.",
        });
      }
    }

    if (quote.acceptedByRecipient === false) {
      blocked = true;
      reasons.push({
        code: "ROUTE_NOT_ACCEPTED",
        severity: "blocked",
        message:
          "The selected route is marked as not accepted by the intended recipient/university instructions.",
      });
    }
    if (quote.acceptedByRecipient == null) {
      missingFields.push("recipient_route_acceptance_status");
    }

    if (quote.sendAmountMinor != null && quote.feeMinor != null) {
      const requirementSend = quote.sendAmountMinor + quote.feeMinor + (quote.fxMarkupMinor ?? 0);
      if (feeCurrency !== quote.sendCurrency) {
        missingFields.push("fee_currency_conversion_missing");
      }
      if (draft.fundingCurrency && draft.fundingCurrency === quote.sendCurrency) {
        paymentRequirementInFunding = requirementSend;
      } else if (draft.fundingCurrency && draft.sendPerFundingRate && draft.sendPerFundingRate > 0) {
        paymentRequirementInFunding = convertMinor(
          requirementSend,
          quote.sendCurrency,
          draft.fundingCurrency,
          1 / draft.sendPerFundingRate,
        );
        assumptions.push(
          `Funding conversion uses explicit user-provided rate: 1 ${draft.fundingCurrency} = ${draft.sendPerFundingRate} ${quote.sendCurrency}.`,
        );
      } else {
        missingFields.push("funding_to_send_conversion_rate");
      }

      if (paymentRequirementInFunding != null) {
        if (plan.planningCurrency === (draft.fundingCurrency ?? "")) {
          paymentRequirementInPlanning = paymentRequirementInFunding;
        } else {
          const resolved = resolveRate(
            plan.fx,
            draft.fundingCurrency ?? "",
            plan.planningCurrency,
          );
          if (resolved) {
            paymentRequirementInPlanning = convertMinor(
              paymentRequirementInFunding,
              draft.fundingCurrency ?? "",
              plan.planningCurrency,
              resolved.rate,
            );
            assumptions.push(
              `Forecast impact conversion uses ${resolved.pair} from the working-plan FX table (${plan.fx.source}, as of ${plan.fx.asOf}).`,
            );
          } else {
            warnings.push(
              `Could not convert ${draft.fundingCurrency ?? "funding currency"} to planning currency ${plan.planningCurrency} for forecast-impact projection.`,
            );
          }
        }
      }
    }
  }

  let remainingAfterPaymentMinor: number | null = null;
  let shortfallMinor: number | null = null;
  if (
    draft.availableFundsMinor != null &&
    paymentRequirementInFunding != null &&
    draft.knownObligationsMinor != null &&
    draft.requiredLivingReserveMinor != null &&
    draft.desiredEmergencyReserveMinor != null
  ) {
    remainingAfterPaymentMinor =
      draft.availableFundsMinor -
      paymentRequirementInFunding -
      draft.knownObligationsMinor -
      draft.requiredLivingReserveMinor -
      draft.desiredEmergencyReserveMinor;
    if (remainingAfterPaymentMinor < 0) {
      risk = true;
      shortfallMinor = -remainingAfterPaymentMinor;
      reasons.push({
        code: "POST_PAYMENT_SHORTFALL",
        severity: "risk",
        message:
          "After tuition transfer cost, obligations, living reserve, and emergency reserve, funds would go negative.",
      });
    }
    if (
      draft.fundsReservedForTuitionMinor != null &&
      draft.fundsReservedForTuitionMinor < paymentRequirementInFunding
    ) {
      risk = true;
      reasons.push({
        code: "RESERVED_FUNDS_INADEQUATE",
        severity: "risk",
        message: "Funds currently reserved for tuition are below the required sending amount plus known transfer costs.",
      });
    }
  }

  if (activeTimeline.earliestShortfall) {
    risk = true;
    reasons.push({
      code: "TIMELINE_EARLIEST_SHORTFALL",
      severity: "risk",
      message:
        `Timeline projects reserve shortfall on ${activeTimeline.earliestShortfall.date} around "${activeTimeline.earliestShortfall.eventLabel}".`,
    });
  }

  let forecastImpact: SafeToSendDecision["forecastImpact"] = null;
  if (paymentRequirementInPlanning != null && quote && draft.tuitionDueDate) {
    const before = buildForecast(assemblePlanState(plan));
    const extraObligation: Obligation = {
      id: `sts-${hashId("obl", { q: quote.id, due: draft.tuitionDueDate }).slice(4)}`,
      label: `SIMULATED tuition payment via ${quote.providerName}`,
      kind: "tuition",
      amountMinor: paymentRequirementInPlanning,
      currency: plan.planningCurrency,
      dueDate: draft.tuitionDueDate,
      recurring: null,
      status: "planned",
      notes: "SIMULATED SANDBOX obligation from Safe-to-Send engine",
      evidenceIds: [],
    };
    const afterPlan: ToolPlanInput = {
      ...plan,
      obligations: [...plan.obligations, extraObligation],
    };
    const after = buildForecast(assemblePlanState(afterPlan));
    forecastImpact = {
      planningCurrency: plan.planningCurrency,
      beforeMinBalanceMinor: before.minBalanceMinor,
      afterMinBalanceMinor: after.minBalanceMinor,
      beforeGapDate: before.firstGap?.date ?? null,
      afterGapDate: after.firstGap?.date ?? null,
      incompleteCountAfter: after.incomplete.length,
    };
    if (after.firstGap) {
      risk = true;
      reasons.push({
        code: "FORECAST_GAP_AFTER_SIMULATION",
        severity: "risk",
        message: `Forecast shows a funding gap after simulation (${after.firstGap.date}).`,
      });
    }
  }

  const uniqMissing = [...new Set(missingFields)].sort();

  let status: SafeToSendStatus;
  if (blocked) {
    status = "BLOCKED";
  } else if (risk) {
    // Material risk remains risk even when other fields are missing.
    status = "RISK_DETECTED";
  } else if (uniqMissing.length > 0) {
    status = "MORE_INFORMATION_REQUIRED";
  } else {
    status = "READY_TO_SIMULATE";
    reasons.push({
      code: "READY_CHECKS_PASSED",
      severity: "info",
      message:
        "Required fields are complete, quote sufficiency checks passed, and affordability checks do not show a shortfall under current assumptions.",
    });
  }

  if (quote?.verificationStatus === "user_provided_unverified") {
    warnings.push("Selected quote is user-provided and not independently verified.");
  }

  const decisionCore = {
    draft,
    status,
    selectedQuoteId: quote?.id ?? null,
    uniqMissing,
    reasons,
    warnings,
    assumptions,
    paymentRequirementInFunding,
    paymentRequirementInPlanning,
    expectedReceiveMinor,
    expectedArrivalDate,
    comparisonCurrency,
    affordability: {
      availableFundsMinor: draft.availableFundsMinor ?? null,
      knownObligationsMinor: draft.knownObligationsMinor ?? null,
      requiredLivingReserveMinor: draft.requiredLivingReserveMinor ?? null,
      desiredEmergencyReserveMinor: draft.desiredEmergencyReserveMinor ?? null,
      remainingAfterPaymentMinor,
      shortfallMinor,
    },
    timeline: {
      baseline: baselineTimeline,
      scenario: scenarioTimeline,
      scenarioLabel: draft.activeDelayScenario?.mode === "none"
        ? null
        : draft.activeDelayScenario
          ? `${draft.activeDelayScenario.mode} ${draft.activeDelayScenario.fundingId}`
          : null,
      selectedRecovery: draft.selectedRecoveryAssumption ?? null,
      recoveryOptions,
    },
    forecastImpact,
  };

  const decisionId = hashId("sts_dec", decisionCore);

  return {
    decisionId,
    status,
    evaluatedAt: nowIso,
    selectedQuoteId: quote?.id ?? null,
    missingFields: uniqMissing,
    reasons,
    warnings,
    assumptions,
    comparisonCurrency,
    payment: {
      tuitionAmountMinor: draft.tuitionAmountMinor ?? null,
      tuitionCurrency: draft.tuitionCurrency ?? null,
      dueDate: draft.tuitionDueDate ?? null,
      expectedArrivalDate,
      expectedReceiveMinor,
      receiveCurrency: quote?.targetCurrency ?? null,
      paymentRequirementMinorInFunding: paymentRequirementInFunding,
      paymentRequirementMinorInPlanning: paymentRequirementInPlanning,
    },
    affordability: {
      availableFundsMinor: draft.availableFundsMinor ?? null,
      knownObligationsMinor: draft.knownObligationsMinor ?? null,
      requiredLivingReserveMinor: draft.requiredLivingReserveMinor ?? null,
      desiredEmergencyReserveMinor: draft.desiredEmergencyReserveMinor ?? null,
      remainingAfterPaymentMinor,
      shortfallMinor,
    },
    forecastImpact,
    timeline: {
      baseline: baselineTimeline,
      scenario: scenarioTimeline,
      scenarioLabel: draft.activeDelayScenario?.mode === "none"
        ? null
        : draft.activeDelayScenario
          ? `${draft.activeDelayScenario.mode} ${draft.activeDelayScenario.fundingId}`
          : null,
      selectedRecovery: draft.selectedRecoveryAssumption ?? null,
      recoveryOptions,
    },
    selectedQuote: quote,
  };
}

export function describeDecision(decision: SafeToSendDecision): string {
  const tuition =
    decision.payment.tuitionAmountMinor != null && decision.payment.tuitionCurrency
      ? formatMinor(decision.payment.tuitionAmountMinor, decision.payment.tuitionCurrency)
      : "unknown tuition amount";
  const due = decision.payment.dueDate ?? "unknown due date";
  if (decision.status === "READY_TO_SIMULATE") {
    return `Safe-to-Send: ready to simulate ${tuition} due ${due}.`;
  }
  if (decision.status === "BLOCKED") {
    return `Safe-to-Send: blocked for ${tuition} due ${due} — ${decision.reasons[0]?.message ?? "mandatory safety checks failed"}.`;
  }
  if (decision.status === "RISK_DETECTED") {
    return `Safe-to-Send: risk detected for ${tuition} due ${due} — ${decision.reasons[0]?.message ?? "financial or deadline risk identified"}.`;
  }
  return `Safe-to-Send: more information required (${decision.missingFields.length} required input(s) missing); tuition due ${due}.`;
}

export interface SafeToSendScenario {
  id: string;
  label: string;
  description: string;
  draft: SafeToSendDraftInput;
}

export const SAFE_TO_SEND_SCENARIOS: SafeToSendScenario[] = [
  {
    id: "A_AFFORDABLE",
    label: "Scenario A — Affordable payment",
    description: "Complete quote, sufficient funds, and acceptable delivery estimate.",
    draft: {
      institutionName: "Sample University of Limerick",
      destinationCountry: "Ireland",
      tuitionAmountMinor: 300000,
      tuitionCurrency: "EUR",
      tuitionDueDate: "2027-09-10",
      officialInstructionsProvided: true,
      officialInstructionsReference: "Sample tuition instructions PDF, section 3",
      fundingSourceCountry: "Bangladesh",
      availableFundsMinor: 720000,
      fundingCurrency: "BDT",
      fundsReservedForTuitionMinor: 530000,
      knownObligationsMinor: 50000,
      requiredLivingReserveMinor: 90000,
      desiredEmergencyReserveMinor: 30000,
      sendPerFundingRate: 0.008,
      sendPerFundingRateSource: "Fictitious Demo FX board",
      sendPerFundingRateTimestamp: "2027-09-01T09:00:00.000Z",
      priority: "balanced",
      selectedQuoteId: "q_a_1",
      openingAvailableMinor: 380000,
      fundingRecords: [
        {
          id: "fund-scholarship",
          type: "scholarship",
          label: "Merit scholarship disbursement (demo)",
          expectedAmountMinor: 240000,
          currency: "BDT",
          expectedDate: "2027-09-05",
          status: "EXPECTED",
          reference: "Fictitious scholarship letter",
        },
        {
          id: "fund-family",
          type: "family_transfer",
          label: "Family transfer from Bangladesh (demo)",
          expectedAmountMinor: 180000,
          currency: "BDT",
          expectedDate: "2027-09-07",
          status: "EXPECTED",
          reference: "Fictitious transfer plan",
        },
      ],
      timelineObligations: [
        {
          id: "obl-rent",
          label: "Rent due (demo)",
          kind: "rent",
          amountMinor: 120000,
          currency: "BDT",
          dueDate: "2027-09-07",
          status: "committed",
        },
        {
          id: "obl-food",
          label: "Essential living costs (demo)",
          kind: "living",
          amountMinor: 40000,
          currency: "BDT",
          dueDate: "2027-09-08",
          status: "planned",
        },
      ],
      quotes: [
        {
          id: "q_a_1",
          providerName: "CampusRemit Demo Route Alpha",
          sendCurrency: "BDT",
          sendAmountMinor: 510000,
          feeMinor: 6000,
          feeCurrency: "BDT",
          exchangeRate: 0.00058,
          rateDirection: "TARGET_PER_SOURCE",
          fxMarkupMinor: 2000,
          targetCurrency: "EUR",
          expectedReceiveMinor: 301500,
          expectedDeliveryDays: 2,
          quoteTimestamp: "2027-09-01T10:00:00.000Z",
          quoteExpiry: "2027-09-05T10:00:00.000Z",
          sourceLabel: "User-entered demo quote",
          sourceUrl: "https://example.org/demo/quote-a1",
          acceptedByRecipient: true,
          verificationStatus: "user_provided_unverified",
          verificationBasis: "User screenshot from provider app",
        },
      ],
      notes: "All providers, quotes, and rates in this scenario are fictitious demonstration data.",
    },
  },
  {
    id: "B_LIVING_SHORTFALL",
    label: "Scenario B — Living-cost shortfall",
    description: "Payment may clear tuition but leaves inadequate living funds.",
    draft: {
      institutionName: "Sample University of Limerick",
      destinationCountry: "Ireland",
      tuitionAmountMinor: 300000,
      tuitionCurrency: "EUR",
      tuitionDueDate: "2027-09-10",
      officialInstructionsProvided: true,
      fundingSourceCountry: "Bangladesh",
      availableFundsMinor: 540000,
      fundingCurrency: "BDT",
      fundsReservedForTuitionMinor: 500000,
      knownObligationsMinor: 80000,
      requiredLivingReserveMinor: 110000,
      desiredEmergencyReserveMinor: 50000,
      sendPerFundingRate: 0.008,
      priority: "meet_deadline",
      selectedQuoteId: "q_b_1",
      quotes: [
        {
          id: "q_b_1",
          providerName: "CampusRemit Demo Route Beta",
          sendCurrency: "BDT",
          sendAmountMinor: 505000,
          feeMinor: 7000,
          feeCurrency: "BDT",
          exchangeRate: 0.00058,
          rateDirection: "TARGET_PER_SOURCE",
          targetCurrency: "EUR",
          expectedReceiveMinor: 300100,
          expectedDeliveryDays: 2,
          quoteTimestamp: "2027-09-01T10:00:00.000Z",
          acceptedByRecipient: true,
          verificationStatus: "user_provided_unverified",
        },
      ],
    },
  },
  {
    id: "C_MISSING_RATE",
    label: "Scenario C — Missing exchange rate",
    description: "Cross-currency payment without usable FX conversion details.",
    draft: {
      institutionName: "Sample University of Limerick",
      destinationCountry: "Ireland",
      tuitionAmountMinor: 300000,
      tuitionCurrency: "EUR",
      tuitionDueDate: "2027-09-10",
      officialInstructionsProvided: true,
      fundingSourceCountry: "Bangladesh",
      availableFundsMinor: 700000,
      fundingCurrency: "BDT",
      knownObligationsMinor: 20000,
      requiredLivingReserveMinor: 80000,
      desiredEmergencyReserveMinor: 25000,
      priority: "balanced",
      selectedQuoteId: "q_c_1",
      quotes: [
        {
          id: "q_c_1",
          providerName: "CampusRemit Demo Route Gamma",
          sendCurrency: "BDT",
          sendAmountMinor: 510000,
          feeMinor: 5000,
          feeCurrency: "BDT",
          targetCurrency: "EUR",
          expectedDeliveryDays: 2,
          quoteTimestamp: "2027-09-01T10:00:00.000Z",
          acceptedByRecipient: true,
          verificationStatus: "user_provided_unverified",
        },
      ],
    },
  },
  {
    id: "D_DEADLINE_RISK",
    label: "Scenario D — Deadline risk",
    description: "Delivery estimate lands after tuition due date.",
    draft: {
      institutionName: "Sample University of Limerick",
      destinationCountry: "Ireland",
      tuitionAmountMinor: 300000,
      tuitionCurrency: "EUR",
      tuitionDueDate: "2027-09-05",
      officialInstructionsProvided: true,
      fundingSourceCountry: "Bangladesh",
      availableFundsMinor: 740000,
      fundingCurrency: "BDT",
      knownObligationsMinor: 30000,
      requiredLivingReserveMinor: 90000,
      desiredEmergencyReserveMinor: 30000,
      sendPerFundingRate: 0.008,
      priority: "minimize_cost",
      selectedQuoteId: "q_d_1",
      quotes: [
        {
          id: "q_d_1",
          providerName: "CampusRemit Demo Route Delta",
          sendCurrency: "BDT",
          sendAmountMinor: 500000,
          feeMinor: 5000,
          feeCurrency: "BDT",
          exchangeRate: 0.0006,
          rateDirection: "TARGET_PER_SOURCE",
          targetCurrency: "EUR",
          expectedReceiveMinor: 302000,
          expectedDeliveryDate: "2027-09-08",
          quoteTimestamp: "2027-09-01T10:00:00.000Z",
          acceptedByRecipient: true,
          verificationStatus: "user_provided_unverified",
        },
      ],
    },
  },
  {
    id: "E_INSTRUCTIONS_MISSING",
    label: "Scenario E — Incomplete payment instructions",
    description: "Recipient/payment instructions are not confirmed.",
    draft: {
      institutionName: "Sample University of Limerick",
      destinationCountry: "Ireland",
      tuitionAmountMinor: 300000,
      tuitionCurrency: "EUR",
      tuitionDueDate: "2027-09-10",
      officialInstructionsProvided: false,
      fundingSourceCountry: "Bangladesh",
      availableFundsMinor: 740000,
      fundingCurrency: "BDT",
      knownObligationsMinor: 30000,
      requiredLivingReserveMinor: 90000,
      desiredEmergencyReserveMinor: 30000,
      sendPerFundingRate: 0.008,
      priority: "balanced",
      selectedQuoteId: "q_e_1",
      quotes: [
        {
          id: "q_e_1",
          providerName: "CampusRemit Demo Route Epsilon",
          sendCurrency: "BDT",
          sendAmountMinor: 500000,
          feeMinor: 5000,
          feeCurrency: "BDT",
          exchangeRate: 0.0006,
          rateDirection: "TARGET_PER_SOURCE",
          targetCurrency: "EUR",
          expectedReceiveMinor: 301000,
          expectedDeliveryDays: 2,
          quoteTimestamp: "2027-09-01T10:00:00.000Z",
          acceptedByRecipient: null,
          verificationStatus: "user_provided_unverified",
        },
      ],
    },
  },
  {
    id: "F_MANIPULATED_AFTER_APPROVAL",
    label: "Scenario F — Conflicting/manipulated inputs",
    description:
      "Demonstrates stale approval protection: changing quote or amount invalidates previous decision approval binding.",
    draft: {
      institutionName: "Sample University of Limerick",
      destinationCountry: "Ireland",
      tuitionAmountMinor: 300000,
      tuitionCurrency: "EUR",
      tuitionDueDate: "2027-09-10",
      officialInstructionsProvided: true,
      fundingSourceCountry: "Bangladesh",
      availableFundsMinor: 730000,
      fundingCurrency: "BDT",
      knownObligationsMinor: 30000,
      requiredLivingReserveMinor: 90000,
      desiredEmergencyReserveMinor: 30000,
      sendPerFundingRate: 0.008,
      priority: "balanced",
      selectedQuoteId: "q_f_1",
      quotes: [
        {
          id: "q_f_1",
          providerName: "CampusRemit Demo Route Zeta",
          sendCurrency: "BDT",
          sendAmountMinor: 500000,
          feeMinor: 4500,
          feeCurrency: "BDT",
          exchangeRate: 0.0006,
          rateDirection: "TARGET_PER_SOURCE",
          targetCurrency: "EUR",
          expectedReceiveMinor: 303000,
          expectedDeliveryDays: 1,
          quoteTimestamp: "2027-09-01T10:00:00.000Z",
          acceptedByRecipient: true,
          verificationStatus: "user_provided_unverified",
        },
      ],
    },
  },
];

export function getSafeToSendScenario(id: string): SafeToSendScenario | null {
  return SAFE_TO_SEND_SCENARIOS.find((s) => s.id === id) ?? null;
}
