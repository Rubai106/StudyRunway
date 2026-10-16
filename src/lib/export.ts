/**
 * Exports: CSV ledgers and the structured action plan.
 * Every figure comes from the same forecast the UI renders — the export
 * functions take the already-computed ForecastResult, so exports and UI
 * cannot disagree.
 */

import { formatMinor } from "./currency";
import { ForecastResult } from "./forecast";
import { FUNDING_STATUS_LABEL } from "./model";
import { PlanState, formatDateLong } from "./model";

function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function rowsToCsv(header: string[], rows: (string | number | null)[][]): string {
  const lines = [header.map(csvCell).join(",")];
  for (const r of rows) lines.push(r.map(csvCell).join(","));
  return lines.join("\r\n") + "\r\n";
}

/** Full dated event ledger: the forecast's rows as CSV. */
export function forecastToCsv(f: ForecastResult): string {
  return rowsToCsv(
    ["date", "event", "type", "amount_minor", `amount_${f.planningCurrency}`, "certainty", "balance_after_minor", `balance_after_${f.planningCurrency}`, "confirmed_balance_after_minor", "evidence_ids", "note"],
    f.rows.map((r) => [
      r.date, r.label, r.kind, r.amountMinor,
      (r.amountMinor / 100).toFixed(2),
      r.certainty, r.balanceAfterMinor, (r.balanceAfterMinor / 100).toFixed(2),
      r.confirmedBalanceAfterMinor, r.evidenceIds.join(";"), r.note ?? "",
    ]),
  );
}

/** Funding sources + obligations ledger as CSV. */
export function planToCsv(state: PlanState): string {
  const fundRows = state.fundingSources.map((s) => [
    "funding", s.label, s.kind, s.status, s.amountMinor,
    s.amountMinor != null ? formatMinor(s.amountMinor, s.currency) : "",
    s.currency, s.availableDate ?? "", s.expectedDate ?? "", s.evidenceIds.join(";"), s.notes,
  ]);
  const oblRows = state.obligations.map((o) => [
    "obligation", o.label, o.kind, o.status, o.amountMinor,
    o.amountMinor != null ? formatMinor(o.amountMinor, o.currency) : "",
    o.currency, "", o.dueDate ?? "", o.evidenceIds.join(";"), o.notes,
  ]);
  return rowsToCsv(
    ["record", "label", "kind", "status", "amount_minor", "amount_formatted", "currency", "available_date", "expected_or_due_date", "evidence_ids", "notes"],
    [...fundRows, ...oblRows],
  );
}

export interface ActionPlanSection {
  heading: string;
  items: string[];
}

export interface ActionPlan {
  title: string;
  generatedAt: string;
  asOfDate: string;
  profileSummary: string;
  planningCurrency: string;
  verdict: string;
  sections: ActionPlanSection[];
  limitations: string[];
  freshness: string;
}

/** Structured action plan for the print-ready report. */
export function buildActionPlan(state: PlanState, f: ForecastResult): ActionPlan {
  const pc = f.planningCurrency;
  const p = state.profile;
  const sections: ActionPlanSection[] = [];

  const obligations = f.rows.filter((r) => r.kind === "outflow" && r.date >= f.today);
  sections.push({
    heading: "Upcoming obligations",
    items: obligations.length === 0
      ? ["No dated obligations in the forecast."]
      : obligations.map((r) => `${formatDateLong(r.date)} — ${r.label}: ${formatMinor(-r.amountMinor, pc)} (balance after: ${formatMinor(r.balanceAfterMinor, pc)})`),
  });

  const inflows = f.rows.filter((r) => r.kind === "inflow" && r.date >= f.today);
  sections.push({
    heading: "Expected funding",
    items: inflows.length === 0
      ? ["No dated inflows in the forecast."]
      : inflows.map((r) => `${formatDateLong(r.date)} — ${r.label}: +${formatMinor(r.amountMinor, pc)} [${r.certainty === "confirmed" ? "confirmed" : "NOT confirmed"}]`),
  });

  sections.push({
    heading: "Funding-gap warnings",
    items: f.firstGap
      ? [
          `Gap opens ${formatDateLong(f.firstGap.date)} — ${formatMinor(f.firstGap.shortfallMinor, pc)} short, triggered by "${f.firstGap.causeLabel}".`,
          f.confirmedFirstGap
            ? `Counting only confirmed money, the gap opens ${formatDateLong(f.confirmedFirstGap.date)} (${formatMinor(f.confirmedFirstGap.shortfallMinor, pc)} short).`
            : "No gap on confirmed money alone.",
          `Lowest projected balance: ${formatMinor(f.minBalanceMinor, pc)}${f.minBalanceDate ? ` on ${formatDateLong(f.minBalanceDate)}` : ""}.`,
        ]
      : [`No funding gap in the forecast window. Lowest projected balance: ${formatMinor(f.minBalanceMinor, pc)}.`,
         `${formatMinor(f.totalUncertainInflowMinor, pc)} of expected funding is conditional, estimated or unverified — the plan depends on it arriving.`],
  });

  sections.push({
    heading: "Key assumptions",
    items: f.assumptionsUsed.length === 0 ? ["No exchange-rate conversions were needed."] : f.assumptionsUsed,
  });

  if (f.incomplete.length > 0) {
    sections.push({
      heading: "Missing data (excluded from the forecast)",
      items: f.incomplete.map((i) => `${i.label}: ${i.reason}`),
    });
  }

  const unverified = state.evidence.filter((e) => !e.verified);
  if (unverified.length > 0) {
    sections.push({
      heading: "Unverified evidence",
      items: unverified.map((e) => `${e.factLabel} — "${e.valueText}" (${e.documentLabel}, confidence: ${e.confidence})`),
    });
  }

  const conflicts = state.evidence.filter((e) => e.conflictsWith.length > 0);
  if (conflicts.length > 0) {
    sections.push({
      heading: "Conflicting evidence (resolve in the app)",
      items: conflicts.map((e) => `${e.factLabel}: "${e.valueText}" (${e.documentLabel}) conflicts with ${e.conflictsWith.length} other source(s).`),
    });
  }

  return {
    title: `StudyRunway action plan — ${p.studentName || "Student plan"}`,
    generatedAt: new Date().toISOString(),
    asOfDate: f.today,
    profileSummary: `${p.homeCountry} → ${p.destinationCountry}; home ${p.homeCurrency}, planning in ${pc}.`,
    planningCurrency: pc,
    verdict: f.firstGap
      ? `NOT READY: a ${formatMinor(f.firstGap.shortfallMinor, pc)} shortfall opens on ${formatDateLong(f.firstGap.date)}.`
      : "ON TRACK: no funding gap in the forecast window — provided uncertain funding arrives as expected.",
    sections,
    limitations: [
      "Forecasts are only as good as their inputs: confirm every conditional, estimated or unverified figure.",
      "Exchange-rate assumptions are point estimates, not predictions; actual conversion rates will differ.",
      "Same-day events are ordered inflows-before-outflows; real settlement order may differ.",
      "This plan is a planning aid, not regulated financial advice.",
    ],
    freshness: `Figures computed ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC from data last updated ${state.updatedAt.slice(0, 16).replace("T", " ")} UTC.`,
  };
}

export function fundingStatusLabel(s: keyof typeof FUNDING_STATUS_LABEL): string {
  return FUNDING_STATUS_LABEL[s];
}
