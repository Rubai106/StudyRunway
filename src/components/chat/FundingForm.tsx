"use client";

import { useMemo, useState, type FormEvent } from "react";
import { CURRENCIES } from "@/lib/currency";
import { FUNDING_FORM_CATEGORIES, FUNDING_FORM_FREQUENCIES, type FundingFormRequest } from "@/lib/fundingForm";

type Expense = FundingFormRequest["expenses"][number];
type Source = FundingFormRequest["fundingSources"][number];
type AnalysisUpdate = { status: "ready"; text: string; provider: string; model: string } | { status: "unavailable"; error: string };
type Props = { disabled?: boolean; onResult: (result: { summary: string; data: Record<string, unknown> }) => void; onAnalysis?: (update: AnalysisUpdate) => void };

const currencyOptions = CURRENCIES.map((item) => item.code);
const expenseLabels: Record<(typeof FUNDING_FORM_CATEGORIES)[number], string> = { tuition: "Tuition", accommodation: "Accommodation", living: "Living expenses", insurance: "Insurance", travel: "Travel", other: "Other" };
const frequencyLabels: Record<(typeof FUNDING_FORM_FREQUENCIES)[number], string> = { one_time: "One-time", monthly: "Monthly", semester: "Every semester", annual: "Annual" };
const sourceKinds = [{ value: "savings", label: "Personal savings" }, { value: "scholarship", label: "Scholarship or grant" }, { value: "family", label: "Family support" }, { value: "loan", label: "Education loan" }, { value: "other", label: "Other funding" }] as const;
const statuses = [{ value: "confirmed_available", label: "Confirmed — available now" }, { value: "confirmed_pending", label: "Confirmed — available later" }, { value: "conditional", label: "Conditional" }, { value: "estimated", label: "Expected / estimated" }, { value: "unverified", label: "Unverified" }] as const;

function id(prefix: string) { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }
function newExpense(): Expense { return { id: id("expense"), label: "", category: "tuition", amount: 0, currency: "EUR", dueDate: null, frequency: "one_time", occurrences: null, notes: "" }; }
function newSource(): Source { return { id: id("source"), label: "", kind: "savings", amount: 0, currency: "EUR", status: "confirmed_available", availableDate: null, expectedDate: null, notes: "" }; }

