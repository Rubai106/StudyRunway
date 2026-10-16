/**
 * Destination budget → working-plan integration (Part H).
 *
 * applyBudgetToTask() converts an ACCEPTED LivingCostPlan into
 * ObligationSchema records via planToObligations() and appends them to the
 * task's workingPlan, then re-runs the funding-gap forecast so the caller
 * sees the new projected minimum balance / gap.
 *
 * revertBudgetFromTask() removes exactly those obligations — only ids from
 * the apply manifest (describePlanRevert ids) that still start with "lcp-"
 * and are still "planned" — then recalculates. Committed/paid records are
 * never touched. Nothing here mutates silently: double-apply and
 * revert-without-apply are explicit errors.
 *
 * When the task has no workingPlan yet (e.g. the no-key demo), the plan is
 * seeded from the deterministic sample student plan — documented in the UI
 * copy and in docs/ARCHITECTURE.md. Tuition is excluded unless the plan was
 * built with includeTuition=true (see planToObligations).
 */

import { z } from "zod";
import { getTask, updateTask } from "./agent/state";
import {
  planToObligations,
  describePlanRevert,
  getDestination,
  LivingCostPlanInputsSchema,
  buildLivingCostPlan,
  type LivingCostPlan,
} from "./livingCosts";
import { buildForecast } from "./forecast";
import { assemblePlanState, type ToolPlanInput } from "./tools/common";
import { buildSamplePlan } from "./sample";
import { formatMinor } from "./currency";
import { convertMinor } from "./money";
import { isSupportedCurrency } from "./currency";
import type { Obligation } from "./model";

export interface GapSnapshot {
  planningCurrency: string;
  hasGap: boolean;
  minBalanceMinor: number;
  minBalance: string;
  minBalanceDate: string | null;
  gapDate: string | null;
  shortfallMinor: number | null;
  shortfall: string | null;
  incompleteCount: number;
}

function snapshot(planInput: ToolPlanInput): GapSnapshot {
  const f = buildForecast(assemblePlanState(planInput));
  const pc = f.planningCurrency;
  const gap = f.firstGap;
  return {
    planningCurrency: pc,
    hasGap: gap !== null,
    minBalanceMinor: f.minBalanceMinor,
    minBalance: formatMinor(f.minBalanceMinor, pc),
    minBalanceDate: f.minBalanceDate,
    gapDate: gap?.date ?? null,
    shortfallMinor: gap?.shortfallMinor ?? null,
    shortfall: gap ? formatMinor(gap.shortfallMinor, pc) : null,
    incompleteCount: f.incomplete.length,
  };
}

/** The deterministic sample plan used to seed an empty working plan. */
function samplePlanInput(): ToolPlanInput {
  const s = buildSamplePlan();
  return {
    fundingSources: s.fundingSources,
    obligations: s.obligations,
    planningCurrency: s.profile.planningCurrency,
    asOfDate: null,
    fx: s.fx,
    evidence: [],
    quotes: [],
  };
}

/**
 * Validate the client-returned plan at the API trust boundary. A result card
 * sends the plan back to apply it, so basic shape checks alone are not enough:
 * amounts, currencies, labels and source fields must be safe before they are
 * converted to financial obligations. Unknown display-only fields are retained
 * for the LivingCostPlan type, but fields consumed by the apply path are strict.
 */
const SafeMinor = z.number().int().min(0).refine(Number.isSafeInteger, "Amount must be a safe integer number of minor units");
const CurrencyCode = z.string().regex(/^[A-Z]{3}$/, "Currency must be a 3-letter ISO code").refine(isSupportedCurrency, "Unsupported currency code");
const SourceUrl = z.string().url().max(1000).refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}, "Source URLs must use HTTPS and must not include embedded credentials");

const ApplyCategorySchema = z.object({
  category: z.string().min(1).max(100),
  label: z.string().min(1).max(160),
  estimateMinor: SafeMinor,
  estimateMethod: z.string().min(1).max(300),
  sourceTitle: z.string().min(1).max(240),
  sourceUrl: SourceUrl,
  accommodationType: z.string().max(240).optional(),
}).passthrough();

