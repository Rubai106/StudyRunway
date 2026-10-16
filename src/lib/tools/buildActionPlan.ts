/**
 * build_action_plan — prioritized action plan from the deterministic engine.
 *
 * Uses the engine's export.ts action-plan builder (buildActionPlan) and the
 * forecast, then derives ACTIONS with deterministic rules:
 *
 * 1. Close the funding gap (if any) — highest priority, impact = shortfall.
 * 2. Confirm uncertain funding (conditional/estimated/unverified sources).
 * 3. Fill in missing data excluded from the forecast.
 * 4. Verify or resolve evidence (unverified facts, conflicting facts).
 * 5. Prepare for upcoming obligations, soonest first.
 *
 * Every action carries purpose, deadline, evidence refs, and an estimated
 * impact — all computed, none invented. Sorting uses urgency from confirmed
 * dates first, then the category priority as a tie-breaker.
 */

import { z } from "zod";
import { formatMinor } from "../currency";
import { buildForecast } from "../forecast";
import { buildActionPlan as buildEngineActionPlan } from "../export";
import { formatDateLong } from "../model";
import {
  ToolPlanSchema,
  assemblePlanState,
  withToolTimeout,
  zodIssues,
} from "./common";
import type { ToolDefinition, ToolResult } from "./types";

export const BuildActionPlanParams = z.object({
  plan: ToolPlanSchema.describe("Plan object: fundingSources, obligations, planningCurrency, asOfDate, fx, evidence"),
  gapSummary: z
    .string()
    .max(2000, "gapSummary is too long (max 2,000 characters)")
    .default("")
    .describe("Gap analysis summary (e.g. from analyze_funding_gap) to anchor the plan to"),
});

export interface PrioritizedAction {
  priority: number;
  urgency?: "critical" | "high" | "medium" | "unknown";
  urgencyReason?: string;
  daysUntilDeadline?: number | null;
  title: string;
  purpose: string;
  deadline: string | null;
  deadlineDisplay: string | null;
  evidenceRefs: string[];
  estimatedImpactMinor: number | null;
  estimatedImpact: string | null;
}

