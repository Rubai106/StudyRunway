import { formatMinor, isSupportedCurrency } from "@/lib/currency";

export type FeeAlertUrgency = "overdue" | "due_today" | "due_soon" | "upcoming" | "review";

export interface FeeDeadlineAlert {
  id: string;
  title: string;
  description: string;
  date: string | null;
  daysUntil: number | null;
  urgency: FeeAlertUrgency;
  messageId: string;
  reminderTitle: string;
}

interface AlertResult {
  component: string;
  data: Record<string, unknown>;
}

interface AlertMessage {
  id: string;
  role: string;
  results: AlertResult[];
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function string(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function dateOnly(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    ? value
    : null;
}

function localDateToday(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function daysUntil(date: string | null, today: string): number | null {
  if (!date) return null;
  const due = dateOnly(date);
  const base = dateOnly(today);
  if (!due || !base) return null;
  return Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${base}T00:00:00Z`)) / 86_400_000);
}

function urgencyFor(days: number | null): FeeAlertUrgency {
  if (days === null) return "review";
  if (days < 0) return "overdue";
  if (days === 0) return "due_today";
  if (days <= 7) return "due_soon";
  return "upcoming";
}

function urgencyRank(value: FeeAlertUrgency): number {
  return value === "overdue" ? 0 : value === "due_today" ? 1 : value === "due_soon" ? 2 : value === "upcoming" ? 3 : 4;
}

function formatDate(value: string): string {
  const date = dateOnly(value);
  return date
    ? new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
        dateStyle: "medium",
        timeZone: "UTC",
      })
    : value;
}

function shortfallDescription(data: Record<string, unknown>): string {
  const amount = string(data["shortfall"]);
  if (amount) return `The latest forecast projects a ${amount} funding gap.`;
  const minor = data["shortfallMinor"];
  const currency = string(data["planningCurrency"]);
  if (typeof minor === "number" && Number.isSafeInteger(minor) && isSupportedCurrency(currency)) {
    try {
      return `The latest forecast projects a ${formatMinor(minor, currency)} funding gap.`;
    } catch {
      // Fall through to a label without an untrusted or unsupported amount.
    }
  }
  return "The latest funding forecast shows a shortfall that needs review.";
}

function latestResult(messages: AlertMessage[], component: string): { messageId: string; data: Record<string, unknown> } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "assistant") continue;
    for (let j = message.results.length - 1; j >= 0; j--) {
      const result = message.results[j];
      if (result.component === component) return { messageId: message.id, data: result.data };
    }
  }
  return null;
}

/** Create alerts only from dated, tool-produced results shown in the conversation. */
export function buildFeeDeadlineAlerts(
  messages: AlertMessage[],
  today = localDateToday(),
): FeeDeadlineAlert[] {
  const alerts: FeeDeadlineAlert[] = [];
  const seenFeeDates = new Set<string>();
  const funding = latestResult(messages, "financial_outcome");

  if (funding?.data["hasGap"] === true) {
    const date = dateOnly(string(funding.data["gapDate"]));
    const days = daysUntil(date, today);
    alerts.push({
      id: `shortfall-${funding.messageId}-${date ?? "undated"}`,
      title: "Projected funding shortfall",
      description: shortfallDescription(funding.data),
      date,
      daysUntil: days,
      urgency: urgencyFor(days),
      messageId: funding.messageId,
      reminderTitle: date ? `Review projected tuition funding shortfall — ${date}` : "Review projected tuition funding shortfall",
    });
  }

  const safeToSend = latestResult(messages, "safe_to_send_decision");
  if (safeToSend && !string(safeToSend.data["demoDataLabel"])) {
    const decision = record(safeToSend.data["decision"]);
    const payment = record(decision?.["payment"]);
    const date = dateOnly(string(payment?.["dueDate"]));
    const days = daysUntil(date, today);
    if (date && (days ?? Number.POSITIVE_INFINITY) <= 90) {
      const amount = payment?.["tuitionAmountMinor"];
      const currency = string(payment?.["tuitionCurrency"]);
      let amountText = "";
      if (typeof amount === "number" && Number.isSafeInteger(amount) && isSupportedCurrency(currency)) {
        try { amountText = formatMinor(amount, currency); } catch { /* keep the deadline without an amount */ }
      }
      alerts.push({
        id: `tuition-${date}`,
        title: "Tuition payment deadline",
        description: `${amountText ? `${amountText} is ` : "Tuition is "}due ${formatDate(date)}. Review the payment readiness result before acting.`,
        date,
        daysUntil: days,
        urgency: urgencyFor(days),
        messageId: safeToSend.messageId,
        reminderTitle: `Tuition payment deadline — ${date}`,
      });
      seenFeeDates.add(date);
    }
  }

  const plan = latestResult(messages, "action_plan");
  const actions = Array.isArray(plan?.data["actions"]) ? plan.data["actions"] : [];
  for (let i = 0; i < actions.length; i++) {
    const action = record(actions[i]);
    if (!action) continue;
    const label = string(action["label"] ?? action["title"]);
    const detail = string(action["purpose"] ?? action["detail"] ?? action["description"]);
    if (!/\b(tuition|fees?|invoice|payment|deposit|instalments?|installments?)\b/i.test(`${label} ${detail}`)) continue;
    const date = dateOnly(string(action["deadline"]));
    if (!date || seenFeeDates.has(date)) continue;
    const days = daysUntil(date, today);
    if (days !== null && days > 60) continue;
    const title = label || "Student fee deadline";
    alerts.push({
      id: `fee-${plan?.messageId ?? "plan"}-${string(action["id"]) || i}-${date}`,
      title,
      description: detail || `A fee or tuition obligation is due ${formatDate(date)}.`,
      date,
      daysUntil: days,
      urgency: urgencyFor(days),
      messageId: plan?.messageId ?? "",
      reminderTitle: `${title} — deadline ${date}`,
    });
    seenFeeDates.add(date);
  }

  return alerts.sort((a, b) =>
    urgencyRank(a.urgency) - urgencyRank(b.urgency)
    || (a.daysUntil ?? Number.POSITIVE_INFINITY) - (b.daysUntil ?? Number.POSITIVE_INFINITY)
    || a.title.localeCompare(b.title),
  );
}

export { localDateToday };