const ApplyOneTimeSchema = z.object({
  label: z.string().min(1).max(240),
  estimateMinor: SafeMinor,
  sourceTitle: z.string().min(1).max(240),
  sourceUrl: SourceUrl,
}).passthrough();

const ApplyPlanSchema = z.object({
  destinationId: z.string().min(1).max(120),
  destinationLabel: z.string().min(1).max(240),
  currency: CurrencyCode,
  verdict: z.enum(["insufficient_data", "shortfall", "tight", "within_budget"]),
  categories: z.array(ApplyCategorySchema).max(100),
  oneTime: z.object({ items: z.array(ApplyOneTimeSchema).max(100) }).passthrough(),
  tuition: z.object({
    included: z.boolean(),
    amountMinor: SafeMinor.nullable(),
    currency: CurrencyCode.nullable(),
    note: z.string().max(1000),
  }).passthrough(),
}).passthrough().superRefine((plan, ctx) => {
  if (plan.tuition.included && (plan.tuition.amountMinor == null || plan.tuition.currency == null)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["tuition"],
      message: "Included tuition must have a valid amount and currency.",
    });
  }
});

function parsePlanForApply(plan: unknown): LivingCostPlan {
  const parsed = ApplyPlanSchema.parse(plan);
  return parsed as unknown as LivingCostPlan;
}

/**
 * Plan-integrity verification at the API trust boundary.
 *
 * The client sends back the accepted plan, but a plan object alone is not
 * trusted: the caller must ALSO send the budget inputs (planInputs) that
 * produced it. The server then:
 *  1. parses the inputs with the real LivingCostPlanInputsSchema;
 *  2. cross-checks destinationId against the server-side cost dataset —
 *     getDestination() throws on a fabricated/unknown id;
 *  3. recomputes the plan with the deterministic engine from those inputs;
 *  4. compares the submitted plan's key amounts against the recomputed plan
 *     with EXACT integer equality in minor units. The engine is
 *     deterministic, so any deviation means the client fabricated the plan
 *     or tampered with its amounts.
 *
 * Throws a clear Error on any mismatch (the route maps it to HTTP 400).
 */
