/**
 * build_living_cost_plan — deterministic destination budget builder.
 *
 * Runs the REAL living-cost engine (src/lib/livingCosts) on sourced cost
 * data for a study destination (Ireland, Germany, Denmark, UK, Australia,
 * Canada) and returns a structured LivingCostPlan: monthly category
 * breakdown, low/typical/high scenarios, one-time costs, including pre-arrival expenses where relevant, an
 * affordability verdict, sources, and recommendations.
 *
 * Read-only analysis: requiresApproval = false. No figures are invented —
 * missing data stays missing (verdict: insufficient_data) and visa
 * requirements are regulatory minimums, never budget lines.
 */

import {
  LivingCostPlanInputsSchema,
  buildLivingCostPlan,
  buildRecommendations,
  getDestination,
  type LivingCostPlan,
} from "../livingCosts";
import { formatMinor } from "../currency";
import { getTask } from "../agent/state";
import { withToolTimeout, zodIssues } from "./common";
import type { ToolDefinition, ToolResult } from "./types";

export const BuildLivingCostPlanParams = LivingCostPlanInputsSchema;

/** Major-unit display for a minor-unit figure in the plan currency. */
function fmt(minor: number, currency: string): string {
  return formatMinor(minor, currency);
}

function verdictSummary(plan: LivingCostPlan): string {
  const cur = plan.currency;
  const typical = fmt(plan.monthlyTotals.typicalMinor, cur);
  const budget = fmt(plan.budgetMinor, cur);
  const where = plan.destinationLabel;
  switch (plan.verdict) {
    case "insufficient_data": {
      const missing = plan.missingData.map((m) => m.label).join("; ") || "key cost data";
      return (
        `Not enough sourced cost data to build a monthly budget for ${where} ` +
        `(missing: ${missing}). No totals are guessed. ` +
        `The visa requirement below is a regulatory minimum, not a budget.`
      );
    }
    case "shortfall":
      return (
        `Typical living costs in ${where} are ${typical}/mo against a ${budget}/mo budget — ` +
        `a shortfall of ${fmt(plan.shortfallMinor ?? 0, cur)}/mo. ${plan.verdictReason}`
      );
    case "tight":
      return (
        `Typical living costs in ${where} are ${typical}/mo against a ${budget}/mo budget — ` +
        `tight but workable (${fmt(plan.remainingMinor, cur)}/mo headroom). ${plan.verdictReason}`
      );
    case "within_budget":
      return (
        `Typical living costs in ${where} are ${typical}/mo against a ${budget}/mo budget — ` +
        `within budget with ${fmt(plan.remainingMinor, cur)}/mo to spare. ${plan.verdictReason}`
      );
  }
}

/** Task-state evidence details are capped at 600 chars — truncate honestly. */
function evDetail(s: string): string {
  return s.length > 590 ? `${s.slice(0, 589)}…` : s;
}

export const buildLivingCostPlanTool: ToolDefinition = {
  name: "build_living_cost_plan",
  description:
    "Build a source-attributed monthly living-cost budget for a study destination " +
    "(Ireland, Germany, Denmark, UK, Australia, Canada). Returns monthly category " +
    "breakdown, low/typical/high cost scenarios, one-time costs, including pre-arrival expenses where relevant, an " +
    "affordability verdict against the user's monthly budget, sources, and " +
    "recommendations. All figures come from the deterministic budget engine and " +
    "the researched cost dataset — nothing is invented. Use when the user asks " +
    "about living costs, cost of living, or a destination budget.",
  parameters: LivingCostPlanInputsSchema,
  requiresApproval: false,
  safeToReplayForVerification: true,
  handler: async (args, ctx) =>
    withToolTimeout("build_living_cost_plan", (): ToolResult => {
      const parsed = LivingCostPlanInputsSchema.safeParse(args);
      if (!parsed.success) {
        return {
          ok: false,
          summary: `build_living_cost_plan: invalid parameters — ${zodIssues(parsed.error)}`,
        };
      }
      const inputs = parsed.data;
      let plan: LivingCostPlan;
      try {
        // The REAL deterministic engine — no reimplementation, no drift.
        plan = buildLivingCostPlan(inputs);
      } catch (err) {
        return {
          ok: false,
          summary: `build_living_cost_plan: ${err instanceof Error ? err.message : "engine failed"}`,
        };
      }
      const profile = getDestination(inputs.destinationId);
      const recs = buildRecommendations(plan, profile, inputs);

      const summary = verdictSummary(plan);
      const cur = plan.currency;

      void ctx;
      return {
        ok: true,
        summary,
        data: {
          plan,
          // The validated inputs, echoed back so the UI can re-run the same
          // deterministic engine client-side when the user adjusts assumptions.
          inputs: { ...inputs },
          recommendations: recs.recommendations,
          recommendationNotes: recs.notes,
          accommodationOptions: profile.categories
            .filter((c) => c.category === "rent" && c.accommodationType)
            .map((c) => c.accommodationType as string),
          destinationLabel: plan.destinationLabel,
          currency: cur,
          // The sample plan used when no working plan exists is GBP-denominated.
          // Only expose the currency code needed to warn before cross-currency apply.
          planningCurrency: getTask(ctx.sessionId)?.workingPlan?.planningCurrency ?? "GBP",
        },
        evidence: [
          ...plan.sources.map((s) => ({
            label: s.title.slice(0, 300),
            detail: evDetail(
              `${s.url} — checked ${s.checkedDate}` +
                (s.publishedDate ? `, published ${s.publishedDate}` : ", publication date not shown") +
                ` (${s.scope} scope)`
            ),
          })),
          ...(plan.assumptions.length > 0
            ? [
                {
                  label: "Engine assumptions",
                  detail: evDetail(
                    plan.assumptions.map((a) => `[${a.tag}] ${a.text}`).join(" | ")
                  ),
                },
              ]
            : []),
          ...(plan.warnings.length > 0
            ? [{ label: "Data warnings", detail: evDetail(plan.warnings.join(" | ")) }]
            : []),
        ],
      };
    }),
};
