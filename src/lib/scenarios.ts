/**
 * Stress-Test Lab — deterministic scenario engine.
 *
 * A scenario is a list of transforms applied to a deep copy of the plan.
 * The forecast is re-run on the modified plan with the exact same engine,
 * so baseline and scenario figures are directly comparable. The LLM is
 * never involved in the numbers.
 */

import { scaleMinor } from "./money";
import { buildForecast, fxKey, type ForecastResult } from "./forecast";
import {
  PlanState,
  Scenario,
  ScenarioTransform,
  addDaysISO,
  todayISO,
} from "./model";

export interface AppliedScenario {
  state: PlanState;
  scenarioId: string;
  scenarioName: string;
  /** Human-readable log of what each transform did (or why it was a no-op). */
  appliedNotes: string[];
  /** FX pairs the fx_shift transform touched. */
  affectedPairs: string[];
  result: ForecastResult;
}

function cloneState(state: PlanState): PlanState {
  return JSON.parse(JSON.stringify(state)) as PlanState;
}

/**
 * Apply one transform. Returns a note describing the effect.
 * Transforms never invent data: a delay on a source with no date is a
 * recorded no-op, and an fx_shift only touches pairs that back future
 * (not yet converted) events.
 */
function applyTransform(state: PlanState, t: ScenarioTransform, notes: string[], affectedPairs: string[]): void {
  const today = todayISO(state.profile.asOfDate);
  const planning = state.profile.planningCurrency;

  if (t.type === "delay_funding") {
    const src = state.fundingSources.find((s) => s.id === t.sourceId);
    if (!src) {
      notes.push(`Delay: funding source "${t.sourceId}" not found — no change.`);
      return;
    }
    const field = src.status === "confirmed_available" ? "availableDate" : "expectedDate";
    const current = (src[field] ?? src.availableDate ?? src.expectedDate) as string | null;
    if (!current) {
      notes.push(`Delay: "${src.label}" has no date, so a ${t.days}-day delay cannot be applied — no change.`);
      return;
    }
    const next = addDaysISO(current, t.days);
    if (field === "availableDate") src.availableDate = next;
    else src.expectedDate = next;
    notes.push(`Delayed "${src.label}" by ${t.days} days: ${current} → ${next}.`);
    return;
  }

  if (t.type === "fx_shift") {
    const factor = 1 + t.percent / 100;
    // Exposure-scoped: only pairs used by events dated after today where the
    // source currency differs from the planning currency ("unconverted").
    const pairs = new Set<string>();
    for (const s of state.fundingSources) {
      if (s.currency.toUpperCase() === planning.toUpperCase()) continue;
      const date = s.status === "confirmed_available" ? s.availableDate : (s.expectedDate ?? s.availableDate);
      if (date && date > today && s.amountMinor != null) pairs.add(fxKey(s.currency, planning));
    }
    for (const o of state.obligations) {
      if (o.status === "paid" || o.currency.toUpperCase() === planning.toUpperCase()) continue;
      if (o.dueDate && o.dueDate > today && o.amountMinor != null) pairs.add(fxKey(o.currency, planning));
    }
    let wanted = [...pairs];
    if (t.pairs.length > 0) {
      wanted = wanted.filter((p) => t.pairs.some((w) => p.startsWith(w.toUpperCase())));
    }
    if (wanted.length === 0) {
      notes.push(`FX shift of ${t.percent}%: no unconverted future-dated exposures in ${planning} terms — no change.`);
      return;
    }
    for (const pair of wanted) {
      const [from, to] = pair.split(">");
      const directKey = fxKey(from, to);
      if (state.fx.rates[directKey] != null) {
        const before = state.fx.rates[directKey];
        state.fx.rates[directKey] = before * factor;
        affectedPairs.push(pair);
        notes.push(`FX ${pair}: ${before} → ${state.fx.rates[directKey]} (${t.percent > 0 ? "+" : ""}${t.percent}%).`);
      } else {
        // Only an inverse is stored: shifting the inverse by the reciprocal
        // keeps the derived direct rate consistent.
        const invKey = fxKey(to, from);
        const inv = state.fx.rates[invKey];
        if (inv != null && inv > 0) {
          state.fx.rates[invKey] = inv / factor;
          affectedPairs.push(pair);
          notes.push(`FX ${pair}: shifted via stored inverse ${invKey} (${t.percent > 0 ? "+" : ""}${t.percent}%).`);
        }
      }
    }
    return;
  }

  // expense_increase
  const factor = 1 + t.percent / 100;
  const kinds = new Set(t.kinds);
  let count = 0;
  for (const o of state.obligations) {
    if (o.status === "paid" || o.amountMinor == null) continue;
    if (kinds.size > 0 && !kinds.has(o.kind)) continue;
    const before = o.amountMinor;
    o.amountMinor = scaleMinor(before, factor);
    count++;
    void before;
  }
  notes.push(
    count > 0
      ? `Increased ${count} obligation${count === 1 ? "" : "s"}${kinds.size ? ` (${[...kinds].join(", ")})` : ""} by ${t.percent}%.`
      : `Expense increase of ${t.percent}%: no matching unpaid obligations — no change.`,
  );
}

export function applyScenario(state: PlanState, scenario: Scenario): AppliedScenario {
  const next = cloneState(state);
  const appliedNotes: string[] = [];
  const affectedPairs: string[] = [];
  for (const t of scenario.transforms) {
    applyTransform(next, t, appliedNotes, affectedPairs);
  }
  next.updatedAt = new Date().toISOString();
  return {
    state: next,
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    appliedNotes,
    affectedPairs,
    result: buildForecast(next),
  };
}