export function verifyPlanIntegrity(plan: LivingCostPlan, rawPlanInputs: unknown): void {
  let inputs;
  try {
    inputs = LivingCostPlanInputsSchema.parse(rawPlanInputs);
  } catch (err) {
    throw new Error(
      "planInputs is required: send the budget inputs used to build the plan so the server can re-verify it. " +
        (err instanceof Error ? err.message : "invalid planInputs"),
    );
  }
  if (inputs.destinationId !== plan.destinationId) {
    throw new Error(
      `plan destination "${plan.destinationId}" does not match the supplied inputs' destination "${inputs.destinationId}" — refusing to apply a mismatched plan`,
    );
  }
  // Explicit dataset cross-check: rejects fabricated destinationIds even when
  // the plan object itself is otherwise well-formed.
  getDestination(inputs.destinationId);
  const expected = buildLivingCostPlan(inputs);

  const mismatches: string[] = [];
  const check = (label: string, got: unknown, want: unknown) => {
    if (got !== want) {
      mismatches.push(
        `${label}: submitted ${JSON.stringify(got)} != recomputed ${JSON.stringify(want)}`,
      );
    }
  };
  check("currency", plan.currency, expected.currency);
  check("destinationLabel", plan.destinationLabel, expected.destinationLabel);
  check("verdict", plan.verdict, expected.verdict);
  check("budgetMinor", plan.budgetMinor, expected.budgetMinor);
  check("monthlyTotals.lowMinor", plan.monthlyTotals?.lowMinor, expected.monthlyTotals.lowMinor);
  check("monthlyTotals.typicalMinor", plan.monthlyTotals?.typicalMinor, expected.monthlyTotals.typicalMinor);
  check("monthlyTotals.highMinor", plan.monthlyTotals?.highMinor, expected.monthlyTotals.highMinor);

  const expectedCats = new Map(expected.categories.map((c) => [c.category, c]));
  if (plan.categories.length !== expected.categories.length) {
    mismatches.push(
      `categories: submitted ${plan.categories.length} lines != recomputed ${expected.categories.length} lines`,
    );
  }
  // Categories become separate obligations, so duplicate identifiers must be
  // rejected explicitly. A length-only check plus a Map lookup would allow a
  // duplicate category to stand in for a missing category and be counted twice.
  const seenCategories = new Set<string>();
  for (const c of plan.categories) {
    if (seenCategories.has(c.category)) {
      mismatches.push(`duplicate category "${c.category}" in submitted plan`);
      continue;
    }
    seenCategories.add(c.category);
    const e = expectedCats.get(c.category);
    if (!e) {
      mismatches.push(`category "${c.category}" is not in the recomputed plan`);
      continue;
    }
    // Verify every category field consumed by the apply/obligation path,
    // including labels and source attribution, not just monetary values.
    for (const field of [
      "label", "accommodationType", "lifestyle", "estimateMethod",
      "sourceTitle", "sourceUrl", "valueKind", "confidence", "limitations",
    ] as const) {
      check(`categories[${c.category}].${field}`, c[field], e[field]);
    }
    check(`categories[${c.category}].estimateMinor`, c.estimateMinor, e.estimateMinor);
    check(`categories[${c.category}].minMinor`, c.minMinor, e.minMinor);
    check(`categories[${c.category}].maxMinor`, c.maxMinor, e.maxMinor);
  }
  for (const expectedCategory of expected.categories) {
    if (!seenCategories.has(expectedCategory.category)) {
      mismatches.push(`missing category "${expectedCategory.category}" from submitted plan`);
    }
  }

  check("oneTime.totalMinor", plan.oneTime?.totalMinor, expected.oneTime.totalMinor);
  if (plan.oneTime.items.length !== expected.oneTime.items.length) {
    mismatches.push(
      `oneTime.items: submitted ${plan.oneTime.items.length} != recomputed ${expected.oneTime.items.length}`,
    );
  }
  // One-time due dates are submitted by array index. Compare each record in
  // that same order so a changed label/source or swapped item cannot inherit
  // another item's date or misleading provenance.
  const oneTimeFields = [
    "label", "sourceTitle", "sourceUrl", "valueKind",
    "estimateMinor", "minMinor", "maxMinor",
  ] as const;
  const oneTimeCount = Math.min(plan.oneTime.items.length, expected.oneTime.items.length);
  for (let i = 0; i < oneTimeCount; i++) {
    const item = plan.oneTime.items[i];
    const e = expected.oneTime.items[i];
    for (const field of oneTimeFields) {
      check(`oneTime[${i}].${field}`, item[field], e[field]);
    }
  }

  check("tuition.included", plan.tuition?.included, expected.tuition.included);
  check("tuition.amountMinor", plan.tuition?.amountMinor ?? null, expected.tuition.amountMinor ?? null);
  check("tuition.currency", plan.tuition?.currency ?? null, expected.tuition.currency ?? null);
  check("tuition.note", plan.tuition?.note, expected.tuition.note);

  if (mismatches.length > 0) {
    const shown = mismatches.slice(0, 5).join("; ");
    const more = mismatches.length > 5 ? ` (+${mismatches.length - 5} more)` : "";
    throw new Error(
      `plan integrity check failed — the submitted plan does not match a server-side recomputation from the supplied inputs (${shown}${more}). ` +
        "Resubmit the plan exactly as the budget tool returned it.",
    );
  }
}

