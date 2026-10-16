/**
 * simulate_scenario — deterministic what-if analysis.
 *
 * Applies a scenario to a deep copy of the plan (the input is never
 * mutated) and re-runs the forecast engine, returning baseline-vs-scenario
 * diffs plus the list of changed assumptions and a practical implication
 * string. All figures are engine-computed.
 *
 * - scholarship_delay / expense_increase / fx_shock map onto the engine's
 *   ScenarioTransform types and run through applyScenario()/diffForecasts().
 * - transfer_fee_change has no engine transform (quotes are not part of the
 *   dated forecast), so it is applied to a deep copy of the plan's quotes
 *   and re-analyzed with the deterministic analyzeQuote() arithmetic.
 */

import { z } from "zod";
import { formatMinor } from "../currency";
import { buildForecast, type ForecastResult } from "../forecast";
import { applyScenario, diffForecasts } from "../scenarios";
import { analyzeQuote } from "../transfers";
import { OBLIGATION_KINDS, Scenario, formatDateLong } from "../model";
import { scaleMinor } from "../money";
import {
  currencyCodeSchema,
  ToolPlanSchema,
  assemblePlanState,
  withToolTimeout,
  zodIssues,
} from "./common";
import type { ToolDefinition, ToolResult } from "./types";

export const ScenarioInputSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("scholarship_delay"),
    sourceId: z.string().min(1).describe("Funding source id to delay"),
    days: z.number().int().min(1).max(365).describe("Days to push the expected date back"),
  }),
  z.object({
    type: z.literal("expense_increase"),
    percent: z.number().min(0).max(200).describe("Percentage to raise obligations by"),
    kinds: z
      .array(z.enum(OBLIGATION_KINDS))
      .default([])
      .describe("Obligation kinds to raise; empty = all"),
  }),
  z.object({
    type: z.literal("fx_shock"),
    percent: z.number().min(-50).max(50).describe("Percent shift of FX rates (negative = worse for the student)"),
    pairs: z.array(z.string()).default([]).describe('Currency pairs like "BDT>GBP"; empty = all live exposures'),
  }),
  z.object({
    type: z.literal("transfer_fee_change"),
    percent: z.number().min(-100).max(500).describe("Percentage change to transfer fees (negative = fees fall)"),
    quoteId: z.string().nullable().default(null).describe("Quote id to change; null = all plan quotes"),
  }),
]);
export type ScenarioInput = z.infer<typeof ScenarioInputSchema>;

/**
 * Explicit recovery assumptions supplied by the user. They are simulated on
 * the stressed forecast only and never written back to the plan.
 */
export const RecoveryOptionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("additional_funding"),
    label: z.string().min(1).max(120),
    amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    currency: currencyCodeSchema,
    availableDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  z.object({
    type: z.literal("tuition_installment"),
    label: z.string().min(1).max(120),
    obligationId: z.string().min(1).max(120),
    firstInstallmentMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    remainderDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
]);

export const RecoveryOptionsSchema = z.array(RecoveryOptionSchema).max(8).default([]);
export type RecoveryOption = z.infer<typeof RecoveryOptionSchema>;

export const SimulateScenarioParams = z.object({
  plan: ToolPlanSchema.describe("Plan object: fundingSources, obligations, planningCurrency, asOfDate, fx (quotes required for transfer_fee_change)"),
  scenario: ScenarioInputSchema.describe("The what-if scenario to simulate"),
  recoveryOptions: RecoveryOptionsSchema.describe("Optional user-stated backup funding or tuition installment options to compare against the scenario. Never infer institutional approval or availability."),
});

