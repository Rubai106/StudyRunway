"use client";

import { useState, type FormEvent } from "react";
import { CURRENCIES, formatMinor, getCurrency, isSupportedCurrency } from "@/lib/currency";
import { toMajor, toMinor } from "@/lib/money";
import {
  compareManualTransferQuotes,
  type ManualTransferComparisonInput,
} from "@/lib/manualTransferComparison";
import { asString } from "./shared";

interface QuoteDraft {
  provider: string;
  exchangeRate: string;
  feeTreatment: "" | "deducted" | "added";
  senderFee: string;
  recipientFee: string;
  deliveryDaysMin: string;
  deliveryDaysMax: string;
  quoteCheckedAt: string;
  minimumSend: string;
  maximumSend: string;
}

interface WiseQuoteOption {
  id: string;
  payIn: string;
  payOut: string;
  sourceAmount: number;
  targetAmount: number;
  rate: number;
  feeAmount: number | null;
  feeCurrency: string;
  priceTotal: number | null;
  priceCurrency: string;
  estimatedDelivery: string | null;
  formattedEstimatedDelivery: string | null;
}

interface WiseQuotePreviewData {
  provider: "Wise";
  quoteType: string;
  environment: "production" | "sandbox";
  sourceCurrency: string;
  targetCurrency: string;
  requestedSourceAmount: number;
  sourceAmount: number;
  targetAmount: number;
  rate: number;
  checkedAt: string;
  createdTime: string;
  expirationTime: string | null;
  rateExpirationTime: string | null;
  options: WiseQuoteOption[];
  sourceUrl: string;
  canCreateTransfer: false;
  rateLocked: false;
}

function blankQuote(): QuoteDraft {
  return {
    provider: "",
    exchangeRate: "",
    feeTreatment: "",
    senderFee: "",
    recipientFee: "",
    deliveryDaysMin: "",
    deliveryDaysMax: "",
    quoteCheckedAt: "",
    minimumSend: "",
    maximumSend: "",
  };
}

function readMoney(value: string, currency: string, label: string, optional: boolean): number | null {
  const normalized = value.trim();
  if (!normalized && optional) return null;
  const amount = Number(normalized);
  if (!normalized || !Number.isFinite(amount) || amount < 0) {
    throw new Error(`${label} must be a number of ${currency}, or enter 0 when there is no charge.`);
  }
  return toMinor(amount, currency);
}

function displayDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString();
}

function formatMajor(amount: number, currency: string): string {
  return formatMinor(toMinor(amount, currency), currency);
}