export interface BudgetApplyResult {
  obligations: Obligation[];
  obligationCount: number;
  monthlyEstimateMinor: number;
  currency: string;
  destinationLabel: string;
  tuitionNote: string;
  gapBefore: GapSnapshot;
  gapAfter: GapSnapshot;
  /** Explicit conversion used when destination and financial-plan currencies differ. */
  fxConversion: { from: string; to: string; rate: number; asOf: string; source: string } | null;
  /** True when the working plan was seeded from the sample plan. */
  seededFromSample: boolean;
}

/**
 * Apply an accepted living-cost plan to the session's working plan.
 * Throws a clear Error on: unknown session, already-applied budget,
 * insufficient_data plans, an invalid startDate/studyMonths, or a plan that
 * fails integrity verification against the supplied planInputs (see
 * verifyPlanIntegrity).
 */
export function applyBudgetToTask(
  sessionId: string,
  plan: unknown,
  rawOptions: unknown,
  rawPlanInputs: unknown
): BudgetApplyResult {
  const state = getTask(sessionId);
  if (!state) {
    throw new Error(
      `unknown session "${sessionId}" — start a chat session before applying a budget`
    );
  }
  if (state.appliedBudget) {
    throw new Error(
      `a destination budget for "${state.appliedBudget.destinationLabel}" is already applied — ` +
        "revert it before applying another"
    );
  }
  const acceptedPlan = parsePlanForApply(plan);
  // The client-returned plan is never trusted on its own: the destination is
  // cross-checked against the server dataset and every key amount is
  // re-verified against a server-side recomputation of the deterministic
  // engine from the supplied inputs.
  verifyPlanIntegrity(acceptedPlan, rawPlanInputs);
  const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }, "Date must be a real calendar date (YYYY-MM-DD)");
  const options = z.object({
    startDate: calendarDate,
    studyMonths: z.number().int().min(1).max(60),
    oneTimeDueDates: z.record(z.string(), calendarDate).default({}),
    tuitionDueDate: calendarDate.optional(),
    fxRateToPlanning: z.number().positive().finite().max(1_000_000).optional(),
    fxRateDate: calendarDate.optional(),
    fxRateSource: z.string().trim().min(1).max(200).optional(),
  }).parse(rawOptions);

  const base = state.workingPlan ?? samplePlanInput();
  const conversion = planToObligations(acceptedPlan, {
    startDate: options.startDate,
    studyMonths: options.studyMonths,
    oneTimeDueDates: options.oneTimeDueDates,
    ...(options.tuitionDueDate ? { tuitionDueDate: options.tuitionDueDate } : {}),
  });

  let fxConversion: BudgetApplyResult["fxConversion"] = null;
  let obligationsToApply = conversion.obligations;
  if (acceptedPlan.currency !== base.planningCurrency) {
    if (options.fxRateToPlanning == null) {
      throw new Error(
        `The destination budget is in ${acceptedPlan.currency}, but your financial plan uses ${base.planningCurrency}. ` +
        `Enter an explicit exchange rate in ${base.planningCurrency} per 1 ${acceptedPlan.currency}, with its source and date. No conversion was applied.`,
      );
    }
    if (!options.fxRateDate || !options.fxRateSource) {
      throw new Error("An explicit exchange rate requires both a rate date and a source label. No conversion was applied.");
    }
    obligationsToApply = conversion.obligations.map((obligation) => {
      if (obligation.currency !== acceptedPlan.currency) {
        throw new Error(`Cannot safely convert ${obligation.currency} obligation with the supplied ${acceptedPlan.currency} → ${base.planningCurrency} rate.`);
      }
      const convertedAmount = obligation.amountMinor == null
        ? null
        : convertMinor(obligation.amountMinor, acceptedPlan.currency, base.planningCurrency, options.fxRateToPlanning as number);
      const rateNote = `Explicit user-supplied FX: 1 ${acceptedPlan.currency} = ${options.fxRateToPlanning} ${base.planningCurrency}; source: ${options.fxRateSource}; dated ${options.fxRateDate}.`;
      const keepOriginalChars = Math.max(0, 500 - rateNote.length - 1);
      return {
        ...obligation,
        amountMinor: convertedAmount,
        currency: base.planningCurrency,
        // Preserve the rate provenance at the end instead of truncating it.
        notes: `${obligation.notes.slice(0, keepOriginalChars)} ${rateNote}`,
      };
    });
    fxConversion = {
      from: acceptedPlan.currency,
      to: base.planningCurrency,
      rate: options.fxRateToPlanning,
      asOf: options.fxRateDate,
      source: options.fxRateSource,
    };
  }

  // A tuition figure may have its own currency. Never leave a differently
  // denominated obligation inside a plan whose forecast uses one currency.
  // The apply form only accepts one explicit rate (destination -> plan), so a
  // tuition figure in a third currency must be corrected/excluded first.
  const currenciesStillUnconverted = [...new Set(
    obligationsToApply.filter((o) => o.currency !== base.planningCurrency).map((o) => o.currency),
  )];
  if (currenciesStillUnconverted.length > 0) {
    throw new Error(
      `Cannot include obligation(s) in ${currenciesStillUnconverted.join(", ")} in a ${base.planningCurrency} forecast without a separate explicit conversion. ` +
      "Align the tuition currency with the destination currency or exclude it and add it separately with its own sourced rate.",
    );
  }

  const gapBefore = snapshot(base);
  const merged: ToolPlanInput = {
    ...base,
    obligations: [...base.obligations, ...obligationsToApply],
  };
  const gapAfter = snapshot(merged);

  updateTask(sessionId, {
    workingPlan: merged,
    appliedBudget: {
      destinationId: acceptedPlan.destinationId,
      destinationLabel: acceptedPlan.destinationLabel,
      appliedAt: new Date().toISOString(),
      obligationIds: obligationsToApply.map((o) => o.id),
      startDate: options.startDate,
      studyMonths: options.studyMonths,
    },
  });

  const monthlyEstimateMinor = obligationsToApply
    .filter((o) => o.recurring)
    .reduce((sum, o) => sum + (o.amountMinor ?? 0), 0);

  return {
    obligations: obligationsToApply,
    obligationCount: obligationsToApply.length,
    monthlyEstimateMinor,
    currency: base.planningCurrency,
    destinationLabel: acceptedPlan.destinationLabel,
    tuitionNote: conversion.tuitionNote,
    gapBefore,
    gapAfter,
    fxConversion,
    seededFromSample: state.workingPlan === null,
  };
}

