"use client";

/**
 * LivingCostPlan — interactive result card for build_living_cost_plan.
 *
 * Renders the deterministic LivingCostPlan: verdict, budget vs estimated
 * spending, category bars, low/typical/high scenarios, one-time costs,
 * sources, recommendations — and the visa requirement in a visually
 * separate, explicitly regulatory box ("what the visa office requires" vs
 * "what you'll spend").
 *
 * Interactive: accommodation and explicit monthly food/transport assumptions,
 * plus the student's monthly budget, re-run the REAL buildLivingCostPlan()
 * engine client-side. Lifestyle preferences without supported price splits are
 * not presented as quantified savings.
 *
 * "Apply to my financial plan" uses an approval-gate style confirmation,
 * converts via planToObligations(), writes into the task's working plan
 * through /api/agent/budget-apply, and re-runs the funding-gap forecast.
 * "Revert applied budget" removes exactly those obligations.
 */

import { useMemo, useState } from "react";
import {
  Disclosure,
  asArray,
  asNumber,
  asString,
  formatMoney,
  isRecord,
} from "./shared";
import {
  buildLivingCostPlan,
  planToObligations,
  type LivingCostPlan as Plan,
  type PlanCategoryLine,
  type PlanVerdict,
} from "@/lib/livingCosts";
import { convertMinor, toMajor, toMinor } from "@/lib/money";
import { BUDGET_ACTION_ACKS } from "@/lib/budgetApproval";

interface Props {
  data: Record<string, unknown>;
  /** Active chat session — required for apply/revert. */
  sessionId?: string;
}

type Scenario = "low" | "typical" | "high";

const SCENARIOS: { id: Scenario; label: string }[] = [
  { id: "low", label: "Low" },
  { id: "typical", label: "Typical" },
  { id: "high", label: "High" },
];


function planRecord(v: unknown): Plan | null {
  if (!isRecord(v)) return null;
  if (typeof v["destinationId"] !== "string") return null;
  if (!Array.isArray(v["categories"])) return null;
  return v as unknown as Plan;
}

function scenarioValue(line: PlanCategoryLine, s: Scenario): number {
  return s === "low"
    ? line.minMinor
    : s === "high"
      ? line.maxMinor
      : line.estimateMinor;
}

function isStale(checkedDate: string): boolean {
  const t = Date.parse(checkedDate);
  if (Number.isNaN(t)) return true;
  return Date.now() - t > 365 * 24 * 60 * 60 * 1000;
}

const VERDICT_COPY: Record<PlanVerdict, { title: string; tone: string }> = {
  insufficient_data: {
    title: "We can't build a reliable budget yet",
    tone: "border-[var(--sr-amber)]/40 bg-[var(--sr-amber)]/10",
  },
  shortfall: {
    title: "Shortfall — typical costs are above your budget",
    tone: "border-[var(--sr-clay)]/40 bg-[var(--sr-clay)]/10",
  },
  tight: {
    title: "Tight — workable, but with little headroom",
    tone: "border-[var(--sr-amber)]/40 bg-[var(--sr-amber)]/10",
  },
  within_budget: {
    title: "Within budget",
    tone: "border-[var(--sr-pine)]/40 bg-[var(--sr-pine)]/10",
  },
};

interface GapView {
  planningCurrency: string;
  hasGap: boolean;
  minBalance: string;
  minBalanceDate: string | null;
  gapDate: string | null;
  shortfall: string | null;
  incompleteCount: number;
}

function gapView(g: unknown): GapView | null {
  if (!isRecord(g)) return null;
  return {
    planningCurrency: asString(g["planningCurrency"]),
    hasGap: g["hasGap"] === true,
    minBalance: asString(g["minBalance"], "—"),
    minBalanceDate: asString(g["minBalanceDate"]) || null,
    gapDate: asString(g["gapDate"]) || null,
    shortfall: asString(g["shortfall"]) || null,
    incompleteCount: asNumber(g["incompleteCount"]) ?? 0,
  };
}

