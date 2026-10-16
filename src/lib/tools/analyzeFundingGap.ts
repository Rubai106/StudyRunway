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
import { CURRENCIES, formatMinor } from "../currency";
import { buildForecast, gapRoles, GapRole } from "../forecast";
import { formatDateLong, ISO_DATE, todayISO } from "../model";
import { toMajor, toMinor } from "../money";
import {
  currencyCodeSchema,
  ToolPlanSchema,
  assemblePlanState,
  withToolTimeout,
  zodIssues,
} from "./common";
import type { ToolPlanInput } from "./common";
import type { ToolDefinition, ToolResult } from "./types";

const FundingInputSchema = z.object({
  label: z.string().min(1).max(120),
  amount: z.number().finite().nonnegative().max(1_000_000_000).optional(),
  currency: currencyCodeSchema,
  status: z.enum(["confirmed_available", "confirmed_pending", "conditional", "estimated", "unverified"]),
  availableDate: ISO_DATE.optional(),
  expectedDate: ISO_DATE.optional(),
  kind: z.enum(["savings", "scholarship", "family", "income", "loan", "other"]).optional(),
});

const ObligationInputSchema = z.object({
  label: z.string().min(1).max(120),
  amount: z.number().finite().nonnegative().max(1_000_000_000).optional(),
  currency: currencyCodeSchema,
  dueDate: ISO_DATE.optional(),
  status: z.enum(["planned", "committed", "paid"]),
  kind: z.enum(["tuition", "deposit", "rent", "living", "travel", "visa", "insurance", "other"]).optional(),
});

/**
 * Keep the model-facing schema small and flat. The deterministic engine still
 * receives its full validated plan, but the model no longer has to reproduce
 * internal ids, evidence arrays, recurring metadata, and nested FX objects.
 */
export const AnalyzeFundingGapParams = z.object({
  planningCurrency: currencyCodeSchema,
  asOfDate: ISO_DATE.optional(),
  fundingSources: z.array(FundingInputSchema),
  obligations: z.array(ObligationInputSchema),
  fxRates: z.record(z.string(), z.number().positive().finite()).optional(),
  fxAsOf: ISO_DATE.optional(),
  fxSource: z.string().max(200).optional(),
});

type AnalyzeFundingGapInput = z.infer<typeof AnalyzeFundingGapParams>;

export type FundingGapToolInput = AnalyzeFundingGapInput;

interface MoneyMention {
  amount: number;
  currency: string;
  start: number;
  end: number;
}

interface DatedMention {
  date: string;
  start: number;
  end: number;
}

const ISO_DATE_PATTERN = /\b\d{4}-\d{2}-\d{2}\b/g;
const CURRENCY_PATTERN = CURRENCIES.map((item) => item.code).sort((a, b) => b.length - a.length).join("|");
const MONEY_PATTERN = new RegExp(
  `(?<![A-Z0-9-])(?:(?<before>${CURRENCY_PATTERN})\\s*)?(?<amount>(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d{1,3})?)(?:\\s*(?<after>${CURRENCY_PATTERN}))?(?![A-Z0-9-])`,
  "gi",
);
const FUNDING_TERMS = /\b(?:savings?|cash|funds?|scholarships?|grants?|loans?|income|available|received|have)\b/gi;
const OBLIGATION_TERMS = /\b(?:tuition|fees?|bill|invoice|rent|deposit|living|travel|visa|insurance|payment|expense|cost|due|payable)\b/gi;

function explicitMoneyMentions(text: string): MoneyMention[] {
  // Mask ISO dates while preserving offsets so date components cannot be
  // mistaken for currency amounts.
  const withoutDates = text.replace(ISO_DATE_PATTERN, (date) => " ".repeat(date.length));
  const mentions: MoneyMention[] = [];
  for (const match of withoutDates.matchAll(MONEY_PATTERN)) {
    const groups = match.groups;
    const before = groups?.before?.toUpperCase();
    const after = groups?.after?.toUpperCase();
    if (!before && !after) continue; // bare numbers have no grounded currency
    if (before && after && before !== after) continue;
    const amount = Number(groups?.amount?.replaceAll(",", ""));
    if (!Number.isFinite(amount)) continue;
    const start = match.index ?? 0;
    mentions.push({ amount, currency: before ?? after!, start, end: start + match[0].length });
  }
  return mentions;
}