export interface BudgetRevertResult {
  removedCount: number;
  removedIds: string[];
  summary: string;
  gapAfter: GapSnapshot;
}

/**
 * Revert the applied destination budget. Removes exactly the applied
 * obligations that are still "planned" (describePlanRevert ids) — records the
 * user has since committed or paid are left alone — then recalculates.
 */
export function revertBudgetFromTask(sessionId: string): BudgetRevertResult {
  const state = getTask(sessionId);
  if (!state) {
    throw new Error(
      `unknown session "${sessionId}" — start a chat session before reverting a budget`
    );
  }
  const applied = state.appliedBudget;
  if (!applied) {
    throw new Error("no destination budget is applied — nothing to revert");
  }
  if (!state.workingPlan) {
    throw new Error("the working plan is missing — nothing to revert");
  }

  const ids = new Set(applied.obligationIds);
  const removed: Obligation[] = [];
  const kept = state.workingPlan.obligations.filter((o) => {
    if (ids.has(o.id) && o.id.startsWith("lcp-") && o.status === "planned") {
      removed.push(o);
      return false;
    }
    return true;
  });

  const desc = describePlanRevert(removed);
  const merged: ToolPlanInput = { ...state.workingPlan, obligations: kept };
  const gapAfter = snapshot(merged);

  updateTask(sessionId, {
    workingPlan: merged,
    appliedBudget: null,
  });

  return {
    removedCount: removed.length,
    removedIds: desc.obligationIds,
    summary:
      desc.summary +
      ` Kept ${kept.length} existing obligation(s); any applied item already ` +
      `committed or paid was left untouched.`,
    gapAfter,
  };
}
