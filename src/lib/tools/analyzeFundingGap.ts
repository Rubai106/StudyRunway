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
import { extractExplicitMoneyMentions } from "../currencyText";
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

const RecurringInputSchema = z.object({
  everyMonths: z.number().int().min(1).max(12),
  occurrences: z.number().int().min(2).max(60),
});

const ObligationInputSchema = z.object({
  label: z.string().min(1).max(120),
  amount: z.number().finite().nonnegative().max(1_000_000_000).optional(),
  currency: currencyCodeSchema,
  dueDate: ISO_DATE.optional(),
  recurring: RecurringInputSchema.optional(),
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
const FUNDING_TERMS = /\b(?:savings?|cash|funds?|scholarships?|grants?|loans?|income|wages?|paychecks?|pay\s+cheques?|salar(?:y|ies)|work\s+pay|available|received|have)\b/gi;
const OBLIGATION_TERMS = /\b(?:tuition|fees?|bill|invoice|rent|deposit|living|travel|visa|insurance|payment|expense|cost|due|payable)\b/gi;

function explicitMoneyMentions(text: string): MoneyMention[] {
  // Mask dates and explicit FX-rate declarations while preserving offsets so
  // their digits cannot be mistaken for bill or funding amounts.
  const withoutRates = text.replace(
    new RegExp(`\\b1\\s+(?:${CURRENCY_PATTERN})\\s*(?:=|equals)\\s*\\d+(?:\\.\\d+)?\\s+(?:${CURRENCY_PATTERN})\\b`, "gi"),
    (rate) => " ".repeat(rate.length),
  );
  const withoutDates = withoutRates.replace(ISO_DATE_PATTERN, (date) => " ".repeat(date.length));
  return extractExplicitMoneyMentions(withoutDates);
}

function explicitExchangeRates(text: string): Record<string, number> {
  const ratePattern = new RegExp(
    `\\b1\\s+(?<from>${CURRENCY_PATTERN})\\s*(?:=|equals)\\s*(?<rate>\\d+(?:\\.\\d+)?)\\s+(?<to>${CURRENCY_PATTERN})\\b`,
    "gi",
  );
  const rates: Record<string, number> = {};
  for (const match of text.matchAll(ratePattern)) {
    const from = match.groups?.from?.toUpperCase();
    const to = match.groups?.to?.toUpperCase();
    const rate = Number(match.groups?.rate);
    if (from && to && Number.isFinite(rate) && rate > 0) rates[`${from}>${to}`] = rate;
  }
  return rates;
}

function hasExplicitConversion(rates: Record<string, number>, from: string, to: string): boolean {
  return from === to || rates[`${from}>${to}`] != null || rates[`${to}>${from}`] != null;
}

function addRelativeDate(referenceDate: string, amount: number, unit: string): string | null {
  const date = new Date(`${referenceDate}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || !Number.isInteger(amount) || amount < 0) return null;
  if (unit.startsWith("day")) {
    date.setUTCDate(date.getUTCDate() + amount);
  } else if (unit.startsWith("week")) {
    date.setUTCDate(date.getUTCDate() + amount * 7);
  } else {
    const dayOfMonth = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + amount);
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(dayOfMonth, lastDay));
  }
  return date.toISOString().slice(0, 10);
}

function explicitDates(text: string, referenceDate: string): DatedMention[] {
  const absoluteDates = [...text.matchAll(ISO_DATE_PATTERN)].flatMap((match) => {
    const date = match[0];
    if (!ISO_DATE.safeParse(date).success) return [];
    const start = match.index ?? 0;
    return [{ date, start, end: start + date.length }];
  });
  const numberWords: Record<string, number> = {
    a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  };
  const relativeDates = [...text.matchAll(/\b(?:in|after)\s+(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+(days?|weeks?|months?)\b/gi)].flatMap((match) => {
    const amountToken = match[1]?.toLowerCase();
    const amount = amountToken ? (numberWords[amountToken] ?? Number(amountToken)) : Number.NaN;
    const date = addRelativeDate(referenceDate, amount, match[2]?.toLowerCase() ?? "");
    const start = match.index ?? 0;
    return date ? [{ date, start, end: start + match[0].length }] : [];
  });
  return [...absoluteDates, ...relativeDates];
}

function nearestAssociatedDate(dates: DatedMention[], amountOffset: number): string | undefined {
  // In prose such as "the scholarship is due in three weeks, and €700 wages
  // arrive in seven days", the second amount is textually closer to the first
  // date. Prefer a date phrase following this amount before falling back to a
  // preceding phrase ("in seven days, I will receive €700").
  const following = dates.filter((date) => date.start >= amountOffset);
  return [...(following.length ? following : dates)]
    .sort((a, b) => Math.abs(a.start - amountOffset) - Math.abs(b.start - amountOffset))[0]?.date;
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

/** Return the sentence containing a money mention without splitting decimals. */
function sentenceAround(text: string, start: number, end: number): { text: string; offset: number } {
  const isBoundary = (index: number) => {
    const ch = text[index];
    if (ch === "\n" || ch === "\r" || ch === ";" || ch === "!" || ch === "?") return true;
    if (ch !== ".") return false;
    // A dot between digits is a decimal point (e.g. 3,500.00), not a sentence end.
    return !(/\d/.test(text[index - 1] ?? "") && /\d/.test(text[index + 1] ?? ""));
  };
  let left = 0;
  for (let i = start - 1; i >= 0; i -= 1) {
    if (isBoundary(i)) {
      left = i + 1;
      break;
    }
  }
  let right = text.length;
  for (let i = end; i < text.length; i += 1) {
    if (isBoundary(i)) {
      right = i;
      break;
    }
  }
  return { text: text.slice(left, right), offset: start - left };
}

/**
 * Keep qualifiers attached to the amount they describe when a user lists
 * multiple records in one sentence (for example, “scholarship expected in
 * three weeks, and wages due next week”). Commas inside numeric amounts are
 * not clause boundaries.
 */
function financialClauseAround(text: string, start: number, end: number): { text: string; offset: number } {
  const sentence = sentenceAround(text, start, end);
  const localStart = sentence.offset;
  const localEnd = localStart + (end - start);
  const isDelimiter = (index: number) => {
    if (sentence.text[index] !== ",") return false;
    const previous = sentence.text[index - 1] ?? "";
    const next = sentence.text[index + 1] ?? "";
    return !(/\d/.test(previous) && /\d/.test(next));
  };
  let left = 0;
  for (let i = localStart - 1; i >= 0; i -= 1) {
    if (isDelimiter(i)) {
      left = i + 1;
      break;
    }
  }
  let right = sentence.text.length;
  for (let i = localEnd; i < sentence.text.length; i += 1) {
    if (isDelimiter(i)) {
      right = i;
      break;
    }
  }
  return { text: sentence.text.slice(left, right), offset: localStart - left };
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
  if (amounts.length === 0) return null;

  const asOfMatch = text.match(/\bas of\s+(\d{4}-\d{2}-\d{2})\b/i);
  const asOfDate = asOfMatch && ISO_DATE.safeParse(asOfMatch[1]).success
    ? asOfMatch[1]
    : undefined;
  const referenceDate = asOfDate ?? todayISO(null);
  const hasRelativeDates = /\b(?:in|after)\s+(?:\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:days?|weeks?|months?)\b/i.test(text);
  const fxRates = explicitExchangeRates(text);

  const fundingSources: AnalyzeFundingGapInput["fundingSources"] = [];
  const obligations: AnalyzeFundingGapInput["obligations"] = [];
  for (const mention of amounts) {
    // Restrict status/kind/date association to the sentence with this amount.
    // A sliding window let a nearby scholarship or bill change the status of
    // unrelated savings (and vice versa).
    const clause = financialClauseAround(text, mention.start, mention.end);
    const nearby = clause.text;
    // A hypothetical or proposed alternative is not part of the baseline
    // forecast. Refuse the full text rather than silently count it as cash.
    if (/\b(?:hypothetical|proposed|backup option|recovery option)\b/i.test(nearby)) return null;
    const localOffset = clause.offset;
    const fundingDistance = nearestTermDistance(nearby, FUNDING_TERMS, localOffset);
    const obligationDistance = nearestTermDistance(nearby, OBLIGATION_TERMS, localOffset);
    if (fundingDistance == null && obligationDistance == null) return null;

    if (fundingDistance != null && (obligationDistance == null || fundingDistance < obligationDistance)) {
      const status: NonNullable<AnalyzeFundingGapInput["fundingSources"][number]["status"]> | undefined =
        /\bconditional\b/i.test(nearby) ? "conditional"
          : /\bunverified\b/i.test(nearby) ? "unverified"
            // Expected describes a forecast, not a confirmed award or
            // payment. Uncertainty takes precedence even if the sentence also
            // says “approved” or “will arrive”.
            : /\b(?:estimated?|expected|expect(?:ing)?|likely|possibly|maybe|might|may|could|should|hoping|uncertain|not\s+sure|not\s+confirmed|pending\s+approval)\b/i.test(nearby) ? "estimated"
              : /\b(?:confirmed\s+(?:and\s+)?(?:pending|scheduled|for release|to arrive|to be disbursed)|approved\s+(?:and\s+)?(?:scheduled|pending disbursement|for release)|awarded\s+(?:and\s+)?(?:scheduled|pending disbursement|for release)|will\s+(?:receive|arrive|be paid|be disbursed))\b/i.test(nearby) ||
                (/\b(due|payday)\b/i.test(nearby) && /\b(?:wages?|paychecks?|pay\s+cheques?|salar(?:y|ies)|work\s+pay)\b/i.test(nearby)) ? "confirmed_pending"
                : /\b(available|in hand|currently have|\bhave\b|received)\b/i.test(nearby) ? "confirmed_available"
                  : undefined;
      if (!status) return null;
      const fundingKind = [...nearby.matchAll(/\b(savings?|scholarships?|grants?|loans?|income|wages?|paychecks?|pay\s+cheques?|salar(?:y|ies)|work\s+pay|family support|cash)\b/gi)]
        .map((match) => {
          const start = match.index ?? 0;
          return {
            value: match[1]?.toLowerCase() ?? "",
            distance: start <= localOffset && start + match[0].length >= localOffset
              ? 0
              : Math.min(Math.abs(start - localOffset), Math.abs(start + match[0].length - localOffset)),
          };
        })
        .sort((a, b) => a.distance - b.distance)[0]?.value;
      const isIncomeKind = fundingKind === "income" || /\b(?:wages?|paychecks?|pay\s+cheques?|salar(?:y|ies)|work\s+pay)\b/i.test(fundingKind ?? "");
      const kind = fundingKind?.startsWith("saving") ? "savings"
        : fundingKind?.startsWith("scholarship") ? "scholarship"
          : fundingKind?.startsWith("grant") ? "other"
            : fundingKind?.startsWith("loan") ? "loan"
              : isIncomeKind ? "income"
                : fundingKind === "family support" ? "family"
                  : "other";
      const datedMentions = explicitDates(nearby, referenceDate);
      const expectedDate = status === "confirmed_pending" || status === "conditional" || status === "estimated" || status === "unverified"
        ? nearestAssociatedDate(datedMentions.filter((d) => d.date !== asOfDate), localOffset)
        : undefined;
      const availableDate = status === "confirmed_available"
        ? nearestAssociatedDate(datedMentions, localOffset)
        : undefined;
      fundingSources.push({
        label: fundingKind ? `${fundingKind[0].toUpperCase()}${fundingKind.slice(1)}` : "Funding",
        amount: mention.amount,
        currency: mention.currency,
        status,
        ...(availableDate ? { availableDate } : {}),
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
    const dueDate = nearestAssociatedDate(explicitDates(nearby, referenceDate), localOffset);
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
  const requestedPlanningCurrency = text.match(
    new RegExp(`\\b(?:planning currency|plan(?:ning)? in|budget currency)\\s*(?:is|:)?\\s*(${CURRENCY_PATTERN})\\b`, "i"),
  )?.[1]?.toUpperCase();
  const planningCurrency = requestedPlanningCurrency ??
    obligations.find((obligation) => obligation.kind === "tuition")?.currency ??
    obligations[0].currency;
  const currencies = new Set([
    ...fundingSources.map((source) => source.currency),
    ...obligations.map((obligation) => obligation.currency),
  ]);
  if ([...currencies].some((currency) => !hasExplicitConversion(fxRates, currency, planningCurrency))) return null;

  const rateLabel = /\b(?:exchange|FX)\s+rate\b/i.exec(text);
  const rateSentence = rateLabel && rateLabel.index !== undefined
    ? sentenceAround(text, rateLabel.index, rateLabel.index + rateLabel[0].length).text
    : "";
  const rateDate = rateSentence.match(/\b(?:dated|as of)\s+(\d{4}-\d{2}-\d{2})/i)?.[1];
  const fxAsOf = rateDate && ISO_DATE.safeParse(rateDate).success ? rateDate : undefined;
  const parsed = AnalyzeFundingGapParams.safeParse({
    planningCurrency,
    ...(asOfDate || hasRelativeDates ? { asOfDate: referenceDate } : {}),
    fundingSources,
    obligations,
    ...(Object.keys(fxRates).length ? {
      fxRates,
      ...(fxAsOf ? { fxAsOf } : {}),
      fxSource: "User-provided exchange-rate assumption",
    } : {}),
  });
  return parsed.success ? parsed.data : null;
}

/** Parse only the stated baseline that precedes an explicit recovery-options list. */
export function extractScenarioFundingGapInputFromText(text: string): AnalyzeFundingGapInput | null {
  const alternativeList = /\b(?:compare|evaluate|rank|consider)\s+(?:only\s+)?(?:these\s+)?(?:hypothetical\s+)?(?:backup\s+|recovery\s+|alternative\s+)?options?\s*:/i;
  const match = alternativeList.exec(text);
  if (!match || match.index === undefined) return extractFundingGapInputFromText(text);
  return extractFundingGapInputFromText(text.slice(0, match.index));
}

/** Convert the model-friendly input into the engine's canonical plan shape. */
export function fundingGapInputToToolPlan(input: AnalyzeFundingGapInput): ToolPlanInput {
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
      recurring: obligation.recurring ?? null,
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
      ...(obligation.recurring ? { recurring: obligation.recurring } : {}),
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
    "provided an exchange rate; never estimate one. Treat expected, likely, conditional, or unverified funds as " +
    "uncertain unless the user explicitly confirms the award and its payment schedule. Never promote expected " +
    "scholarships or wages to confirmed_pending. If required data is missing, ask instead of guessing.",
  parameters: AnalyzeFundingGapParams,
  requiresApproval: false,
  safeToReplayForVerification: true,
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
      return analyzePlan(fundingGapInputToToolPlan(parsed.data));
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
          // Preserve the user-provided original-currency records for the
          // dashboard. Do not replace these with converted forecast totals.
          cashFlow: {
            planningCurrency: pc,
            asOfDate: f.today,
            fundingSources: state.fundingSources.map((source) => ({
              id: source.id,
              label: source.label,
              kind: source.kind,
              amountMinor: source.amountMinor,
              currency: source.currency,
              status: source.status,
              availableDate: source.availableDate,
              expectedDate: source.expectedDate,
            })),
            bills: state.obligations
              .filter((obligation) => obligation.status !== "paid")
              .map((obligation) => ({
                id: obligation.id,
                label: obligation.label,
                kind: obligation.kind,
                amountMinor: obligation.amountMinor,
                currency: obligation.currency,
                dueDate: obligation.dueDate,
                recurring: obligation.recurring,
                status: obligation.status,
              })),
            fxAssumptions: Object.entries(state.fx.rates).map(([pair, rate]) => ({
              pair,
              rate,
              asOf: state.fx.asOf,
              source: state.fx.source,
            })),
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
