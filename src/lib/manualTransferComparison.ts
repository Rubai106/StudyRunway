/** Deterministic comparison for quote details the student enters manually. */
import { z } from "zod";
import { formatMinor, isSupportedCurrency } from "./currency";
import { convertMinor } from "./money";
import { ISO_DATE, addDaysISO } from "./model";

export const ManualTransferQuoteSchema = z.object({
  provider: z.string().trim().min(1).max(80),
  exchangeRate: z.number().positive().finite(),
  feeTreatment: z.enum(["deducted", "added"]),
  feeMinor: z.number().int().nonnegative().nullable(),
  recipientFeeMinor: z.number().int().nonnegative().nullable(),
  deliveryDaysMin: z.number().int().min(0).max(60),
  deliveryDaysMax: z.number().int().min(0).max(60),
  quoteDate: ISO_DATE,
  quoteCheckedAt: z.string().datetime({ offset: true }),
  minimumSendMinor: z.number().int().nonnegative().nullable().default(null),
  maximumSendMinor: z.number().int().positive().nullable().default(null),
}).refine((quote) => quote.deliveryDaysMax >= quote.deliveryDaysMin, {
  message: "Maximum delivery time must be at least the minimum.",
  path: ["deliveryDaysMax"],
}).refine((quote) => quote.minimumSendMinor == null || quote.maximumSendMinor == null || quote.minimumSendMinor <= quote.maximumSendMinor, {
  message: "The minimum transfer limit cannot exceed the maximum.",
  path: ["maximumSendMinor"],
});

const ManualComparisonSchema = z.object({
  sendAmountMinor: z.number().int().positive(),
  sendCurrency: z.string().length(3).refine(isSupportedCurrency),
  receiveCurrency: z.string().length(3).refine(isSupportedCurrency),
  deadlineIso: ISO_DATE.nullable(),
  objective: z.enum(["max_received", "min_total_cost", "fastest"]),
  midMarketRate: z.number().positive().finite().nullable(),
  quotes: z.array(ManualTransferQuoteSchema).min(1).max(6),
});

export type ManualTransferComparisonInput = z.input<typeof ManualComparisonSchema>;

export interface ManualTransferOption {
  provider: string;
  quoteDate: string;
  quoteCheckedAt: string;
  exchangeRate: number;
  feeTreatment: "deducted" | "added";
  spreadBasisPoints: number | null;
  senderFeeMinor: number | null;
  recipientFeeMinor: number | null;
  receivedMinor: number | null;
  totalCostMinor: number | null;
  arrivalEarliest: string;
  arrivalLatest: string;
  deadlineVerdict: "meets" | "uncertain" | "misses" | null;
  flags: string[];
  exclusionReason: string | null;
}

