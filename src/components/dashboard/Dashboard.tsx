"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Bell,
  CalendarClock,
  CircleAlert,
  ClipboardCheck,
  MessagesSquare,
  WalletCards,
} from "lucide-react";
import { OPEN_REMINDER_EVENT, loadReminders, REMINDERS_CHANGE_EVENT, type Reminder } from "@/lib/reminders";
import { asArray, asNumber, asString, formatMinorMoney, formatMoney, isRecord } from "../results/shared";

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

function formatReminderTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Time unavailable"
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function Dashboard({ messages, onAsk, onOpenConversation, disabled = false }: Props) {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const entries = useMemo(() => resultEntries(messages), [messages]);
  const fundingSource = useMemo(() => latestResult(entries, "financial_outcome"), [entries]);
  const planSource = useMemo(() => latestResult(entries, "action_plan"), [entries]);
  const latestDocument = useMemo(() => latestResult(entries, "document_review"), [entries]);
  const funding = useMemo(
    () => fundingSource ? readShortfall(fundingSource.data) : null,
    [fundingSource],
  );
  const actions = useMemo(() => readActions(planSource?.data ?? null).slice(0, 4), [planSource]);
  const pendingQuestions = messages.flatMap((message) =>
    message.role === "assistant" && message.pendingClarifications.length > 0
      ? [{ messageId: message.id, count: message.pendingClarifications.length }]
      : [],
  );

  useEffect(() => {
    const refresh = () => setReminders(loadReminders());
    refresh();
    window.addEventListener(REMINDERS_CHANGE_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(REMINDERS_CHANGE_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const openReminderForm = () => {
    window.dispatchEvent(new CustomEvent(OPEN_REMINDER_EVENT));
  };

  const activeReminders = reminders.filter((reminder) => !reminder.notifiedAt).slice(0, 3);
  const hasFinanceContext = fundingSource !== null || planSource !== null || latestDocument !== null;
  const statusTitle = funding?.hasGap
    ? "A funding gap appears in your forecast"
    : funding?.knownNoGap
      ? "No gap appears in the latest forecast"
      : fundingSource
        ? "Funding check available"
        : "Your finance overview starts here";

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

        <section className={`mt-7 overflow-hidden rounded-3xl border ${funding?.hasGap ? "border-[var(--sr-amber)]/45 bg-[#fbf3e2]" : "border-[var(--sr-line)] bg-white/70"}`} aria-labelledby="dashboard-funding-title">
          <div className="grid gap-6 p-5 sm:p-7 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <div className="max-w-2xl">
              <div className="flex items-center gap-2 text-xs font-semibold text-[var(--sr-ink)]/55">
                <WalletCards size={15} aria-hidden="true" />
                Latest funding check
              </div>
              <h3 id="dashboard-funding-title" className="mt-2 text-xl font-bold leading-snug sm:text-2xl">{statusTitle}</h3>
              {funding?.hasGap && funding.amountText ? (
                <p className="mt-2 text-sm text-[var(--sr-ink)]/75">
                  Projected shortfall: <strong className="font-bold text-[var(--sr-ink)]">{funding.amountText}</strong>
                  {funding.date && <> by <strong className="font-semibold">{funding.date}</strong></>}
                </p>
              ) : funding?.verdict ? (
                <p className="mt-2 line-clamp-2 max-w-2xl text-sm leading-relaxed text-[var(--sr-ink)]/65">{funding.verdict}</p>
              ) : (
                <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--sr-ink)]/65">
                  Start with a funding check or try the sample budget. The dashboard only shows amounts and dates returned by your finance results.
                </p>
              )}
              {fundingSource && (
                <button type="button" onClick={() => onOpenConversation(fundingSource.messageId)} className="mt-4 inline-flex items-center gap-1.5 rounded-lg text-xs font-semibold text-[var(--sr-pine)] underline underline-offset-4 hover:text-[var(--sr-pine)]/75">
                  Open funding result <ArrowUpRight size={14} aria-hidden="true" />
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2 md:justify-end">
              <button type="button" onClick={() => onAsk("Help me check whether my tuition and study costs are funded. Ask me for any missing amounts, currencies, and deadlines before calculating.")} disabled={disabled} className="rounded-xl bg-[var(--sr-pine)] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--sr-pine)]/90 disabled:opacity-50">
                Check my funding
              </button>
              {!hasFinanceContext && (
                <button type="button" onClick={() => onAsk("Try the sample student budget — show me the Limerick sample")} disabled={disabled} className="rounded-xl border border-[var(--sr-line)] bg-white/75 px-4 py-2.5 text-sm font-semibold text-[var(--sr-ink)]/75 transition hover:bg-white disabled:opacity-50">
                  Try sample budget
                </button>
              )}
            </div>
          </div>
          {fundingSource && <p className="border-t border-[var(--sr-line)]/80 px-5 py-2.5 text-[11px] text-[var(--sr-ink)]/50 sm:px-7">Based on the latest funding result in this conversation. Check its assumptions and evidence before acting.</p>}
        </section>

        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.8fr)]">
          <section className="rounded-2xl border border-[var(--sr-line)] bg-white/60 p-5 sm:p-6" aria-labelledby="dashboard-actions-title">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-xs font-semibold text-[var(--sr-ink)]/55"><ClipboardCheck size={15} aria-hidden="true" />Plan</div>
                <h3 id="dashboard-actions-title" className="mt-1 text-lg font-bold">Next steps</h3>
              </div>
              {planSource && <button type="button" onClick={() => onOpenConversation(planSource.messageId)} className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-[var(--sr-pine)] underline underline-offset-4">Open plan</button>}
            </div>
            {actions.length > 0 ? (
              <ol className="mt-4 divide-y divide-[var(--sr-line)]">
                {actions.map((action, index) => (
                  <li key={`${action.id}-${index}`} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold leading-snug">{action.label}</p>
                      {(action.deadline || action.urgency) && <p className="mt-1 text-xs font-medium text-[var(--sr-amber)]">{action.urgency}{action.urgency && action.deadline ? " · " : ""}{action.deadline}</p>}
                      {action.detail && <p className="mt-1 text-xs leading-relaxed text-[var(--sr-ink)]/60">{action.detail}</p>}
                    </div>
                    <button type="button" onClick={() => window.dispatchEvent(new CustomEvent(OPEN_REMINDER_EVENT, { detail: { title: action.deadline ? `${action.label} — deadline ${action.deadline}` : action.label } }))} className="shrink-0 rounded-lg border border-[var(--sr-line)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--sr-pine)] transition hover:bg-[var(--sr-pine)]/5">Remind me</button>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="mt-4 rounded-xl bg-[var(--sr-mist)]/45 px-4 py-4">
                <p className="text-sm font-medium">No action plan yet</p>
                <p className="mt-1 text-xs leading-relaxed text-[var(--sr-ink)]/60">Ask the agent to build a dated plan from your tuition, funding, and living-cost details.</p>
                <button type="button" onClick={() => onAsk("Build a prioritized student-finance action plan from my confirmed tuition deadlines, funding, and costs. Ask for any missing details.")} disabled={disabled} className="mt-3 text-xs font-semibold text-[var(--sr-pine)] underline underline-offset-4 disabled:opacity-50">Create an action plan</button>
              </div>
            )}
          </section>

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
