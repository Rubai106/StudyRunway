"use client";

import { useEffect, useMemo, useState } from "react";
import { BriefcaseBusiness, CircleAlert, TrendingDown } from "lucide-react";
import { CURRENCIES, getCurrency } from "@/lib/currency";
import { toMajor, toMinor } from "@/lib/money";
import { localDateToday } from "@/lib/feeAlerts";
import { formatMinorMoney } from "../results/shared";

interface Amounts {
  cash: number;
  paycheck: number;
  rent: number;
  tuition: number;
}

interface TimelineEvent {
  date: string;
  label: string;
  kind: "income" | "bill";
  amount: number;
  balance: number;
}

interface Timeline {
  events: TimelineEvent[];
  firstGap: { date: string; label: string; amount: number } | null;
  lowestBalance: number;
}

function parseAmount(value: string, currency: string): number | null {
  if (!currency || !/^\d+(\.\d+)?$/.test(value.trim())) return null;
  try {
    const fraction = value.trim().split(".")[1] ?? "";
    if (fraction.length > getCurrency(currency).minorUnits) return null;
    const amount = toMinor(Number(value), currency);
    return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
  } catch {
    return null;
  }
}

function plusDays(date: string, days: number): string {
  const next = new Date(date + "T00:00:00Z");
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function timeline(
  amounts: Amounts,
  dates: { paycheck: string; rent: string; tuition: string },
  delayDays: number,
  reductionPercent: number,
): Timeline {
  const reducedPay = Math.round(amounts.paycheck * (100 - reductionPercent) / 100);
  const eventInputs: Omit<TimelineEvent, "balance">[] = [
    { date: dates.rent, label: "Rent", kind: "bill", amount: amounts.rent },
    { date: dates.tuition, label: "Tuition", kind: "bill", amount: amounts.tuition },
    { date: plusDays(dates.paycheck, delayDays), label: "Expected work pay · unconfirmed", kind: "income", amount: reducedPay },
  ];
  const events = eventInputs.filter((event) => event.amount > 0).sort((a, b) => {
      const dateOrder = a.date.localeCompare(b.date);
      if (dateOrder !== 0) return dateOrder;
      const kindOrder = (a.kind === "bill" ? 0 : 1) - (b.kind === "bill" ? 0 : 1);
      return kindOrder || a.label.localeCompare(b.label);
    });

  let balance = amounts.cash;
  let lowestBalance = balance;
  let firstGap: Timeline["firstGap"] = null;
  const rows = events.map((event): TimelineEvent => {
    balance += event.kind === "income" ? event.amount : -event.amount;
    lowestBalance = Math.min(lowestBalance, balance);
    if (event.kind === "bill" && balance < 0 && firstGap === null) {
      firstGap = { date: event.date, label: event.label, amount: Math.abs(balance) };
    }
    return { ...event, balance };
  });
  return { events: rows, firstGap, lowestBalance };
}

function amountLabel(amountMinor: number, currency: string): string {
  return toMajor(amountMinor, currency).toFixed(getCurrency(currency).minorUnits) + " " + currency;
}

function TimelineCard({ title, forecast, currency }: { title: string; forecast: Timeline; currency: string }) {
  return (
    <div className="rounded-xl border border-[var(--sr-line)] bg-white/75 p-4">
      <h4 className="text-sm font-bold">{title}</h4>
      <p className={"mt-2 rounded-lg px-3 py-2 text-xs font-semibold " + (forecast.firstGap ? "bg-[var(--sr-clay)]/5 text-[var(--sr-clay)]" : "bg-[var(--sr-pine)]/5 text-[var(--sr-pine)]")}>
        {forecast.firstGap
          ? "First projected shortfall: " + formatMinorMoney(forecast.firstGap.amount, currency) + " at " + forecast.firstGap.label.toLowerCase() + " on " + forecast.firstGap.date + "."
          : "No shortfall at the entered bills in this scenario. Other expenses are not included."}
      </p>
      <ol className="mt-3 space-y-2">
        {forecast.events.map((event, index) => (
          <li key={event.date + event.label + index} className="flex items-start justify-between gap-3 text-xs">
            <span className="min-w-0 text-[var(--sr-ink)]/70">
              <strong className="font-semibold text-[var(--sr-ink)]">{event.date}</strong> · {event.label}<br />
              <span>{event.kind === "income" ? "+" : "−"}{formatMinorMoney(event.amount, currency)}</span>
            </span>
            <span className={"shrink-0 text-right font-semibold tabular-nums " + (event.balance < 0 ? "text-[var(--sr-clay)]" : "text-[var(--sr-ink)]")}>
              {formatMinorMoney(event.balance, currency)}<br /><span className="text-[10px] font-normal text-[var(--sr-ink)]/50">after event</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-3 border-t border-[var(--sr-line)] pt-2 text-[11px] text-[var(--sr-ink)]/55">
        Lowest projected balance: {formatMinorMoney(forecast.lowestBalance, currency)}
      </p>
    </div>
  );
}

export default function IncomeShockPlan({ onAsk, disabled = false }: { onAsk: (prompt: string) => void; disabled?: boolean }) {
  const [today, setToday] = useState("");
  const [country, setCountry] = useState("");
  const [currency, setCurrency] = useState("");
  const [cash, setCash] = useState("");
  const [paycheck, setPaycheck] = useState("");
  const [rent, setRent] = useState("");
  const [tuition, setTuition] = useState("");
  const [payDate, setPayDate] = useState("");
  const [rentDate, setRentDate] = useState("");
  const [tuitionDate, setTuitionDate] = useState("");
  const [delayDays, setDelayDays] = useState(14);
  const [reductionPercent, setReductionPercent] = useState(25);

  useEffect(() => setToday(localDateToday()), []);

  const parsed = useMemo(() => {
    if (!currency) return null;
    const cashMinor = parseAmount(cash, currency);
    const paycheckMinor = parseAmount(paycheck, currency);
    const rentMinor = parseAmount(rent, currency);
    const tuitionMinor = parseAmount(tuition, currency);
    if ([cashMinor, paycheckMinor, rentMinor, tuitionMinor].some((amount) => amount === null)) return null;
    if (rentMinor === 0 && tuitionMinor === 0) return null;
    const dates = [payDate, rentDate, tuitionDate];
    if (!today || dates.some((date) => !date || date < today)) return null;
    return {
      amounts: { cash: cashMinor as number, paycheck: paycheckMinor as number, rent: rentMinor as number, tuition: tuitionMinor as number },
      dates: { paycheck: payDate, rent: rentDate, tuition: tuitionDate },
    };
  }, [currency, cash, paycheck, rent, tuition, today, payDate, rentDate, tuitionDate]);

  const baseline = useMemo(() => parsed ? timeline(parsed.amounts, parsed.dates, 0, 0) : null, [parsed]);
  const stressed = useMemo(() => parsed ? timeline(parsed.amounts, parsed.dates, delayDays, reductionPercent) : null, [parsed, delayDays, reductionPercent]);

  const factLines = () => {
    if (!parsed || !currency || !today) return "";
    const amount = parsed.amounts;
    const dates = parsed.dates;
    return [
      "Planning currency is " + currency + ". As of " + today + ".",
      "Cash currently available: " + amountLabel(amount.cash, currency) + " is in hand as of " + today + ".",
      "Estimated work income of " + amountLabel(amount.paycheck, currency) + " is expected on " + dates.paycheck + ".",
      amount.rent > 0 ? "Committed rent bill of " + amountLabel(amount.rent, currency) + " is due on " + dates.rent + "." : "",
      amount.tuition > 0 ? "Committed tuition bill of " + amountLabel(amount.tuition, currency) + " is due on " + dates.tuition + "." : "",
      "Income stress scenario: delay the work paycheck by " + delayDays + " days and reduce the work paycheck amount by " + reductionPercent + "%.",
      country.trim() ? "Country: " + country.trim() + "." : "",
    ].filter(Boolean).join("\n");
  };

  const askRecoveryPlan = () => onAsk([
    "Use the explicit dated facts below to simulate the late/reduced work-income scenario with the deterministic financial tools, then give prioritized recovery steps. Keep projected income separate from cash in hand. Do not assume employer, university, landlord, or aid approval. Include only the rent and tuition bills listed; state that other expenses are excluded. If a country is supplied, use current official sources for relevant wage-payment or student-support rules; do not give unsupported legal conclusions. Never suggest exceeding student visa work limits.",
    factLines(),
  ].filter(Boolean).join("\n\n"));

  const askEmployerDraft = () => onAsk([
    "Prepare an email draft for me to review to my employer about a late or insufficient paycheck. Use the confirmed facts below, ask for the payment status and expected pay date, and do not make legal claims or invent details. Ask me for the recipient email and any missing information, then pause for approval before creating the draft. Never send the message.",
    factLines(),
  ].filter(Boolean).join("\n\n"));

  const amountFields = [
    { id: "income-cash", label: "Cash available now", value: cash, set: setCash },
    { id: "income-paycheck", label: "Next expected work paycheck", value: paycheck, set: setPaycheck },
    { id: "income-rent", label: "Rent due", value: rent, set: setRent },
    { id: "income-tuition", label: "Tuition due", value: tuition, set: setTuition },
  ];

  return (
    <section className="mt-5 overflow-hidden rounded-2xl border border-[var(--sr-line)] bg-white/70" aria-labelledby="income-shock-title">
      <div className="border-b border-[var(--sr-line)]/80 bg-[var(--sr-mist)]/45 p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <BriefcaseBusiness size={18} className="mt-0.5 shrink-0 text-[var(--sr-pine)]" aria-hidden="true" />
          <div>
            <p className="text-xs font-semibold text-[var(--sr-pine)]">Paycheck changes · rent · tuition</p>
            <h3 id="income-shock-title" className="mt-1 text-lg font-bold">Income Shock Plan</h3>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-[var(--sr-ink)]/65">
              Compare the expected paycheck with a delayed and reduced-pay scenario against your rent and tuition dates. Expected wages stay labeled as uncertain; they are not cash on hand.
            </p>
          </div>
        </div>
      </div>

      <div className="p-5 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs font-medium text-[var(--sr-ink)]/70">
            Destination country (optional)
            <input value={country} onChange={(event) => setCountry(event.target.value.slice(0, 100))} maxLength={100} placeholder="e.g. Australia" className="mt-1 block w-full rounded-lg border border-[var(--sr-line)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--sr-pine)]" />
          </label>
          <label className="text-xs font-medium text-[var(--sr-ink)]/70">
            Currency for all amounts
            <select value={currency} onChange={(event) => setCurrency(event.target.value)} className="mt-1 block w-full rounded-lg border border-[var(--sr-line)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--sr-pine)]">
              <option value="">Choose currency</option>
              {CURRENCIES.map((item) => <option key={item.code} value={item.code}>{item.code} · {item.name}</option>)}
            </select>
          </label>
          {amountFields.map((field) => (
            <label key={field.id} htmlFor={field.id} className="text-xs font-medium text-[var(--sr-ink)]/70">
              {field.label} ({currency || "currency"})
              <input id={field.id} type="number" min="0" step={currency ? 10 ** -getCurrency(currency).minorUnits : "0.01"} inputMode="decimal" value={field.value} onChange={(event) => field.set(event.target.value)} placeholder="0" className="mt-1 block w-full rounded-lg border border-[var(--sr-line)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--sr-pine)]" />
            </label>
          ))}
          <label className="text-xs font-medium text-[var(--sr-ink)]/70">
            Expected pay date
            <input type="date" min={today || undefined} value={payDate} onChange={(event) => setPayDate(event.target.value)} className="mt-1 block w-full rounded-lg border border-[var(--sr-line)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--sr-pine)]" />
          </label>
          <label className="text-xs font-medium text-[var(--sr-ink)]/70">
            Rent due date
            <input type="date" min={today || undefined} value={rentDate} onChange={(event) => setRentDate(event.target.value)} className="mt-1 block w-full rounded-lg border border-[var(--sr-line)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--sr-pine)]" />
          </label>
          <label className="text-xs font-medium text-[var(--sr-ink)]/70">
            Tuition due date
            <input type="date" min={today || undefined} value={tuitionDate} onChange={(event) => setTuitionDate(event.target.value)} className="mt-1 block w-full rounded-lg border border-[var(--sr-line)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--sr-pine)]" />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-4 rounded-xl bg-[var(--sr-mist)]/45 p-4">
          <div className="flex items-center gap-2 text-xs font-bold text-[var(--sr-ink)]/75"><TrendingDown size={15} aria-hidden="true" />What-if assumptions · editable, not a prediction</div>
          <label className="text-xs font-medium text-[var(--sr-ink)]/70">
            Pay delay
            <select value={delayDays} onChange={(event) => setDelayDays(Number(event.target.value))} className="ml-2 rounded-lg border border-[var(--sr-line)] bg-white px-2.5 py-1.5 text-xs">
              {[0, 7, 14, 30].map((days) => <option key={days} value={days}>{days} days</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-[var(--sr-ink)]/70">
            Pay reduction
            <select value={reductionPercent} onChange={(event) => setReductionPercent(Number(event.target.value))} className="ml-2 rounded-lg border border-[var(--sr-line)] bg-white px-2.5 py-1.5 text-xs">
              {[0, 25, 50, 75, 100].map((percent) => <option key={percent} value={percent}>{percent}%</option>)}
            </select>
          </label>
        </div>

        {baseline && stressed && currency ? (
          <>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <TimelineCard title="Expected schedule · paycheck not guaranteed" forecast={baseline} currency={currency} />
              <TimelineCard title={"Stress case · " + delayDays + " day(s) late, " + reductionPercent + "% less pay"} forecast={stressed} currency={currency} />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={askRecoveryPlan} disabled={disabled} className="rounded-lg bg-[var(--sr-pine)] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[var(--sr-pine)]/90 disabled:opacity-50">
                Get prioritized recovery steps
              </button>
              <button type="button" onClick={askEmployerDraft} disabled={disabled} className="rounded-lg border border-[var(--sr-line)] bg-white px-3 py-2 text-xs font-semibold text-[var(--sr-pine)] hover:bg-[var(--sr-mist)] disabled:opacity-50">
                Prepare employer pay follow-up draft
              </button>
            </div>
          </>
        ) : (
          <p className="mt-4 rounded-xl bg-[var(--sr-mist)]/45 px-4 py-3 text-xs leading-relaxed text-[var(--sr-ink)]/65">
            Choose one currency, enter cash, next expected pay, rent, and tuition amounts, then provide each date to compare the timelines. Set either bill to zero if it is not due; enter a nonzero amount for at least one bill.
          </p>
        )}

        <p className="mt-4 flex items-start gap-2 border-t border-[var(--sr-line)] pt-3 text-[11px] leading-relaxed text-[var(--sr-ink)]/50">
          <CircleAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          This projection includes only the entered cash, one expected paycheck, rent, and tuition. It excludes other bills and does not verify wages, employer obligations, immigration/work limits, or whether assistance will be approved. Same-day bills are counted before uncertain pay.
        </p>
      </div>
    </section>
  );
}
