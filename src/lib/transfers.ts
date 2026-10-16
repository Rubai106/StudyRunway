/**
 * Deadline-Aware Transfer Optimizer.
 *
 * Compares manually entered (or sample) transfer quotes with one consistent
 * arithmetic convention:
 *
 *   received = round((send − fee − otherCosts) × rate)
 *
 * where fee/otherCosts are first converted to the send currency when they
 * are quoted in another currency. Fees already embedded in the rate are not
 * subtracted again — the quote records the rate as quoted and the fee as a
 * separate visible fee, so double-counting is impossible by construction.
 *
 * A missing fee is NEVER treated as zero: the quote is flagged incomplete
 * and excluded from ranking until the user supplies it.
 */

import { convertMinor } from "./money";
import { resolveRate } from "./forecast";
import { FxTable, TransferQuote, addDaysISO, formatDateLong } from "./model";

export type DeadlineVerdict = "meets" | "uncertain" | "misses";

export interface QuoteAnalysis {
  quote: TransferQuote;
  complete: boolean;
  flags: string[];
  /** In receive-currency minor units; null when the fee is unknown. */
  receivedMinor: number | null;
  receiveCurrency: string;
  /** Total cost in planning-currency minor units (send + fee + other). */
  totalCostMinor: number | null;
  /** Effective rate actually achieved (receive per 1 send), null when unknown. */
  effectiveRate: number | null;
  arrivalEarliest: string;
  arrivalLatest: string;
  deadline: string | null;
  deadlineVerdict: DeadlineVerdict | null;
  rank: number | null; // null = not ranked (incomplete or no deadline context needed)
}

