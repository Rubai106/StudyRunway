/**
 * compare_transfers — deadline-aware transfer comparison.
 *
 * HONESTY RULE (hard): there is no live rate/fee/quote feed in this build,
 * so the tool never invents one. It compares the engine's reference/sample
 * transfer quotes (src/lib/sample.ts) for the requested currency corridor,
 * analyzed with the deterministic analyzeQuote() arithmetic. Every figure
 * is labelled "reference estimate — not a live quote" and the quote
 * timestamp is "sample data".
 *
 * - A missing fee is NEVER treated as zero: such quotes are flagged
 *   incomplete, their received amount is null, and they are excluded
 *   from ranking.
 * - Ranking follows the caller's actual objective, deadline-aware:
 *   quotes that would miss the requested deadline are excluded from the
 *   ranking and listed separately.
 */

import { z } from "zod";
import { formatMinor } from "../currency";
import { analyzeQuote } from "../transfers";
import { buildSamplePlan, SAMPLE_FX_SOURCE } from "../sample";
import { formatDateLong } from "../model";
import {
  currencyCodeSchema,
  withToolTimeout,
  zodIssues,
} from "./common";
import type { ToolDefinition, ToolResult } from "./types";

export const REFERENCE_ESTIMATE_LABEL = "reference estimate — not a live quote";
export const SAMPLE_TIMESTAMP = "sample data";

/** World Bank RPW industry context; this is a benchmark, never a provider quote. */
export const WORLD_BANK_REMITTANCE_BENCHMARK = {
  source: "The World Bank, Remittance Prices Worldwide",
  sourceUrl: "https://remittanceprices.worldbank.org/sites/default/files/2026-04/RPW_main_report_and_annex_Q325.pdf",
  referencePeriod: "Q3 2025",
  reportedAmountUsdMinor: 20_000,
  globalAverageTotalCostPercent: 6.36,
  globalDigitalAveragePercent: 4.59,
  checkedAt: "2026-10-16",
  attribution: "The World Bank, Remittance Prices Worldwide, available at http://remittanceprices.worldbank.org",
} as const;

const OBJECTIVES = ["min_total_cost", "fastest", "balanced"] as const;

export const CompareTransfersParams = z.object({
  amountMinor: z
    .number()
    .int("amountMinor must be an integer number of minor units")
    .positive("amountMinor must be positive"),
  fromCurrency: currencyCodeSchema.describe("ISO code of the currency being sent"),
  toCurrency: currencyCodeSchema.describe("ISO code of the currency to receive"),
  deadlineIso: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "deadlineIso must be YYYY-MM-DD")
    .nullable()
    .default(null)
    .describe("Payment deadline the transfer must meet (optional)"),
  objective: z
    .enum(OBJECTIVES)
    .describe("How to rank: min_total_cost, fastest, or balanced"),
});

interface EligibleQuote {
  provider: string;
  quoteId: string;
  totalCostMinor: number;
  arrivalLatest: string;
  arrivalEarliest: string;
  receivedMinor: number;
  effectiveRate: number;
  flags: string[];
  amountNote: string | null;
}