function evaluateRecoveryOptions(
  stressedState: ReturnType<typeof assemblePlanState>,
  options: RecoveryOption[],
) {
  const evaluated = options.map((option, index) => {
    const candidate = JSON.parse(JSON.stringify(stressedState)) as typeof stressedState;
    let assumption: string;
    if (option.type === "additional_funding") {
      candidate.fundingSources.push({
        id: `recovery-option-${index + 1}`,
        label: option.label,
        kind: "other",
        amountMinor: option.amountMinor,
        currency: option.currency,
        status: "conditional",
        availableDate: null,
        expectedDate: option.availableDate,
        notes: "Hypothetical recovery option; not confirmed or added to the plan.",
        evidenceIds: [],
      });
      assumption = `Assumes ${option.label} of ${formatMinor(option.amountMinor, option.currency)} arrives by ${option.availableDate}; availability is unverified.`;
    } else {
      const original = candidate.obligations.find((obligation) => obligation.id === option.obligationId);
      if (!original || original.kind !== "tuition" || original.status === "paid" || original.amountMinor == null || !original.dueDate) {
        return {
          label: option.label,
          type: option.type,
          valid: false,
          reason: "The referenced unpaid tuition obligation with a known amount and due date was not found; no option was simulated.",
        };
      }
      if (option.firstInstallmentMinor >= original.amountMinor || option.remainderDueDate <= original.dueDate) {
        return {
          label: option.label,
          type: option.type,
          valid: false,
          reason: "The first installment must be smaller than the full tuition amount and the remainder date must be later than the current due date.",
        };
      }
      const remainder = original.amountMinor - option.firstInstallmentMinor;
      original.amountMinor = option.firstInstallmentMinor;
      candidate.obligations.push({
        ...original,
        id: `${original.id}-recovery-${index + 1}`,
        label: `${original.label} (installment remainder — scenario)`,
        amountMinor: remainder,
        dueDate: option.remainderDueDate,
        notes: [original.notes, "Hypothetical installment split; university approval not confirmed."].filter(Boolean).join(" "),
        evidenceIds: [...original.evidenceIds],
      });
      assumption = `Assumes (not confirmed) the university accepts ${formatMinor(option.firstInstallmentMinor, original.currency)} by ${original.dueDate} and the remaining ${formatMinor(remainder, original.currency)} by ${option.remainderDueDate}; no policy or fee was assumed.`;
    }

    const forecast = buildForecast(candidate);
    return {
      label: option.label,
      type: option.type,
      valid: true,
      assumption,
      remainingGapMinor: forecast.firstGap?.shortfallMinor ?? 0,
      remainingGap: forecast.firstGap ? formatMinor(forecast.firstGap.shortfallMinor, forecast.planningCurrency) : null,
      remainingGapDate: forecast.firstGap?.date ?? null,
      minimumBalanceMinor: forecast.minBalanceMinor,
      minimumBalance: formatMinor(forecast.minBalanceMinor, forecast.planningCurrency),
      verdict: forecast.firstGap ? "gap remains" : "no gap in forecast window",
      planningCurrency: forecast.planningCurrency,
    };
  });
  const valid = evaluated.filter((option) => option.valid) as (typeof evaluated[number] & { remainingGapMinor: number; minimumBalanceMinor: number })[];
  const order = new Map(valid
    .sort((a, b) => a.remainingGapMinor - b.remainingGapMinor || b.minimumBalanceMinor - a.minimumBalanceMinor)
    .map((option, rank) => [option.label, rank + 1]));
  return evaluated.map((option) => option.valid ? { ...option, rank: order.get(option.label) ?? null } : option);
}

function deltaDays(a: string, b: string): number {
  return Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000);
}

function implicationForForecastDiff(
  name: string,
  pc: string,
  base: ForecastResult,
  modified: ForecastResult,
): string {
  const parts: string[] = [];
  const gb = base.firstGap;
  const gm = modified.firstGap;
  if (!gb && gm) {
    parts.push(
      `This scenario CREATES a funding gap where the baseline had none: ${formatMinor(gm.shortfallMinor, pc)} short on ${formatDateLong(gm.date)}, triggered by "${gm.causeLabel}".`,
    );
  } else if (gb && !gm) {
    parts.push(
      `This scenario REMOVES the baseline gap (${formatMinor(gb.shortfallMinor, pc)} short on ${formatDateLong(gb.date)}): no funding gap remains in the forecast window.`,
    );
  } else if (gb && gm) {
    const dayShift = deltaDays(gm.date, gb.date);
    const shiftWord = dayShift === 0 ? "on the same date" : dayShift < 0 ? `${-dayShift} day(s) earlier` : `${dayShift} day(s) later`;
    const shortDelta = gm.shortfallMinor - gb.shortfallMinor;
    const shortWord =
      shortDelta === 0
        ? "the same size"
        : `${formatMinor(Math.abs(shortDelta), pc)} ${shortDelta > 0 ? "larger" : "smaller"}`;
    parts.push(
      `The gap still opens ${shiftWord} (${formatDateLong(gm.date)} vs baseline ${formatDateLong(gb.date)}) and is ${shortWord} ` +
        `(${formatMinor(gm.shortfallMinor, pc)} vs ${formatMinor(gb.shortfallMinor, pc)}).`,
    );
  } else {
    parts.push("No funding gap in either the baseline or the scenario.");
  }
  const delta = modified.minBalanceMinor - base.minBalanceMinor;
  parts.push(
    `Lowest projected balance moves from ${formatMinor(base.minBalanceMinor, pc)} to ${formatMinor(modified.minBalanceMinor, pc)}` +
      (delta === 0 ? " (unchanged)." : ` (${delta < 0 ? "−" : "+"}${formatMinor(Math.abs(delta), pc)}).`),
  );
  void name;
  return parts.join(" ");
}

