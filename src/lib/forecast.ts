/**
 * Funding Gap Radar — deterministic date-based forecast engine.
 *
 * The engine walks the student's dated financial events in chronological
 * order and computes the expected balance after each event, in the planning
 * currency. It answers:
 *   1. Can the student afford upcoming obligations? (balance after each event)
 *   2. On which date could funds run short? (first balance < 0)
 *   3. How big is the shortfall and what causes it?
 *   4. How does the picture change with confirmed money only?
 *
 * Conventions (documented in docs/CALC_SPEC.md):
 * - Money "in hand" (confirmed_available, available on/before today) forms
 *   the opening balance. Everything else is a dated event.
 * - Same-day ordering: inflows before outflows; deterministic tie-breaks.
 * - Conditional/estimated/unverified money IS included in the main forecast
 *   but flagged, and a parallel "confirmed-only" balance is computed so the
 *   student can see the plan without uncertain funds.
 * - Missing amounts or dates are never invented: the item is listed under
 *   `incomplete` and excluded from the math.
 * - Missing FX assumptions are never invented either: the event is listed
 *   as incomplete with the missing pair named.
 */

import { convertMinor } from "./money";
import {
  FxTable,
  FundingSource,
  FundingStatus,
  Obligation,
  PlanState,
  addDaysISO,
  addMonthsISO,
  todayISO,
} from "./model";

export type Certainty = "confirmed" | "uncertain";

export interface ForecastEvent {
  id: string;
  date: string; // YYYY-MM-DD
  label: string;
  kind: "inflow" | "outflow";
  /** Amount in planning-currency minor units (signed: +inflow, -outflow). */
  amountMinor: number;
  originalMinor: number;
  originalCurrency: string;
  certainty: Certainty;
  status: FundingStatus | "obligation";
  evidenceIds: string[];
  note: string | null;
  fxPair: string;
  fxRate: number;
  fxDerived: boolean; // true when the rate was derived as an inverse
}

export interface ForecastRow extends ForecastEvent {
  balanceAfterMinor: number;
  confirmedBalanceAfterMinor: number;
}

export interface IncompleteItem {
  id: string;
  label: string;
  reason: string;
}

export interface GapInfo {
  date: string;
  /** Positive minor units: how far below zero the balance falls. */
  shortfallMinor: number;
  causeLabel: string;
  causeKind: "inflow" | "outflow";
}

export interface ForecastResult {
  today: string;
  planningCurrency: string;
  openingMinor: number;
  rows: ForecastRow[];
  incomplete: IncompleteItem[];
  minBalanceMinor: number;
  minBalanceDate: string | null;
  confirmedMinBalanceMinor: number;
  firstGap: GapInfo | null;
  confirmedFirstGap: GapInfo | null;
  totalConfirmedInflowMinor: number;
  totalUncertainInflowMinor: number;
  totalOutflowMinor: number;
  assumptionsUsed: string[];
  generatedAt: string;
}

export function fxKey(from: string, to: string): string {
  return `${from.toUpperCase()}>${to.toUpperCase()}`;
}

/**
 * Resolve an FX rate. Direct quote wins; otherwise a stored inverse is
 * derived (and flagged). Returns null when neither exists — the caller must
 * treat the event as incomplete rather than inventing a rate.
 */
export function resolveRate(
  fx: FxTable,
  from: string,
  to: string,
): { rate: number; derived: boolean; pair: string } | null {
  const f = from.toUpperCase();
  const t = to.toUpperCase();
  if (f === t) return { rate: 1, derived: false, pair: fxKey(f, t) };
  const direct = fx.rates[fxKey(f, t)];
  if (direct != null) return { rate: direct, derived: false, pair: fxKey(f, t) };
  const inverse = fx.rates[fxKey(t, f)];
  if (inverse != null && inverse > 0) {
    return { rate: 1 / inverse, derived: true, pair: `${fxKey(t, f)} (inverted)` };
  }
  return null;
}

const CONFIRMED: ReadonlySet<FundingStatus> = new Set<FundingStatus>([
  "confirmed_available",
  "confirmed_pending",
]);

function certaintyOf(status: FundingStatus): Certainty {
  return CONFIRMED.has(status) ? "confirmed" : "uncertain";
}

function tryConvert(
  amountMinor: number,
  from: string,
  to: string,
  fx: FxTable,
  assumptionsUsed: Set<string>,
): { minor: number; rate: number; derived: boolean; pair: string } | null {
  const r = resolveRate(fx, from, to);
  if (!r) return null;
  assumptionsUsed.add(
    `${r.pair} = ${r.rate} (as of ${fx.asOf}, ${fx.source}${r.derived ? ", inverted" : ""})`,
  );
  return { minor: convertMinor(amountMinor, from, to, r.rate), rate: r.rate, derived: r.derived, pair: r.pair };
}

