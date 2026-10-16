/**
 * analyze_funding_gap — deterministic funding-gap analysis.
 *
 * Runs the plan through the forecast engine (buildForecast) and reports:
 * - the first date the balance goes negative (shortfall amount + date),
 * - gap causality from the engine's own event-level gapRoles(),
 * - the confirmed vs uncertain funding split.
 *
 * Every figure is computed by the engine; nothing is invented.
 */

import { z } from "zod";
import { formatMinor } from "../currency";
import { buildForecast, gapRoles, GapRole } from "../forecast";
import { formatDateLong } from "../model";
import {
  ToolPlanSchema,
  assemblePlanState,
  withToolTimeout,
  zodIssues,
} from "./common";
import type { ToolDefinition, ToolResult } from "./types";

export const AnalyzeFundingGapParams = z.object({
  plan: ToolPlanSchema.describe("Plan object: fundingSources, obligations, planningCurrency, asOfDate, fx"),
});

export const analyzeFundingGapTool: ToolDefinition = {
  name: "analyze_funding_gap",
  description:
    "Analyze the funding gap for a student plan: computes the dated forecast, finds the first shortfall " +
    "(amount and date), explains which events open/widen the gap (gap causality), and splits funding into " +
    "confirmed vs uncertain. All figures come from the deterministic forecast engine.",
  parameters: AnalyzeFundingGapParams,
  requiresApproval: false,
  handler: async (args, ctx) =>
    withToolTimeout("analyze_funding_gap", (): ToolResult => {
      const parsed = AnalyzeFundingGapParams.safeParse(args);
      if (!parsed.success) {
        return { ok: false, summary: `analyze_funding_gap: invalid parameters — ${zodIssues(parsed.error)}` };
      }
      const state = assemblePlanState(parsed.data.plan);
      const f = buildForecast(state);
      const roles = gapRoles(f.rows, f.openingMinor);
      const pc = f.planningCurrency;

      const roleRows = f.rows
        .map((row, i) => ({ row, role: roles[i] as GapRole }))
        .filter((r) => r.role !== null)
        .map((r) => ({
          date: r.row.date,
          label: r.row.label,
          kind: r.row.kind,
          role: r.role,
          amountMinor: r.row.amountMinor,
          amount: formatMinor(r.row.amountMinor, pc),
          balanceAfterMinor: r.row.balanceAfterMinor,
          evidenceIds: r.row.evidenceIds,
        }));

      const gap = f.firstGap;
      const confirmedGap = f.confirmedFirstGap;

      const summary = gap
        ? `Funding gap: ${formatMinor(gap.shortfallMinor, pc)} short on ${formatDateLong(gap.date)}, ` +
          `triggered by "${gap.causeLabel}".` +
          (confirmedGap
            ? ` Counting only confirmed money, the gap opens ${formatDateLong(confirmedGap.date)} (${formatMinor(confirmedGap.shortfallMinor, pc)} short).`
            : " No gap on confirmed money alone.")
        : `No funding gap in the forecast window. Lowest projected balance: ${formatMinor(f.minBalanceMinor, pc)}` +
          `${f.minBalanceDate ? ` on ${formatDateLong(f.minBalanceDate)}` : ""}.`;

      void ctx;
      return {
        ok: true,
        summary,
        data: {
          planningCurrency: pc,
          asOfDate: f.today,
          hasGap: gap !== null,
          gapDate: gap?.date ?? null,
          shortfallMinor: gap?.shortfallMinor ?? null,
          shortfall: gap ? formatMinor(gap.shortfallMinor, pc) : null,
          gapCause: gap ? { label: gap.causeLabel, kind: gap.causeKind } : null,
          confirmedOnly: {
            hasGap: confirmedGap !== null,
            gapDate: confirmedGap?.date ?? null,
            shortfallMinor: confirmedGap?.shortfallMinor ?? null,
            shortfall: confirmedGap ? formatMinor(confirmedGap.shortfallMinor, pc) : null,
          },
          // Which records drove the gap: the engine's own event-level causality.
          gapCausality: roleRows,
          // Confirmed vs uncertain funding split.
          fundingSplit: {
            inHandMinor: f.openingMinor,
            inHand: formatMinor(f.openingMinor, pc),
            confirmedInflowMinor: f.totalConfirmedInflowMinor,
            confirmedInflow: formatMinor(f.totalConfirmedInflowMinor, pc),
            uncertainInflowMinor: f.totalUncertainInflowMinor,
            uncertainInflow: formatMinor(f.totalUncertainInflowMinor, pc),
            totalOutflowMinor: f.totalOutflowMinor,
            totalOutflow: formatMinor(f.totalOutflowMinor, pc),
          },
          incomplete: f.incomplete.map((i) => ({ label: i.label, reason: i.reason })),
          assumptionsUsed: f.assumptionsUsed,
        },
        evidence: [
          ...(gap
            ? [{
                label: "Gap cause (engine-computed)",
                detail: `"${gap.causeLabel}" moves the forecast balance below zero on ${gap.date} — the engine's first negative balance, not an interpretation.`,
              }]
            : [{
                label: "No gap (engine-computed)",
                detail: "The dated forecast never drops below zero in the planning window.",
              }]),
          {
            label: "Funding split (engine-computed)",
            detail:
              `Confirmed inflow ${formatMinor(f.totalConfirmedInflowMinor, pc)}, ` +
              `uncertain inflow ${formatMinor(f.totalUncertainInflowMinor, pc)} (conditional/estimated/unverified sources).`,
          },
          ...(f.assumptionsUsed.length > 0
            ? [{ label: "FX assumptions", detail: f.assumptionsUsed.join(" | ") }]
            : []),
        ],
      };
    }),
};