export const simulateScenarioTool: ToolDefinition = {
  name: "simulate_scenario",
  description:
    "Run a what-if scenario (scholarship_delay, expense_increase, fx_shock, or transfer_fee_change) on a deep " +
    "copy of the plan and return baseline-vs-scenario diffs, the changed assumptions, and a practical implication. " +
    "The input plan is never mutated. Optional user-stated funding and tuition installment options are simulated independently against the stress case, with the remaining gap calculated for each. Installment approval and backup-fund availability are never presumed.",
  parameters: SimulateScenarioParams,
  requiresApproval: false,
  handler: async (args, ctx) =>
    withToolTimeout("simulate_scenario", (): ToolResult => {
      const parsed = SimulateScenarioParams.safeParse(args);
      if (!parsed.success) {
        return { ok: false, summary: `simulate_scenario: invalid parameters — ${zodIssues(parsed.error)}` };
      }
      void ctx;
      const state = assemblePlanState(parsed.data.plan);
      const baseline = buildForecast(state);
      const pc = baseline.planningCurrency;
      const scenario = parsed.data.scenario;

      // ---- transfer_fee_change: quote-level analysis on a deep copy ----
      if (scenario.type === "transfer_fee_change") {
        const quotes = parsed.data.plan.quotes;
        if (quotes.length === 0) {
          return {
            ok: false,
            summary:
              "simulate_scenario: transfer_fee_change needs transfer quotes — pass quotes in the plan input. " +
              "No figures were invented; nothing was simulated.",
          };
        }
        const targets = scenario.quoteId
          ? quotes.filter((q) => q.id === scenario.quoteId)
          : quotes;
        if (targets.length === 0) {
          return {
            ok: false,
            summary: `simulate_scenario: no quote with id "${scenario.quoteId}" in the plan — nothing simulated.`,
          };
        }
        const factor = 1 + scenario.percent / 100;
        const perQuote = targets.map((q) => {
          const before = analyzeQuote(q, state.fx, pc);
          const afterQ = q.feeMinor != null ? { ...q, feeMinor: scaleMinor(q.feeMinor, factor) } : q;
          const after = analyzeQuote(afterQ, state.fx, pc);
          const recvDelta =
            before.receivedMinor != null && after.receivedMinor != null
              ? after.receivedMinor - before.receivedMinor
              : null;
          return {
            quoteId: q.id,
            provider: q.provider,
            feeChange: q.feeMinor != null
              ? `${formatMinor(q.feeMinor, q.feeCurrency ?? q.sendCurrency)} → ${formatMinor(afterQ.feeMinor as number, q.feeCurrency ?? q.sendCurrency)} (${scenario.percent > 0 ? "+" : ""}${scenario.percent}%)`
              : "fee unknown — cannot be changed",
            receivedBefore: before.receivedMinor != null ? formatMinor(before.receivedMinor, q.receiveCurrency) : null,
            receivedAfter: after.receivedMinor != null ? formatMinor(after.receivedMinor, q.receiveCurrency) : null,
            receivedDeltaMinor: recvDelta,
            receivedDelta: recvDelta != null ? `${recvDelta < 0 ? "−" : "+"}${formatMinor(Math.abs(recvDelta), q.receiveCurrency)}` : null,
            totalCostBefore: before.totalCostMinor != null ? formatMinor(before.totalCostMinor, pc) : null,
            totalCostAfter: after.totalCostMinor != null ? formatMinor(after.totalCostMinor, pc) : null,
            quoteComplete: before.complete,
          };
        });
        const changed = perQuote.filter((p) => p.receivedDeltaMinor != null && p.receivedDeltaMinor !== 0);
        const summary =
          changed.length > 0
            ? `A ${scenario.percent > 0 ? "+" : ""}${scenario.percent}% fee change affects ${changed.length} quote(s): ` +
              changed.map((p) => `${p.provider}: receive ${p.receivedBefore} → ${p.receivedAfter} (${p.receivedDelta})`).join("; ") +
              ". Deterministic quote arithmetic — not a live quote."
            : "No quote received amounts changed (fees unknown or fees consume the whole amount). Nothing invented.";
        return {
          ok: true,
          summary,
          data: {
            scenarioType: "transfer_fee_change",
            percent: scenario.percent,
            perQuote,
            planningCurrency: pc,
            figureLabel: "deterministic quote arithmetic — not a live quote",
          },
          evidence: [{
            label: "Quote re-analysis (engine-computed)",
            detail: "Each affected quote was re-analyzed with the deterministic analyzeQuote() arithmetic on a deep copy; the plan itself was not mutated.",
          }],
        };
      }

      // ---- Engine scenarios on a deep copy ----
      const engineScenario: Scenario = {
        id: `tool_${scenario.type}`,
        name: scenario.type.replaceAll("_", " "),
        description: "Ad-hoc scenario from the simulate_scenario tool.",
        transforms: [
          scenario.type === "scholarship_delay"
            ? { type: "delay_funding", sourceId: scenario.sourceId, days: scenario.days }
            : scenario.type === "expense_increase"
              ? { type: "expense_increase", percent: scenario.percent, kinds: scenario.kinds }
              : { type: "fx_shift", percent: scenario.percent, pairs: scenario.pairs },
        ],
        createdAt: new Date().toISOString(),
      };
      const applied = applyScenario(state, engineScenario);
      const modified = applied.result;
      const diff = diffForecasts(baseline, modified);
      const recoveryOptions = evaluateRecoveryOptions(applied.state, parsed.data.recoveryOptions);

      const summary = implicationForForecastDiff(engineScenario.name, pc, baseline, modified);

      return {
        ok: true,
        summary,
        data: {
          scenarioType: scenario.type,
          appliedNotes: applied.appliedNotes,
          affectedFxPairs: applied.affectedPairs,
          baseline: {
            minBalanceMinor: baseline.minBalanceMinor,
            minBalance: formatMinor(baseline.minBalanceMinor, pc),
            gapDate: baseline.firstGap?.date ?? null,
            shortfallMinor: baseline.firstGap?.shortfallMinor ?? null,
            shortfall: baseline.firstGap ? formatMinor(baseline.firstGap.shortfallMinor, pc) : null,
          },
          scenario: {
            minBalanceMinor: modified.minBalanceMinor,
            minBalance: formatMinor(modified.minBalanceMinor, pc),
            gapDate: modified.firstGap?.date ?? null,
            shortfallMinor: modified.firstGap?.shortfallMinor ?? null,
            shortfall: modified.firstGap ? formatMinor(modified.firstGap.shortfallMinor, pc) : null,
          },
          deltaMinBalanceMinor: diff.deltaMinBalanceMinor,
          deltaMinBalance: `${diff.deltaMinBalanceMinor < 0 ? "−" : "+"}${formatMinor(Math.abs(diff.deltaMinBalanceMinor), pc)}`,
          changedAssumptions: diff.changedAssumptions,
          recoveryOptions,
          recoveryOptionBasis: parsed.data.recoveryOptions.length > 0
            ? "User-stated what-if options. They are independent scenarios; no option changes the plan or confirms availability, approval, fees, or policy."
            : null,
          practicalImplication: summary,
          planningCurrency: pc,
        },
        evidence: [
          {
            label: "Scenario diff (engine-computed)",
            detail: `Baseline and scenario forecasts were both computed by buildForecast() on a deep copy of the plan. ${applied.appliedNotes.join(" ")}`,
          },
          ...(diff.changedAssumptions.length > 0
            ? [{ label: "Changed assumptions", detail: diff.changedAssumptions.join(" | ") }]
            : []),
        ],
      };
    }),
};