export const buildActionPlanTool: ToolDefinition = {
  name: "build_action_plan",
  description:
    "Build a prioritized action plan from the plan and its gap analysis: closes the funding gap first, then " +
    "confirms uncertain funding, fills missing data, resolves evidence issues, and prepares for upcoming " +
    "obligations. Each action has a purpose, deadline, evidence refs, and an estimated impact — all computed " +
    "by the deterministic engine.",
  parameters: BuildActionPlanParams,
  requiresApproval: false,
  handler: async (args, ctx) =>
    withToolTimeout("build_action_plan", (): ToolResult => {
      const parsed = BuildActionPlanParams.safeParse(args);
      if (!parsed.success) {
        return { ok: false, summary: `build_action_plan: invalid parameters — ${zodIssues(parsed.error)}` };
      }
      void ctx;
      const state = assemblePlanState(parsed.data.plan);
      const f = buildForecast(state);
      const enginePlan = buildEngineActionPlan(state, f);
      const pc = f.planningCurrency;

      const actions: PrioritizedAction[] = [];

      // 1. Close the gap.
      if (f.firstGap) {
        actions.push({
          priority: 1,
          title: `Close the ${formatMinor(f.firstGap.shortfallMinor, pc)} shortfall before ${formatDateLong(f.firstGap.date)}`,
          purpose: `The forecast balance drops below zero on ${formatDateLong(f.firstGap.date)}, triggered by "${f.firstGap.causeLabel}". Without extra funds arriving first, this obligation cannot be met on time.`,
          deadline: f.firstGap.date,
          deadlineDisplay: formatDateLong(f.firstGap.date),
          evidenceRefs: [],
          estimatedImpactMinor: f.firstGap.shortfallMinor,
          estimatedImpact: `Eliminates the ${formatMinor(f.firstGap.shortfallMinor, pc)} shortfall`,
        });
      }

      // 2. Confirm uncertain funding.
      const uncertain = state.fundingSources.filter(
        (s) => s.amountMinor != null && ["conditional", "estimated", "unverified"].includes(s.status),
      );
      for (const s of uncertain) {
        const date = s.expectedDate ?? s.availableDate;
        actions.push({
          priority: 2,
          title: `Confirm "${s.label}" (${formatMinor(s.amountMinor as number, s.currency)})`,
          purpose: `This ${s.status} funding is counted in the forecast but is not guaranteed; if it slips, the plan is ${formatMinor(s.amountMinor as number, s.currency)} worse off.`,
          deadline: date,
          deadlineDisplay: date ? formatDateLong(date) : null,
          evidenceRefs: s.evidenceIds,
          estimatedImpactMinor: s.amountMinor,
          estimatedImpact: `Removes ${formatMinor(s.amountMinor as number, s.currency)} of uncertainty`,
        });
      }

      // 3. Fill in missing data.
      for (const i of f.incomplete) {
        actions.push({
          priority: 3,
          title: `Fill in missing data: ${i.label}`,
          purpose: "This record was excluded from the forecast, so the forecast may be understating risk.",
          deadline: null,
          deadlineDisplay: null,
          evidenceRefs: [],
          estimatedImpactMinor: null,
          estimatedImpact: "Makes the forecast complete (impact depends on the real figure)",
        });
      }

      // 4. Evidence issues.
      for (const e of state.evidence) {
        if (e.conflictsWith.length > 0) {
          actions.push({
            priority: 4,
            title: `Resolve conflicting evidence: "${e.factLabel}"`,
            purpose: `"${e.valueText}" (${e.documentLabel}) conflicts with ${e.conflictsWith.length} other source(s) — the plan may be built on the wrong figure.`,
            deadline: null,
            deadlineDisplay: null,
            evidenceRefs: [e.id, ...e.conflictsWith],
            estimatedImpactMinor: null,
            estimatedImpact: "Ensures the plan uses the correct figure",
          });
        } else if (!e.verified) {
          actions.push({
            priority: 4,
            title: `Verify evidence: "${e.factLabel}"`,
            purpose: `"${e.valueText}" (${e.documentLabel}) has not been verified against the original document.`,
            deadline: null,
            deadlineDisplay: null,
            evidenceRefs: [e.id],
            estimatedImpactMinor: null,
            estimatedImpact: "Increases confidence in the plan's inputs",
          });
        }
      }

      // 5. Prepare for upcoming obligations, soonest first.
      const upcoming = f.rows
        .filter((r) => r.kind === "outflow" && r.date >= f.today)
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      for (const r of upcoming) {
        actions.push({
          priority: 5,
          title: `Prepare ${formatMinor(-r.amountMinor, pc)} for "${r.label}" due ${formatDateLong(r.date)}`,
          purpose: `Dated obligation in the forecast; the projected balance after it is ${formatMinor(r.balanceAfterMinor, pc)}.`,
          deadline: r.date,
          deadlineDisplay: formatDateLong(r.date),
          evidenceRefs: r.evidenceIds,
          estimatedImpactMinor: -r.amountMinor,
          estimatedImpact: `Covers the ${formatMinor(-r.amountMinor, pc)} obligation`,
        });
      }

      // Urgency and earliest confirmed deadline come before category priority.
      for (const action of actions) {
        if (!action.deadline) {
          action.urgency = "unknown";
          action.daysUntilDeadline = null;
          action.urgencyReason = "No verified deadline is attached to this action.";
          continue;
        }
        const days = Math.floor((Date.parse(`${action.deadline}T00:00:00Z`) - Date.parse(`${f.today}T00:00:00Z`)) / 86_400_000);
        action.daysUntilDeadline = days;
        action.urgency = days <= 7 ? "critical" : days <= 30 ? "high" : "medium";
        action.urgencyReason = days < 0
          ? `Deadline passed ${Math.abs(days)} day(s) ago.`
          : days === 0
            ? "Due today."
            : `Due in ${days} day(s).`;
      }

      // Closest confirmed deadline comes first. Category priority breaks ties.
      actions.sort((a, b) =>
        urgencyOrder(a.urgency) !== urgencyOrder(b.urgency)
          ? urgencyOrder(a.urgency) - urgencyOrder(b.urgency)
          : (a.deadline ?? "9999-12-31") < (b.deadline ?? "9999-12-31")
            ? -1
            : (a.deadline ?? "9999-12-31") > (b.deadline ?? "9999-12-31")
              ? 1
              : a.priority !== b.priority
                ? a.priority - b.priority
                : a.title < b.title
                  ? -1
                  : 1,
      );

      const top = actions[0];
      const summary = actions.length === 0
        ? "No actions needed: no gap, no uncertain funding, no missing data, and no upcoming obligations in the forecast."
        : `Action plan: ${actions.length} prioritized action(s). Top priority: ${top.title}. Verdict: ${enginePlan.verdict}`;

      return {
        ok: true,
        summary,
        data: {
          planningCurrency: pc,
          asOfDate: f.today,
          verdict: enginePlan.verdict,
          gapSummaryReceived: parsed.data.gapSummary || null,
          actions,
          limitations: enginePlan.limitations,
        },
        evidence: [
          {
            label: "Engine-built action plan",
            detail:
              "Derived from the deterministic buildActionPlan() + buildForecast() output. " +
              "Urgency is based on the confirmed deadline; category priority breaks ties after urgency and date. Nothing was invented.",
          },
          ...(parsed.data.gapSummary
            ? [{ label: "Gap summary anchor", detail: "The supplied gap summary was recorded with the plan (input, not recomputed)." }]
            : []),
        ],
      };
    }),
};

function urgencyOrder(urgency: PrioritizedAction["urgency"]): number {
  return urgency === "critical" ? 0 : urgency === "high" ? 1 : urgency === "medium" ? 2 : 3;
}
