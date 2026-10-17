"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { CalendarDays, CircleAlert, Plus, ReceiptText, Trash2 } from "lucide-react";
import { CURRENCIES, getCurrency } from "@/lib/currency";
import { toMinor, toMajor } from "@/lib/money";
import { DAILY_BUDGET_CHANGE_EVENT, DAILY_EXPENSE_CATEGORIES, createDailyExpense, emptyDailyBudget, loadDailyBudget, saveDailyBudget, type DailyBudgetState, type DailyExpense, type DailyExpenseCategory } from "@/lib/dailyBudget";
import { localDateToday } from "@/lib/feeAlerts";
import { formatMinorMoney } from "../results/shared";

function amountInputToMinor(value: string, currency: string): number | null {
  const normalized = value.trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  try {
    const fraction = normalized.split(".")[1] ?? "";
    if (fraction.length > getCurrency(currency).minorUnits) return null;
    const amount = Number(normalized);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    const minor = toMinor(amount, currency);
    return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
  } catch {
    return null;
  }
}

function localDateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function previousSevenDays(endDate: string): string[] {
  if (!endDate) return [];
  const end = new Date(`${endDate}T12:00:00`);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(end);
    date.setDate(end.getDate() - (6 - index));
    return localDateString(date);
  });
}

function dateLabel(date: string): string {
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? date
    : parsed.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function sumMinor(expenses: DailyExpense[]): number {
  return expenses.reduce((total, expense) => total + expense.amountMinor, 0);
}

function sortedExpenses(expenses: DailyExpense[]): DailyExpense[] {
  return [...expenses].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export default function DailyBudgetPlanner() {
  const [budget, setBudget] = useState<DailyBudgetState>(emptyDailyBudget);
  const [loaded, setLoaded] = useState(false);
  const [today, setToday] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [budgetCurrency, setBudgetCurrency] = useState("");
  const [limitInput, setLimitInput] = useState("");
  const [expenseCurrency, setExpenseCurrency] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [category, setCategory] = useState<DailyExpenseCategory>("Food");
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState("");
  const [storageError, setStorageError] = useState(false);
  const currentDayRef = useRef("");

  useEffect(() => {
    const refresh = () => {
      const current = loadDailyBudget();
      const date = localDateToday();
      currentDayRef.current = date;
      setBudget(current);
      setBudgetCurrency(current.currency ?? "");
      setLimitInput(current.dailyLimitMinor !== null && current.currency
        ? String(toMajor(current.dailyLimitMinor, current.currency))
        : "");
      setExpenseCurrency(current.currency ?? "");
      setToday(date);
      setSelectedDate((previous) => previous || date);
      setLoaded(true);
    };
    refresh();
    window.addEventListener(DAILY_BUDGET_CHANGE_EVENT, refresh);
    window.addEventListener("storage", refresh);
    const timer = window.setInterval(() => {
      const previousDate = currentDayRef.current;
      const date = localDateToday();
      currentDayRef.current = date;
      setToday(date);
      if (date !== previousDate) setSelectedDate((current) => current === previousDate ? date : current);
    }, 60_000);
    return () => {
      window.removeEventListener(DAILY_BUDGET_CHANGE_EVENT, refresh);
      window.removeEventListener("storage", refresh);
      window.clearInterval(timer);
    };
  }, []);

  const trackingCurrency = budget.currency ?? expenseCurrency;
  const dateExpenses = useMemo(
    () => sortedExpenses(budget.expenses.filter((expense) => expense.date === selectedDate)),
    [budget.expenses, selectedDate],
  );
  const trackedExpenses = useMemo(
    () => dateExpenses.filter((expense) => expense.currency === trackingCurrency),
    [dateExpenses, trackingCurrency],
  );
  const spentMinor = sumMinor(trackedExpenses);
  const dailyLimit = budget.currency !== null && budget.dailyLimitMinor !== null
    ? { amountMinor: budget.dailyLimitMinor, currency: budget.currency }
    : null;
  const remainingMinor = dailyLimit ? dailyLimit.amountMinor - spentMinor : null;
  const ratio = dailyLimit && dailyLimit.amountMinor > 0
    ? spentMinor / dailyLimit.amountMinor
    : 0;
  const weekDates = useMemo(() => previousSevenDays(selectedDate), [selectedDate]);
  const weeklyTotals = weekDates.map((date) => ({
    date,
    amountMinor: sumMinor(budget.expenses.filter((expense) => expense.date === date && expense.currency === trackingCurrency)),
  }));
  const largestDay = Math.max(1, ...weeklyTotals.map((day) => day.amountMinor));
  const categoryTotals = DAILY_EXPENSE_CATEGORIES
    .map((name) => ({
      name,
      amountMinor: sumMinor(trackedExpenses.filter((expense) => expense.category === name)),
    }))
    .filter((item) => item.amountMinor > 0)
    .sort((a, b) => b.amountMinor - a.amountMinor);
  const otherCurrencyEntries = dateExpenses.filter((expense) => trackingCurrency && expense.currency !== trackingCurrency).length;

  const persist = (next: DailyBudgetState) => {
    setBudget(next);
    setStorageError(!saveDailyBudget(next));
  };

  const saveLimit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError("");
    if (!budgetCurrency) {
      setFormError("Choose the currency you use for your day-to-day budget.");
      return;
    }
    const amountMinor = amountInputToMinor(limitInput, budgetCurrency);
    if (amountMinor === null) {
      setFormError(`Enter a positive daily limit with up to ${getCurrency(budgetCurrency).minorUnits} decimal places.`);
      return;
    }
    persist({ ...budget, currency: budgetCurrency, dailyLimitMinor: amountMinor });
    setExpenseCurrency(budgetCurrency);
  };

  const addExpense = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError("");
    if (!selectedDate || !today) {
      setFormError("Wait for today’s date to load, then try again.");
      return;
    }
    if (selectedDate > today) {
      setFormError("Choose today or an earlier date for a completed expense.");
      return;
    }
    if (!expenseCurrency) {
      setFormError("Choose the currency used for this expense.");
      return;
    }
    const amountMinor = amountInputToMinor(expenseAmount, expenseCurrency);
    if (amountMinor === null) {
      setFormError(`Enter a positive amount with up to ${getCurrency(expenseCurrency).minorUnits} decimal places.`);
      return;
    }
    try {
      const expense = createDailyExpense({
        date: selectedDate,
        amountMinor,
        currency: expenseCurrency,
        category,
        note: note.trim(),
      });
      persist({ ...budget, expenses: [...budget.expenses, expense] });
      setExpenseAmount("");
      setNote("");
    } catch {
      setFormError("That entry could not be saved. Check the amount and try again.");
    }
  };

  const removeExpense = (id: string) => {
    persist({ ...budget, expenses: budget.expenses.filter((expense) => expense.id !== id) });
  };

  const dayName = selectedDate === today ? "Today" : dateLabel(selectedDate);
  const progressValue = dailyLimit ? Math.min(spentMinor, dailyLimit.amountMinor) : 0;
  const progressLabel = !dailyLimit
    ? "Set a daily limit to track how much remains."
    : remainingMinor !== null && remainingMinor >= 0
      ? `${formatMinorMoney(remainingMinor, dailyLimit.currency)} left for ${dayName.toLowerCase()}.`
      : `${formatMinorMoney(Math.abs(remainingMinor ?? 0), dailyLimit.currency)} over the daily limit.`;

  return (
    <section className="mt-5 overflow-hidden rounded-3xl border border-[var(--sr-line)] bg-white/70" aria-labelledby="daily-budget-title">
      <div className="border-b border-[var(--sr-line)]/80 px-5 py-5 sm:px-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <ReceiptText size={19} className="mt-0.5 shrink-0 text-[var(--sr-pine)]" aria-hidden="true" />
            <div>
              <p className="text-xs font-semibold text-[var(--sr-pine)]">Your everyday spending</p>
              <h3 id="daily-budget-title" className="mt-1 text-xl font-bold">Daily budget planner</h3>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[var(--sr-ink)]/60">
                Set a daily limit, log purchases, and see where the day’s money went. Entries are saved only in this browser.
              </p>
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs font-semibold text-[var(--sr-ink)]/70">
            <CalendarDays size={15} aria-hidden="true" />
            <span className="sr-only">Choose spending date</span>
            <input
              type="date"
              value={selectedDate}
              max={today || undefined}
              onChange={(event) => { setSelectedDate(event.target.value); setFormError(""); }}
              disabled={!loaded}
              className="rounded-lg border border-[var(--sr-line)] bg-white px-2.5 py-2 text-xs font-medium text-[var(--sr-ink)]"
            />
          </label>
        </div>
      </div>

      <div className="grid gap-4 p-5 sm:p-7 lg:grid-cols-[minmax(0,1.2fr)_minmax(260px,0.8fr)]">
        <div className="rounded-2xl bg-[var(--sr-mist)]/55 p-4 sm:p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-[var(--sr-ink)]/55">{dayName} · spent{trackingCurrency ? ` in ${trackingCurrency}` : ""}</p>
              <p className="mt-1 text-3xl font-bold tracking-tight tabular-nums">
                {trackingCurrency ? formatMinorMoney(spentMinor, trackingCurrency) : "Choose a currency"}
              </p>
            </div>
            <p className={`text-sm font-semibold ${remainingMinor !== null && remainingMinor < 0 ? "text-[var(--sr-clay)]" : "text-[var(--sr-pine)]"}`}>
              {budget.dailyLimitMinor !== null ? progressLabel : "No daily limit set"}
            </p>
          </div>
          {dailyLimit ? (
            <div className="mt-4">
              <div
                role="progressbar"
                aria-label={`Daily budget used: ${formatMinorMoney(spentMinor, dailyLimit.currency)} of ${formatMinorMoney(dailyLimit.amountMinor, dailyLimit.currency)}`}
                aria-valuemin={0}
                aria-valuemax={dailyLimit.amountMinor}
                aria-valuenow={progressValue}
                aria-valuetext={progressLabel}
                className="h-2.5 overflow-hidden rounded-full bg-white/80"
              >
                <div className={`h-full rounded-full transition-[width] ${ratio > 1 ? "bg-[var(--sr-clay)]" : "bg-[var(--sr-pine)]"}`} style={{ width: `${Math.min(ratio * 100, 100)}%` }} />
              </div>
              <p className="mt-2 text-xs text-[var(--sr-ink)]/60">
                {ratio > 1 ? `${Math.round((ratio - 1) * 100)}% above your limit` : `${Math.round(ratio * 100)}% of ${formatMinorMoney(dailyLimit.amountMinor, dailyLimit.currency)} used`}
              </p>
            </div>
          ) : (
            <p className="mt-4 text-xs leading-relaxed text-[var(--sr-ink)]/60">You can still record spending before setting a limit.</p>
          )}
        </div>

        <div className="rounded-2xl border border-[var(--sr-line)] bg-white/55 p-4 sm:p-5">
          <h4 className="text-sm font-bold">Set your daily limit</h4>
          <form onSubmit={saveLimit} className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <label className="min-w-0 text-[11px] font-medium text-[var(--sr-ink)]/65">
              Limit amount
              <input
                type="text"
                inputMode="decimal"
                value={limitInput}
                onChange={(event) => setLimitInput(event.target.value)}
                placeholder="e.g. 25.00"
                disabled={!loaded}
                className="mt-1 w-full rounded-lg border border-[var(--sr-line)] bg-white px-3 py-2 text-sm text-[var(--sr-ink)] placeholder:text-[var(--sr-ink)]/35"
              />
            </label>
            <label className="text-[11px] font-medium text-[var(--sr-ink)]/65">
              Currency
              <select
                value={budgetCurrency}
                onChange={(event) => setBudgetCurrency(event.target.value)}
                disabled={!loaded}
                className="mt-1 w-full rounded-lg border border-[var(--sr-line)] bg-white px-2.5 py-2 text-sm text-[var(--sr-ink)]"
              >
                <option value="">Choose</option>
                {CURRENCIES.map((currency) => <option key={currency.code} value={currency.code}>{currency.code}</option>)}
              </select>
            </label>
            <p className="col-span-2 text-[10px] text-[var(--sr-ink)]/50">Choose the currency you use for everyday costs. If you change it, the saved limit amount will use the new currency; past expenses keep their original currency.</p>
            <button type="submit" disabled={!loaded} className="col-span-2 rounded-lg bg-[var(--sr-pine)] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[var(--sr-pine)]/90 disabled:opacity-50">
              Save daily limit
            </button>
          </form>
        </div>

        <form onSubmit={addExpense} className="rounded-2xl border border-[var(--sr-line)] bg-white/55 p-4 sm:p-5 lg:col-span-2">
          <div className="flex items-center gap-2">
            <Plus size={16} className="text-[var(--sr-pine)]" aria-hidden="true" />
            <h4 className="text-sm font-bold">Log an expense</h4>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.2fr_1.5fr_auto] lg:items-end">
            <label className="text-[11px] font-medium text-[var(--sr-ink)]/65">
              Amount
              <input
                type="text"
                inputMode="decimal"
                value={expenseAmount}
                onChange={(event) => setExpenseAmount(event.target.value)}
                placeholder="e.g. 4.50"
                disabled={!loaded}
                className="mt-1 w-full rounded-lg border border-[var(--sr-line)] bg-white px-3 py-2 text-sm placeholder:text-[var(--sr-ink)]/35"
              />
            </label>
            <label className="text-[11px] font-medium text-[var(--sr-ink)]/65">
              Currency
              <select
                value={expenseCurrency}
                onChange={(event) => setExpenseCurrency(event.target.value)}
                disabled={!loaded}
                className="mt-1 w-full rounded-lg border border-[var(--sr-line)] bg-white px-2.5 py-2 text-sm"
              >
                <option value="">Choose</option>
                {CURRENCIES.map((currency) => <option key={currency.code} value={currency.code}>{currency.code}</option>)}
              </select>
            </label>
            <label className="text-[11px] font-medium text-[var(--sr-ink)]/65">
              Category
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value as DailyExpenseCategory)}
                disabled={!loaded}
                className="mt-1 w-full rounded-lg border border-[var(--sr-line)] bg-white px-2.5 py-2 text-sm"
              >
                {DAILY_EXPENSE_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label className="text-[11px] font-medium text-[var(--sr-ink)]/65">
              Note <span className="font-normal">(optional)</span>
              <input
                type="text"
                value={note}
                onChange={(event) => setNote(event.target.value.slice(0, 100))}
                maxLength={100}
                placeholder="e.g. campus lunch"
                disabled={!loaded}
                className="mt-1 w-full rounded-lg border border-[var(--sr-line)] bg-white px-3 py-2 text-sm placeholder:text-[var(--sr-ink)]/35"
              />
            </label>
            <button type="submit" disabled={!loaded || !selectedDate} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[var(--sr-ink)] px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-[var(--sr-ink)]/90 disabled:opacity-50">
              <Plus size={14} aria-hidden="true" /> Add expense
            </button>
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-[var(--sr-ink)]/50">Entries in another currency are kept as entered and are not converted into your daily total. Don’t add card numbers or account details to notes.</p>
          {formError && <p role="alert" className="mt-2 text-xs font-medium text-[var(--sr-clay)]">{formError}</p>}
        </form>

        <div className="min-w-0 rounded-2xl border border-[var(--sr-line)] bg-white/55 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="text-sm font-bold">{dayName}’s entries</h4>
              <p className="mt-0.5 text-[11px] text-[var(--sr-ink)]/55">{dateExpenses.length} recorded expense{dateExpenses.length === 1 ? "" : "s"}</p>
            </div>
            {selectedDate !== today && today && (
              <button type="button" onClick={() => { setSelectedDate(today); setFormError(""); }} className="rounded-lg border border-[var(--sr-line)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--sr-pine)] hover:bg-[var(--sr-mist)]/50">Back to today</button>
            )}
          </div>
          {dateExpenses.length > 0 ? (
            <ul className="mt-3 divide-y divide-[var(--sr-line)]/80">
              {dateExpenses.map((expense) => (
                <li key={expense.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-1 last:pb-1">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold">{expense.note || expense.category}</p>
                    <p className="mt-0.5 text-[10px] text-[var(--sr-ink)]/55">{expense.category}{trackingCurrency && expense.currency !== trackingCurrency ? ` · not included in ${trackingCurrency} total` : ""}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs font-bold tabular-nums">{formatMinorMoney(expense.amountMinor, expense.currency)}</span>
                    <button type="button" onClick={() => removeExpense(expense.id)} aria-label={`Delete ${expense.category} expense ${formatMinorMoney(expense.amountMinor, expense.currency)}`} className="rounded-md p-1.5 text-[var(--sr-ink)]/45 hover:bg-[var(--sr-clay)]/10 hover:text-[var(--sr-clay)]">
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-3 rounded-xl bg-[var(--sr-mist)]/45 px-3 py-4">
              <p className="text-xs font-medium">No spending logged for this date</p>
              <p className="mt-1 text-[11px] text-[var(--sr-ink)]/55">Add the first purchase above. You can also choose an earlier date.</p>
            </div>
          )}
        </div>

        <div className="min-w-0 rounded-2xl border border-[var(--sr-line)] bg-white/55 p-4 sm:p-5">
          <h4 className="text-sm font-bold">The last seven days</h4>
          <p className="mt-0.5 text-[11px] text-[var(--sr-ink)]/55">Spending in {trackingCurrency || "your selected currency"} through {dateLabel(selectedDate)}</p>
          {trackingCurrency ? (
            <div
              role="img"
              aria-label={`Daily spending over the last seven days in ${trackingCurrency}: ${weeklyTotals.map((day) => `${dateLabel(day.date)} ${formatMinorMoney(day.amountMinor, trackingCurrency)}`).join("; ")}`}
              className="mt-4 flex h-24 items-end justify-between gap-2"
            >
              {weeklyTotals.map((day) => {
                const height = day.amountMinor > 0 ? Math.max(6, (day.amountMinor / largestDay) * 58) : 3;
                return (
                  <div key={day.date} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1.5" title={`${dateLabel(day.date)}: ${formatMinorMoney(day.amountMinor, trackingCurrency)}`}>
                    <div className="flex h-[60px] w-full items-end justify-center">
                      <div className={`w-full max-w-7 rounded-t-md ${day.date === selectedDate ? "bg-[var(--sr-pine)]" : "bg-[var(--sr-pine)]/40"}`} style={{ height: `${height}px` }} />
                    </div>
                    <span className="text-[9px] text-[var(--sr-ink)]/55">{new Date(`${day.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short" })}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-3 text-xs text-[var(--sr-ink)]/55">Choose a currency when adding an expense to see a spending trend.</p>
          )}
          {categoryTotals.length > 0 && (
            <div className="mt-4 border-t border-[var(--sr-line)] pt-3">
              <h5 className="text-[11px] font-bold text-[var(--sr-ink)]/70">Where it went</h5>
              <ul className="mt-2 space-y-1.5">
                {categoryTotals.slice(0, 5).map((item) => (
                  <li key={item.name} className="flex justify-between gap-3 text-[11px]">
                    <span className="text-[var(--sr-ink)]/65">{item.name}</span>
                    <span className="font-semibold tabular-nums">{formatMinorMoney(item.amountMinor, trackingCurrency)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {otherCurrencyEntries > 0 && (
          <p className="lg:col-span-2 rounded-lg bg-[var(--sr-amber)]/5 px-3 py-2 text-[11px] leading-relaxed text-[var(--sr-ink)]/65">
            {otherCurrencyEntries} expense{otherCurrencyEntries === 1 ? " is" : "s are"} recorded in a different currency. The daily total and chart include only {trackingCurrency}; no exchange rate is assumed.
          </p>
        )}

        {storageError && (
          <p role="alert" className="lg:col-span-2 flex items-start gap-2 text-xs leading-relaxed text-[var(--sr-clay)]">
            <CircleAlert size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
            The browser could not save this update. It is visible until you leave or refresh this page, but may not be stored.
          </p>
        )}
      </div>
      <div className="border-t border-[var(--sr-line)]/80 px-5 py-3 text-[10px] leading-relaxed text-[var(--sr-ink)]/50 sm:px-7">
        Private to this browser profile. Entries are not synced across devices or sent to the AI agent. You can remove an entry with its delete button.
      </div>
    </section>
  );
}
