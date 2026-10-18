"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  ArrowDownLeft,
  ArrowLeftRight,
  Bell,
  CalendarClock,
  CircleAlert,
  CreditCard,
  Landmark,
  MessagesSquare,
  WalletCards,
} from "lucide-react";
import { OPEN_REMINDER_EVENT, loadReminders, REMINDERS_CHANGE_EVENT, type Reminder } from "@/lib/reminders";
import { buildFeeDeadlineAlerts, localDateToday } from "@/lib/feeAlerts";
import { requestReminder } from "@/lib/reminders";
import { asArray, asNumber, asString, formatMinorMoney, formatMoney, isRecord } from "../results/shared";
import DailyBudgetPlanner from "./DailyBudgetPlanner";
import ArrivalCostPlanner from "./ArrivalCostPlanner";
import IncomeShockPlan from "./IncomeShockPlan";
import RentalSafetyCheck from "./RentalSafetyCheck";

interface DashboardResult {
  component: string;
  data: Record<string, unknown>;
}

interface DashboardMessage {
  id: string;
  role: "user" | "assistant";
  results: DashboardResult[];
  pendingClarifications: { id: string; prompt?: string; question?: string }[];
}

interface ResultSource extends DashboardResult {
  messageId: string;
}

interface ActionItem {
  id: string;
  label: string;
  detail: string;
  deadline: string;
  urgency: string;
}

interface CashFlowRecord {
  id: string;
  label: string;
  kind: string;
  amountMinor: number | null;
  currency: string;
  date: string | null;
  status: string;
  recurring: { everyMonths: number; occurrences: number } | null;
}

interface CashFlowView {
  planningCurrency: string;
  asOfDate: string;
  fundingSources: CashFlowRecord[];
  bills: CashFlowRecord[];
  fxAssumptions: { pair: string; rate: number; asOf: string; source: string }[];
}

interface CashFlowGroup {
  currency: string;
  records: CashFlowRecord[];
  availableMinor: number | null;
  confirmedPendingMinor: number | null;
  uncertainMinor: number | null;
  billsMinor: number | null;
  hasUnknownAmounts: boolean;
}

interface Props {
  messages: DashboardMessage[];
  onAsk: (prompt: string) => void;
  onOpenConversation: (messageId: string) => void;
  disabled?: boolean;
}

function resultEntries(messages: DashboardMessage[]): ResultSource[] {
  return messages.flatMap((message) =>
    message.role === "assistant"
      ? message.results.map((result) => ({ ...result, messageId: message.id }))
      : [],
  );
}

function latestResult(entries: ResultSource[], component: string): ResultSource | null {
  return [...entries].reverse().find((entry) => entry.component === component) ?? null;
}

function readActions(data: Record<string, unknown> | null): ActionItem[] {
  if (!data) return [];
  return asArray<unknown>(data["actions"] ?? data["items"] ?? data["steps"])
    .map((value, index) => {
      if (typeof value === "string") {
        return { id: `action-${index}`, label: value, detail: "", deadline: "", urgency: "" };
      }
      if (!isRecord(value)) return null;
      return {
        id: asString(value["id"], `action-${index}`),
        label: asString(value["label"] ?? value["title"], `Next step ${index + 1}`),
        detail: asString(value["purpose"] ?? value["detail"] ?? value["description"]),
        deadline: asString(value["deadlineDisplay"] ?? value["deadline"]),
        urgency: asString(value["urgency"]),
      };
    })
    .filter((item): item is ActionItem => item !== null);
}

function readShortfall(data: Record<string, unknown>) {
  const shortfall = isRecord(data["shortfall"]) ? data["shortfall"] : null;
  const amountMinor = asNumber(shortfall?.["amountMinor"] ?? data["shortfallMinor"]);
  const amount = asNumber(shortfall?.["amount"] ?? data["shortfall"]);
  const currency = asString(shortfall?.["currency"] ?? data["planningCurrency"] ?? data["currency"]);
  const date = asString(shortfall?.["date"] ?? data["gapDate"]);
  return {
    hasGap: data["hasGap"] === true || (amountMinor !== null && amountMinor > 0) || (amount !== null && amount > 0),
    knownNoGap: data["hasGap"] === false,
    amountText: amountMinor !== null && currency
      ? formatMinorMoney(amountMinor, currency)
      : amount !== null
        ? formatMoney(amount, currency)
        : null,
    date,
    currency,
    verdict: asString(data["verdict"] ?? data["summary"]),
  };
}