export function buildForecast(state: PlanState): ForecastResult {
  const planning = state.profile.planningCurrency;
  const today = todayISO(state.profile.asOfDate);
  const assumptionsUsed = new Set<string>();
  const incomplete: IncompleteItem[] = [];
  const events: ForecastEvent[] = [];
  let openingMinor = 0;

  const pushIncomplete = (id: string, label: string, reason: string) =>
    incomplete.push({ id, label, reason });

  // ---- Funding sources ----------------------------------------------------
  for (const s of state.fundingSources) {
    const label = s.label;
    if (s.amountMinor == null) {
      pushIncomplete(s.id, label, "Amount is unknown — enter the expected amount or mark the source as unverified with an estimate.");
      continue;
    }
    if (s.amountMinor < 0) {
      pushIncomplete(s.id, label, "Amount must not be negative.");
      continue;
    }
    const conv = tryConvert(s.amountMinor, s.currency, planning, state.fx, assumptionsUsed);
    if (!conv) {
      pushIncomplete(s.id, label, `No exchange-rate assumption for ${s.currency} → ${planning}. Add it in Funding & documents.`);
      continue;
    }
    const certainty = certaintyOf(s.status);
    if (s.status === "confirmed_available") {
      const date = s.availableDate ?? today;
      if (date <= today) {
        openingMinor += conv.minor; // money in hand: opening balance
      } else {
        events.push(mkEvent(`${s.id}@${date}`, date, label, "inflow", conv, s, certainty, s.evidenceIds, null));
      }
    } else {
      const date = s.expectedDate ?? s.availableDate;
      if (!date) {
        pushIncomplete(s.id, label, "Expected arrival date is unknown — without a date it cannot appear in the forecast.");
        continue;
      }
      events.push(
        mkEvent(`${s.id}@${date}`, date, label, "inflow", conv, s, certainty, s.evidenceIds,
          certainty === "uncertain" ? `Counted as ${statusWord(s.status)} money — see the confirmed-only line for the plan without it.` : null),
      );
    }
  }

  // ---- Obligations ----------------------------------------------------------
  for (const o of state.obligations) {
    if (o.status === "paid") continue; // already settled: not part of the forward forecast
    if (o.amountMinor == null) {
      pushIncomplete(o.id, o.label, "Amount is unknown — enter the amount due.");
      continue;
    }
    if (o.amountMinor < 0) {
      pushIncomplete(o.id, o.label, "Amount must not be negative.");
      continue;
    }
    if (!o.dueDate) {
      pushIncomplete(o.id, o.label, "Due date is unknown — without a date it cannot appear in the forecast.");
      continue;
    }
    const conv = tryConvert(o.amountMinor, o.currency, planning, state.fx, assumptionsUsed);
    if (!conv) {
      pushIncomplete(o.id, o.label, `No exchange-rate assumption for ${o.currency} → ${planning}. Add it in Funding & documents.`);
      continue;
    }
    const occurrences = expandRecurring(o);
    for (const occ of occurrences) {
      events.push({
        id: `${o.id}@${occ.date}`,
        date: occ.date,
        label: occurrences.length > 1 ? `${o.label} (${occ.index + 1}/${occurrences.length})` : o.label,
        kind: "outflow",
        amountMinor: -conv.minor,
        originalMinor: o.amountMinor,
        originalCurrency: o.currency,
        certainty: "confirmed",
        status: "obligation",
        evidenceIds: o.evidenceIds,
        note: null,
        fxPair: conv.pair,
        fxRate: conv.rate,
        fxDerived: conv.derived,
      });
    }
  }

  // ---- Order: date asc; inflows before outflows on the same day ------------
  events.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.kind !== b.kind) return a.kind === "inflow" ? -1 : 1;
    if (a.label !== b.label) return a.label < b.label ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });

  // ---- Walk -----------------------------------------------------------------
  const rows: ForecastRow[] = [];
  let balance = openingMinor;
  let confirmedBalance = openingMinor;
  let totalConfirmedInflowMinor = 0;
  let totalUncertainInflowMinor = 0;
  let totalOutflowMinor = 0;
  let minBalanceMinor = openingMinor;
  let minBalanceDate: string | null = null;
  let confirmedMin = openingMinor;
  let firstGap: GapInfo | null = null;
  let confirmedFirstGap: GapInfo | null = null;

  const trackMin = (b: number, cb: number, date: string) => {
    if (b < minBalanceMinor) { minBalanceMinor = b; minBalanceDate = date; }
    if (cb < confirmedMin) confirmedMin = cb;
  };

  for (const e of events) {
    balance += e.amountMinor;
    if (e.kind === "inflow") {
      if (e.certainty === "confirmed") {
        confirmedBalance += e.amountMinor;
        totalConfirmedInflowMinor += e.amountMinor;
      } else {
        totalUncertainInflowMinor += e.amountMinor;
      }
    } else {
      confirmedBalance += e.amountMinor; // outflows always hit the confirmed line
      totalOutflowMinor += -e.amountMinor;
    }
    if (balance < 0 && !firstGap) {
      firstGap = { date: e.date, shortfallMinor: -balance, causeLabel: e.label, causeKind: e.kind };
    }
    if (confirmedBalance < 0 && !confirmedFirstGap) {
      confirmedFirstGap = { date: e.date, shortfallMinor: -confirmedBalance, causeLabel: e.label, causeKind: e.kind };
    }
    trackMin(balance, confirmedBalance, e.date);
    rows.push({ ...e, balanceAfterMinor: balance, confirmedBalanceAfterMinor: confirmedBalance });
  }

  return {
    today,
    planningCurrency: planning,
    openingMinor,
    rows,
    incomplete,
    minBalanceMinor,
    minBalanceDate,
    confirmedMinBalanceMinor: confirmedMin,
    firstGap,
    confirmedFirstGap,
    totalConfirmedInflowMinor,
    totalUncertainInflowMinor,
    totalOutflowMinor,
    assumptionsUsed: [...assumptionsUsed].sort(),
    generatedAt: new Date().toISOString(),
  };
}