export default function FundingForm({ disabled, onResult, onAnalysis }: Props) {
  const [open, setOpen] = useState(false);
  const [planningCurrency, setPlanningCurrency] = useState("EUR");
  const [asOfDate, setAsOfDate] = useState("");
  const [expenses, setExpenses] = useState<Expense[]>([newExpense()]);
  const [sources, setSources] = useState<Source[]>([newSource()]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [lastPayload, setLastPayload] = useState<FundingFormRequest | null>(null);
  const summary = useMemo(() => `${expenses.length} cost${expenses.length === 1 ? "" : "s"} · ${sources.length} funding source${sources.length === 1 ? "" : "s"}`, [expenses.length, sources.length]);

  const updateExpense = (index: number, patch: Partial<Expense>) => setExpenses((current) => current.map((item, i) => i === index ? { ...item, ...patch } : item));
  const updateSource = (index: number, patch: Partial<Source>) => setSources((current) => current.map((item, i) => i === index ? { ...item, ...patch } : item));

  const requestAnalysis = async (payload: FundingFormRequest) => {
    if (analysisLoading) return;
    setAnalysisLoading(true);
    setAnalysisError(null);
    try {
      const response = await fetch("/api/agent/funding-analysis", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json() as { ok?: boolean; error?: string; analysis?: string; provider?: string; model?: string };
      if (!response.ok || !body.ok || !body.analysis || !body.provider || !body.model) throw new Error(body.error ?? "AI financial analysis is temporarily unavailable.");
      onAnalysis?.({ status: "ready", text: body.analysis, provider: body.provider, model: body.model });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "AI financial analysis is temporarily unavailable.";
      setAnalysisError(message);
      onAnalysis?.({ status: "unavailable", error: message });
    } finally {
      setAnalysisLoading(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setAnalysisError(null);
    setSubmitted(false);
    setSubmitting(true);
    const payload: FundingFormRequest = { planningCurrency, asOfDate: asOfDate || null, expenses, fundingSources: sources };
    setLastPayload(payload);
    try {
      const response = await fetch("/api/agent/funding-check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json() as { ok?: boolean; error?: string; summary?: string; data?: Record<string, unknown> };
      if (!response.ok || !body.ok || !body.data) throw new Error(body.error ?? "The funding check could not be calculated.");
      onResult({ summary: body.summary ?? "Funding readiness calculated from your structured details.", data: body.data });
      setSubmitted(true);
      void requestAnalysis(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The funding check could not be calculated.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="border-t border-[var(--sr-line)] bg-[var(--sr-paper)]/95 px-3 py-2 sm:px-6" aria-label="Structured funding form">
      <div className="mx-auto max-w-3xl">
        <button type="button" onClick={() => setOpen((value) => !value)} disabled={disabled} aria-expanded={open} className="w-full rounded-xl border border-[var(--sr-line)] bg-white/80 px-3 py-2 text-left text-xs font-semibold text-[var(--sr-pine)] hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sr-pine)] disabled:opacity-50">
          <span>Enter funding details</span><span className="ml-2 font-normal text-[var(--sr-ink)]/55">{open ? "Hide form" : `${summary} · deterministic calculation`}</span>
        </button>
        {open && (
          <form onSubmit={submit} className="mt-3 rounded-2xl border border-[var(--sr-line)] bg-white p-3 shadow-[0_2px_12px_rgba(31,42,38,0.06)] sm:p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-medium">Planning currency<span className="text-[var(--sr-clay)]"> *</span><select value={planningCurrency} onChange={(e) => setPlanningCurrency(e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--sr-line)] bg-white px-2.5 py-2 text-sm">{currencyOptions.map((code) => <option key={code}>{code}</option>)}</select></label>
              <label className="text-xs font-medium">As-of date (optional)<input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--sr-line)] bg-white px-2.5 py-2 text-sm" /></label>
            </div>
            <fieldset className="mt-4"><legend className="text-sm font-semibold">Costs and payment obligations</legend><p className="mt-1 text-xs text-[var(--sr-ink)]/60">Use each cost&apos;s own currency and schedule. Missing dates remain incomplete.</p>
              <div className="mt-2 grid gap-3">{expenses.map((expense, index) => <div key={expense.id} className="rounded-xl border border-[var(--sr-line)] bg-[var(--sr-mist)]/30 p-3"><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <label className="text-xs">Name<span className="text-[var(--sr-clay)]"> *</span><input required value={expense.label} onChange={(e) => updateExpense(index, { label: e.target.value })} className="mt-1 w-full rounded-lg border border-[var(--sr-line)] bg-white px-2 py-1.5 text-sm" /></label>
                <label className="text-xs">Category<select value={expense.category} onChange={(e) => updateExpense(index, { category: e.target.value as Expense["category"] })} className="mt-1 w-full rounded-lg border border-[var(--sr-line)] bg-white px-2 py-1.5 text-sm">{FUNDING_FORM_CATEGORIES.map((value) => <option key={value} value={value}>{expenseLabels[value]}</option>)}</select></label>
                <label className="text-xs">Amount<span className="text-[var(--sr-clay)]"> *</span><input required min="0.01" step="any" type="number" value={expense.amount || ""} onChange={(e) => updateExpense(index, { amount: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-[var(--sr-line)] bg-white px-2 py-1.5 text-sm" /></label>
                <label className="text-xs">Currency<select value={expense.currency} onChange={(e) => updateExpense(index, { currency: e.target.value })} className="mt-1 w-full rounded-lg border border-[var(--sr-line)] bg-white px-2 py-1.5 text-sm">{currencyOptions.map((code) => <option key={code}>{code}</option>)}</select></label>
                <label className="text-xs">Frequency<select value={expense.frequency} onChange={(e) => updateExpense(index, { frequency: e.target.value as Expense["frequency"], occurrences: e.target.value === "one_time" ? null : expense.occurrences ?? 2 })} className="mt-1 w-full rounded-lg border border-[var(--sr-line)] bg-white px-2 py-1.5 text-sm">{FUNDING_FORM_FREQUENCIES.map((value) => <option key={value} value={value}>{frequencyLabels[value]}</option>)}</select></label>
                {expense.frequency !== "one_time" && <label className="text-xs">Payments<span className="text-[var(--sr-clay)]"> *</span><input required min="2" max="60" type="number" value={expense.occurrences ?? ""} onChange={(e) => updateExpense(index, { occurrences: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-[var(--sr-line)] bg-white px-2 py-1.5 text-sm" /></label>}
                <label className="text-xs">Payment deadline<input type="date" value={expense.dueDate ?? ""} onChange={(e) => updateExpense(index, { dueDate: e.target.value || null })} className="mt-1 w-full rounded-lg border border-[var(--sr-line)] bg-white px-2 py-1.5 text-sm" /></label>
                <label className="text-xs sm:col-span-2">Notes (optional)<input value={expense.notes} onChange={(e) => updateExpense(index, { notes: e.target.value })} className="mt-1 w-full rounded-lg border border-[var(--sr-line)] bg-white px-2 py-1.5 text-sm" /></label>
              </div><button type="button" onClick={() => setExpenses((current) => current.filter((_, i) => i !== index))} disabled={expenses.length === 1} className="mt-2 text-xs font-semibold text-[var(--sr-clay)] underline disabled:opacity-40">Remove cost</button></div>)}</div>
              <button type="button" onClick={() => setExpenses((current) => [...current, newExpense()])} className="mt-2 rounded-lg border border-[var(--sr-line)] px-3 py-1.5 text-xs font-semibold text-[var(--sr-pine)]">+ Add cost</button>
            </fieldset>
            <fieldset className="mt-5"><legend className="text-sm font-semibold">Funding sources</legend><p className="mt-1 text-xs text-[var(--sr-ink)]/60">Expected, conditional, estimated, and unverified funding is shown separately and never counted as cash in hand.</p>
              <div className="mt-2 grid gap-3">{sources.map((source, index) => <div key={source.id} className="rounded-xl border border-[var(--sr-line)] bg-[var(--sr-mist)]/30 p-3"><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <label className="text-xs">Name<span className="text-[var(--sr-clay)]"> *</span><input required value={source.label} onChange={(e) => updateSource(index, { label: e.target.value })} className="mt-1 w-full rounded-lg border border-[var(--sr-line)] bg-white px-2 py-1.5 text-sm" /></label>
                <label className="text-xs">Type<select value={source.kind} onChange={(e) => updateSource(index, { kind: e.target.value as Source["kind"] })} className="mt-1 w-full rounded-lg border border-[var(--sr-line)] bg-white px-2 py-1.5 text-sm">{sourceKinds.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
                <label className="text-xs">Amount<span className="text-[var(--sr-clay)]"> *</span><input required min="0.01" step="any" type="number" value={source.amount || ""} onChange={(e) => updateSource(index, { amount: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-[var(--sr-line)] bg-white px-2 py-1.5 text-sm" /></label>
                <label className="text-xs">Currency<select value={source.currency} onChange={(e) => updateSource(index, { currency: e.target.value })} className="mt-1 w-full rounded-lg border border-[var(--sr-line)] bg-white px-2 py-1.5 text-sm">{currencyOptions.map((code) => <option key={code}>{code}</option>)}</select></label>
                <label className="text-xs sm:col-span-2">Availability<select value={source.status} onChange={(e) => updateSource(index, { status: e.target.value as Source["status"] })} className="mt-1 w-full rounded-lg border border-[var(--sr-line)] bg-white px-2 py-1.5 text-sm">{statuses.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
                {source.status === "confirmed_available" ? <label className="text-xs">Available date<input type="date" value={source.availableDate ?? ""} onChange={(e) => updateSource(index, { availableDate: e.target.value || null })} className="mt-1 w-full rounded-lg border border-[var(--sr-line)] bg-white px-2 py-1.5 text-sm" /></label> : <label className="text-xs">Expected date<input type="date" value={source.expectedDate ?? ""} onChange={(e) => updateSource(index, { expectedDate: e.target.value || null })} className="mt-1 w-full rounded-lg border border-[var(--sr-line)] bg-white px-2 py-1.5 text-sm" /></label>}
                <label className="text-xs sm:col-span-2">Notes (optional)<input value={source.notes} onChange={(e) => updateSource(index, { notes: e.target.value })} className="mt-1 w-full rounded-lg border border-[var(--sr-line)] bg-white px-2 py-1.5 text-sm" /></label>
              </div><button type="button" onClick={() => setSources((current) => current.filter((_, i) => i !== index))} disabled={sources.length === 1} className="mt-2 text-xs font-semibold text-[var(--sr-clay)] underline disabled:opacity-40">Remove funding source</button></div>)}</div>
              <button type="button" onClick={() => setSources((current) => [...current, newSource()])} className="mt-2 rounded-lg border border-[var(--sr-line)] px-3 py-1.5 text-xs font-semibold text-[var(--sr-pine)]">+ Add funding source</button>
            </fieldset>
            {error && <p role="alert" className="mt-3 rounded-lg border border-[var(--sr-clay)]/30 bg-[var(--sr-clay)]/10 px-3 py-2 text-xs text-[var(--sr-clay)]">{error}</p>}
            {submitted && <p role="status" className="mt-3 text-xs text-[var(--sr-pine)]">Funding readiness calculated from the entries above. The deterministic result is authoritative.</p>}
            {analysisLoading && <p role="status" className="mt-2 text-xs text-[var(--sr-ink)]/60">Generating an explanation with hosted Google Gemini…</p>}
            {analysisError && <div role="alert" className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--sr-clay)]/30 bg-[var(--sr-clay)]/10 px-3 py-2 text-xs text-[var(--sr-clay)]"><span>AI explanation unavailable; your deterministic result is still shown.</span><button type="button" onClick={() => lastPayload && void requestAnalysis(lastPayload)} disabled={analysisLoading || !lastPayload} className="font-semibold underline">Retry explanation</button></div>}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2"><p className="text-[11px] text-[var(--sr-ink)]/55">No payment or transfer is performed by this form.</p><button type="submit" disabled={disabled || submitting || analysisLoading} className="rounded-xl bg-[var(--sr-pine)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{submitting ? "Calculating…" : "Calculate funding readiness"}</button></div>
          </form>
        )}
      </div>
    </section>
  );
}