function readCashFlow(data: Record<string, unknown> | null): CashFlowView | null {
  const value = data?.["cashFlow"];
  if (!isRecord(value)) return null;

  const parseRecords = (input: unknown, direction: "in" | "out"): CashFlowRecord[] =>
    asArray<unknown>(input).flatMap((item, index) => {
      if (!isRecord(item)) return [];
      const currency = asString(item["currency"]).toUpperCase();
      const label = asString(item["label"]).trim();
      if (!/^[A-Z]{3}$/.test(currency) || !label) return [];
      const rawAmount = item["amountMinor"];
      const amountMinor = typeof rawAmount === "number" && Number.isSafeInteger(rawAmount) ? rawAmount : null;
      const dateValue = direction === "in"
        ? item["status"] === "confirmed_available"
          ? item["availableDate"]
          : item["expectedDate"] ?? item["availableDate"]
        : item["dueDate"];
      const date = asString(dateValue) || null;
      const recurringValue = item["recurring"];
      const recurring = isRecord(recurringValue)
        && Number.isInteger(recurringValue["everyMonths"])
        && Number.isInteger(recurringValue["occurrences"])
        ? { everyMonths: Number(recurringValue["everyMonths"]), occurrences: Number(recurringValue["occurrences"]) }
        : null;
      return [{
        id: asString(item["id"], `${direction}-${index}`),
        label,
        kind: asString(item["kind"]),
        amountMinor,
        currency,
        date,
        status: asString(item["status"]),
        recurring,
      }];
    });

  const fxAssumptions = asArray<unknown>(value["fxAssumptions"]).flatMap((item) => {
    if (!isRecord(item)) return [];
    const pair = asString(item["pair"]);
    const rate = asNumber(item["rate"]);
    if (!pair || rate === null || rate <= 0) return [];
    return [{ pair, rate, asOf: asString(item["asOf"]), source: asString(item["source"]) }];
  });

  return {
    planningCurrency: asString(value["planningCurrency"]).toUpperCase(),
    asOfDate: asString(value["asOfDate"]),
    fundingSources: parseRecords(value["fundingSources"], "in"),
    bills: parseRecords(value["bills"], "out"),
    fxAssumptions,
  };
}