export function compareManualTransferQuotes(input: ManualTransferComparisonInput): {
  objective: "max_received" | "min_total_cost" | "fastest";
  deadlineIso: string | null;
  sendAmountMinor: number;
  sendCurrency: string;
  receiveCurrency: string;
  ranked: ManualTransferOption[];
  excluded: ManualTransferOption[];
} {
  const parsed = ManualComparisonSchema.parse(input);
  const sendCurrency = parsed.sendCurrency.toUpperCase();
  const receiveCurrency = parsed.receiveCurrency.toUpperCase();
  const ranked: ManualTransferOption[] = [];
  const excluded: ManualTransferOption[] = [];

  parsed.quotes.forEach((candidate) => {
    const limitIssue = candidate.minimumSendMinor != null && parsed.sendAmountMinor < candidate.minimumSendMinor
      ? `Below the provider's minimum of ${formatMinor(candidate.minimumSendMinor, sendCurrency)}.`
      : candidate.maximumSendMinor != null && parsed.sendAmountMinor > candidate.maximumSendMinor
        ? `Above the provider's maximum of ${formatMinor(candidate.maximumSendMinor, sendCurrency)}.`
        : null;
    const reasons: string[] = [];
    if (candidate.feeMinor == null) reasons.push("Provider fee is unknown; it was not treated as zero.");
    if (candidate.recipientFeeMinor == null) reasons.push("Recipient or intermediary charge is unknown; it was not treated as zero.");
    if (limitIssue) reasons.push(limitIssue);
    const arrivalEarliest = addDaysISO(candidate.quoteDate, candidate.deliveryDaysMin);
    const arrivalLatest = addDaysISO(candidate.quoteDate, candidate.deliveryDaysMax);
    const deadlineVerdict = parsed.deadlineIso
      ? arrivalLatest <= parsed.deadlineIso
        ? "meets" as const
        : arrivalEarliest > parsed.deadlineIso ? "misses" as const : "uncertain" as const
      : null;
    if (parsed.deadlineIso && deadlineVerdict !== "meets") {
      reasons.push(deadlineVerdict === "uncertain"
        ? "Arrival window overlaps the payment deadline, so on-time delivery is uncertain."
        : "The latest stated arrival misses the payment deadline.");
    }
    if (candidate.feeMinor != null && candidate.feeTreatment === "deducted" && candidate.feeMinor >= parsed.sendAmountMinor) {
      reasons.push("The provider fee consumes the full transfer amount.");
    }
    const sourceForExchange = candidate.feeTreatment === "deducted" && candidate.feeMinor != null
      ? parsed.sendAmountMinor - candidate.feeMinor
      : parsed.sendAmountMinor;
    const grossReceivedMinor = convertMinor(sourceForExchange, sendCurrency, receiveCurrency, candidate.exchangeRate);
    const receivedMinor = candidate.recipientFeeMinor == null
      ? null
      : grossReceivedMinor - candidate.recipientFeeMinor;
    if (receivedMinor != null && receivedMinor <= 0) reasons.push("The recipient charge consumes the full quoted amount.");
    const totalCostMinor = candidate.feeMinor == null
      ? null
      : parsed.sendAmountMinor + (candidate.feeTreatment === "added" ? candidate.feeMinor : 0);
    const spreadBasisPoints = parsed.midMarketRate == null
      ? null
      : ((parsed.midMarketRate - candidate.exchangeRate) / parsed.midMarketRate) * 10_000;
    const option: ManualTransferOption = {
      provider: candidate.provider,
      quoteDate: candidate.quoteDate,
      quoteCheckedAt: candidate.quoteCheckedAt,
      exchangeRate: candidate.exchangeRate,
      feeTreatment: candidate.feeTreatment,
      spreadBasisPoints,
      senderFeeMinor: candidate.feeMinor,
      recipientFeeMinor: candidate.recipientFeeMinor,
      receivedMinor,
      totalCostMinor,
      arrivalEarliest,
      arrivalLatest,
      deadlineVerdict,
      flags: reasons,
      exclusionReason: reasons.length ? reasons.join(" ") : null,
    };
    (reasons.length ? excluded : ranked).push(option);
  });

  ranked.sort((a, b) => {
    if (parsed.objective === "min_total_cost") {
      return (a.totalCostMinor ?? Infinity) - (b.totalCostMinor ?? Infinity)
        || (b.receivedMinor ?? 0) - (a.receivedMinor ?? 0);
    }
    if (parsed.objective === "fastest") {
      return a.arrivalLatest.localeCompare(b.arrivalLatest)
        || (b.receivedMinor ?? 0) - (a.receivedMinor ?? 0);
    }
    return (b.receivedMinor ?? 0) - (a.receivedMinor ?? 0)
      || (a.totalCostMinor ?? Infinity) - (b.totalCostMinor ?? Infinity);
  });
  return {
    objective: parsed.objective,
    deadlineIso: parsed.deadlineIso,
    sendAmountMinor: parsed.sendAmountMinor,
    sendCurrency,
    receiveCurrency,
    ranked,
    excluded,
  };
}
