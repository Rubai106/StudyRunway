"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { CircleAlert, Plus, Trash2, Truck } from "lucide-react";
import { CURRENCIES, getCurrency } from "@/lib/currency";
import { toMinor } from "@/lib/money";
import {
  ARRIVAL_COST_BASES,
  ARRIVAL_COST_CATEGORIES,
  ARRIVAL_COSTS_CHANGE_EVENT,
  createArrivalCost,
  emptyArrivalCosts,
  loadArrivalCosts,
  saveArrivalCosts,
  type ArrivalCostBasis,
  type ArrivalCostCategory,
  type ArrivalCostState,
} from "@/lib/arrivalCosts";
import { formatMinorMoney } from "../results/shared";

function parseAmount(value: string, currency: string): number | null {
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

function dateLabel(value: string | null): string {
  if (!value) return "Date not set";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { dateStyle: "medium" });
}

export default function ArrivalCostPlanner({
  onAsk,
  disabled = false,
}: {
  onAsk: (prompt: string) => void;
  disabled?: boolean;
}) {
  const [state, setState] = useState<ArrivalCostState>(emptyArrivalCosts);
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState<ArrivalCostCategory>("Housing deposit");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [basis, setBasis] = useState<ArrivalCostBasis>("My estimate");
  const [sourceNote, setSourceNote] = useState("");
  const [error, setError] = useState("");
  const [storageError, setStorageError] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const refresh = () => setState(loadArrivalCosts());
    refresh();
    setLoaded(true);
    window.addEventListener(ARRIVAL_COSTS_CHANGE_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(ARRIVAL_COSTS_CHANGE_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const totals = useMemo(() => {
    const map = new Map<string, { planned: number | null; paid: number | null }>();
    for (const entry of state.entries) {
      const current = map.get(entry.currency) ?? { planned: 0, paid: 0 };
      const subtotal = current[entry.status];
      const nextSubtotal = subtotal === null ? null : subtotal + entry.amountMinor;
      current[entry.status] = Number.isSafeInteger(nextSubtotal) ? nextSubtotal : null;
      map.set(entry.currency, current);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [state.entries]);

  const persist = (next: ArrivalCostState) => {
    setState(next);
    setStorageError(!saveArrivalCosts(next));
  };

  const addEntry = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    if (state.entries.length >= 1_000) {
      setError("This browser has reached the 1,000-entry limit. Remove an old item before adding another.");
      return;
    }
    if (!currency) {
      setError("Choose the currency for this cost.");
      return;
    }
    const amountMinor = parseAmount(amount, currency);
    if (amountMinor === null) {
      setError(`Enter a positive amount with up to ${getCurrency(currency).minorUnits} decimal places.`);
      return;
    }
    try {
      const entry = createArrivalCost({
        label: label.trim(),
        category,
        amountMinor,
        currency,
        dueDate: dueDate || null,
        status: "planned",
        basis,
        sourceNote: sourceNote.trim(),
      });
      persist({ version: 1, entries: [...state.entries, entry] });
      setLabel("");
      setAmount("");
      setDueDate("");
      setSourceNote("");
      setBasis("My estimate");
    } catch {
      setError("That cost could not be saved. Check the details and try again.");
    }
  };

  const changeStatus = (id: string, status: "planned" | "paid") => {
    persist({ version: 1, entries: state.entries.map((entry) => entry.id === id ? { ...entry, status } : entry) });
  };

  const removeEntry = (id: string) => {
    persist({ version: 1, entries: state.entries.filter((entry) => entry.id !== id) });
  };

  const planned = state.entries.filter((entry) => entry.status === "planned");
  const inputClass = "mt-1 w-full rounded-lg border border-[var(--sr-line)] bg-white px-2.5 py-2 text-sm outline-none focus:border-[var(--sr-pine)] focus:ring-2 focus:ring-[var(--sr-pine)]/20";
  const labelClass = "block text-xs font-medium text-[var(--sr-ink)]/75";

  const sharePlannedCosts = () => {
    const details = planned.slice(0, 40).map((entry) => ({
      item: entry.label,
      category: entry.category,
      amount: formatMinorMoney(entry.amountMinor, entry.currency),
      currency: entry.currency,
      dueDate: entry.dueDate,
      basis: entry.basis,
      sourceNote: entry.sourceNote || undefined,
    }));
    onAsk(`Add these student arrival/setup costs to a separate, clearly labeled draft funding forecast. They are student-entered planned costs, not independently verified. Preserve each currency, date, and basis; do not convert currencies without an explicit dated FX rate. Do not change any existing plan unless I confirm. Ask for missing destination, available funds, or tuition dates as needed. Costs: ${JSON.stringify(details)}`);
  };

  return (
    <section className="mt-5 overflow-hidden rounded-3xl border border-[var(--sr-line)] bg-white/70" aria-labelledby="arrival-cost-title">
      <div className="border-b border-[var(--sr-line)]/80 px-5 py-5 sm:px-7">
        <div className="flex items-start gap-3">
          <Truck size={19} className="mt-0.5 shrink-0 text-[var(--sr-pine)]" aria-hidden="true" />
          <div>
            <p className="text-xs font-semibold text-[var(--sr-pine)]">Before classes begin</p>
            <h3 id="arrival-cost-title" className="mt-1 text-xl font-bold">Arrival &amp; emergency costs</h3>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[var(--sr-ink)]/60">Track one-time move-in and setup expenses separately from everyday spending. Add your estimates or quotes and note their source; StudyRunway does not verify entered prices or assume amounts.</p>
          </div>
        </div>
      </div>

      <div className="grid gap-5 p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.9fr)]">
        <form onSubmit={addEntry} className="space-y-3" aria-label="Add an arrival cost">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelClass}>Cost name
              <input className={inputClass} value={label} onChange={(event) => setLabel(event.target.value)} maxLength={100} required placeholder="e.g. bedding and kitchen items" />
            </label>
            <label className={labelClass}>Category
              <select className={inputClass} value={category} onChange={(event) => setCategory(event.target.value as ArrivalCostCategory)}>
                {ARRIVAL_COST_CATEGORIES.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label className={labelClass}>Amount
              <input className={inputClass} value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" required placeholder="0.00" />
            </label>
            <label className={labelClass}>Currency
              <select className={inputClass} value={currency} onChange={(event) => setCurrency(event.target.value)} required>
                <option value="">Choose currency</option>
                {CURRENCIES.map((item) => <option key={item.code} value={item.code}>{item.code} · {item.name}</option>)}
              </select>
            </label>
            <label className={labelClass}>Expected payment date
              <input className={inputClass} type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
            </label>
            <label className={labelClass}>Amount basis
              <select className={inputClass} value={basis} onChange={(event) => setBasis(event.target.value as ArrivalCostBasis)}>
                {ARRIVAL_COST_BASES.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
          </div>
          <label className={labelClass}>Source label or note (optional)
            <input className={inputClass} value={sourceNote} onChange={(event) => setSourceNote(event.target.value)} maxLength={220} placeholder="For example, university fee page or supplier quote date" />
          </label>
          {error && <p role="alert" className="text-xs text-[var(--sr-clay)]">{error}</p>}
          <button type="submit" disabled={!loaded} className="inline-flex items-center gap-2 rounded-lg bg-[var(--sr-pine)] px-3 py-2 text-xs font-semibold text-white hover:bg-[var(--sr-pine)]/90 disabled:opacity-50"><Plus size={14} aria-hidden="true" />Add planned cost</button>
        </form>

        <div>
          <h4 className="text-sm font-bold">Your totals</h4>
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--sr-ink)]/55">Planned and paid amounts stay separate by currency. Estimates are not confirmed bills.</p>
          {totals.length ? (
            <ul className="mt-3 space-y-2">
              {totals.map(([code, values]) => (
                <li key={code} className="grid grid-cols-2 gap-2 rounded-xl border border-[var(--sr-line)] bg-white/55 px-3 py-2 text-xs">
                  <p className="font-bold">{code}</p>
                  <p className="text-right font-semibold tabular-nums">Planned {values.planned === null ? "too large to total" : formatMinorMoney(values.planned, code)}</p>
                  <p className="col-span-2 text-right text-[10px] text-[var(--sr-ink)]/55">Paid {values.paid === null ? "too large to total" : formatMinorMoney(values.paid, code)}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 rounded-xl bg-[var(--sr-mist)]/45 px-3 py-3 text-xs text-[var(--sr-ink)]/60">No arrival costs recorded yet.</p>
          )}

          {state.entries.length > 0 && (
            <ul className="mt-3 max-h-64 divide-y divide-[var(--sr-line)] overflow-auto rounded-xl border border-[var(--sr-line)] bg-white/45" aria-label="Arrival cost entries">
              {[...state.entries].sort((a, b) => (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31")).map((entry) => (
                <li key={entry.id} className="flex items-start justify-between gap-2 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="break-words text-xs font-semibold">{entry.label}</p>
                    <p className="mt-0.5 text-[10px] text-[var(--sr-ink)]/55">{entry.category} · {dateLabel(entry.dueDate)} · {entry.basis}</p>
                    {entry.sourceNote && <p className="mt-0.5 break-words text-[10px] text-[var(--sr-ink)]/50">{entry.sourceNote}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <div className="text-right">
                      <p className="text-xs font-bold tabular-nums">{formatMinorMoney(entry.amountMinor, entry.currency)}</p>
                      <button type="button" onClick={() => changeStatus(entry.id, entry.status === "paid" ? "planned" : "paid")} className="text-[10px] font-semibold text-[var(--sr-pine)] underline underline-offset-2">{entry.status === "paid" ? "Mark planned" : "Mark paid"}</button>
                    </div>
                    <button type="button" onClick={() => removeEntry(entry.id)} aria-label={`Delete ${entry.label}`} className="rounded-md p-1.5 text-[var(--sr-ink)]/45 hover:bg-[var(--sr-clay)]/10 hover:text-[var(--sr-clay)]"><Trash2 size={13} aria-hidden="true" /></button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {planned.length > 0 && (
            <button type="button" onClick={sharePlannedCosts} disabled={disabled} className="mt-3 w-full rounded-lg border border-[var(--sr-line)] bg-white px-3 py-2 text-left text-xs font-semibold text-[var(--sr-pine)] hover:bg-[var(--sr-mist)] disabled:opacity-50">Compare planned costs with my funding plan</button>
          )}
          <button type="button" onClick={() => onAsk("Research official university or government information about student arrival costs, including one-time move-in and setup costs, in my destination. Ask for my destination country and city if they are missing. Separate one-time costs from recurring monthly costs; provide only claims tied to cited official pages, show when checked, and do not invent typical amounts or treat unofficial estimates as verified.")} disabled={disabled} className="mt-2 w-full rounded-lg px-3 py-2 text-left text-xs font-semibold text-[var(--sr-pine)] underline underline-offset-4 disabled:opacity-50">Find official cost sources for my destination</button>
        </div>
      </div>

      {(storageError) && <p role="alert" className="flex items-start gap-2 border-t border-[var(--sr-line)] px-5 py-3 text-xs text-[var(--sr-clay)] sm:px-7"><CircleAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" />Browser storage could not save this change.</p>}
      <p className="border-t border-[var(--sr-line)]/80 px-5 py-3 text-[10px] leading-relaxed text-[var(--sr-ink)]/50 sm:px-7">Saved in this browser only. Entries are not sent unless you choose “Compare planned costs with my funding plan”; that sends planned item names, amounts, currencies, dates, basis, and source notes. Marking an item paid excludes it from that share.</p>
    </section>
  );
}
