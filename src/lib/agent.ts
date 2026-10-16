/**
 * Evidence-Based Action Agent.
 *
 * The agent parses a natural-language request into a structured intent,
 * invokes REAL application tools (the same deterministic engine the UI
 * uses), and produces findings + ranked next steps with evidence
 * references. Financial figures always come from the calculation engine —
 * never from generated prose.
 *
 * Modes:
 * - "deterministic": rule-based intent parsing, fully offline. This is the
 *   default and is honestly labelled in the UI.
 * - "llm": an optional server-side model may be used for interpretation
 *   (see lib/llm.ts). Tool arguments are schema-validated either way, and
 *   the model can never overwrite financial records.
 *
 * The agent NEVER moves money, submits payments, or contacts anyone. Drafts
 * (e.g. an email) are drafts; consequential actions require the user.
 */

import { formatMinor } from "./currency";
import { buildForecast, type ForecastResult } from "./forecast";
import { applyScenario, diffForecasts } from "./scenarios";
import { rankQuotes } from "./transfers";
import {
  PlanState,
  formatDateLong,
} from "./model";

export type AgentMode = "deterministic" | "llm";

export interface ToolCallTrace {
  tool: string;
  args: Record<string, unknown>;
  summary: string;
}

export interface AgentNextStep {
  title: string;
  detail: string;
  evidenceRefs: string[];
}

export interface AgentResult {
  mode: AgentMode;
  interpretation: string;
  trace: ToolCallTrace[];
  findings: string[];
  nextSteps: AgentNextStep[];
  warnings: string[];
  refused: string | null;
}

type Intent =
  | { type: "affordability" }
  | { type: "gap" }
  | { type: "scenario"; which: "delay" | "fx" | "costs" | "all" }
  | { type: "transfers" }
  | { type: "calendar" }
  | { type: "checklist" }
  | { type: "draft_email"; topic: "instalment" | "extension" }
  | { type: "unsupported"; action: string }
  | { type: "fallback" };

function parseIntent(message: string): Intent {
  const m = message.toLowerCase();

  // Unsupported actions first: anything that would move money or act externally.
  if (/(^|\b)(pay|send|transfer|wire|book|apply for|submit)( the| my| this)?\b.*\b(tuition|money|payment|fee|loan)/.test(m)
    && !/draft|email|letter|compare|quote|check|can i|what if/.test(m)) {
    return { type: "unsupported", action: message.trim().slice(0, 120) };
  }
  if (/\b(pay now|send it|make the payment|complete the transfer)\b/.test(m)) {
    return { type: "unsupported", action: message.trim().slice(0, 120) };
  }

  if (/\b(what if|scenario|stress|delay|late|exchange rate|fx|deprecat|stronger|weaker|costs? (rise|increase|go up))\b/.test(m)) {
    const which =
      /\bdelay|late\b/.test(m) ? "delay"
      : /\b(exchange|fx|rate|currency)\b/.test(m) ? "fx"
      : /\bcost|expense|rent\b/.test(m) ? "costs"
      : "all";
    return { type: "scenario", which };
  }
  if (/\btransfer|remit|send money|quote|cheapest|provider|wise|fee\b/.test(m)) {
    return { type: "transfers" };
  }
  if (/\bcalendar|schedule|upcoming|due dates?\b/.test(m)) {
    return { type: "calendar" };
  }
  if (/\bchecklist|action plan|next steps?|what should i do|todo\b/.test(m)) {
    return { type: "checklist" };
  }
  if (/\bemail|draft|letter|write to\b/.test(m)) {
    const topic = /\binstal|installment|payment plan\b/.test(m) ? "instalment" : "extension";
    return { type: "draft_email", topic };
  }
  if (/\bcan i afford|afford|meet (my|the).*deadline|enough|shortfall|gap|run out|will i\b/.test(m)) {
    return { type: "affordability" };
  }
  return { type: "fallback" };
}