export const compareTransfersTool: ToolDefinition = {
  name: "compare_transfers",
  description:
    "Compare money-transfer options for a corridor (e.g. BDT → GBP) using the engine's reference/sample " +
    "quotes — analyzed with deterministic arithmetic and ranked by the caller's objective (min_total_cost, " +
    "fastest, or balanced), deadline-aware. HONESTY: no live rates exist in this build; every figure is a " +
    "labelled reference estimate, never a live quote. Missing fees are never treated as zero.",
  parameters: CompareTransfersParams,
  requiresApproval: false,
  safeToReplayForVerification: true,
  handler: async (args, ctx) =>
    withToolTimeout("compare_transfers", (): ToolResult => {
      const parsed = CompareTransfersParams.safeParse(args);
      if (!parsed.success) {
        return { ok: false, summary: `compare_transfers: invalid parameters — ${zodIssues(parsed.error)}` };
      }
      const { amountMinor, fromCurrency, toCurrency, deadlineIso, objective } = parsed.data;

      // Reference data only: the engine's sample quotes for this corridor.
      const sample = buildSamplePlan();
      const fx = sample.fx;
      const corridorQuotes = sample.quotes.filter(
        (q) =>
          q.sendCurrency.toUpperCase() === fromCurrency &&
          q.receiveCurrency.toUpperCase() === toCurrency,
      );

      void ctx;

      if (corridorQuotes.length === 0) {
        return {
          ok: true,
          summary:
            `No reference quotes cover ${fromCurrency} → ${toCurrency} in the sample dataset — ` +
            `nothing compared, nothing invented. ${REFERENCE_ESTIMATE_LABEL}.`,
          data: {
            corridor: `${fromCurrency}>${toCurrency}`,
            objective,
            ranked: [],
            excluded: [],
            figureLabel: REFERENCE_ESTIMATE_LABEL,
            quoteTimestamp: SAMPLE_TIMESTAMP,
            fxSource: SAMPLE_FX_SOURCE,
            worldBankBenchmark: WORLD_BANK_REMITTANCE_BENCHMARK,
          },
          evidence: [{
            label: REFERENCE_ESTIMATE_LABEL,
            detail: "The sample dataset has no quotes for this corridor; no live lookup was attempted.",
          }],
        };
      }

      const analyzed = corridorQuotes.map((q) =>
        analyzeQuote({ ...q, paymentDeadline: deadlineIso ?? q.paymentDeadline }, fx, toCurrency),
      );

      const eligible: EligibleQuote[] = [];
      const excluded: Record<string, unknown>[] = [];

      for (const a of analyzed) {
        const entry = {
          provider: a.quote.provider,
          quoteId: a.quote.id,
          figureLabel: REFERENCE_ESTIMATE_LABEL,
          quoteTimestamp: SAMPLE_TIMESTAMP,
          quotedSendAmountMinor: a.quote.sendAmountMinor,
          quotedSendAmount: formatMinor(a.quote.sendAmountMinor, a.quote.sendCurrency),
          requestedAmountMinor: amountMinor,
          requestedAmount: formatMinor(amountMinor, a.quote.sendCurrency),
          exchangeRate: a.quote.exchangeRate,
          feeMinor: a.quote.feeMinor,
          fee: a.quote.feeMinor != null
            ? formatMinor(a.quote.feeMinor, a.quote.feeCurrency ?? a.quote.sendCurrency)
            : "unknown",
          receivedMinor: a.receivedMinor,
          received: a.receivedMinor != null ? formatMinor(a.receivedMinor, a.receiveCurrency) : null,
          totalCostMinor: a.totalCostMinor,
          totalCost: a.totalCostMinor != null ? formatMinor(a.totalCostMinor, toCurrency) : null,
          effectiveRate: a.effectiveRate,
          arrivalEarliest: a.arrivalEarliest,
          arrivalLatest: a.arrivalLatest,
          deadline: a.deadline,
          deadlineVerdict: a.deadlineVerdict,
          flags: a.flags,
          complete: a.complete,
        };
        const amountNote =
          a.quote.sendAmountMinor !== amountMinor
            ? `Reference quote was for ${formatMinor(a.quote.sendAmountMinor, a.quote.sendCurrency)} send — ` +
              `figures are NOT scaled to the requested ${formatMinor(amountMinor, a.quote.sendCurrency)}.`
            : null;
        if (!a.complete || a.receivedMinor == null || a.totalCostMinor == null) {
          excluded.push({
            ...entry,
            amountNote,
            exclusionReason:
              "Incomplete quote — the fee is unknown, so the received amount cannot be computed. " +
              "The missing fee is not treated as zero.",
          });
        } else if (a.deadlineVerdict === "misses") {
          excluded.push({
            ...entry,
            amountNote,
            exclusionReason: `Would miss the ${a.deadline ? formatDateLong(a.deadline) : "requested"} deadline.`,
          });
        } else {
          eligible.push({
            provider: a.quote.provider,
            quoteId: a.quote.id,
            totalCostMinor: a.totalCostMinor,
            arrivalLatest: a.arrivalLatest,
            arrivalEarliest: a.arrivalEarliest,
            receivedMinor: a.receivedMinor,
            effectiveRate: a.effectiveRate as number,
            flags: a.flags,
            amountNote,
          });
        }
      }

      // Rank by the caller's actual objective.
      const rankedEntries = [...eligible];
      if (objective === "min_total_cost") {
        rankedEntries.sort((a, b) =>
          a.totalCostMinor !== b.totalCostMinor
            ? a.totalCostMinor - b.totalCostMinor
            : b.receivedMinor - a.receivedMinor,
        );
      } else if (objective === "fastest") {
        rankedEntries.sort((a, b) =>
          a.arrivalLatest !== b.arrivalLatest
            ? (a.arrivalLatest < b.arrivalLatest ? -1 : 1)
            : a.totalCostMinor - b.totalCostMinor,
        );
      } else {
        // balanced: equal-weight min-max score of cost and arrival time.
        const costs = rankedEntries.map((e) => e.totalCostMinor);
        const days = rankedEntries.map((e) => Date.parse(e.arrivalLatest));
        const cMin = Math.min(...costs);
        const cMax = Math.max(...costs);
        const dMin = Math.min(...days);
        const dMax = Math.max(...days);
        const score = (e: EligibleQuote) =>
          0.5 * ((e.totalCostMinor - cMin) / (cMax - cMin || 1)) +
          0.5 * ((Date.parse(e.arrivalLatest) - dMin) / (dMax - dMin || 1));
        rankedEntries.sort((a, b) => score(a) - score(b) || a.totalCostMinor - b.totalCostMinor);
      }

      const ranked = rankedEntries.map((e, i) => {
        const a = analyzed.find((x) => x.quote.id === e.quoteId)!;
        return {
          rank: i + 1,
          provider: e.provider,
          figureLabel: REFERENCE_ESTIMATE_LABEL,
          quoteTimestamp: SAMPLE_TIMESTAMP,
          feeMinor: a.quote.feeMinor,
          fee: a.quote.feeMinor != null
            ? formatMinor(a.quote.feeMinor, a.quote.feeCurrency ?? a.quote.sendCurrency)
            : "unknown",
          received: e.receivedMinor != null ? formatMinor(e.receivedMinor, toCurrency) : null,
          receivedMinor: e.receivedMinor,
          totalCost: formatMinor(e.totalCostMinor, toCurrency),
          totalCostMinor: e.totalCostMinor,
          effectiveRate: e.effectiveRate,
          arrivalWindow: `${formatDateLong(e.arrivalEarliest)} – ${formatDateLong(e.arrivalLatest)}`,
          arrivalEarliest: e.arrivalEarliest,
          arrivalLatest: e.arrivalLatest,
          deadlineVerdict: a.deadlineVerdict,
          amountNote: e.amountNote,
          flags: e.flags,
        };
      });

      const best = ranked[0];
      const summary =
        ranked.length > 0
          ? `Compared ${corridorQuotes.length} reference ${fromCurrency} → ${toCurrency} quote(s) by "${objective}"` +
            `${deadlineIso ? ` against the ${formatDateLong(deadlineIso)} deadline` : ""}: ` +
            `top = ${best.provider} (est. receive ${best.received}, est. total cost ${best.totalCost}). ` +
            `${excluded.length} quote(s) excluded (incomplete or misses deadline). ` +
            `${REFERENCE_ESTIMATE_LABEL} — verify with a live quote before deciding.`
          : `No comparable reference quotes for ${fromCurrency} → ${toCurrency} ` +
            `(${excluded.length} excluded: incomplete or deadline-missing). Nothing invented. ` +
            REFERENCE_ESTIMATE_LABEL + ".";

      return {
        ok: true,
        summary,
        data: {
          corridor: `${fromCurrency}>${toCurrency}`,
          objective,
          requestedAmountMinor: amountMinor,
          requestedAmount: formatMinor(amountMinor, fromCurrency),
          requestedDeadline: deadlineIso,
          figureLabel: REFERENCE_ESTIMATE_LABEL,
          quoteTimestamp: SAMPLE_TIMESTAMP,
          fxSource: SAMPLE_FX_SOURCE,
          worldBankBenchmark: WORLD_BANK_REMITTANCE_BENCHMARK,
          ranked,
          excluded,
        },
        evidence: [
          {
            label: REFERENCE_ESTIMATE_LABEL,
            detail:
              `Figures come from the engine's sample quotes (${corridorQuotes.length} for this corridor), ` +
              `analyzed with deterministic arithmetic. quoteTimestamp is "${SAMPLE_TIMESTAMP}"; ` +
              `FX assumptions: ${SAMPLE_FX_SOURCE}`,
          },
          {
            label: "Missing fees never assumed zero",
            detail:
              excluded.filter((e) => (e as { complete?: boolean }).complete === false).length > 0
                ? "Quotes with an unknown fee were excluded from ranking; their received amount is null."
                : "All compared quotes had a known fee.",
          },
        ],
      };
    }),
};