function localDateTimeInput(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function calendarDaysBetween(from: string, to: string): number | null {
  const fromDay = from.slice(0, 10);
  const toDay = to.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDay) || !/^\d{4}-\d{2}-\d{2}$/.test(toDay)) return null;
  const start = new Date(`${fromDay}T00:00:00Z`).getTime();
  const end = new Date(`${toDay}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

export default function ManualTransferComparison({
  data,
}: {
  data: Record<string, unknown>;
}) {
  const corridor = asString(data["corridor"]);
  const [sendCurrency, setSendCurrency] = useState(corridor.split(">")[0] || "BDT");
  const [receiveCurrency, setReceiveCurrency] = useState(corridor.split(">")[1] || "GBP");
  const [sendAmount, setSendAmount] = useState("");
  const [deadline, setDeadline] = useState(asString(data["requestedDeadline"]));
  const [midMarketRate, setMidMarketRate] = useState("");
  const [objective, setObjective] = useState<ManualTransferComparisonInput["objective"]>("max_received");
  const [quotes, setQuotes] = useState<QuoteDraft[]>([blankQuote(), blankQuote()]);
  const [comparison, setComparison] = useState<ReturnType<typeof compareManualTransferQuotes> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wiseQuote, setWiseQuote] = useState<WiseQuotePreviewData | null>(null);
  const [wiseLoading, setWiseLoading] = useState(false);
  const [wiseError, setWiseError] = useState<string | null>(null);
  const [wiseImportNotice, setWiseImportNotice] = useState<string | null>(null);

  const wiseQuoteMatchesCurrentInputs = (() => {
    if (!wiseQuote || !sendAmount.trim()) return false;
    const amount = Number(sendAmount);
    if (!Number.isFinite(amount) || amount <= 0) return false;
    try {
      return wiseQuote.sourceCurrency === sendCurrency &&
        wiseQuote.targetCurrency === receiveCurrency &&
        toMinor(wiseQuote.requestedSourceAmount, sendCurrency) === toMinor(amount, sendCurrency);
    } catch {
      return false;
    }
  })();

  const fetchWiseQuote = async () => {
    setWiseError(null);
    setWiseImportNotice(null);
    setWiseQuote(null);
    setComparison(null);
    const amount = Number(sendAmount);
    if (!sendAmount.trim() || !Number.isFinite(amount) || amount <= 0) {
      setWiseError("Enter a positive amount before requesting a Wise quote.");
      return;
    }
    if (sendCurrency === receiveCurrency) {
      setWiseError("Choose different send and recipient currencies for a Wise quote.");
      return;
    }

    setWiseLoading(true);
    try {
      const response = await fetch("/api/transfers/wise-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceCurrency: sendCurrency, targetCurrency: receiveCurrency, sourceAmount: amount }),
        cache: "no-store",
      });
      const payload = await response.json() as { ok?: boolean; error?: string; data?: WiseQuotePreviewData };
      if (!response.ok || !payload.ok || !payload.data) {
        throw new Error(payload.error || "Wise quote request failed. No estimate was substituted.");
      }
      setWiseQuote(payload.data);
    } catch (quoteError) {
      setWiseError(quoteError instanceof Error ? quoteError.message : "Could not fetch a Wise quote.");
    } finally {
      setWiseLoading(false);
    }
  };

  const addWiseOptionToComparison = (option: WiseQuoteOption) => {
    if (!wiseQuoteMatchesCurrentInputs || !wiseQuote) {
      setWiseError("The Wise quote no longer matches the amount or currencies above. Fetch a fresh quote first.");
      return;
    }
    if (Math.abs(option.sourceAmount - Number(sendAmount)) > 1 / (2 * 10 ** getCurrency(sendCurrency).minorUnits)) {
      setWiseError("This Wise payment option returned a different send amount. It cannot be ranked against the current amount.");
      return;
    }

    const feeCurrency = (option.priceCurrency || option.feeCurrency).toUpperCase();
    const comparisonFee = feeCurrency === sendCurrency
      ? (option.priceTotal != null && option.priceTotal >= 0 ? option.priceTotal : option.feeAmount)
      : null;
    const deliveryDays = option.estimatedDelivery
      ? calendarDaysBetween(wiseQuote.checkedAt, option.estimatedDelivery)
      : null;
    const feeMinor = comparisonFee != null ? toMinor(comparisonFee, sendCurrency) : null;
    const quote: QuoteDraft = {
      provider: `Wise (${option.payIn} / ${option.payOut})`,
      exchangeRate: String(option.rate),
      feeTreatment: "deducted",
      senderFee: feeMinor == null ? "" : String(toMajor(feeMinor, sendCurrency)),
      recipientFee: "",
      deliveryDaysMin: deliveryDays == null ? "" : String(deliveryDays),
      deliveryDaysMax: deliveryDays == null ? "" : String(deliveryDays),
      quoteCheckedAt: localDateTimeInput(wiseQuote.checkedAt),
      minimumSend: "",
      maximumSend: "",
    };
    const firstEmpty = quotes.findIndex((entry) => !entry.provider.trim());
    if (firstEmpty < 0 && quotes.length >= 6) {
      setWiseError("The comparison already has six provider options. Remove one before adding Wise.");
      return;
    }
    setQuotes((current) => {
      const emptyIndex = current.findIndex((entry) => !entry.provider.trim());
      if (emptyIndex >= 0) return current.map((entry, index) => index === emptyIndex ? quote : entry);
      return [...current, quote];
    });
    setComparison(null);
    setWiseError(null);
    setWiseImportNotice("Added to the comparison form. Enter the receiving bank or intermediary fee; leave the option unranked if that charge is still unknown.");
  };

  const updateQuote = (index: number, field: keyof QuoteDraft, value: string) => {
    setQuotes((current) => current.map((quote, i) => i === index ? { ...quote, [field]: value } : quote));
    setComparison(null);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setComparison(null);
    try {
      const amountMinor = readMoney(sendAmount, sendCurrency, "Transfer amount", false);
      if (amountMinor == null || amountMinor <= 0) throw new Error("Enter a transfer amount greater than zero.");
      const entered = quotes.filter((quote) => quote.provider.trim());
      if (entered.length === 0) throw new Error("Enter at least one provider quote.");
      const normalizedQuotes = entered.map((quote) => {
        const rate = Number(quote.exchangeRate);
        const minDays = Number(quote.deliveryDaysMin);
        const maxDays = Number(quote.deliveryDaysMax);
        if (!quote.quoteCheckedAt) throw new Error(`Add when you checked the quote for ${quote.provider}.`);
        if (sendCurrency !== receiveCurrency && (!Number.isFinite(rate) || rate <= 0)) throw new Error(`Enter a positive exchange rate for ${quote.provider}.`);
        if (!quote.feeTreatment) throw new Error(`Choose whether ${quote.provider} deducts its fee or charges it on top.`);
        if (!Number.isInteger(minDays) || !Number.isInteger(maxDays) || minDays < 0 || maxDays < minDays) {
          throw new Error(`Enter a valid delivery window for ${quote.provider}.`);
        }
        return {
          provider: quote.provider.trim(),
          exchangeRate: sendCurrency === receiveCurrency ? 1 : rate,
          feeTreatment: quote.feeTreatment,
          feeMinor: readMoney(quote.senderFee, sendCurrency, `${quote.provider} transfer fee`, true),
          recipientFeeMinor: readMoney(quote.recipientFee, receiveCurrency, `${quote.provider} recipient charge`, true),
          deliveryDaysMin: minDays,
          deliveryDaysMax: maxDays,
          quoteDate: quote.quoteCheckedAt.slice(0, 10),
          quoteCheckedAt: new Date(quote.quoteCheckedAt).toISOString(),
          minimumSendMinor: readMoney(quote.minimumSend, sendCurrency, `${quote.provider} minimum limit`, true),
          maximumSendMinor: readMoney(quote.maximumSend, sendCurrency, `${quote.provider} maximum limit`, true),
        };
      });
      const market = midMarketRate.trim() ? Number(midMarketRate) : null;
      if (market !== null && (!Number.isFinite(market) || market <= 0)) {
        throw new Error("The mid-market rate must be a positive number.");
      }
      setComparison(compareManualTransferQuotes({
        sendAmountMinor: amountMinor,
        sendCurrency,
        receiveCurrency,
        deadlineIso: deadline || null,
        objective,
        midMarketRate: market,
        quotes: normalizedQuotes,
      }));
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Could not compare these quote details.");
    }
  };

  const inputClass = "mt-1 w-full rounded-lg border border-[var(--sr-line)] bg-white px-2.5 py-2 text-sm outline-none focus:border-[var(--sr-pine)] focus:ring-2 focus:ring-[var(--sr-pine)]/20";
  const labelClass = "block text-xs font-medium text-[var(--sr-ink)]/75";

  return (
    <section className="mt-4 rounded-2xl border border-[var(--sr-line)] bg-white/60 p-3 sm:p-4" aria-labelledby="manual-transfer-title">
      <div>
        <h3 id="manual-transfer-title" className="text-sm font-bold text-[var(--sr-ink)]">Compare quotes you collected</h3>
        <p className="mt-1 text-xs leading-relaxed text-[var(--sr-ink)]/60">
          Enter the details shown by each provider. Unknown fees are excluded instead of counted as zero. These entries stay in this result view and are not saved or sent.
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-[var(--sr-ink)]/50">
          Use the same provider-stated send amount for each option. If the fee is deducted, it reduces the amount exchanged; if charged on top, it increases your sender outlay.
        </p>
      </div>

      <form className="mt-3 space-y-4" onSubmit={onSubmit}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className={labelClass}>
            Amount to send ({sendCurrency})
            <input className={inputClass} type="number" min="0.01" step="any" required value={sendAmount} onChange={(event) => { setSendAmount(event.target.value); setComparison(null); setWiseImportNotice(null); }} />
          </label>
          <label className={labelClass}>
            Send currency
            <select className={inputClass} value={sendCurrency} onChange={(event) => { setSendCurrency(event.target.value); setComparison(null); setWiseImportNotice(null); }}>
              {CURRENCIES.map((currency) => <option key={currency.code} value={currency.code}>{currency.code} · {currency.name}</option>)}
            </select>
          </label>
          <label className={labelClass}>
            Recipient currency
            <select className={inputClass} value={receiveCurrency} onChange={(event) => { setReceiveCurrency(event.target.value); setComparison(null); setWiseImportNotice(null); }}>
              {CURRENCIES.map((currency) => <option key={currency.code} value={currency.code}>{currency.code} · {currency.name}</option>)}
            </select>
          </label>
          <label className={labelClass}>
            Tuition payment deadline
            <input className={inputClass} type="date" value={deadline} onChange={(event) => { setDeadline(event.target.value); setComparison(null); }} />
          </label>
          {sendCurrency !== receiveCurrency && <label className={labelClass}>
            Optional mid-market rate found now
            <input className={inputClass} type="number" min="0.00000001" step="any" inputMode="decimal" placeholder={`1 ${sendCurrency} = ? ${receiveCurrency}`} value={midMarketRate} onChange={(event) => { setMidMarketRate(event.target.value); setComparison(null); }} />
          </label>}
          <label className={labelClass}>
            Rank by
            <select className={inputClass} value={objective} onChange={(event) => { setObjective(event.target.value as ManualTransferComparisonInput["objective"]); setComparison(null); }}>
              <option value="max_received">Most received before deadline</option>
              <option value="min_total_cost">Lowest total outlay</option>
              <option value="fastest">Fastest arrival</option>
            </select>
          </label>
        </div>

        <div className="rounded-xl border border-[var(--sr-pine)]/20 bg-[var(--sr-pine)]/[0.035] p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-[var(--sr-ink)]">Get a Wise quote</p>
              <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-[var(--sr-ink)]/60">
                Fetches a fresh Wise display estimate for the amount and currency pair above. The quote is not rate-locked and cannot initiate a transfer.
              </p>
            </div>
            <button type="button" onClick={fetchWiseQuote} disabled={wiseLoading} className="shrink-0 rounded-lg border border-[var(--sr-pine)]/30 bg-white px-3 py-2 text-xs font-semibold text-[var(--sr-pine)] hover:bg-[var(--sr-pine)]/5 disabled:opacity-50">
              {wiseLoading ? "Getting Wise quote…" : "Fetch Wise quote"}
            </button>
          </div>
          {wiseError && <p role="alert" className="mt-3 rounded-lg bg-[var(--sr-clay)]/10 p-2.5 text-xs text-[var(--sr-clay)]">{wiseError}</p>}
          {wiseImportNotice && <p role="status" className="mt-3 rounded-lg bg-[var(--sr-pine)]/10 p-2.5 text-xs text-[var(--sr-pine)]">{wiseImportNotice}</p>}
          {wiseQuote && (
            <div className="mt-3 space-y-2" aria-live="polite">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--sr-pine)]">
                {wiseQuote.environment === "production" ? "Wise live indicative estimate" : "Wise sandbox estimate · not live"}
                {wiseQuoteMatchesCurrentInputs ? " · current inputs" : " · stale for current inputs"}
              </p>
              {!wiseQuoteMatchesCurrentInputs && <p className="text-xs text-[var(--sr-clay)]">The amount or currency route changed. Fetch a new quote before adding it to this comparison.</p>}
              {wiseQuote.options.map((option) => {
                const priceCurrency = (option.priceCurrency || option.feeCurrency).toUpperCase();
                const canShowPriceTotal = option.priceTotal != null && isSupportedCurrency(priceCurrency);
                const canShowFee = option.feeAmount != null && isSupportedCurrency(option.feeCurrency);
                const sameSendAmount = Math.abs(option.sourceAmount - Number(sendAmount)) <= 1 / (2 * 10 ** getCurrency(sendCurrency).minorUnits);
                return (
                  <article key={option.id} className="rounded-xl border border-[var(--sr-line)] bg-white/80 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-bold text-[var(--sr-ink)]">Wise · {option.payIn} → {option.payOut}</p>
                        <p className="mt-1 text-[11px] text-[var(--sr-ink)]/55">{formatMajor(option.sourceAmount, wiseQuote.sourceCurrency)} send · {formatMajor(option.targetAmount, wiseQuote.targetCurrency)} to recipient</p>
                      </div>
                      <button type="button" onClick={() => addWiseOptionToComparison(option)} disabled={!wiseQuoteMatchesCurrentInputs || !sameSendAmount} className="rounded-lg bg-[var(--sr-pine)] px-3 py-2 text-xs font-semibold text-white hover:bg-[var(--sr-pine)]/90 disabled:opacity-45">
                        Add option to comparison
                      </button>
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs sm:grid-cols-4">
                      <div><dt className="text-[var(--sr-ink)]/50">Wise rate</dt><dd className="font-semibold">1 {wiseQuote.sourceCurrency} = {option.rate} {wiseQuote.targetCurrency}</dd></div>
                      <div><dt className="text-[var(--sr-ink)]/50">Wise fee summary</dt><dd className="font-semibold">{canShowFee ? formatMajor(option.feeAmount!, option.feeCurrency) : "Not provided"}</dd></div>
                      <div><dt className="text-[var(--sr-ink)]/50">Total pricing</dt><dd className="font-semibold">{canShowPriceTotal ? formatMajor(option.priceTotal!, priceCurrency) : "Not provided"}</dd></div>
                      <div><dt className="text-[var(--sr-ink)]/50">Estimated delivery</dt><dd className="font-semibold">{option.formattedEstimatedDelivery ?? (option.estimatedDelivery ? new Date(option.estimatedDelivery).toLocaleString() : "Not provided")}</dd></div>
                    </dl>
                    <p className="mt-3 text-[10px] leading-relaxed text-[var(--sr-ink)]/50">
                      Checked {new Date(wiseQuote.checkedAt).toLocaleString()}. This display quote has no locked rate and no transfer ID. Recipient-bank or intermediary deductions may differ; confirm them before comparing or paying.
                    </p>
                    <a className="mt-1 inline-block text-[10px] font-medium text-[var(--sr-pine)] underline" href={wiseQuote.sourceUrl} target="_blank" rel="noreferrer">Wise quote documentation</a>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-3">
              {quotes.map((quote, index) => (
            <fieldset key={index} className="grid gap-2 rounded-xl border border-[var(--sr-line)] p-3 sm:grid-cols-2 lg:grid-cols-4">
              <legend className="px-1 text-xs font-bold text-[var(--sr-ink)]/65">Provider quote {index + 1}</legend>
              <label className={labelClass}>Provider name<input className={inputClass} maxLength={80} value={quote.provider} onChange={(event) => updateQuote(index, "provider", event.target.value)} placeholder="Provider or bank" /></label>
              <label className={labelClass}>Rate (receive currency per 1 {sendCurrency})<input className={inputClass} type="number" min="0.00000001" step="any" value={quote.exchangeRate} onChange={(event) => updateQuote(index, "exchangeRate", event.target.value)} placeholder="e.g. 0.0067" /></label>
              <label className={labelClass}>Sender fee ({sendCurrency})<input className={inputClass} type="number" min="0" step="any" value={quote.senderFee} onChange={(event) => updateQuote(index, "senderFee", event.target.value)} placeholder="Enter 0 if none" /></label>
              <label className={labelClass}>How provider charges this fee<select className={inputClass} value={quote.feeTreatment} onChange={(event) => updateQuote(index, "feeTreatment", event.target.value as QuoteDraft["feeTreatment"])}><option value="">Choose fee handling</option><option value="deducted">Deducts it from the transfer</option><option value="added">Charges it on top</option></select></label>
              <label className={labelClass}>Recipient / intermediary charges ({receiveCurrency})<input className={inputClass} type="number" min="0" step="any" value={quote.recipientFee} onChange={(event) => updateQuote(index, "recipientFee", event.target.value)} placeholder="Enter 0 if none" /></label>
              <label className={labelClass}>Earliest delivery (days)<input className={inputClass} type="number" min="0" max="60" step="1" value={quote.deliveryDaysMin} onChange={(event) => updateQuote(index, "deliveryDaysMin", event.target.value)} /></label>
              <label className={labelClass}>Latest delivery (days)<input className={inputClass} type="number" min="0" max="60" step="1" value={quote.deliveryDaysMax} onChange={(event) => updateQuote(index, "deliveryDaysMax", event.target.value)} /></label>
              <label className={labelClass}>When did you check this quote?<input className={inputClass} type="datetime-local" value={quote.quoteCheckedAt} onChange={(event) => updateQuote(index, "quoteCheckedAt", event.target.value)} /></label>
              <div className="grid grid-cols-2 gap-2">
                <label className={labelClass}>Minimum principal ({sendCurrency})<input className={inputClass} type="number" min="0" step="any" value={quote.minimumSend} onChange={(event) => updateQuote(index, "minimumSend", event.target.value)} placeholder="Optional" /></label>
                <label className={labelClass}>Maximum principal ({sendCurrency})<input className={inputClass} type="number" min="0" step="any" value={quote.maximumSend} onChange={(event) => updateQuote(index, "maximumSend", event.target.value)} placeholder="Optional" /></label>
              </div>
              {quotes.length > 1 && (
                <button type="button" className="justify-self-start self-end rounded-lg px-2 py-2 text-xs font-semibold text-[var(--sr-clay)] hover:bg-[var(--sr-clay)]/10" onClick={() => { setQuotes((current) => current.filter((_, i) => i !== index)); setComparison(null); }}>
                  Remove quote
                </button>
              )}
            </fieldset>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {quotes.length < 6 && (
            <button type="button" className="rounded-lg border border-[var(--sr-line)] px-3 py-2 text-xs font-semibold text-[var(--sr-ink)]/70 hover:bg-[var(--sr-mist)]" onClick={() => { setQuotes((current) => [...current, blankQuote()]); setComparison(null); }}>
              Add another provider
            </button>
          )}
          <button type="submit" className="rounded-lg bg-[var(--sr-pine)] px-3 py-2 text-xs font-semibold text-white hover:bg-[var(--sr-pine)]/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sr-pine)]">
            Compare entered quotes
          </button>
        </div>
      </form>

      {error && <p role="alert" className="mt-3 rounded-lg bg-[var(--sr-clay)]/10 p-2.5 text-xs text-[var(--sr-clay)]">{error}</p>}
      {comparison && (
        <div className="mt-4" aria-live="polite">
          <p className="text-xs font-semibold text-[var(--sr-ink)]/65">
            {comparison.ranked.length
              ? `Ranked ${comparison.ranked.length} quote(s)${comparison.deadlineIso ? ` that meet ${displayDate(comparison.deadlineIso)}` : ""}. Entered quote details are not independently verified.`
              : "No quote met all fee, limit, and deadline checks. Review excluded options below."}
          </p>
          <ol className="mt-2 space-y-2">
            {comparison.ranked.map((option, index) => (
              <li key={`${option.provider}-${index}`} className={`rounded-xl border p-3 ${index === 0 ? "border-[var(--sr-pine)]/50 bg-[var(--sr-pine)]/5" : "border-[var(--sr-line)] bg-white/60"}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-bold text-[var(--sr-ink)]">{index + 1}. {option.provider}{index === 0 ? " · best for selected ranking" : ""}</p>
                  <span className="text-[11px] text-[var(--sr-ink)]/50">Checked: {new Date(option.quoteCheckedAt).toLocaleString()}</span>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-xs sm:grid-cols-4">
                  <div><dt className="text-[var(--sr-ink)]/50">Recipient gets</dt><dd className="font-semibold">{option.receivedMinor == null ? "Unknown" : formatMinor(option.receivedMinor, comparison.receiveCurrency)}</dd></div>
                  <div><dt className="text-[var(--sr-ink)]/50">Sender total outlay</dt><dd className="font-semibold">{option.totalCostMinor == null ? "Unknown" : formatMinor(option.totalCostMinor, comparison.sendCurrency)}</dd></div>
                  <div><dt className="text-[var(--sr-ink)]/50">Quoted rate</dt><dd className="font-semibold">1 {comparison.sendCurrency} = {option.exchangeRate} {comparison.receiveCurrency}</dd></div>
                  <div><dt className="text-[var(--sr-ink)]/50">Arrival window</dt><dd className="font-semibold">{displayDate(option.arrivalEarliest)} – {displayDate(option.arrivalLatest)}</dd></div>
                  <div><dt className="text-[var(--sr-ink)]/50">Sender fee</dt><dd>{option.senderFeeMinor == null ? "Unknown" : formatMinor(option.senderFeeMinor, comparison.sendCurrency)}</dd></div>
                  <div><dt className="text-[var(--sr-ink)]/50">Fee handling</dt><dd>{option.feeTreatment === "added" ? "Charged on top" : "Deducted from transfer"}</dd></div>
                  <div><dt className="text-[var(--sr-ink)]/50">Recipient charges</dt><dd>{option.recipientFeeMinor == null ? "Unknown" : formatMinor(option.recipientFeeMinor, comparison.receiveCurrency)}</dd></div>
                  {option.spreadBasisPoints != null && <div><dt className="text-[var(--sr-ink)]/50">Rate spread vs entered mid-market</dt><dd>{(option.spreadBasisPoints / 100).toFixed(2)}%</dd></div>}
                </dl>
                {option.spreadBasisPoints != null && <p className="mt-2 text-[10px] text-[var(--sr-ink)]/50">The rate spread is compared with the mid-market value you entered; it does not include fees.</p>}
              </li>
            ))}
          </ol>
          {comparison.excluded.length > 0 && (
            <details className="mt-3 rounded-xl border border-[var(--sr-line)] p-3">
              <summary className="cursor-pointer text-xs font-semibold text-[var(--sr-ink)]/70">Excluded quotes ({comparison.excluded.length})</summary>
              <ul className="mt-2 space-y-2 text-xs text-[var(--sr-ink)]/65">
                {comparison.excluded.map((option, index) => <li key={`${option.provider}-${index}`}><strong>{option.provider}:</strong> {option.exclusionReason}</li>)}
              </ul>
            </details>
          )}
          <p className="mt-3 text-[10px] leading-relaxed text-[var(--sr-ink)]/45">
            Recipient estimates subtract the entered sender and recipient fees from the provider&apos;s quote arithmetic. Confirm the exact send amount, all charges, rate validity, and delivery with the provider before transferring.
          </p>
        </div>
      )}
    </section>
  );
}