function money(minor: number, currency: string): string {
  return formatMinor(minor, currency);
}

function gapFinding(f: ForecastResult): string {
  const pc = f.planningCurrency;
  if (!f.firstGap) {
    return `No funding gap in the forecast window. The lowest projected balance is ${money(f.minBalanceMinor, pc)}${f.minBalanceDate ? ` on ${formatDateLong(f.minBalanceDate)}` : ""}.`;
  }
  return (
    `A funding gap opens on ${formatDateLong(f.firstGap.date)}: the balance would fall ` +
    `${money(f.firstGap.shortfallMinor, pc)} short, triggered by "${f.firstGap.causeLabel}".`
  );
}

export function runAgent(state: PlanState, message: string, mode: AgentMode = "deterministic"): AgentResult {
  const intent = parseIntent(message);
  const trace: ToolCallTrace[] = [];
  const findings: string[] = [];
  const nextSteps: AgentNextStep[] = [];
  const warnings: string[] = [];
  const pc = state.profile.planningCurrency;

  const call = (tool: string, args: Record<string, unknown>, summary: string) => {
    trace.push({ tool, args, summary });
  };

  // Tool: runForecast — always available to every intent.
  const forecast = buildForecast(state);
  call("runForecast", {}, `${forecast.rows.length} dated events; opening ${money(forecast.openingMinor, pc)}; first gap ${forecast.firstGap ? formatDateLong(forecast.firstGap.date) : "none"}.`);

  if (intent.type === "unsupported") {
    return {
      mode,
      interpretation: `You asked me to take a real-world financial action ("${intent.action}").`,
      trace,
      findings: [
        "StudyRunway is a planning agent: it forecasts, compares and drafts, but it never moves money, submits payments, or contacts institutions on your behalf.",
      ],
      nextSteps: [
        {
          title: "Review the forecast first",
          detail: "Check the Funding Gap Radar to see exactly when money would run short, then decide the action yourself.",
          evidenceRefs: [],
        },
      ],
      warnings: [],
      refused: "I can't execute payments or transfers. I can compare quotes, forecast the impact, and draft the email you would send — the action itself stays with you.",
    };
  }

  if (intent.type === "affordability" || intent.type === "gap" || intent.type === "fallback") {
    findings.push(gapFinding(forecast));
    if (forecast.firstGap && forecast.confirmedFirstGap) {
      findings.push(
        `Counting only confirmed money, the gap opens ${forecast.confirmedFirstGap.date === forecast.firstGap.date ? "on the same date" : `earlier, on ${formatDateLong(forecast.confirmedFirstGap.date)}`} ` +
        `(${money(forecast.confirmedFirstGap.shortfallMinor, pc)} short). ` +
        `${money(forecast.totalUncertainInflowMinor, pc)} of expected funding is conditional, estimated or unverified.`,
      );
    }
    const upcoming = forecast.rows.filter((r) => r.kind === "outflow" && r.date >= forecast.today).slice(0, 3);
    if (upcoming.length > 0) {
      findings.push(
        "Next outflows: " + upcoming.map((r) => `${r.label} — ${money(-r.amountMinor, pc)} due ${formatDateLong(r.date)}`).join("; ") + ".",
      );
    }
    if (forecast.incomplete.length > 0) {
      warnings.push(`${forecast.incomplete.length} item(s) are missing an amount, date or exchange rate and are excluded from the forecast: ${forecast.incomplete.map((i) => i.label).join("; ")}.`);
    }
    if (forecast.firstGap) {
      nextSteps.push({
        title: `Cover the ${money(forecast.firstGap.shortfallMinor, pc)} gap before ${formatDateLong(forecast.firstGap.date)}`,
        detail: `The gap is triggered by "${forecast.firstGap.causeLabel}". Options: bring forward a funding source, split the payment, or negotiate the deadline — see What If? for the effect of each.`,
        evidenceRefs: [],
      });
    }
    if (forecast.totalUncertainInflowMinor > 0) {
      nextSteps.push({
        title: "Nail down uncertain funding",
        detail: `${money(forecast.totalUncertainInflowMinor, pc)} is conditional, estimated or unverified. Confirm dates and amounts, and add evidence in My Money.`,
        evidenceRefs: [],
      });
    }
    return {
      mode,
      interpretation: intent.type === "fallback"
        ? "I read this as a general affordability check. (Try: \"what if my scholarship is delayed?\", \"compare transfer quotes\", or \"draft an email about an instalment plan\".)"
        : "Affordability check against your dated forecast.",
      trace, findings, nextSteps, warnings, refused: null,
    };
  }

  if (intent.type === "scenario") {
    const picked = state.scenarios.filter((s) =>
      intent.which === "all" ? true
      : intent.which === "delay" ? /delay/i.test(s.name)
      : intent.which === "fx" ? /exchange|fx/i.test(s.name)
      : /cost|rise|increase/i.test(s.name),
    );
    const toRun = picked.length > 0 ? picked : state.scenarios;
    if (toRun.length === 0) {
      warnings.push("No scenarios are defined yet — open What If? to create one.");
    }
    for (const s of toRun) {
      const applied = applyScenario(state, s);
      const diff = diffForecasts(forecast, applied.result);
      call("runScenario", { scenario: s.name }, `min balance ${money(applied.result.minBalanceMinor, pc)} (Δ ${money(diff.deltaMinBalanceMinor, pc)}); gap ${diff.gapDateAfter ? formatDateLong(diff.gapDateAfter) : "none"}.`);
      const bits: string[] = [];
      for (const n of applied.appliedNotes) bits.push(n);
      bits.push(`Projected minimum balance moves from ${money(forecast.minBalanceMinor, pc)} to ${money(applied.result.minBalanceMinor, pc)} (Δ ${money(diff.deltaMinBalanceMinor, pc)}).`);
      if (diff.gapDateBefore !== diff.gapDateAfter) {
        bits.push(`First gap moves from ${diff.gapDateBefore ? formatDateLong(diff.gapDateBefore) : "none"} to ${diff.gapDateAfter ? formatDateLong(diff.gapDateAfter) : "none"}.`);
      } else {
        bits.push(`First gap stays ${diff.gapDateAfter ? `on ${formatDateLong(diff.gapDateAfter)}` : "absent"}.`);
      }
      if (diff.shortfallAfterMinor != null && diff.shortfallBeforeMinor !== diff.shortfallAfterMinor) {
        bits.push(`Shortfall changes from ${diff.shortfallBeforeMinor != null ? money(diff.shortfallBeforeMinor, pc) : "—"} to ${money(diff.shortfallAfterMinor, pc)}.`);
      }
      findings.push(`Scenario "${s.name}": ` + bits.join(" "));
    }
    const worst = toRun
      .map((s) => ({ s, r: applyScenario(state, s).result }))
      .sort((a, b) => a.r.minBalanceMinor - b.r.minBalanceMinor)[0];
    if (worst) {
      nextSteps.push({
        title: `Plan for "${worst.s.name}"`,
        detail: `It is the harshest tested scenario (minimum balance ${money(worst.r.minBalanceMinor, pc)}). Keep a buffer for it or line up a fallback funding source.`,
        evidenceRefs: [],
      });
    }
    return { mode, interpretation: "Scenario comparison using the deterministic forecast engine.", trace, findings, nextSteps, warnings, refused: null };
  }

  if (intent.type === "transfers") {
    const { ranked, excluded } = rankQuotes(state.quotes, state.fx, pc);
    call("compareQuotes", { quotes: state.quotes.length }, `${ranked.length} ranked, ${excluded.length} excluded (incomplete or misses deadline).`);
    if (ranked.length > 0) {
      const best = ranked[0];
      findings.push(
        `Best viable quote: ${best.quote.provider} — receive ${best.receivedMinor != null ? money(best.receivedMinor, best.receiveCurrency) : "unknown"}, ` +
        `total cost ${best.totalCostMinor != null ? money(best.totalCostMinor, pc) : "unknown"}, ` +
        `arriving ${formatDateLong(best.arrivalEarliest)}–${formatDateLong(best.arrivalLatest)}` +
        `${best.deadline ? ` (deadline ${formatDateLong(best.deadline)}: ${best.deadlineVerdict})` : ""}.`,
      );
    } else {
      findings.push("No quote is both complete and able to meet the deadline.");
    }
    for (const e of excluded) {
      findings.push(`Excluded: ${e.quote.provider} — ${e.flags.join(" ")}`);
    }
    if (ranked.length > 1) {
      const [a, b] = ranked;
      findings.push(
        `Runner-up ${b.quote.provider} costs ${b.totalCostMinor != null && a.totalCostMinor != null ? money(b.totalCostMinor - a.totalCostMinor, pc) : "?"} more ` +
        `for ${b.receivedMinor != null && a.receivedMinor != null ? money(b.receivedMinor - (a.receivedMinor ?? 0), b.receiveCurrency) : "?"} difference in amount received.`,
      );
    }
    warnings.push("Quotes are samples you enter — StudyRunway shows no live rates and executes no transfer.");
    if (ranked.length > 0) {
      nextSteps.push({
        title: `Use ${ranked[0].quote.provider} for the next transfer`,
        detail: `Initiate it so funds arrive by ${formatDateLong(ranked[0].arrivalLatest)} at the latest. Re-check the rate on the day — the comparison uses the quote as entered.`,
        evidenceRefs: [],
      });
    }
    return { mode, interpretation: "Transfer quote comparison with deadline awareness.", trace, findings, nextSteps, warnings, refused: null };
  }

  if (intent.type === "calendar") {
    const rows = forecast.rows.filter((r) => r.date >= forecast.today).slice(0, 12);
    call("buildPaymentCalendar", { events: rows.length }, `${rows.length} upcoming events listed.`);
    findings.push(
      rows.length === 0
        ? "No upcoming dated events. Add obligations with due dates to build your calendar."
        : "Upcoming: " + rows.map((r) => `${formatDateLong(r.date)} — ${r.label} (${r.kind === "inflow" ? "+" : "−"}${money(Math.abs(r.amountMinor), pc)})`).join("; ") + ".",
    );
    return { mode, interpretation: "Payment calendar from your dated forecast.", trace, findings, nextSteps, warnings, refused: null };
  }

  if (intent.type === "checklist") {
    call("buildChecklist", {}, "Checklist derived from gaps, incomplete items, conflicts and unverified evidence.");
    if (forecast.firstGap) {
      nextSteps.push({
        title: `Close the ${money(forecast.firstGap.shortfallMinor, pc)} gap by ${formatDateLong(forecast.firstGap.date)}`,
        detail: `Triggered by "${forecast.firstGap.causeLabel}".`,
        evidenceRefs: [],
      });
    }
    for (const inc of forecast.incomplete.slice(0, 5)) {
      nextSteps.push({ title: `Resolve: ${inc.label}`, detail: inc.reason, evidenceRefs: [] });
    }
    const conflicts = state.evidence.filter((e) => e.conflictsWith.length > 0 && !e.verified);
    for (const c of conflicts.slice(0, 4)) {
      nextSteps.push({
        title: `Resolve conflicting evidence: ${c.factLabel}`,
        detail: `"${c.valueText}" (${c.documentLabel}) conflicts with another source. Open the Evidence Ledger to pick the correct value.`,
        evidenceRefs: [c.id, ...c.conflictsWith],
      });
    }
    const unverified = state.evidence.filter((e) => !e.verified).length;
    if (unverified > 0) {
      nextSteps.push({
        title: `Verify ${unverified} extracted fact(s)`,
        detail: "Unverified facts are used in the forecast — confirm them in the Evidence Ledger.",
        evidenceRefs: [],
      });
    }
    if (nextSteps.length === 0) {
      findings.push("Nothing urgent: no gap, no missing data, no conflicts, all evidence verified.");
    } else {
      findings.push(`${nextSteps.length} action(s) derived from your data — most urgent first.`);
    }
    return { mode, interpretation: "Action checklist derived from your forecast, evidence and gaps.", trace, findings, nextSteps, warnings, refused: null };
  }

  // draft_email
  const gap = forecast.firstGap;
  const amount = gap ? money(gap.shortfallMinor, pc) : money(0, pc);
  const tuition = state.obligations.find((o) => o.kind === "tuition" && o.status !== "paid");
  const uniLine = state.profile.destinationCountry ? `the admissions/finance office in ${state.profile.destinationCountry}` : "the university finance office";
  const body =
    intent.topic === "instalment"
      ? [
          `Dear Finance Office,`,
          ``,
          `I am writing about my ${tuition ? `"${tuition.label}" of ${money(tuition.amountMinor ?? 0, tuition.currency)} due ${tuition.dueDate ? formatDateLong(tuition.dueDate) : "(date to confirm)"}` : "upcoming tuition payment"}.`,
          gap
            ? `My current funding plan shows a shortfall of ${amount} around ${formatDateLong(gap.date)} because ${gap.causeLabel.toLowerCase()} falls before my full funding is available.`
            : `I would like to understand my options for spreading this payment.`,
          ``,
          `Would it be possible to split this instalment or agree a short payment plan? I can share my funding schedule and evidence of incoming funds if helpful.`,
          ``,
          `Kind regards,`,
          `${state.profile.studentName || "[Your name]"}`,
        ].join("\n")
      : [
          `Dear Finance Office,`,
          ``,
          `I am writing about my ${tuition ? `"${tuition.label}" of ${money(tuition.amountMinor ?? 0, tuition.currency)} due ${tuition.dueDate ? formatDateLong(tuition.dueDate) : "(date to confirm)"}` : "upcoming tuition deadline"}.`,
          gap
            ? `My funding plan projects a shortfall of ${amount} around ${formatDateLong(gap.date)}; a short extension would let confirmed funding clear in time.`
            : `I would like to request a short extension to the payment deadline.`,
          ``,
          `Would a brief extension be possible, and would it affect my enrolment or visa documentation timeline?`,
          ``,
          `Kind regards,`,
          `${state.profile.studentName || "[Your name]"}`,
        ].join("\n");
  call("draftEmail", { topic: intent.topic }, "Draft created from real forecast figures. Not sent.");
  findings.push("Draft email prepared below using your actual forecast figures. It has not been sent — review and send it yourself.");
  if (gap) {
    findings.push(`It references the projected ${amount} shortfall on ${formatDateLong(gap.date)} and ${money(forecast.totalUncertainInflowMinor, pc)} of conditional/estimated funding.`);
  }
  nextSteps.push({
    title: "Review and send the draft yourself",
    detail: `Address it to ${uniLine}. Attach evidence from your Evidence Ledger (offer letter, scholarship letter) before sending.`,
    evidenceRefs: state.evidence.filter((e) => e.verified).map((e) => e.id).slice(0, 5),
  });
  findings.push("---DRAFT---\n" + body);
  return { mode, interpretation: `Drafting a ${intent.topic === "instalment" ? "payment-instalment request" : "deadline-extension request"} email from your forecast.`, trace, findings, nextSteps, warnings, refused: null };
}

/** Names of the tools the agent can call — shown in the UI as the agent's capability list. */
export const AGENT_TOOLS = [
  "runForecast",
  "runScenario",
  "compareQuotes",
  "buildPaymentCalendar",
  "buildChecklist",
  "draftEmail",
] as const;