function groupCashFlow(records: CashFlowRecord[], direction: "in" | "out"): CashFlowGroup[] {
  const groups = new Map<string, CashFlowRecord[]>();
  for (const record of records) groups.set(record.currency, [...(groups.get(record.currency) ?? []), record]);
  return [...groups.entries()]
    .map(([currency, items]) => {
      const sum = (selected: CashFlowRecord[]) => {
        const amounts = selected.flatMap((item) => item.amountMinor === null ? [] : [item.amountMinor]);
        const total = amounts.reduce((subtotal, amount) => subtotal + amount, 0);
        return amounts.length > 0 && Number.isSafeInteger(total) ? total : null;
      };
      return {
        currency,
        records: [...items].sort((a, b) => (a.date ?? "9999-99-99").localeCompare(b.date ?? "9999-99-99")),
        availableMinor: direction === "in" ? sum(items.filter((item) => item.status === "confirmed_available")) : null,
        confirmedPendingMinor: direction === "in" ? sum(items.filter((item) => item.status === "confirmed_pending")) : null,
        uncertainMinor: direction === "in" ? sum(items.filter((item) => !["confirmed_available", "confirmed_pending"].includes(item.status))) : null,
        billsMinor: direction === "out" ? sum(items) : null,
        hasUnknownAmounts: items.some((item) => item.amountMinor === null),
      };
    })
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

function cashFlowStatus(status: string, direction: "in" | "out"): string {
  if (direction === "out") return status === "committed" ? "Committed" : "Planned";
  return ({
    confirmed_available: "Available",
    confirmed_pending: "Confirmed incoming",
    conditional: "Conditional",
    estimated: "Estimated",
    unverified: "Unverified",
  } as Record<string, string>)[status] ?? "Status unknown";
}

function displayCashFlowDate(date: string | null, direction: "in" | "out", status: string, asOfDate: string): string {
  if (date) return date;
  if (direction === "out") return "Due date not provided";
  return status === "confirmed_available" ? `Available by ${asOfDate || "today"}` : "Expected date not provided";
}

function relevantFxAssumptions(cashFlow: CashFlowView): CashFlowView["fxAssumptions"] {
  const currencies = new Set([
    ...cashFlow.fundingSources.map((item) => item.currency),
    ...cashFlow.bills.map((item) => item.currency),
  ]);
  return cashFlow.fxAssumptions.filter(({ pair }) => {
    const [from, to, ...rest] = pair.split(">");
    return rest.length === 0 && Boolean(from && to)
      && (to === cashFlow.planningCurrency && currencies.has(from)
        || from === cashFlow.planningCurrency && currencies.has(to));
  });
}

function formatReminderTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Time unavailable"
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function alertUrgencyLabel(urgency: string, daysUntil: number | null): string {
  if (urgency === "overdue") return `${Math.abs(daysUntil ?? 0)} day${Math.abs(daysUntil ?? 0) === 1 ? "" : "s"} overdue`;
  if (urgency === "due_today") return "Due today";
  if (urgency === "due_soon") return `Due in ${daysUntil} day${daysUntil === 1 ? "" : "s"}`;
  if (urgency === "upcoming") return `Upcoming · ${daysUntil} days`;
  return "Review forecast";
}

function alertTone(urgency: string): string {
  if (urgency === "overdue" || urgency === "due_today") return "border-[var(--sr-clay)]/30 bg-[var(--sr-clay)]/5 text-[var(--sr-clay)]";
  if (urgency === "due_soon") return "border-[var(--sr-amber)]/35 bg-[var(--sr-amber)]/5 text-[var(--sr-amber)]";
  return "border-[var(--sr-line)] bg-white/60 text-[var(--sr-ink)]/60";
}

function WorkflowStepHeader({
  number,
  title,
  complete,
}: {
  number: number;
  title: string;
  complete: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <span
        aria-hidden="true"
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${complete ? "bg-[var(--sr-pine)] text-white" : "bg-[var(--sr-mist)] text-[var(--sr-ink)]/60"}`}
      >
        {complete ? "✓" : number}
      </span>
      <div className="min-w-0">
        <h4 className="text-sm font-bold leading-snug text-[var(--sr-ink)]">{title}</h4>
        <p className={`mt-0.5 text-[10px] font-semibold uppercase tracking-wide ${complete ? "text-[var(--sr-pine)]" : "text-[var(--sr-ink)]/45"}`}>
          {complete ? "Ready" : "To do"}
        </p>
      </div>
    </div>
  );
}

export default function Dashboard({ messages, onAsk, onOpenConversation, disabled = false }: Props) {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [today, setToday] = useState("");
  const entries = useMemo(() => resultEntries(messages), [messages]);
  const fundingSource = useMemo(() => latestResult(entries, "financial_outcome"), [entries]);
  const planSource = useMemo(() => latestResult(entries, "action_plan"), [entries]);
  const scenarioSource = useMemo(() => latestResult(entries, "scenario_comparison"), [entries]);
  const emailSource = useMemo(() => latestResult(entries, "draft_email"), [entries]);
  const latestDocument = useMemo(() => latestResult(entries, "document_review"), [entries]);
  const funding = useMemo(
    () => fundingSource ? readShortfall(fundingSource.data) : null,
    [fundingSource],
  );
  const cashFlow = useMemo(
    () => fundingSource ? readCashFlow(fundingSource.data) : null,
    [fundingSource],
  );
  const actions = useMemo(() => readActions(planSource?.data ?? null).slice(0, 4), [planSource]);
  const feeAlerts = useMemo(() => today ? buildFeeDeadlineAlerts(messages, today) : [], [messages, today]);
  const pendingQuestions = messages.flatMap((message) =>
    message.role === "assistant" && message.pendingClarifications.length > 0
      ? [{ messageId: message.id, count: message.pendingClarifications.length }]
      : [],
  );

  useEffect(() => {
    const refresh = () => setReminders(loadReminders());
    const refreshDate = () => setToday(localDateToday());
    refresh();
    refreshDate();
    window.addEventListener(REMINDERS_CHANGE_EVENT, refresh);
    window.addEventListener("storage", refresh);
    const dateTimer = window.setInterval(refreshDate, 60_000);
    return () => {
      window.removeEventListener(REMINDERS_CHANGE_EVENT, refresh);
      window.removeEventListener("storage", refresh);
      window.clearInterval(dateTimer);
    };
  }, []);

  const openReminderForm = () => {
    window.dispatchEvent(new CustomEvent(OPEN_REMINDER_EVENT));
  };

  const activeReminders = reminders.filter((reminder) => !reminder.notifiedAt).slice(0, 3);
  const hasFinanceContext = fundingSource !== null || planSource !== null || latestDocument !== null;
  const statusTitle = funding?.hasGap
    ? "A tuition shortfall needs a plan"
    : funding?.knownNoGap
      ? "Tuition appears covered in this forecast"
      : fundingSource
        ? "Review your tuition funding check"
        : "Start with your tuition and funding dates";
  const scholarshipDelayComplete = scenarioSource?.data["scenarioType"] === "scholarship_delay";
  const workflowSteps = [
    { number: 1, title: "Check funds against the deadline", complete: fundingSource !== null },
    { number: 2, title: "Stress-test a late scholarship", complete: scholarshipDelayComplete },
    { number: 3, title: "Create prioritized next steps", complete: planSource !== null },
    { number: 4, title: "Prepare a university email draft", complete: emailSource !== null },
  ];

  return (
    <main className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-9">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-[var(--sr-pine)]">StudyRunway overview</p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Your study finances, at a glance</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--sr-ink)]/65">
              Deadlines, funding checks, next steps, and reminders from your conversations.
            </p>
          </div>
          <p className="rounded-full border border-[var(--sr-line)] bg-white/55 px-3 py-1.5 text-xs text-[var(--sr-ink)]/60">
            Saved on this browser
          </p>
        </div>

        <section className={`mt-7 overflow-hidden rounded-3xl border ${funding?.hasGap ? "border-[var(--sr-amber)]/45 bg-[#fbf3e2]" : "border-[var(--sr-line)] bg-white/70"}`} aria-labelledby="dashboard-tuition-plan-title">
          <div className="p-5 sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-2xl">
                <div className="flex items-center gap-2 text-xs font-semibold text-[var(--sr-pine)]">
                  <WalletCards size={15} aria-hidden="true" />
                  Guided tuition workflow
                </div>
                <h3 id="dashboard-tuition-plan-title" className="mt-2 text-xl font-bold leading-snug sm:text-2xl">Tuition shortfall plan</h3>
                <p className="mt-1 text-sm leading-relaxed text-[var(--sr-ink)]/65">Check the deadline, test a funding delay, get prioritized next steps, and prepare a message for your university.</p>
              </div>
              <span className="rounded-full border border-[var(--sr-line)] bg-white/60 px-3 py-1.5 text-[11px] font-semibold text-[var(--sr-ink)]/60">
                {workflowSteps.filter((step) => step.complete).length} of 4 steps ready
              </span>
            </div>

            <div className={`mt-5 rounded-2xl border px-4 py-3.5 ${funding?.hasGap ? "border-[var(--sr-amber)]/35 bg-white/70" : "border-[var(--sr-line)] bg-white/55"}`}>
              <p className="text-sm font-bold text-[var(--sr-ink)]">{statusTitle}</p>
              {funding?.hasGap && funding.amountText ? (
                <p className="mt-1 text-sm text-[var(--sr-ink)]/75">
                  Forecast shortfall: <strong>{funding.amountText}</strong>{funding.date && <> by <strong>{funding.date}</strong></>}
                </p>
              ) : funding?.verdict ? (
                <p className="mt-1 text-sm leading-relaxed text-[var(--sr-ink)]/65">{funding.verdict}</p>
              ) : (
                <p className="mt-1 text-sm leading-relaxed text-[var(--sr-ink)]/65">Add confirmed funds, expected scholarship dates, tuition amount, currency, and due date. The forecast will keep uncertain money separate.</p>
              )}
              {fundingSource && (
                <button type="button" onClick={() => onOpenConversation(fundingSource.messageId)} className="mt-2 inline-flex items-center gap-1 rounded-lg text-xs font-semibold text-[var(--sr-pine)] underline underline-offset-4 hover:text-[var(--sr-pine)]/75">
                  Review funding calculation <ArrowUpRight size={13} aria-hidden="true" />
                </button>
              )}
            </div>

            <ol className="mt-4 grid gap-3 md:grid-cols-2" aria-label="Tuition shortfall plan steps">
              <li className="rounded-2xl border border-[var(--sr-line)] bg-white/70 p-4">
                <WorkflowStepHeader number={1} title="Check funds against the deadline" complete={fundingSource !== null} />
                <p className="mt-2 text-xs leading-relaxed text-[var(--sr-ink)]/60">Compare money available by the due date with tuition and other dated bills.</p>
                <button type="button" onClick={() => onAsk("Create or update my tuition shortfall plan. Ask for any missing tuition amount, currency, due date, confirmed funds available by that date, and expected funding amounts and arrival dates. Treat an unqualified $ as USD and say that assumption. Once enough details are confirmed, calculate the dated funding gap and separate available, expected, and uncertain money. Do not invent figures or dates.")} disabled={disabled} className="mt-3 rounded-lg bg-[var(--sr-pine)] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[var(--sr-pine)]/90 disabled:opacity-50">
                  {fundingSource ? "Update funding check" : "Start funding check"}
                </button>
              </li>
              <li className="rounded-2xl border border-[var(--sr-line)] bg-white/70 p-4">
                <WorkflowStepHeader number={2} title="Stress-test a late scholarship" complete={scholarshipDelayComplete} />
                <p className="mt-2 text-xs leading-relaxed text-[var(--sr-ink)]/60">Compare your forecast with a clearly labeled 14-day delay. This is a what-if, not a prediction.</p>
                <button type="button" onClick={() => onAsk("In my tuition shortfall plan, simulate what happens if the scholarship arrives 14 days late. Use only my latest confirmed tuition and funding details; compare the baseline and delayed scenario, including the remaining shortfall and date. If there is no single dated scholarship in the plan, ask me which funding source and expected date to use. Do not change my baseline plan or treat the scholarship as guaranteed.")} disabled={disabled} className="mt-3 rounded-lg border border-[var(--sr-line)] bg-white px-3 py-2 text-xs font-semibold text-[var(--sr-pine)] transition hover:bg-[var(--sr-mist)] disabled:opacity-50">
                  {scholarshipDelayComplete ? "Re-run delay scenario" : "Test a 14-day delay"}
                </button>
                {scenarioSource && <button type="button" onClick={() => onOpenConversation(scenarioSource.messageId)} className="ml-3 text-xs font-semibold text-[var(--sr-pine)] underline underline-offset-4">Review latest scenario</button>}
              </li>
              <li className="rounded-2xl border border-[var(--sr-line)] bg-white/70 p-4">
                <WorkflowStepHeader number={3} title="Create prioritized next steps" complete={planSource !== null} />
                <p className="mt-2 text-xs leading-relaxed text-[var(--sr-ink)]/60">Prioritize the deadline and confirm uncertain funding. University options are suggestions to verify, not promises.</p>
                {actions.length > 0 && (
                  <ul className="mt-3 space-y-2 border-t border-[var(--sr-line)] pt-3">
                    {actions.slice(0, 2).map((action) => (
                      <li key={action.id} className="text-xs">
                        <p className="font-semibold text-[var(--sr-ink)]">{action.label}</p>
                        {(action.urgency || action.deadline) && <p className="mt-0.5 text-[10px] font-medium text-[var(--sr-amber)]">{action.urgency}{action.urgency && action.deadline ? " · " : ""}{action.deadline}</p>}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-3 flex items-center gap-3">
                  <button type="button" onClick={() => onAsk("Build or update the prioritized next steps for my tuition shortfall plan using my confirmed funding forecast. Put the earliest tuition deadline and amount gap first, then list funding dates that need confirmation and any missing information. Do not assume a payment plan, extension, grant, or scholarship is approved. Show what to verify with the university.")} disabled={disabled} className="rounded-lg border border-[var(--sr-line)] bg-white px-3 py-2 text-xs font-semibold text-[var(--sr-pine)] transition hover:bg-[var(--sr-mist)] disabled:opacity-50">
                    {planSource ? "Update next steps" : "Build next steps"}
                  </button>
                  {planSource && <button type="button" onClick={() => onOpenConversation(planSource.messageId)} className="text-xs font-semibold text-[var(--sr-pine)] underline underline-offset-4">Review action plan</button>}
                </div>
              </li>
              <li className="rounded-2xl border border-[var(--sr-line)] bg-white/70 p-4">
                <WorkflowStepHeader number={4} title="Prepare a university email draft" complete={emailSource !== null} />
                <p className="mt-2 text-xs leading-relaxed text-[var(--sr-ink)]/60">Ask about an installment plan, deadline extension, or emergency support using only your confirmed details.</p>
                <button type="button" onClick={() => onAsk("Draft an email to my university's student finance office about my tuition shortfall. Use only confirmed figures and dates from my plan, ask about available installment arrangements, an extension, or emergency student support, and clearly phrase these as questions rather than guaranteed options. Ask me for any missing recipient or identifying details. The draft must be shown for my approval and must never be sent.")} disabled={disabled} className="mt-3 rounded-lg border border-[var(--sr-line)] bg-white px-3 py-2 text-xs font-semibold text-[var(--sr-pine)] transition hover:bg-[var(--sr-mist)] disabled:opacity-50">
                  {emailSource ? "Prepare another draft" : "Prepare email draft"}
                </button>
                {emailSource && <button type="button" onClick={() => onOpenConversation(emailSource.messageId)} className="ml-3 text-xs font-semibold text-[var(--sr-pine)] underline underline-offset-4">Review latest draft</button>}
              </li>
            </ol>
            <p className="mt-4 border-t border-[var(--sr-line)]/80 pt-3 text-[11px] leading-relaxed text-[var(--sr-ink)]/50">
              Scenarios do not change your forecast. Email drafts require your review; StudyRunway does not send messages or payments.
            </p>
          </div>
        </section>

        <IncomeShockPlan onAsk={onAsk} disabled={disabled} />

        <RentalSafetyCheck onAsk={onAsk} disabled={disabled} />

        {today && (
          <section className="mt-5 rounded-2xl border border-[var(--sr-amber)]/35 bg-[#fbf3e2]/70 p-5 sm:p-6" aria-labelledby="dashboard-fee-alerts-title">
            <div className="flex items-start gap-3">
              <CircleAlert size={18} className="mt-0.5 shrink-0 text-[var(--sr-amber)]" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-[var(--sr-amber)]">Automatic checks from your latest finance results</p>
                <h3 id="dashboard-fee-alerts-title" className="mt-1 text-lg font-bold">Fee &amp; deadline alerts</h3>
              </div>
            </div>
            {feeAlerts.length > 0 ? (
              <ul className="mt-4 space-y-3">
                {feeAlerts.map((alert) => (
                  <li key={alert.id} className="flex flex-col gap-3 rounded-xl border border-[var(--sr-line)] bg-white/75 p-3 sm:flex-row sm:items-start sm:justify-between sm:p-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-[var(--sr-ink)]">{alert.title}</p>
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${alertTone(alert.urgency)}`}>
                          {alertUrgencyLabel(alert.urgency, alert.daysUntil)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-[var(--sr-ink)]/65">{alert.description}</p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      {alert.messageId && (
                        <button type="button" onClick={() => onOpenConversation(alert.messageId)} className="rounded-lg border border-[var(--sr-line)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--sr-ink)]/70 hover:bg-[var(--sr-mist)]">
                          Review result
                        </button>
                      )}
                      <button type="button" onClick={() => requestReminder(alert.reminderTitle)} className="rounded-lg bg-[var(--sr-pine)] px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-[var(--sr-pine)]/90">
                        Set reminder
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-4 rounded-xl bg-white/65 px-4 py-4">
                <p className="text-sm font-medium">No upcoming fee deadline or shortfall found</p>
                <p className="mt-1 text-xs leading-relaxed text-[var(--sr-ink)]/60">Run a funding check or create a dated action plan to surface deadlines. Alerts use only dates and figures from your results.</p>
              </div>
            )}
            <p className="mt-4 border-t border-[var(--sr-line)]/80 pt-3 text-[11px] leading-relaxed text-[var(--sr-ink)]/50">
              Browser reminders are saved on this device and work while StudyRunway is open. Cross-device alerts need sign-in and a notification service, which are not configured yet.
            </p>
          </section>
        )}

        <section className="mt-5 rounded-2xl border border-[var(--sr-line)] bg-white/70 p-5 sm:p-6" aria-labelledby="dashboard-cash-flow-title">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold text-[var(--sr-ink)]/55">
                <ArrowLeftRight size={15} aria-hidden="true" />
                Original currencies · no combined total
              </div>
              <h3 id="dashboard-cash-flow-title" className="mt-1 text-lg font-bold">Multi-currency cash flow</h3>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[var(--sr-ink)]/60">
                Upcoming funds and unpaid bills stay in their stated currencies. Totals are grouped by currency, never added across currencies.
              </p>
            </div>
            {fundingSource && (
              <button type="button" onClick={() => onOpenConversation(fundingSource.messageId)} className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-[var(--sr-pine)] underline underline-offset-4">
                Open funding result
              </button>
            )}
          </div>

          {cashFlow ? (
            <>
              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                {([
                  { title: "Expected funds", direction: "in" as const, groups: groupCashFlow(cashFlow.fundingSources, "in"), icon: ArrowDownLeft },
                  { title: "Upcoming bills", direction: "out" as const, groups: groupCashFlow(cashFlow.bills, "out"), icon: ArrowUpRight },
                ]).map(({ title, direction, groups, icon: Icon }) => (
                  <div key={title} className="rounded-xl border border-[var(--sr-line)] bg-white/70 p-4">
                    <div className="flex items-center gap-2 text-sm font-bold">
                      <Icon size={16} className={direction === "in" ? "text-[var(--sr-pine)]" : "text-[var(--sr-amber)]"} aria-hidden="true" />
                      {title}
                    </div>
                    {groups.length ? (
                      <div className="mt-3 space-y-4">
                        {groups.map((group) => (
                          <div key={`${title}-${group.currency}`}>
                            <div className="flex items-baseline justify-between gap-3 border-b border-[var(--sr-line)] pb-1.5">
                              <span className="text-xs font-bold uppercase tracking-wide text-[var(--sr-pine)]">{group.currency}</span>
                              <span className="text-right text-[10px] font-semibold leading-relaxed tabular-nums">
                                {direction === "in" ? (
                                  <>
                                    <span className="block">Available {group.availableMinor === null ? "—" : formatMinorMoney(group.availableMinor, group.currency)}</span>
                                    <span className="block">Confirmed incoming {group.confirmedPendingMinor === null ? "—" : formatMinorMoney(group.confirmedPendingMinor, group.currency)}</span>
                                    <span className="block">Conditional / estimated {group.uncertainMinor === null ? "—" : formatMinorMoney(group.uncertainMinor, group.currency)}</span>
                                  </>
                                ) : (
                                  <span className="block">{group.billsMinor === null ? "Known subtotal unavailable" : `Known subtotal ${formatMinorMoney(group.billsMinor, group.currency)}`}</span>
                                )}
                                {group.hasUnknownAmounts && <span className="block font-normal text-[var(--sr-ink)]/50">Unknown amounts excluded</span>}
                              </span>
                            </div>
                            <ul className="divide-y divide-[var(--sr-line)]/70">
                              {group.records.map((record, index) => (
                                <li key={`${record.id}-${record.date ?? "undated"}-${index}`} className="py-2.5 first:pt-2 last:pb-0">
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <p className="break-words text-xs font-semibold">{record.label}</p>
                                      <p className="mt-0.5 text-[11px] text-[var(--sr-ink)]/55">
                                        {displayCashFlowDate(record.date, direction, record.status, cashFlow.asOfDate)}
                                        {record.recurring && ` · every ${record.recurring.everyMonths} month${record.recurring.everyMonths === 1 ? "" : "s"}, ${record.recurring.occurrences} occurrences`}
                                      </p>
                                    </div>
                                    <div className="shrink-0 text-right">
                                      <p className="text-xs font-bold tabular-nums">{record.amountMinor === null ? "Amount unknown" : formatMinorMoney(record.amountMinor, record.currency)}</p>
                                      <p className="mt-0.5 text-[10px] text-[var(--sr-ink)]/50">{cashFlowStatus(record.status, direction)}</p>
                                    </div>
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-3 rounded-lg bg-[var(--sr-mist)]/45 px-3 py-3 text-xs text-[var(--sr-ink)]/60">
                        No {direction === "in" ? "funding sources" : "unpaid bills"} in the latest funding result.
                      </p>
                    )}
                  </div>
                ))}
              </div>

              <div className="mt-4 rounded-xl border border-[var(--sr-amber)]/30 bg-[#fbf3e2]/55 p-4">
                <p className="text-xs font-bold">Exchange-rate assumptions</p>
                {relevantFxAssumptions(cashFlow).length ? (
                  <ul className="mt-2 space-y-1.5">
                    {relevantFxAssumptions(cashFlow).map((assumption) => {
                      const [from, to] = assumption.pair.split(">");
                      return (
                        <li key={`${assumption.pair}-${assumption.asOf}-${assumption.source}`} className="text-[11px] leading-relaxed text-[var(--sr-ink)]/70">
                          <strong className="font-semibold">1 {from} = {assumption.rate.toLocaleString(undefined, { maximumSignificantDigits: 10 })} {to}</strong>
                          {` · ${assumption.asOf || "date not provided"} · ${assumption.source || "source not provided"}`}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--sr-ink)]/65">
                    No matching FX assumption was provided for these currencies and the planning currency ({cashFlow.planningCurrency || "unknown"}). Figures remain in their original currencies; no live rate is shown.
                  </p>
                )}
                <p className="mt-2 text-[10px] leading-relaxed text-[var(--sr-ink)]/50">
                  Rates are assumptions from the latest funding result, not live transfer quotes. As of {cashFlow.asOfDate || "date not provided"}; verify rates and fees with a provider before sending money.
                </p>
              </div>
            </>
          ) : (
            <div className="mt-4 rounded-xl bg-[var(--sr-mist)]/45 px-4 py-4">
              <p className="text-sm font-medium">Add a funding check to populate the cash-flow view</p>
              <p className="mt-1 text-xs leading-relaxed text-[var(--sr-ink)]/60">The dashboard needs your dated funding sources, unpaid bills, original currencies, and any FX assumptions you have. It won’t estimate missing rates.</p>
              <button type="button" onClick={() => onAsk("Build a multi-currency cash-flow view from my current plan. Show expected funding and unpaid bills in their original currencies, and clearly label the date and source of each exchange-rate assumption. Ask me for missing amounts, currencies, or dates; never estimate an FX rate.")} disabled={disabled} className="mt-3 text-xs font-semibold text-[var(--sr-pine)] underline underline-offset-4 disabled:opacity-50">
                Build cash-flow view
              </button>
            </div>
          )}
        </section>

        <section className="mt-5 flex flex-col gap-4 rounded-2xl border border-[var(--sr-line)] bg-white/60 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6" aria-labelledby="dashboard-transfer-plan-title">
          <div className="flex items-start gap-3">
            <ArrowLeftRight size={18} className="mt-0.5 shrink-0 text-[var(--sr-pine)]" aria-hidden="true" />
            <div>
              <p className="text-xs font-semibold text-[var(--sr-pine)]">Pay by the deadline</p>
              <h3 id="dashboard-transfer-plan-title" className="mt-1 text-lg font-bold">Compare tuition transfer offers</h3>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[var(--sr-ink)]/60">Fetch an indicative Wise quote when enabled, then compare it with provider quotes by recipient amount, fees, delivery window, and tuition deadline. Other providers are entered manually; recipient-bank charges must be confirmed.</p>
            </div>
          </div>
          <button type="button" onClick={() => onAsk("Help me compare transfer offers for a tuition payment. Ask for the send and receive currencies, amount, payment deadline, and each actual provider quote: rate, whether sender fee is deducted or added, sender fee, intermediary or recipient fee, delivery window, quote time, and any send limits. Rank deadline-feasible offers by net amount the university receives. Mark user-entered quotes as unverified, exclude unknown fees from confident rankings, and never invent a live rate or claim that a reference estimate is a provider quote.")} disabled={disabled} className="shrink-0 rounded-xl bg-[var(--sr-pine)] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--sr-pine)]/90 disabled:opacity-50">
            Compare offers
          </button>
        </section>

        <DailyBudgetPlanner onAsk={onAsk} disabled={disabled} />
        <ArrivalCostPlanner onAsk={onAsk} disabled={disabled} />

        <section className="mt-5 flex flex-col gap-4 rounded-2xl border border-[var(--sr-line)] bg-white/60 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6" aria-labelledby="dashboard-credit-guide-title">
          <div className="flex items-start gap-3">
            <CreditCard size={18} className="mt-0.5 shrink-0 text-[var(--sr-pine)]" aria-hidden="true" />
            <div>
              <p className="text-xs font-semibold text-[var(--sr-pine)]">Official-source research</p>
              <h3 id="dashboard-credit-guide-title" className="mt-1 text-lg font-bold">Credit-building guide by destination</h3>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[var(--sr-ink)]/60">Learn how students may start a local credit history and what to check when a landlord or provider asks for a cosigner. Cited sources, eligibility caveats, and no promise of approval.</p>
            </div>
          </div>
          <button type="button" onClick={() => onAsk("Research an official-source guide for an international student starting a local credit history in my destination country. Include source-supported ways to check a credit file, eligibility requirements and limitations, and official alternatives or processes to ask about when renting or opening services without a local history or cosigner. Ask for my destination country if it is not confirmed. Do not recommend borrowing or imply I qualify, will be approved, or that an alternative is guaranteed.")} disabled={disabled} className="shrink-0 rounded-xl bg-[var(--sr-pine)] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--sr-pine)]/90 disabled:opacity-50">
            Research credit guide
          </button>
        </section>

        <section className="mt-5 flex flex-col gap-4 rounded-2xl border border-[var(--sr-line)] bg-white/60 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6" aria-labelledby="dashboard-banking-guide-title">
          <div className="flex items-start gap-3">
            <Landmark size={18} className="mt-0.5 shrink-0 text-[var(--sr-pine)]" aria-hidden="true" />
            <div>
              <p className="text-xs font-semibold text-[var(--sr-pine)]">Official-source research</p>
              <h3 id="dashboard-banking-guide-title" className="mt-1 text-lg font-bold">Set up banking in your destination</h3>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[var(--sr-ink)]/60">Check official account-opening documents, fees, timing, and whether you can apply before arrival. Requirements depend on country and provider.</p>
            </div>
          </div>
          <button type="button" onClick={() => onAsk("Research official banking setup guidance for an international student moving to my destination. Ask me for the country if not confirmed. Find official government, financial-regulator, bank, or university pages that state account-opening documents, address/residency requirements, fees, appointment or processing time, and whether opening before arrival is allowed. Include practical official fallback ways to pay early rent and bills if no local account is available. Cite every factual claim, state when checked, do not guarantee eligibility, and do not invent provider terms.")} disabled={disabled} className="shrink-0 rounded-xl bg-[var(--sr-pine)] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--sr-pine)]/90 disabled:opacity-50">
            Research banking setup
          </button>
        </section>

        <div className="mt-5">
          <section className="rounded-2xl border border-[var(--sr-line)] bg-white/60 p-5 sm:p-6" aria-labelledby="dashboard-reminders-title">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-xs font-semibold text-[var(--sr-ink)]/55"><Bell size={15} aria-hidden="true" />On this browser</div>
                <h3 id="dashboard-reminders-title" className="mt-1 text-lg font-bold">Reminders</h3>
              </div>
              <button type="button" onClick={openReminderForm} className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-[var(--sr-pine)] underline underline-offset-4">Add reminder</button>
            </div>
            {activeReminders.length ? (
              <ul className="mt-4 space-y-3">
                {activeReminders.map((reminder) => (
                  <li key={reminder.id} className="flex items-start gap-3">
                    <CalendarClock size={16} className="mt-0.5 shrink-0 text-[var(--sr-pine)]" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="break-words text-sm font-medium">{reminder.title}</p>
                      <p className="mt-1 text-xs text-[var(--sr-ink)]/55">{formatReminderTime(reminder.remindAt)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-4 rounded-xl bg-[var(--sr-mist)]/45 px-4 py-4">
                <p className="text-sm font-medium">Nothing scheduled</p>
                <p className="mt-1 text-xs leading-relaxed text-[var(--sr-ink)]/60">Save a reminder for an application, payment, or follow-up date.</p>
              </div>
            )}
            <p className="mt-4 border-t border-[var(--sr-line)] pt-3 text-[11px] leading-relaxed text-[var(--sr-ink)]/50">Reminders are stored in this browser. Alerts work while StudyRunway is open.</p>
          </section>
        </div>

        {(pendingQuestions.length > 0 || latestDocument) && (
          <section className="mt-5 rounded-2xl border border-[var(--sr-amber)]/35 bg-[var(--sr-amber)]/5 p-5 sm:p-6" aria-labelledby="dashboard-review-title">
            <div className="flex items-center gap-2 text-xs font-semibold text-[var(--sr-amber)]"><CircleAlert size={15} aria-hidden="true" />Needs your attention</div>
            <h3 id="dashboard-review-title" className="mt-1 text-lg font-bold">Review before continuing</h3>
            <ul className="mt-3 space-y-2">
              {pendingQuestions.map((question) => (
                <li key={question.messageId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white/65 px-3 py-2.5">
                  <p className="text-sm">The agent needs {question.count === 1 ? "one detail" : `${question.count} details`} to continue.</p>
                  <button type="button" onClick={() => onOpenConversation(question.messageId)} className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--sr-pine)] underline underline-offset-4">Open question <MessagesSquare size={13} aria-hidden="true" /></button>
                </li>
              ))}
              {latestDocument && (
                <li className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white/65 px-3 py-2.5">
                  <p className="text-sm">Document candidates should be checked against their source before use.</p>
                  <button type="button" onClick={() => onOpenConversation(latestDocument.messageId)} className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--sr-pine)] underline underline-offset-4">Open document review <MessagesSquare size={13} aria-hidden="true" /></button>
                </li>
              )}
            </ul>
          </section>
        )}

        {!hasFinanceContext && (
          <p className="mt-5 text-center text-xs leading-relaxed text-[var(--sr-ink)]/50">
            No tuition or funding figures are available yet. StudyRunway will not fill in missing numbers for you.
          </p>
        )}
      </div>
    </main>
  );
}