export function analyzeQuote(
  q: TransferQuote,
  fx: FxTable,
  planningCurrency: string,
): QuoteAnalysis {
  const flags: string[] = [];

  const arrivalEarliest = addDaysISO(q.quoteDate, q.deliveryDaysMin);
  const arrivalLatest = addDaysISO(q.quoteDate, q.deliveryDaysMax);

  let deadlineVerdict: DeadlineVerdict | null = null;
  if (q.paymentDeadline) {
    if (arrivalLatest <= q.paymentDeadline) deadlineVerdict = "meets";
    else if (arrivalEarliest > q.paymentDeadline) deadlineVerdict = "misses";
    else deadlineVerdict = "uncertain";
    if (deadlineVerdict !== "meets") {
      flags.push(
        deadlineVerdict === "misses"
          ? `Expected to arrive ${formatDateLong(arrivalEarliest)}–${formatDateLong(arrivalLatest)}, after the ${formatDateLong(q.paymentDeadline)} deadline.`
          : `May arrive ${formatDateLong(arrivalEarliest)}–${formatDateLong(arrivalLatest)}; the ${formatDateLong(q.paymentDeadline)} deadline falls inside that window.`,
      );
    }
  }

  // Fee handling: missing fee => incomplete quote, never assumed zero.
  let feeInSendMinor = 0;
  if (q.feeMinor == null) {
    flags.push("Transfer fee is unknown — the receiving amount cannot be computed reliably. Add the fee to compare this quote.");
  } else {
    const feeCur = q.feeCurrency ?? q.sendCurrency;
    if (feeCur.toUpperCase() === q.sendCurrency.toUpperCase()) {
      feeInSendMinor = q.feeMinor;
    } else {
      const r = resolveRate(fx, feeCur, q.sendCurrency);
      if (!r) {
        flags.push(`Cannot convert the fee from ${feeCur} — missing FX assumption.`);
      } else {
        feeInSendMinor = convertMinor(q.feeMinor, feeCur, q.sendCurrency, r.rate);
      }
    }
  }

  let otherInSendMinor = 0;
  if (q.otherCostsMinor != null) {
    const ocCur = q.otherCostsCurrency ?? q.sendCurrency;
    if (ocCur.toUpperCase() === q.sendCurrency.toUpperCase()) {
      otherInSendMinor = q.otherCostsMinor;
    } else {
      const r = resolveRate(fx, ocCur, q.sendCurrency);
      if (r) otherInSendMinor = convertMinor(q.otherCostsMinor, ocCur, q.sendCurrency, r.rate);
      else flags.push(`Cannot convert other costs from ${ocCur} — missing FX assumption.`);
    }
  }

  const complete = q.feeMinor != null && flags.every((f) => !f.startsWith("Cannot convert"));
  const netSendMinor = q.sendAmountMinor - feeInSendMinor - otherInSendMinor;

  let receivedMinor: number | null = null;
  let effectiveRate: number | null = null;
  if (complete && netSendMinor > 0) {
    receivedMinor = convertMinor(netSendMinor, q.sendCurrency, q.receiveCurrency, q.exchangeRate);
    // Ratio of minor units == ratio of major units: receive-currency per 1 send-currency.
    effectiveRate = receivedMinor / q.sendAmountMinor;
  } else if (complete && netSendMinor <= 0) {
    flags.push("Fees consume the entire transfer amount — nothing would be received.");
  }

  // Total cost in planning currency: send + fee + other (all converted).
  let totalCostMinor: number | null = null;
  {
    const r1 = resolveRate(fx, q.sendCurrency, planningCurrency);
    const feeCur = q.feeCurrency ?? q.sendCurrency;
    const r2 = q.feeMinor != null ? resolveRate(fx, feeCur, planningCurrency) : null;
    const ocCur = q.otherCostsCurrency ?? q.sendCurrency;
    const r3 = q.otherCostsMinor != null ? resolveRate(fx, ocCur, planningCurrency) : null;
    if (r1 && (q.feeMinor == null || r2) && (q.otherCostsMinor == null || r3)) {
      totalCostMinor =
        convertMinor(q.sendAmountMinor, q.sendCurrency, planningCurrency, r1.rate) +
        (q.feeMinor != null && r2 ? convertMinor(q.feeMinor, feeCur, planningCurrency, r2.rate) : 0) +
        (q.otherCostsMinor != null && r3 ? convertMinor(q.otherCostsMinor, ocCur, planningCurrency, r3.rate) : 0);
    } else if (q.feeMinor == null) {
      // Cost without the unknown fee would understate reality: still show it
      // but it is already flagged incomplete and excluded from ranking.
      totalCostMinor = r1 ? convertMinor(q.sendAmountMinor, q.sendCurrency, planningCurrency, r1.rate) : null;
    }
  }

  return {
    quote: q,
    complete,
    flags,
    receivedMinor,
    receiveCurrency: q.receiveCurrency,
    totalCostMinor,
    effectiveRate,
    arrivalEarliest,
    arrivalLatest,
    deadline: q.paymentDeadline,
    deadlineVerdict,
    rank: null,
  };
}

export interface RankedQuote extends QuoteAnalysis {
  rank: number;
}

/**
 * Rank quotes: complete quotes that can meet the deadline come first,
 * ordered by total cost (then by amount received). Incomplete quotes and
 * deadline-missers are listed separately and never recommended.
 */
export function rankQuotes(
  quotes: TransferQuote[],
  fx: FxTable,
  planningCurrency: string,
): { ranked: RankedQuote[]; excluded: QuoteAnalysis[] } {
  const analyses = quotes.map((q) => analyzeQuote(q, fx, planningCurrency));
  const eligible = analyses.filter(
    (a) => a.complete && a.totalCostMinor != null && a.deadlineVerdict !== "misses",
  );
  eligible.sort((a, b) => {
    const costA = a.totalCostMinor as number;
    const costB = b.totalCostMinor as number;
    if (costA !== costB) return costA - costB;
    return (b.receivedMinor ?? 0) - (a.receivedMinor ?? 0);
  });
  const ranked: RankedQuote[] = eligible.map((a, i) => ({ ...a, rank: i + 1 }));
  const rankedIds = new Set(ranked.map((r) => r.quote.id));
  const excluded = analyses.filter((a) => !rankedIds.has(a.quote.id));
  return { ranked, excluded };
}