function explicitDates(text: string): DatedMention[] {
  return [...text.matchAll(ISO_DATE_PATTERN)].flatMap((match) => {
    const date = match[0];
    if (!ISO_DATE.safeParse(date).success) return [];
    const start = match.index ?? 0;
    return [{ date, start, end: start + date.length }];
  });
}

function nearestTermDistance(text: string, term: RegExp, offset: number): number | null {
  const matches = [...text.matchAll(term)];
  if (matches.length === 0) return null;
  return Math.min(...matches.map((match) => {
    const start = match.index ?? 0;
    return start <= offset && start + match[0].length >= offset
      ? 0
      : Math.min(Math.abs(start - offset), Math.abs(start + match[0].length - offset));
  }));
}

/**
 * Recover the simple amounts/dates directly from the user's text. When this
 * strict parser can account for each explicit currency amount, use that data
 * instead of model-generated tool arguments, which may contain a plausible
 * but unstated date. More complex or ambiguous requests fall back to the
 * normal clarification/model path.
 */
export function extractFundingGapInputFromText(text: string): AnalyzeFundingGapInput | null {
  // Uploaded evidence is heuristic and unconfirmed. Never infer a forecast
  // directly from an attachment turn; the extraction review must happen first.
  if (/I've attached the text of ["“]uploaded document["”] below\./i.test(text)) return null;
  const amounts = explicitMoneyMentions(text);
  const dates = explicitDates(text);
  if (amounts.length === 0) return null;

  const asOfMatch = text.match(/\bas of\s+(\d{4}-\d{2}-\d{2})\b/i);
  const asOfDate = asOfMatch && ISO_DATE.safeParse(asOfMatch[1]).success
    ? asOfMatch[1]
    : undefined;
  const planningCurrency = amounts[0].currency;
  if (amounts.some((mention) => mention.currency !== planningCurrency)) return null;

  const fundingSources: AnalyzeFundingGapInput["fundingSources"] = [];
  const obligations: AnalyzeFundingGapInput["obligations"] = [];
  for (const mention of amounts) {
    const windowStart = Math.max(0, mention.start - 80);
    const windowEnd = Math.min(text.length, mention.end + 80);
    const nearby = text.slice(windowStart, windowEnd);
    const localOffset = mention.start - windowStart;
    const fundingDistance = nearestTermDistance(nearby, FUNDING_TERMS, localOffset);
    const obligationDistance = nearestTermDistance(nearby, OBLIGATION_TERMS, localOffset);
    if (fundingDistance == null && obligationDistance == null) return null;

    if (fundingDistance != null && (obligationDistance == null || fundingDistance < obligationDistance)) {
      const status: NonNullable<AnalyzeFundingGapInput["fundingSources"][number]["status"]> | undefined =
        /\bconditional\b/i.test(nearby) ? "conditional"
          : /\bestimated?\b/i.test(nearby) ? "estimated"
            : /\bunverified\b/i.test(nearby) ? "unverified"
              : /\b(expected|approved|confirmed pending|will receive|will arrive)\b/i.test(nearby) ? "confirmed_pending"
                : /\b(available|in hand|currently have|\bhave\b|received)\b/i.test(nearby) ? "confirmed_available"
                  : undefined;
      if (!status) return null;
      const fundingKind = nearby.match(/\b(savings?|scholarships?|grants?|loans?|income|family support|cash)\b/i)?.[1]?.toLowerCase();
      const kind = fundingKind?.startsWith("saving") ? "savings"
        : fundingKind?.startsWith("scholarship") ? "scholarship"
          : fundingKind?.startsWith("grant") ? "other"
            : fundingKind?.startsWith("loan") ? "loan"
              : fundingKind?.startsWith("income") ? "income"
                : fundingKind === "family support" ? "family"
                  : "other";
      const expectedDate = status === "confirmed_pending"
        ? dates.filter((d) => Math.abs(d.start - mention.end) <= 100 && d.date !== asOfDate)
            .sort((a, b) => Math.abs(a.start - mention.end) - Math.abs(b.start - mention.end))[0]?.date
        : undefined;
      fundingSources.push({
        label: fundingKind ? `${fundingKind[0].toUpperCase()}${fundingKind.slice(1)}` : "Funding",
        amount: mention.amount,
        currency: mention.currency,
        status,
        ...(expectedDate ? { expectedDate } : {}),
        kind,
      });
      continue;
    }

    const status: AnalyzeFundingGapInput["obligations"][number]["status"] | undefined =
      /\bpaid\b/i.test(nearby) ? "paid"
        : /\bplanned\b/i.test(nearby) ? "planned"
          : /\b(committed|bill|invoice|due|payable)\b/i.test(nearby) ? "committed"
            : undefined;
    const dueDate = dates
      .filter((d) => Math.abs(d.start - mention.end) <= 120)
      .sort((a, b) => Math.abs(a.start - mention.end) - Math.abs(b.start - mention.end))[0]?.date;
    if (!status || !dueDate) return null;
    const kind = /\btuition\b/i.test(nearby) ? "tuition"
      : /\bdeposit\b/i.test(nearby) ? "deposit"
        : /\brent\b/i.test(nearby) ? "rent"
          : /\bliving\b/i.test(nearby) ? "living"
            : /\btravel\b/i.test(nearby) ? "travel"
              : /\bvisa\b/i.test(nearby) ? "visa"
                : /\binsurance\b/i.test(nearby) ? "insurance"
                  : "other";
    const label = kind === "other" ? "Education expense" : `${kind[0].toUpperCase()}${kind.slice(1)}${/\b(bill|invoice|fee|payment)\b/i.test(nearby) ? " bill" : ""}`;
    obligations.push({ label, amount: mention.amount, currency: mention.currency, dueDate, status, kind });
  }

  if (fundingSources.length === 0 || obligations.length === 0) return null;
  const parsed = AnalyzeFundingGapParams.safeParse({
    planningCurrency,
    ...(asOfDate ? { asOfDate } : {}),
    fundingSources,
    obligations,
  });
  return parsed.success ? parsed.data : null;
}

/** Convert the model-friendly input into the engine's canonical plan shape. */
function toToolPlan(input: AnalyzeFundingGapInput): ToolPlanInput {
  const asOfDate = input.asOfDate ?? todayISO(null);
  return {
    planningCurrency: input.planningCurrency,
    asOfDate: input.asOfDate ?? null,
    fundingSources: input.fundingSources.map((source, index) => ({
      id: `agent-funding-${index + 1}`,
      label: source.label,
      kind: source.kind ?? "other",
      amountMinor: source.amount === undefined ? null : toMinor(source.amount, source.currency),
      currency: source.currency,
      status: source.status,
      availableDate: source.availableDate ?? null,
      expectedDate: source.expectedDate ?? null,
      notes: "",
      evidenceIds: [],
    })),
    obligations: input.obligations.map((obligation, index) => ({
      id: `agent-obligation-${index + 1}`,
      label: obligation.label,
      kind: obligation.kind ?? "other",
      amountMinor: obligation.amount === undefined ? null : toMinor(obligation.amount, obligation.currency),
      currency: obligation.currency,
      dueDate: obligation.dueDate ?? null,
      recurring: null,
      status: obligation.status,
      notes: "",
      evidenceIds: [],
    })),
    fx: {
      rates: input.fxRates ?? {},
      asOf: input.fxAsOf ?? asOfDate,
      source: input.fxSource ?? (input.fxRates ? "User-provided exchange rates" : "No exchange-rate assumption provided"),
    },
    evidence: [],
    quotes: [],
  };
}

/** Adapt the app's structured plan to the compact model-facing tool contract. */
export function fundingGapInputFromPlan(plan: ToolPlanInput): AnalyzeFundingGapInput {
  return {
    planningCurrency: plan.planningCurrency,
    ...(plan.asOfDate ? { asOfDate: plan.asOfDate } : {}),
    fundingSources: plan.fundingSources.map((source) => ({
      label: source.label,
      ...(source.amountMinor == null ? {} : { amount: toMajor(source.amountMinor, source.currency) }),
      currency: source.currency,
      status: source.status,
      ...(source.availableDate ? { availableDate: source.availableDate } : {}),
      ...(source.expectedDate ? { expectedDate: source.expectedDate } : {}),
      kind: source.kind,
    })),
    obligations: plan.obligations.map((obligation) => ({
      label: obligation.label,
      ...(obligation.amountMinor == null ? {} : { amount: toMajor(obligation.amountMinor, obligation.currency) }),
      currency: obligation.currency,
      ...(obligation.dueDate ? { dueDate: obligation.dueDate } : {}),
      status: obligation.status,
      kind: obligation.kind,
    })),
    fxRates: plan.fx.rates,
    fxAsOf: plan.fx.asOf,
    fxSource: plan.fx.source,
  };
}

export const analyzeFundingGapTool: ToolDefinition = {
  name: "analyze_funding_gap",
  description:
    "Analyze the funding gap for a student plan: computes the dated forecast, finds the first shortfall " +
    "(amount and date), explains which events open/widen the gap (gap causality), and splits funding into " +
    "confirmed vs uncertain. All figures come from the deterministic forecast engine. Provide planningCurrency, " +
    "fundingSources and obligations as simple arrays. Amounts are major units (e.g. 5000.00 USD), not cents. " +
    "Use only amounts, dates, currencies, and funding status explicitly stated by the user or present in the " +
    "structured plan. Use ISO dates. For confirmed_available money with no explicit date, omit availableDate " +
    "so the engine treats it as available as of asOfDate. Include fxRates only when the user or structured plan " +
    "provided an exchange rate; never estimate one. If required data is missing, ask instead of guessing.",
  parameters: AnalyzeFundingGapParams,
  requiresApproval: false,
  handler: async (args) =>
    withToolTimeout("analyze_funding_gap", (): ToolResult => {
      const parsed = AnalyzeFundingGapParams.safeParse(args);
      if (!parsed.success) {
        // Retain the old direct-handler contract for internal callers while
        // keeping the Vertex-facing schema compact.
        const legacy = z.object({ plan: ToolPlanSchema }).safeParse(args);
        if (!legacy.success) {
          return { ok: false, summary: `analyze_funding_gap: invalid parameters — ${zodIssues(parsed.error)}` };
        }
        return analyzePlan(legacy.data.plan);
      }
      return analyzePlan(toToolPlan(parsed.data));
    }),
};

function analyzePlan(plan: ToolPlanInput): ToolResult {
      const state = assemblePlanState(plan);
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
          `triggered by "${gap.causeLabel}". Available funds in hand: ${formatMinor(f.openingMinor, pc)}.` +
          (confirmedGap
            ? ` Counting only confirmed money, the gap opens ${formatDateLong(confirmedGap.date)} (${formatMinor(confirmedGap.shortfallMinor, pc)} short).`
            : " No gap on confirmed money alone.")
        : f.incomplete.length > 0
          ? `No gap among the complete forecast items. Overall result is incomplete because ${f.incomplete.length} item(s) lack required amounts, dates, or exchange rates; see incomplete items before concluding the plan is fully covered.`
          : `No funding gap in the forecast window. Lowest projected balance: ${formatMinor(f.minBalanceMinor, pc)}` +
            `${f.minBalanceDate ? ` on ${formatDateLong(f.minBalanceDate)}` : ""}.`;

      return {
        ok: true,
        summary,
        data: {
          planningCurrency: pc,
          asOfDate: f.today,
          hasGap: gap !== null,
          forecastComplete: f.incomplete.length === 0,
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
              `Available funds in hand ${formatMinor(f.openingMinor, pc)}, future confirmed inflow ${formatMinor(f.totalConfirmedInflowMinor, pc)}, ` +
              `uncertain inflow ${formatMinor(f.totalUncertainInflowMinor, pc)} (conditional/estimated/unverified sources).`,
          },
          ...(f.assumptionsUsed.length > 0
            ? [{ label: "FX assumptions", detail: f.assumptionsUsed.join(" | ") }]
            : []),
        ],
      };
}