export interface ScenarioDiff {
  deltaMinBalanceMinor: number;
  gapDateBefore: string | null;
  gapDateAfter: string | null;
  shortfallBeforeMinor: number | null;
  shortfallAfterMinor: number | null;
  changedAssumptions: string[];
}

/** Compare a scenario result against the baseline forecast. */
export function diffForecasts(base: ForecastResult, modified: ForecastResult): ScenarioDiff {
  return {
    deltaMinBalanceMinor: modified.minBalanceMinor - base.minBalanceMinor,
    gapDateBefore: base.firstGap?.date ?? null,
    gapDateAfter: modified.firstGap?.date ?? null,
    shortfallBeforeMinor: base.firstGap ? base.firstGap.shortfallMinor : null,
    shortfallAfterMinor: modified.firstGap ? modified.firstGap.shortfallMinor : null,
    changedAssumptions: modified.assumptionsUsed.filter((a) => !base.assumptionsUsed.includes(a)),
  };
}

/** The three worked examples the product ships with. */
export function builtinScenarios(sourceIdForDelay: string | null): Scenario[] {
  const now = new Date().toISOString();
  const list: Scenario[] = [
    {
      id: "scn_delay_14",
      name: "Scholarship delayed 14 days",
      description: "The expected scholarship (or selected funding source) arrives two weeks late.",
      transforms: sourceIdForDelay
        ? [{ type: "delay_funding", sourceId: sourceIdForDelay, days: 14 }]
        : [],
      createdAt: now,
    },
    {
      id: "scn_fx_5",
      name: "Exchange rate moves 5% against you",
      description: "Home-currency funding converts 5% worse on all unconverted future exposures.",
      transforms: [{ type: "fx_shift", percent: -5, pairs: [] }],
      createdAt: now,
    },
    {
      id: "scn_costs_10",
      name: "Setup costs rise 10%",
      description: "Accommodation, travel and setup obligations cost 10% more.",
      transforms: [{ type: "expense_increase", percent: 10, kinds: ["rent", "deposit", "travel", "living"] }],
      createdAt: now,
    },
  ];
  return list.filter((s) => s.transforms.length > 0);
}

/* ------------------------------------------------------------------ */
/* Plan Reliability Test — the selected additional feature (docs/FEATURE_STRATEGY.md) */
/* ------------------------------------------------------------------ */

export interface BatteryShock {
  id: string;
  name: string;
  description: string;
  /** Pass = no funding gap anywhere in the forecast window under this shock. */
  passed: boolean;
  minBalanceMinor: number;
  gapDate: string | null;
  shortfallMinor: number | null;
  notes: string[];
}

export interface BatteryResult {
  shocks: BatteryShock[];
  survived: number;
  total: number;
  planningCurrency: string;
}

/** FX pairs backing future (not yet converted) events — the plan's live exposures. */
export function futureFxPairs(state: PlanState): string[] {
  const today = todayISO(state.profile.asOfDate);
  const planning = state.profile.planningCurrency;
  const pairs = new Set<string>();
  for (const s of state.fundingSources) {
    if (s.currency.toUpperCase() === planning.toUpperCase() || s.amountMinor == null) continue;
    const date = s.status === "confirmed_available" ? s.availableDate : (s.expectedDate ?? s.availableDate);
    if (date && date > today) pairs.add(fxKey(s.currency, planning));
  }
  for (const o of state.obligations) {
    if (o.status === "paid" || o.amountMinor == null || o.currency.toUpperCase() === planning.toUpperCase()) continue;
    if (o.dueDate && o.dueDate > today) pairs.add(fxKey(o.currency, planning));
  }
  return [...pairs].sort();
}

/**
 * Run the full battery: every saved scenario plus an automatic 5%-against
 * shock on each live FX exposure. Fully deterministic; every figure links
 * back to the forecast engine.
 */
export function runReliabilityBattery(state: PlanState): BatteryResult {
  const pc = state.profile.planningCurrency;
  const shocks: BatteryShock[] = [];
  const now = new Date().toISOString();

  for (const s of state.scenarios) {
    const applied = applyScenario(state, s);
    const r = applied.result;
    shocks.push({
      id: `scn:${s.id}`,
      name: s.name,
      description: s.description || applied.appliedNotes.join(" "),
      passed: r.firstGap == null,
      minBalanceMinor: r.minBalanceMinor,
      gapDate: r.firstGap?.date ?? null,
      shortfallMinor: r.firstGap?.shortfallMinor ?? null,
      notes: applied.appliedNotes,
    });
  }

  for (const pair of futureFxPairs(state)) {
    const shock: Scenario = {
      id: `fx:${pair}`,
      name: `${pair.replace(">", " → ")} moves 5% against you`,
      description: "Automatic sensitivity shock on a live foreign-currency exposure.",
      transforms: [{ type: "fx_shift", percent: -5, pairs: [pair] }],
      createdAt: now,
    };
    const applied = applyScenario(state, shock);
    const r = applied.result;
    shocks.push({
      id: `fx:${pair}`,
      name: shock.name,
      description: shock.description,
      passed: r.firstGap == null,
      minBalanceMinor: r.minBalanceMinor,
      gapDate: r.firstGap?.date ?? null,
      shortfallMinor: r.firstGap?.shortfallMinor ?? null,
      notes: applied.appliedNotes,
    });
  }

  return {
    shocks,
    survived: shocks.filter((s) => s.passed).length,
    total: shocks.length,
    planningCurrency: pc,
  };
}