export default function LivingCostPlan({ data, sessionId }: Props) {
  const plan = planRecord(data["plan"]);
  const inputs = isRecord(data["inputs"]) ? data["inputs"] : null;
  const recommendations = asArray<Record<string, unknown>>(data["recommendations"]);
  const recommendationNotes = asArray<unknown>(data["recommendationNotes"]).map((n) =>
    asString(n),
  );
  const accommodationOptions = asArray<unknown>(data["accommodationOptions"])
    .map((o) => asString(o))
    .filter(Boolean);
  const demoMode = data["demoMode"] === true;

  // Snapshot the validated tool inputs once per result card; the adjusted
  // plan is derived from the control states below, not from data re-renders.
  const baseInputs = useMemo<Record<string, unknown> | null>(
    () => (inputs ? { ...inputs } : null),
    [],
  );

  const currency = plan?.currency ?? asString(data["currency"], "EUR");
  const budgetCurrency = asString(inputs?.["budgetCurrency"], currency);
  const planningCurrency = asString(data["planningCurrency"], currency);
  const currencyMismatch = currency !== planningCurrency;
  const fmt = (minor: number | null | undefined): string =>
    minor == null ? "—" : formatMoney(toMajor(minor, currency), currency);

  // --- interactive assumption controls -------------------------------------
  // Reflect the option the engine actually selected, rather than a shorthand
  // input such as "shared" that may not match an option label.
  const initialAcc =
    plan?.categories.find((line) => line.category === "rent")?.accommodationType ??
    accommodationOptions.find((option) => option === asString(inputs?.["accommodationType"])) ??
    "";
  const initialBudgetMajor = (() => {
    const minor = asNumber(inputs?.["monthlyBudgetMinor"]);
    return minor != null ? String(toMajor(minor, budgetCurrency)) : "";
  })();
  const originalOverrides = isRecord(inputs?.["categoryOverridesMinor"])
    ? inputs?.["categoryOverridesMinor"] as Record<string, unknown>
    : {};
  const foodKey = plan?.categories.some((line) => line.category === "groceries")
    ? "groceries"
    : "groceries_eating_out";
  const initialFoodMajor = (() => {
    const minor = asNumber(originalOverrides[foodKey]);
    return minor != null ? String(toMajor(minor, currency)) : "";
  })();
  const initialTransportMajor = (() => {
    const minor = asNumber(originalOverrides["local_transport"]);
    return minor != null ? String(toMajor(minor, currency)) : "";
  })();

  const [accType, setAccType] = useState(initialAcc);
  const [foodMajor, setFoodMajor] = useState(initialFoodMajor);
  const [transportMajor, setTransportMajor] = useState(initialTransportMajor);
  const [budgetMajor, setBudgetMajor] = useState(initialBudgetMajor);
  const [scenario, setScenario] = useState<Scenario>("typical");

  const adjusted = useMemo(() => {
    if (!plan || !baseInputs) return { plan: null as Plan | null, inputs: null as Record<string, unknown> | null, error: "No plan data." };
    try {
      const budgetText = budgetMajor.trim();
      if (budgetText === "") throw new Error("Enter a monthly budget to compare affordability.");
      const budgetNum = Number(budgetText);
      if (!Number.isFinite(budgetNum) || budgetNum < 0) {
        throw new Error("Enter a valid non-negative monthly budget.");
      }
      const overrides = isRecord(baseInputs["categoryOverridesMinor"])
        ? { ...(baseInputs["categoryOverridesMinor"] as Record<string, number>) }
        : {};
      if (foodMajor.trim() !== "") {
        const foodValue = Number(foodMajor);
        if (!Number.isFinite(foodValue) || foodValue < 0) throw new Error("Enter a valid non-negative monthly food amount.");
        overrides[foodKey] = toMinor(foodValue, currency);
      } else {
        delete overrides[foodKey];
      }
      if (transportMajor.trim() !== "") {
        const transportValue = Number(transportMajor);
        if (!Number.isFinite(transportValue) || transportValue < 0) throw new Error("Enter a valid non-negative monthly transport amount.");
        overrides["local_transport"] = toMinor(transportValue, currency);
      } else {
        delete overrides["local_transport"];
      }
      // The exact engine inputs that produced the adjusted plan — sent to
      // /api/agent/budget-apply as planInputs so the server can re-verify the
      // plan's integrity with a server-side recomputation.
      const adjustedInputs: Record<string, unknown> = {
        ...baseInputs,
        accommodationType: accType || undefined,
        categoryOverridesMinor: overrides,
        monthlyBudgetMinor:
          Number.isFinite(budgetNum) && budgetNum >= 0
            ? toMinor(budgetNum, budgetCurrency)
            : 0,
      };
      const next = buildLivingCostPlan(adjustedInputs);
      return { plan: next, inputs: adjustedInputs, error: null as string | null };
    } catch (err) {
      return {
        plan: null,
        inputs: null as Record<string, unknown> | null,
        error: err instanceof Error ? err.message : "Could not rebuild the plan.",
      };
    }
  }, [plan, baseInputs, accType, foodMajor, transportMajor, budgetMajor, budgetCurrency, foodKey, currency]);

  const isAdjusted = useMemo(() => {
    if (!baseInputs) return false;
    const selectedRent = plan?.categories.find((line) => line.category === "rent")?.accommodationType ?? "";
    // Compare against the original controls, not merely whether an override exists.
    // Otherwise a plan that already contains a user-entered override appears
    // modified immediately after opening the result card.
    return (
      accType !== initialAcc ||
      foodMajor.trim() !== initialFoodMajor.trim() ||
      transportMajor.trim() !== initialTransportMajor.trim() ||
      budgetMajor.trim() !== initialBudgetMajor.trim() ||
      accType !== selectedRent
    );
  }, [baseInputs, plan, accType, foodMajor, transportMajor, budgetMajor, budgetCurrency, initialAcc, initialFoodMajor, initialTransportMajor, initialBudgetMajor]);

  const resetControls = () => {
    setAccType(initialAcc);
    setFoodMajor(initialFoodMajor);
    setTransportMajor(initialTransportMajor);
    setBudgetMajor(initialBudgetMajor);
  };

  // --- apply / revert --------------------------------------------------------
  type ApplyPhase = "idle" | "confirm" | "working" | "done" | "error";
  const [applyPhase, setApplyPhase] = useState<ApplyPhase>("idle");
  const [startDate, setStartDate] = useState(
    asString(inputs?.["arrivalDate"]) || new Date().toISOString().slice(0, 10),
  );
  const [studyMonths, setStudyMonths] = useState(
    String(asNumber(inputs?.["studyMonths"]) ?? 12),
  );
  const [oneTimeDates, setOneTimeDates] = useState<Record<string, string>>({});
  const [tuitionDueDate, setTuitionDueDate] = useState("");
  const [fxRateToPlanning, setFxRateToPlanning] = useState("");
  const [fxRateDate, setFxRateDate] = useState("");
  const [fxRateSource, setFxRateSource] = useState("");
  const [applyResult, setApplyResult] = useState<Record<string, unknown> | null>(null);
  const [revertResult, setRevertResult] = useState<Record<string, unknown> | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);

  const activePlan = adjusted.plan ?? plan;
  // The inputs that produced activePlan: the adjusted inputs when the user
  // changed assumptions (the adjusted plan is the engine output for them),
  // otherwise the original tool inputs. Sent as planInputs on apply so the
  // server can re-verify the plan against a server-side recomputation.
  const activeInputs = adjusted.plan ? adjusted.inputs : baseInputs;

  const preview = useMemo(() => {
    if (!activePlan || applyPhase !== "confirm") return null;
    try {
      const months = Number(studyMonths);
      const rate = fxRateToPlanning.trim() === "" ? undefined : Number(fxRateToPlanning);
      if (rate != null && (!Number.isFinite(rate) || rate <= 0)) throw new Error("Enter a positive finite exchange rate.");
      const confirmedOneTimeDates = Object.fromEntries(
        Object.entries(oneTimeDates).filter(([, date]) => typeof date === "string" && date.trim() !== ""),
      );
      const conv = planToObligations(activePlan, {
        startDate,
        studyMonths: Number.isFinite(months) ? Math.round(months) : 12,
        oneTimeDueDates: confirmedOneTimeDates,
        ...(tuitionDueDate ? { tuitionDueDate } : {}),
      });
      const monthly = conv.obligations
        .filter((o) => o.recurring)
        .reduce((s, o) => s + (o.amountMinor ?? 0), 0);
      const conversionDetailsComplete =
        fxRateDate.trim() !== "" && fxRateSource.trim() !== "";
      const convertedMonthly = activePlan.currency === planningCurrency
        ? monthly
        : rate != null && conversionDetailsComplete
          ? convertMinor(monthly, activePlan.currency, planningCurrency, rate)
          : null;
      return {
        count: conv.obligations.length,
        monthly,
        convertedMonthly,
        currenciesDiffer: activePlan.currency !== planningCurrency,
        planningCurrency,
        tuitionNote: conv.tuitionNote,
        undatedOneTimeLabels: conv.undatedOneTimeLabels,
        tuitionDueDateMissing: conv.tuitionDueDateMissing,
        fxRateEntered: rate != null,
        error: null as string | null,
      };
    } catch (err) {
      return {
        count: 0,
        monthly: 0,
        convertedMonthly: null,
        currenciesDiffer: activePlan.currency !== planningCurrency,
        planningCurrency,
        tuitionNote: "",
        undatedOneTimeLabels: [],
        tuitionDueDateMissing: false,
        fxRateEntered: false,
        error: err instanceof Error ? err.message : "Cannot convert this plan.",
      };
    }
  }, [activePlan, applyPhase, startDate, studyMonths, oneTimeDates, tuitionDueDate, fxRateToPlanning, fxRateDate, fxRateSource, planningCurrency]);

  const doApply = async () => {
    if (!sessionId || !activePlan || !preview || preview.error) return;
    setApplyPhase("working");
    setApplyError(null);
    try {
      const res = await fetch("/api/agent/budget-apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          approvalAck: BUDGET_ACTION_ACKS.apply,
          plan: activePlan,
          planInputs: activeInputs,
          startDate,
          studyMonths: Math.round(Number(studyMonths) || 12),
          oneTimeDueDates: Object.fromEntries(
            Object.entries(oneTimeDates).filter(([, date]) => typeof date === "string" && date.trim() !== ""),
          ),
          ...(tuitionDueDate ? { tuitionDueDate } : {}),
          ...(fxRateToPlanning.trim() ? {
            fxRateToPlanning: Number(fxRateToPlanning),
            fxRateDate,
            fxRateSource,
          } : {}),
        }),
      });
      const body = (await res.json()) as Record<string, unknown>;
      if (!res.ok || body["ok"] !== true) {
        throw new Error(asString(body["error"], `Apply failed (HTTP ${res.status}).`));
      }
      setApplyResult(body);
      setRevertResult(null);
      setApplyPhase("done");
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : "Apply failed.");
      setApplyPhase("error");
    }
  };

  const doRevert = async (approvalAck: string) => {
    if (!sessionId) return;
    setApplyPhase("working");
    setApplyError(null);
    try {
      const res = await fetch("/api/agent/budget-revert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, approvalAck }),
      });
      const body = (await res.json()) as Record<string, unknown>;
      if (!res.ok || body["ok"] !== true) {
        throw new Error(asString(body["error"], `Revert failed (HTTP ${res.status}).`));
      }
      setRevertResult(body);
      setApplyResult(null);
      setApplyPhase("idle");
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : "Revert failed.");
      setApplyPhase("error");
    }
  };

  if (!plan) {
    return (
      <p className="text-sm text-[var(--sr-ink)]/70">
        The budget result arrived without plan data. Try asking for the budget again.
      </p>
    );
  }

  // plan is non-null above, so activePlan (= adjusted.plan ?? plan) cannot be
  // null here; the guard narrows TS's control flow for the JSX below.
  if (!activePlan) {
    return (
      <p className="text-sm text-[var(--sr-ink)]/70">
        The budget result arrived without plan data. Try asking for the budget again.
      </p>
    );
  }

  const verdict = VERDICT_COPY[plan.verdict];
  const totals = plan.monthlyTotals;
  const oneTime = plan.oneTime;
  const visa = plan.visaRequirementSeparate;
  const maxBar = Math.max(1, ...plan.categories.map((c) => c.maxMinor));

  const contingencyFor = (s: Scenario): number =>
    s === "low"
      ? plan.contingencyMinor.lowMinor
      : s === "high"
        ? plan.contingencyMinor.highMinor
        : plan.contingencyMinor.typicalMinor;

  const gapAfter = applyResult ? gapView(applyResult["gapAfter"]) : null;
  const gapBefore = applyResult ? gapView(applyResult["gapBefore"]) : null;
  const appliedMonthlyMinor = applyResult ? asNumber(applyResult["monthlyEstimateMinor"]) : null;
  const appliedCurrency = applyResult ? asString(applyResult["currency"], currency) : currency;
  const appliedMonthlyLabel = appliedMonthlyMinor == null
    ? "—"
    : formatMoney(toMajor(appliedMonthlyMinor, appliedCurrency), appliedCurrency);
  const fxRateUsable = fxRateToPlanning.trim() !== "" && Number.isFinite(Number(fxRateToPlanning)) && Number(fxRateToPlanning) > 0 && fxRateSource.trim() !== "" && fxRateDate.trim() !== "";

  return (
    <div>
      {demoMode && (
        <p className="mb-3 rounded-lg border border-[var(--sr-amber)]/40 bg-[var(--sr-amber)]/10 px-3 py-2 text-xs text-[var(--sr-ink)]/70">
          {asString(
            data["note"],
            "Demo mode — deterministic engine output, no model involved.",
          )}
        </p>
      )}

      {/* Verdict */}
      <div className={`rounded-xl border px-4 py-3 ${verdict.tone}`} role="status">
        <p className="text-sm font-semibold text-[var(--sr-ink)]">{verdict.title}</p>
        <p className="mt-1 text-sm leading-relaxed text-[var(--sr-ink)]/80">
          {plan.verdictReason}
        </p>
        <p className="mt-2 text-xs text-[var(--sr-ink)]/60">
          {plan.destinationLabel}
          {plan.scope === "city" && plan.city ? ` · city-level figures` : ` · country-level figures`}
          {" · "}figures in {currency}
        </p>
      </div>

      {plan.verdict === "insufficient_data" ? (
        <div className="mt-4">
          <h4 className="text-xs font-bold uppercase tracking-widest text-[var(--sr-ink)]/60">
            What&apos;s missing
          </h4>
          <ul className="mt-2 space-y-2">
            {plan.missingData.map((m, i) => (
              <li
                key={`${m.category}-${i}`}
                className="rounded-lg border border-[var(--sr-line)] px-3 py-2"
              >
                <p className="text-sm font-medium text-[var(--sr-ink)]">{m.label}</p>
                <p className="text-xs text-[var(--sr-ink)]/60">
                  {m.reason === "bundled" ? "Bundled into another cost. " : ""}
                  {m.note}
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-[var(--sr-ink)]/60">
            No totals are guessed — the budget can be built once sourced figures exist.
          </p>
        </div>
      ) : (
        <>
          {/* Budget vs estimated spending */}
          <dl className="mt-4 grid gap-2">
            {[
              { label: "Your monthly budget", value: plan.budgetMinor },
              { label: "Typical estimated spending", value: totals.typicalMinor },
              {
                label:
                  plan.verdict === "shortfall" ? "Monthly shortfall" : "Monthly headroom",
                value: plan.verdict === "shortfall" ? plan.shortfallMinor : plan.remainingMinor,
              },
            ].map((row) => (
              <div
                key={row.label}
                className="flex items-baseline justify-between gap-3 rounded-lg bg-[var(--sr-mist)]/70 px-3 py-2"
              >
                <dt className="text-xs text-[var(--sr-ink)]/60">{row.label}</dt>
                <dd className="text-sm font-semibold tabular-nums text-[var(--sr-ink)]">
                  {fmt(row.value ?? null)}
                </dd>
              </div>
            ))}
          </dl>

          {/* Scenario selector + category bars */}
          <div className="mt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-xs font-bold uppercase tracking-widest text-[var(--sr-ink)]/60">
                Monthly breakdown
              </h4>
              <div role="radiogroup" aria-label="Cost scenario" className="flex gap-1">
                {SCENARIOS.map((s) => (
                  <label
                    key={s.id}
                    className={`cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--sr-pine)] ${
                      scenario === s.id
                        ? "border-[var(--sr-pine)] bg-[var(--sr-pine)]/10 text-[var(--sr-pine)]"
                        : "border-[var(--sr-line)] text-[var(--sr-ink)]/60"
                    }`}
                  >
                    <input
                      type="radio"
                      name="lcp-scenario"
                      value={s.id}
                      checked={scenario === s.id}
                      onChange={() => setScenario(s.id)}
                      className="sr-only"
                    />
                    {s.label}
                  </label>
                ))}
              </div>
            </div>
            <ul className="mt-2 space-y-2">
              {plan.categories.map((c) => {
                const v = scenarioValue(c, scenario);
                const pct = Math.max(2, Math.round((v / maxBar) * 100));
                return (
                  <li key={c.category} className="min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-xs font-medium text-[var(--sr-ink)]/80">
                        {c.label}
                      </span>
                      <span className="shrink-0 text-xs font-semibold tabular-nums text-[var(--sr-ink)]">
                        {fmt(v)}
                        <span className="ml-1 font-normal text-[var(--sr-ink)]/50">
                          ({fmt(c.minMinor)}–{fmt(c.maxMinor)})
                        </span>
                      </span>
                    </div>
                    <div
                      className="mt-1 h-2 overflow-hidden rounded-full bg-[var(--sr-mist)]"
                      role="progressbar"
                      aria-label={`${c.label}: ${fmt(v)} per month, range ${fmt(c.minMinor)} to ${fmt(c.maxMinor)}`}
                      aria-valuenow={Math.round(v)}
                      aria-valuemin={0}
                      aria-valuemax={maxBar}
                    >
                      <div
                        className="h-full rounded-full bg-[var(--sr-pine)]/70"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className="mt-0.5 text-[11px] text-[var(--sr-ink)]/45">
                      {c.estimateMethod} · {c.confidence} confidence
                    </p>
                  </li>
                );
              })}
              <li className="min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-xs font-medium text-[var(--sr-ink)]/80">
                    Planning contingency (5%, engine assumption)
                  </span>
                  <span className="shrink-0 text-xs font-semibold tabular-nums text-[var(--sr-ink)]">
                    {fmt(contingencyFor(scenario))}
                  </span>
                </div>
              </li>
            </ul>
            <p className="mt-2 text-xs tabular-nums text-[var(--sr-ink)]/60">
              {scenario === "low" ? "Low" : scenario === "high" ? "High" : "Typical"} monthly
              total: <span className="font-semibold text-[var(--sr-ink)]">
                {fmt(scenario === "low" ? totals.lowMinor : scenario === "high" ? totals.highMinor : totals.typicalMinor)}
              </span>
              {" "}(incl. contingency)
            </p>
          </div>

          {/* Comparable source benchmark — not added to the plan total. */}
          {activePlan.benchmarkCrossCheck && (
            <div className="mt-4 rounded-xl border border-[var(--sr-line)] px-3 py-3">
              <h4 className="text-xs font-bold uppercase tracking-widest text-[var(--sr-ink)]/60">Source cross-check</h4>
              <p className="mt-1 text-sm font-semibold text-[var(--sr-ink)]">
                Core costs: {fmt(activePlan.benchmarkCrossCheck.comparableEstimateMinor)}
              </p>
              <p className="mt-1 text-xs text-[var(--sr-ink)]/65">
                Comparable categories: rent, food and local transport. Source range: {fmt(activePlan.benchmarkCrossCheck.sourceMinMinor)}–{fmt(activePlan.benchmarkCrossCheck.sourceMaxMinor)}.
              </p>
              <p className="mt-1 text-xs text-[var(--sr-ink)]/65">
                Other categories and the planning buffer add {fmt(activePlan.benchmarkCrossCheck.additionalMonthlyMinor)} beyond this core subtotal.
              </p>
              <p className="mt-1 text-xs text-[var(--sr-ink)]/60">{activePlan.benchmarkCrossCheck.note}</p>
              <a href={activePlan.benchmarkCrossCheck.sourceUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block break-all text-xs underline text-[var(--sr-pine)]">{activePlan.benchmarkCrossCheck.sourceTitle}</a>
              <p className="mt-1 text-[11px] text-[var(--sr-ink)]/50">This benchmark is informational and is not added to monthly spending.</p>
            </div>
          )}

          {/* One-time costs */}
          {oneTime.items.length > 0 && (
            <div className="mt-4">
              <h4 className="text-xs font-bold uppercase tracking-widest text-[var(--sr-ink)]/60">
                One-time costs
              </h4>
              <ul className="mt-2 space-y-1.5">
                {oneTime.items.map((item, i) => (
                  <li
                    key={`${item.label}-${i}`}
                    className="flex items-baseline justify-between gap-3 rounded-lg bg-[var(--sr-mist)]/50 px-3 py-1.5"
                  >
                    <span className="text-xs text-[var(--sr-ink)]/75">{item.label}</span>
                    <span className="shrink-0 text-xs font-semibold tabular-nums text-[var(--sr-ink)]">
                      {fmt(item.estimateMinor)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-xs tabular-nums text-[var(--sr-ink)]/60">
                One-time total:{" "}
                <span className="font-semibold text-[var(--sr-ink)]">{fmt(oneTime.totalMinor)}</span>
              </p>
            </div>
          )}
        </>
      )}

      {/* Interactive assumption controls */}
      <div className="mt-4 rounded-xl border border-[var(--sr-line)] px-3 py-3">
        <h4 className="text-xs font-bold uppercase tracking-widest text-[var(--sr-ink)]/60">
          Adjust assumptions
        </h4>
        <p className="mt-1 text-[11px] text-[var(--sr-ink)]/55">
          Every change re-runs the real budget engine — nothing is estimated by hand.
        </p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <div className="min-w-0">
            <label htmlFor="lcp-acc" className="text-xs font-medium text-[var(--sr-ink)]/70">
              Accommodation
            </label>
            <select
              id="lcp-acc"
              value={accType}
              onChange={(e) => setAccType(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--sr-line)] bg-white/70 px-2.5 py-1.5 text-sm outline-none focus:border-[var(--sr-pine)] focus:ring-2 focus:ring-[var(--sr-pine)]/25"
            >
              <option value="">Cheapest sourced (default)</option>
              {accommodationOptions.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-0">
            <label htmlFor="lcp-food" className="text-xs font-medium text-[var(--sr-ink)]/70">
              Monthly food budget ({currency})
            </label>
            <input
              id="lcp-food"
              type="number"
              inputMode="decimal"
              min="0"
              step="5"
              value={foodMajor}
              placeholder={(() => {
                const line = plan.categories.find((item) => item.category === foodKey);
                return line ? String(toMajor(line.estimateMinor, currency)) : "Enter estimate";
              })()}
              onChange={(e) => setFoodMajor(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--sr-line)] bg-white/70 px-2.5 py-1.5 text-sm tabular-nums outline-none focus:border-[var(--sr-pine)] focus:ring-2 focus:ring-[var(--sr-pine)]/25"
            />
            <p className="mt-1 text-[11px] text-[var(--sr-ink)]/50">
              Optional personal estimate. It replaces the reference food figure; it is not added on top.
            </p>
          </div>
          <div className="min-w-0">
            <label htmlFor="lcp-transport" className="text-xs font-medium text-[var(--sr-ink)]/70">
              Monthly transport budget ({currency})
            </label>
            <input
              id="lcp-transport"
              type="number"
              inputMode="decimal"
              min="0"
              step="5"
              value={transportMajor}
              placeholder={(() => {
                const line = plan.categories.find((item) => item.category === "local_transport");
                return line ? String(toMajor(line.estimateMinor, currency)) : "Enter estimate";
              })()}
              onChange={(e) => setTransportMajor(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--sr-line)] bg-white/70 px-2.5 py-1.5 text-sm tabular-nums outline-none focus:border-[var(--sr-pine)] focus:ring-2 focus:ring-[var(--sr-pine)]/25"
            />
            <p className="mt-1 text-[11px] text-[var(--sr-ink)]/50">
              Optional personal estimate. Published data does not price every transport preference separately.
            </p>
          </div>
          <div className="min-w-0">
            <label htmlFor="lcp-budget" className="text-xs font-medium text-[var(--sr-ink)]/70">
              Monthly budget ({budgetCurrency})
            </label>
            <input
              id="lcp-budget"
              type="number"
              inputMode="decimal"
              min="0"
              step="10"
              value={budgetMajor}
              onChange={(e) => setBudgetMajor(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--sr-line)] bg-white/70 px-2.5 py-1.5 text-sm tabular-nums outline-none focus:border-[var(--sr-pine)] focus:ring-2 focus:ring-[var(--sr-pine)]/25"
            />
          </div>
        </div>
        {adjusted.error && (
          <p role="alert" className="mt-2 text-xs text-[var(--sr-clay)]">
            {adjusted.error}
          </p>
        )}
        {isAdjusted && adjusted.plan && (
          <div className="mt-3 rounded-lg bg-[var(--sr-mist)]/60 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-[var(--sr-ink)]">
                Original vs adjusted
              </p>
              <button
                type="button"
                onClick={resetControls}
                className="rounded-lg border border-[var(--sr-line)] px-2.5 py-1 text-xs font-medium text-[var(--sr-ink)]/70 transition hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sr-pine)]"
              >
                Reset
              </button>
            </div>
            <dl className="mt-1.5 space-y-1 text-xs tabular-nums">
              <div className="flex justify-between gap-2">
                <dt className="text-[var(--sr-ink)]/55">Monthly budget</dt>
                <dd>
                  {plan.budgetMinor === adjusted.plan.budgetMinor ? (
                    <span>Unchanged · {fmt(adjusted.plan.budgetMinor)}</span>
                  ) : (
                    <><span className="text-[var(--sr-ink)]/50 line-through">{fmt(plan.budgetMinor)}</span>{" → "}<span className="font-semibold">{fmt(adjusted.plan.budgetMinor)}</span></>
                  )}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-[var(--sr-ink)]/55">Typical spending</dt>
                <dd>
                  {plan.monthlyTotals.typicalMinor === adjusted.plan.monthlyTotals.typicalMinor ? (
                    <span>Unchanged · {fmt(adjusted.plan.monthlyTotals.typicalMinor)}</span>
                  ) : (
                    <><span className="text-[var(--sr-ink)]/50 line-through">{fmt(plan.monthlyTotals.typicalMinor)}</span>{" → "}<span className="font-semibold">{fmt(adjusted.plan.monthlyTotals.typicalMinor)}</span></>
                  )}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-[var(--sr-ink)]/55">Verdict</dt>
                <dd>
                  {plan.verdict === adjusted.plan.verdict ? (
                    <span>Unchanged · {VERDICT_COPY[adjusted.plan.verdict].title}</span>
                  ) : (
                    <><span className="text-[var(--sr-ink)]/50 line-through">{VERDICT_COPY[plan.verdict].title}</span>{" → "}<span className="font-semibold">{VERDICT_COPY[adjusted.plan.verdict].title}</span></>
                  )}
                </dd>
              </div>
            </dl>
          </div>
        )}
      </div>

      {/* Visa requirement — visually separate, regulatory only */}
      {visa && (
        <div
          className="mt-4 rounded-xl border-2 border-dashed border-[var(--sr-amber)]/60 bg-[var(--sr-amber)]/5 px-4 py-3"
          aria-label="Visa requirement (regulatory)"
        >
          <h4 className="text-xs font-bold uppercase tracking-widest text-[var(--sr-amber)]">
            What the visa office requires
          </h4>
          <p className="mt-1 text-[11px] font-medium uppercase tracking-wide text-[var(--sr-ink)]/50">
            Regulatory minimum — not what you&apos;ll spend
          </p>
          <p className="mt-2 text-sm font-semibold tabular-nums text-[var(--sr-ink)]">
            {formatMoney(toMajor(visa.amount, currency), currency)}
            <span className="ml-1 text-xs font-normal text-[var(--sr-ink)]/60">
              per {visa.period === "year" ? "year" : "month"}
            </span>
          </p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--sr-ink)]/65">{visa.note}</p>
          <p className="mt-1 text-[11px] text-[var(--sr-ink)]/50">
            Source: {visa.sourceTitle} ·{" "}
            <a
              href={visa.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-[var(--sr-pine)]"
            >
              {visa.sourceUrl}
            </a>
          </p>
        </div>
      )}

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <div className="mt-4">
          <h4 className="text-xs font-bold uppercase tracking-widest text-[var(--sr-ink)]/60">
            Ways to bring costs down
          </h4>
          <ul className="mt-2 space-y-2">
            {recommendations.map((r, i) => (
              <li
                key={i}
                className="rounded-lg border border-[var(--sr-line)] px-3 py-2"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-[var(--sr-ink)]">
                    {asString(r["change"], "Recommendation")}
                  </p>
                  {asNumber(r["impactMinor"]) != null && (
                    <span className="shrink-0 text-xs font-semibold tabular-nums text-[var(--sr-pine)]">
                      {asNumber(r["impactMinor"])! < 0 ? "saves " : "adds "}
                      {fmt(Math.abs(asNumber(r["impactMinor"]) ?? 0))}
                      {asString(r["impactKind"]) === "one_time" ? " once" : "/mo"}
                    </span>
                  )}
                </div>
                {asString(r["tradeoff"]) && (
                  <p className="mt-0.5 text-[11px] text-[var(--sr-ink)]/50">
                    Trade-off: {asString(r["tradeoff"])}
                  </p>
                )}
                {asString(r["supportsBy"]) && (
                  <p className="mt-0.5 text-[11px] text-[var(--sr-ink)]/50">
                    Based on: {asString(r["supportsBy"])}
                  </p>
                )}
              </li>
            ))}
          </ul>
          {recommendationNotes.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[11px] text-[var(--sr-ink)]/55">
              {recommendationNotes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Sources + freshness */}
      {plan.sources.length > 0 && (
        <Disclosure label={`Sources (${plan.sources.length})`}>
          <ul className="space-y-2">
            {plan.sources.map((s, i) => {
              const stale = isStale(s.checkedDate);
              return (
                <li key={i} className="text-xs">
                  <p className="font-medium text-[var(--sr-ink)]">
                    {s.title}
                    {stale && (
                      <span className="ml-2 rounded-full border border-[var(--sr-amber)]/40 bg-[var(--sr-amber)]/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--sr-amber)]">
                        older than 12 months — verify before use
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 break-all text-[var(--sr-ink)]/55">
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      className="underline hover:text-[var(--sr-pine)]"
                    >
                      {s.url}
                    </a>
                  </p>
                  <p className="text-[var(--sr-ink)]/45">
                    Checked {s.checkedDate}
                    {s.publishedDate ? ` · published ${s.publishedDate}` : " · publication date not shown"} ·{" "}
                    {s.scope} scope
                  </p>
                </li>
              );
            })}
          </ul>
        </Disclosure>
      )}

      {plan.warnings.length > 0 && (
        <Disclosure label={`Warnings (${plan.warnings.length})`}>
          <ul className="list-disc space-y-1 pl-5 text-xs text-[var(--sr-ink)]/70">
            {plan.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Disclosure>
      )}

      {plan.assumptions.length > 0 && (
        <Disclosure label={`Assumptions (${plan.assumptions.length})`}>
          <ul className="space-y-1.5">
            {plan.assumptions.map((a, i) => (
              <li key={i} className="text-xs text-[var(--sr-ink)]/70">
                <span className="font-medium text-[var(--sr-ink)]/50">[{a.tag}]</span> {a.text}
              </li>
            ))}
          </ul>
        </Disclosure>
      )}

      {/* Tuition note — never silent */}
      <p className="mt-3 rounded-lg bg-[var(--sr-mist)]/60 px-3 py-2 text-[11px] leading-relaxed text-[var(--sr-ink)]/60">
        {plan.tuition.note}
      </p>

      {/* Apply to financial plan (approval-gate pattern) */}
      <div className="mt-4 rounded-xl border border-[var(--sr-pine)]/30 px-3 py-3">
        <h4 className="text-xs font-bold uppercase tracking-widest text-[var(--sr-ink)]/60">
          Apply to my financial plan
        </h4>
        {!sessionId && (
          <p className="mt-1 text-xs text-[var(--sr-ink)]/55">
            Applying needs an active chat session.
          </p>
        )}
        {applyPhase === "idle" && (
          <>
            <p className="mt-1 text-xs text-[var(--sr-ink)]/65">
              Convert the {isAdjusted && adjusted.plan ? "adjusted" : "current"} budget into
              dated obligations and re-run the funding-gap forecast. You confirm first —
              nothing is written silently.
            </p>
            <button
              type="button"
              disabled={!sessionId || plan.verdict === "insufficient_data"}
              onClick={() => {
                setApplyError(null);
                setApplyPhase("confirm");
              }}
              title={
                plan.verdict === "insufficient_data"
                  ? "An insufficient-data plan has no estimates to convert"
                  : undefined
              }
              className="mt-2 rounded-xl bg-[var(--sr-pine)] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[var(--sr-pine)]/85 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sr-pine)]"
            >
              Apply to my financial plan
            </button>
          </>
        )}

        {applyPhase === "confirm" && (
          <div role="group" aria-label="Confirm applying the budget">
            <p className="mt-1 text-xs font-medium text-[var(--sr-ink)]">
              Please confirm — this writes to your working plan:
            </p>
            {preview?.error ? (
              <p role="alert" className="mt-2 text-xs text-[var(--sr-clay)]">
                {preview.error}
              </p>
            ) : (
              preview && (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-[var(--sr-ink)]/70">
                  <li>
                    {preview.count} obligation(s). Estimated recurring costs: {fmt(preview.monthly)}/mo in {activePlan?.currency ?? currency} — each marked &ldquo;estimated budget item, not a committed bill&rdquo;.
                    {preview.currenciesDiffer && preview.convertedMonthly != null && ` At the explicitly entered rate, this is approximately ${formatMoney(toMajor(preview.convertedMonthly, preview.planningCurrency), preview.planningCurrency)}/mo in the financial plan currency.`}
                  </li>
                  <li>Tuition: {preview.tuitionNote}</li>
                  {preview.undatedOneTimeLabels.length > 0 && (
                    <li>{preview.undatedOneTimeLabels.length} one-time cost(s) have no confirmed due date and will remain incomplete in the dated forecast until you supply dates.</li>
                  )}
                  {preview.tuitionDueDateMissing && <li>Tuition has no confirmed due date and will remain incomplete in the dated forecast.</li>}
                  <li>The funding-gap forecast is re-run after applying eligible, dated obligations.</li>
                </ul>
              )
            )}
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div className="min-w-0">
                <label htmlFor="lcp-start" className="text-xs font-medium text-[var(--sr-ink)]/70">
                  Start date
                </label>
                <input
                  id="lcp-start"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--sr-line)] bg-white/70 px-2.5 py-1.5 text-sm outline-none focus:border-[var(--sr-pine)] focus:ring-2 focus:ring-[var(--sr-pine)]/25"
                />
              </div>
              <div className="min-w-0">
                <label htmlFor="lcp-months" className="text-xs font-medium text-[var(--sr-ink)]/70">
                  Study months
                </label>
                <input
                  id="lcp-months"
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max="60"
                  value={studyMonths}
                  onChange={(e) => setStudyMonths(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--sr-line)] bg-white/70 px-2.5 py-1.5 text-sm tabular-nums outline-none focus:border-[var(--sr-pine)] focus:ring-2 focus:ring-[var(--sr-pine)]/25"
                />
              </div>
            </div>
            {activePlan && activePlan.oneTime.items.length > 0 && (
              <div className="mt-3 rounded-lg bg-[var(--sr-mist)]/60 p-3">
                <p className="text-xs font-semibold text-[var(--sr-ink)]">One-time costs need their own dates</p>
                <p className="mt-1 text-[11px] text-[var(--sr-ink)]/55">We will not assume that a visa fee, deposit or setup cost is due on your arrival date.</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {activePlan.oneTime.items.map((item, index) => (
                    <div key={`${item.label}-${index}`} className="min-w-0">
                      <label htmlFor={`lcp-onetime-${index}`} className="text-xs font-medium text-[var(--sr-ink)]/70">{item.label} due date</label>
                      <input id={`lcp-onetime-${index}`} type="date" value={oneTimeDates[String(index)] ?? ""} onChange={(e) => setOneTimeDates((prev) => ({ ...prev, [String(index)]: e.target.value }))} className="mt-1 w-full rounded-lg border border-[var(--sr-line)] bg-white/70 px-2.5 py-1.5 text-sm outline-none focus:border-[var(--sr-pine)] focus:ring-2 focus:ring-[var(--sr-pine)]/25" />
                    </div>
                  ))}
                </div>
              </div>
            )}
            {activePlan?.tuition.included && (
              <div className="mt-2 min-w-0">
                <label htmlFor="lcp-tuition-date" className="text-xs font-medium text-[var(--sr-ink)]/70">Tuition due date</label>
                <input id="lcp-tuition-date" type="date" value={tuitionDueDate} onChange={(e) => setTuitionDueDate(e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--sr-line)] bg-white/70 px-2.5 py-1.5 text-sm outline-none focus:border-[var(--sr-pine)] focus:ring-2 focus:ring-[var(--sr-pine)]/25" />
              </div>
            )}
            {currencyMismatch && (
              <p className="mt-3 rounded-lg border border-[var(--sr-amber)]/50 bg-[var(--sr-amber)]/10 px-3 py-2 text-xs text-[var(--sr-ink)]/80" role="status">
                This budget is in {currency}, but your financial plan uses {planningCurrency}. It will not be included in the numerical forecast until you provide and confirm an explicit {planningCurrency}-per-{currency} rate, its date and its source.
              </p>
            )}
            {currencyMismatch && <Disclosure label="Enter explicit currency conversion" defaultOpen={true}>
              <p className="text-xs text-[var(--sr-ink)]/65">If your financial plan uses a different currency from this destination budget, enter an explicit rate in planning-currency units per 1 {activePlan?.currency ?? currency}. Without a source and date, no conversion will be applied.</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <div>
                  <label htmlFor="lcp-fx-rate" className="text-xs font-medium text-[var(--sr-ink)]/70">Planning currency per 1 {activePlan?.currency ?? currency}</label>
                  <input id="lcp-fx-rate" type="number" min="0.000001" step="any" value={fxRateToPlanning} onChange={(e) => setFxRateToPlanning(e.target.value)} placeholder="e.g. 0.86" className="mt-1 w-full rounded-lg border border-[var(--sr-line)] bg-white/70 px-2.5 py-1.5 text-sm tabular-nums outline-none focus:border-[var(--sr-pine)] focus:ring-2 focus:ring-[var(--sr-pine)]/25" />
                </div>
                <div>
                  <label htmlFor="lcp-fx-date" className="text-xs font-medium text-[var(--sr-ink)]/70">Rate date</label>
                  <input id="lcp-fx-date" type="date" value={fxRateDate} onChange={(e) => setFxRateDate(e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--sr-line)] bg-white/70 px-2.5 py-1.5 text-sm outline-none focus:border-[var(--sr-pine)] focus:ring-2 focus:ring-[var(--sr-pine)]/25" />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="lcp-fx-source" className="text-xs font-medium text-[var(--sr-ink)]/70">Rate source / how you obtained this rate</label>
                  <input id="lcp-fx-source" value={fxRateSource} onChange={(e) => setFxRateSource(e.target.value)} placeholder="e.g. bank quote checked today" className="mt-1 w-full rounded-lg border border-[var(--sr-line)] bg-white/70 px-2.5 py-1.5 text-sm outline-none focus:border-[var(--sr-pine)] focus:ring-2 focus:ring-[var(--sr-pine)]/25" />
                </div>
              </div>
            </Disclosure>}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!preview || !!preview.error || (currencyMismatch && !fxRateUsable)}
                onClick={doApply}
                className="rounded-xl bg-[var(--sr-pine)] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[var(--sr-pine)]/85 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sr-pine)]"
              >
                Confirm — apply budget
              </button>
              <button
                type="button"
                onClick={() => setApplyPhase("idle")}
                className="rounded-xl border border-[var(--sr-line)] px-4 py-2 text-xs font-medium text-[var(--sr-ink)]/70 transition hover:bg-[var(--sr-mist)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sr-pine)]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {applyPhase === "working" && (
          <p className="mt-2 text-xs text-[var(--sr-ink)]/60" role="status">
            Working…
          </p>
        )}

        {(applyPhase === "error" || applyError) && applyError && (
          <p role="alert" className="mt-2 text-xs text-[var(--sr-clay)]">
            {applyError}{" "}
            <button
              type="button"
              onClick={() => {
                setApplyError(null);
                setApplyPhase("idle");
              }}
              className="underline"
            >
              Back
            </button>
          </p>
        )}

        {applyPhase === "done" && applyResult && (
          <div className="mt-2">
            <p className="text-xs font-semibold text-[var(--sr-pine)]" role="status">
              Applied {asNumber(applyResult["obligationCount"]) ?? 0} obligation(s) for{" "}
              {asString(applyResult["destinationLabel"])} — estimated {appliedMonthlyLabel}/mo in {appliedCurrency}.
            </p>
            {applyResult["seededFromSample"] === true && (
              <p className="mt-1 text-[11px] text-[var(--sr-ink)]/55">
                Your working plan was empty, so it was seeded from the sample student
                plan (demo behaviour) before applying.
              </p>
            )}
            {isRecord(applyResult["fxConversion"]) && (
              <p className="mt-1 text-[11px] text-[var(--sr-ink)]/60">
                Conversion used: 1 {asString(applyResult["fxConversion"]["from"])} = {asNumber(applyResult["fxConversion"]["rate"])} {asString(applyResult["fxConversion"]["to"])}; source: {asString(applyResult["fxConversion"]["source"])}; dated {asString(applyResult["fxConversion"]["asOf"])}. This is the rate you supplied, not a live rate.
              </p>
            )}
            {gapBefore && gapAfter && (
              <dl className="mt-2 space-y-1 text-xs tabular-nums">
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--sr-ink)]/55">Lowest projected balance — before</dt>
                  <dd className="font-semibold">{gapBefore.minBalance}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--sr-ink)]/55">Lowest projected balance — after</dt>
                  <dd className="font-semibold">{gapAfter.minBalance}</dd>
                </div>
                {gapAfter.hasGap ? (
                  <div className="flex justify-between gap-2">
                    <dt className="text-[var(--sr-ink)]/55">Projected gap</dt>
                    <dd className="font-semibold text-[var(--sr-clay)]">
                      {gapAfter.shortfall} {gapAfter.gapDate ? `on ${gapAfter.gapDate}` : ""}
                    </dd>
                  </div>
                ) : (
                  <div className="flex justify-between gap-2">
                    <dt className="text-[var(--sr-ink)]/55">Projected gap</dt>
                    <dd className="font-semibold text-[var(--sr-pine)]">None in the forecast window</dd>
                  </div>
                )}
                {gapAfter.incompleteCount > 0 && (
                  <p className="text-[11px] text-[var(--sr-ink)]/55">
                    {gapAfter.incompleteCount} item(s) remain incomplete or outside the dated forecast. Review missing due dates and any unresolved currency assumptions; incomplete items are never silently guessed.
                  </p>
                )}
              </dl>
            )}
            <p className="mt-2 text-[11px] text-[var(--sr-ink)]/55">
              {asString(applyResult["tuitionNote"])}
            </p>
            <button
              type="button"
              onClick={() => {
                if (!window.confirm("Approve removing only the planned obligations added by this destination budget? Paid or committed items will stay.")) return;
                void doRevert(BUDGET_ACTION_ACKS.revert);
              }}
              className="mt-3 rounded-xl border border-[var(--sr-clay)]/40 px-4 py-2 text-xs font-semibold text-[var(--sr-clay)] transition hover:bg-[var(--sr-clay)]/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sr-clay)]"
            >
              Revert applied budget
            </button>
          </div>
        )}

        {revertResult && applyPhase === "idle" && (
          <div className="mt-2">
            <p className="text-xs text-[var(--sr-ink)]/70" role="status">
              Reverted — removed {asNumber(revertResult["removedCount"]) ?? 0} planned
              obligation(s). {asString(revertResult["summary"])}
            </p>
            {(() => {
              const g = gapView(revertResult["gapAfter"]);
              return g ? (
                <p className="mt-1 text-xs tabular-nums text-[var(--sr-ink)]/60">
                  Lowest projected balance now:{" "}
                  <span className="font-semibold">{g.minBalance}</span>
                  {g.hasGap ? ` — projected gap ${g.shortfall}` : " — no projected gap"}
                </p>
              ) : null;
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