function mkEvent(
  id: string, date: string, label: string, kind: "inflow" | "outflow",
  conv: { minor: number; rate: number; derived: boolean; pair: string },
  s: FundingSource, certainty: Certainty, evidenceIds: string[], note: string | null,
): ForecastEvent {
  return {
    id, date, label, kind,
    amountMinor: conv.minor,
    originalMinor: s.amountMinor as number,
    originalCurrency: s.currency,
    certainty,
    status: s.status,
    evidenceIds,
    note,
    fxPair: conv.pair,
    fxRate: conv.rate,
    fxDerived: conv.derived,
  };
}

function statusWord(status: FundingStatus): string {
  switch (status) {
    case "conditional": return "conditional";
    case "estimated": return "estimated";
    case "unverified": return "unverified";
    default: return status;
  }
}

function expandRecurring(o: Obligation): { date: string; index: number }[] {
  if (!o.recurring || !o.dueDate) return o.dueDate ? [{ date: o.dueDate, index: 0 }] : [];
  const out: { date: string; index: number }[] = [];
  for (let i = 0; i < o.recurring.occurrences; i++) {
    out.push({ date: addMonthsISO(o.dueDate, i * o.recurring.everyMonths), index: i });
  }
  return out;
}

/** Small helper used by the UI: events grouped for the payment calendar. */
export function paymentCalendar(state: PlanState): ForecastRow[] {
  return buildForecast(state).rows;
}

/**
 * Event-level gap causality for the payment calendar.
 *
 * Derived from the engine's already-ordered rows — no new financial math, just
 * interpreting the balance transition each event causes:
 * - "opens": the event that first moves the balance from >= 0 to < 0
 *   (this is the engine's own firstGap).
 * - "reopens": a later event that moves the balance from >= 0 back below 0
 *   after it had recovered.
 * - "widens": while a gap is open, an outflow that pushes the balance lower.
 * - "reduces": while a gap is open, an inflow that lifts the balance (still < 0).
 * - null: no gap effect — the balance stays >= 0, or a zero-amount event.
 *
 * A forecast that starts negative (opening < 0) has no opener: the gap predates
 * the forecast, so later outflows only "widen" it.
 *
 * Same-day ordering follows the engine convention: inflows are applied before
 * outflows on the same date, so a same-day inflow can prevent an outflow from
 * opening the gap.
 */
export type GapRole = "opens" | "reopens" | "widens" | "reduces" | null;

export function gapRoles(rows: ForecastRow[], openingMinor: number): GapRole[] {
  const roles: GapRole[] = new Array(rows.length).fill(null);
  let gapOpen = openingMinor < 0;
  let everOpened = gapOpen;
  for (let i = 0; i < rows.length; i++) {
    const before = i === 0 ? openingMinor : rows[i - 1].balanceAfterMinor;
    const after = rows[i].balanceAfterMinor;
    if (after < 0 && before >= 0) {
      roles[i] = everOpened ? "reopens" : "opens";
      gapOpen = true;
      everOpened = true;
    } else if (gapOpen && after < 0 && after !== before) {
      roles[i] = after < before ? "widens" : "reduces";
    } else if (after >= 0) {
      gapOpen = false;
    }
  }
  return roles;
}

export { addDaysISO };
