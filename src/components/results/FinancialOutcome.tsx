"use client";

import { useState } from "react";
import {
  Disclosure,
  asArray,
  asNumber,
  asString,
  formatMoney,
  formatMinorMoney,
  isRecord,
} from "./shared";
import { formatAssumptionCorrection } from "../chat/answers";
import AssistantMarkdown from "../chat/AssistantMarkdown";

interface Assumption {
  name: string;
  value: string;
}

function readAssumptions(v: unknown): Assumption[] {
  if (Array.isArray(v)) {
    return v
      .filter(isRecord)
      .map((r) => ({
        name: asString(r["name"]),
        value: asString(r["value"]),
      }))
      .filter((a) => a.name);
  }
  if (isRecord(v)) {
    return Object.entries(v).map(([name, value]) => ({
      name,
      value: asString(value),
    }));
  }
  return [];
}

interface Props {
  data: Record<string, unknown>;
  /** Parent sends the formatted correction message as a real chat message. */
  onCorrectAssumption?: (message: string) => void;
}

export default function FinancialOutcome({ data, onCorrectAssumption }: Props) {
  const verdict = asString(data["verdict"] ?? data["summary"]);
  const currency = asString(data["currency"] ?? data["planningCurrency"]);
  const deadline = asString(data["deadline"] ?? data["gapDate"]);
  const amounts = asArray<Record<string, unknown>>(data["amounts"]);
  const shortfall = isRecord(data["shortfall"])
    ? data["shortfall"]
    : data["hasGap"] === true
      ? {
          label: "Projected funding gap",
          date: asString(data["gapDate"]),
          amountMinor: asNumber(data["shortfallMinor"]),
          currency,
        }
      : null;
  const assumptions = readAssumptions(data["assumptions"]);
  const fundingSplit = isRecord(data["fundingSplit"]) ? data["fundingSplit"] : null;
  const incomplete = asArray<Record<string, unknown>>(data["incomplete"]);
  const aiAnalysis = isRecord(data["aiAnalysis"]) ? data["aiAnalysis"] : null;

  const [correcting, setCorrecting] = useState<string | null>(null);
  const [newValue, setNewValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submitCorrection = (assumption: Assumption) => {
    if (!newValue.trim()) {
      setError("Enter the corrected value first.");
      return;
    }
    setError(null);
    onCorrectAssumption?.(
      formatAssumptionCorrection(
        assumption.name,
        assumption.value,
        newValue.trim(),
      ),
    );
    setCorrecting(null);
    setNewValue("");
  };

  return (
    <div>
      {verdict && (
        <p className="text-sm leading-relaxed text-[var(--sr-ink)]">{verdict}</p>
      )}
      {amounts.length > 0 && (
        <dl className="mt-3 grid gap-2">
          {amounts.map((row, i) => {
            const value = asNumber(row["value"]);
            const label = asString(row["label"], `Amount ${i + 1}`);
            const cur = asString(row["currency"], currency);
            return (
              <div
                key={`${label}-${i}`}
                className="flex items-baseline justify-between gap-3 rounded-lg bg-[var(--sr-mist)]/70 px-3 py-2"
              >
                <dt className="text-xs text-[var(--sr-ink)]/60">{label}</dt>
                <dd className="text-sm font-semibold tabular-nums text-[var(--sr-ink)]">
                  {formatMoney(value, cur)}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
      {shortfall && (
        <div
          className="mt-3 flex items-baseline justify-between gap-3 rounded-xl border border-[var(--sr-amber)]/40 bg-[var(--sr-amber)]/10 px-3 py-2.5"
          role="status"
        >
          <span className="text-sm font-medium text-[var(--sr-ink)]">
            {asString(shortfall["label"], "Projected shortfall")}
            {asString(shortfall["date"]) && (
              <span className="ml-2 text-xs font-normal text-[var(--sr-ink)]/60">
                by {asString(shortfall["date"])}
              </span>
            )}
          </span>
          <span className="text-base font-bold tabular-nums text-[var(--sr-amber)]">
            {shortfall["amountMinor"] !== undefined
              ? formatMinorMoney(asNumber(shortfall["amountMinor"]), asString(shortfall["currency"], currency))
              : formatMoney(asNumber(shortfall["amount"]), asString(shortfall["currency"], currency))}
          </span>
        </div>
      )}
      {fundingSplit && (
        <div className="mt-3 rounded-xl border border-[var(--sr-line)] bg-[var(--sr-mist)]/50 px-3 py-2.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--sr-ink)]/60">Funding split</p>
          <dl className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
            <div className="flex justify-between gap-3"><dt>Available now</dt><dd className="font-semibold tabular-nums">{asString(fundingSplit["inHand"])}</dd></div>
            <div className="flex justify-between gap-3"><dt>Confirmed future</dt><dd className="font-semibold tabular-nums">{asString(fundingSplit["confirmedInflow"])}</dd></div>
            <div className="flex justify-between gap-3"><dt>Expected / unconfirmed</dt><dd className="font-semibold tabular-nums">{asString(fundingSplit["uncertainInflow"])}</dd></div>
            <div className="flex justify-between gap-3"><dt>Planned outflow</dt><dd className="font-semibold tabular-nums">{asString(fundingSplit["totalOutflow"])}</dd></div>
          </dl>
        </div>
      )}
      {incomplete.length > 0 && (
        <Disclosure label={`Needs attention (${incomplete.length})`} defaultOpen>
          <ul className="list-disc space-y-1 pl-5 text-xs text-[var(--sr-ink)]/70">
            {incomplete.map((item, index) => <li key={`${asString(item["label"])}-${index}`}>{asString(item["label"], "Item")}: {asString(item["reason"], "missing information")}</li>)}
          </ul>
        </Disclosure>
      )}
      {aiAnalysis && (
        <div className="mt-4 rounded-xl border border-[var(--sr-line)] bg-white/70 px-3 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--sr-ink)]/60">AI Financial Readiness Analysis</p>
          {asString(aiAnalysis["status"]) === "ready" ? (
            <>
              <p className="mt-1 text-[11px] text-[var(--sr-ink)]/50">Generated by hosted Google {asString(aiAnalysis["provider"], "Gemini")} ({asString(aiAnalysis["model"])}) using the authoritative calculation above.</p>
              <div className="mt-3 text-sm leading-relaxed"><AssistantMarkdown text={asString(aiAnalysis["text"])} /></div>
            </>
          ) : (
            <p className="mt-2 text-xs text-[var(--sr-clay)]">{asString(aiAnalysis["message"], "AI explanation is temporarily unavailable. The deterministic result remains authoritative.")}</p>
          )}
        </div>
      )}
      {deadline && (
        <p className="mt-3 text-xs text-[var(--sr-ink)]/60">
          Deadline: <span className="font-medium">{deadline}</span>
        </p>
      )}
      {assumptions.length > 0 && (
        <Disclosure label={`Assumptions (${assumptions.length})`}>
          <ul className="space-y-2">
            {assumptions.map((a) => (
              <li
                key={a.name}
                className="rounded-lg border border-[var(--sr-line)] px-3 py-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium text-[var(--sr-ink)]/60">
                      {a.name}
                    </p>
                    <p className="text-sm text-[var(--sr-ink)]">{a.value}</p>
                  </div>
                  {onCorrectAssumption && (
                    <button
                      type="button"
                      onClick={() =>
                        setCorrecting(correcting === a.name ? null : a.name)
                      }
                      className="shrink-0 rounded-lg border border-[var(--sr-line)] px-2.5 py-1 text-xs font-medium text-[var(--sr-pine)] transition hover:bg-[var(--sr-pine)]/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sr-pine)]"
                      aria-expanded={correcting === a.name}
                    >
                      Correct
                    </button>
                  )}
                </div>
                {correcting === a.name && (
                  <form
                    className="mt-2 flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      submitCorrection(a);
                    }}
                  >
                    <label htmlFor={`correct-${a.name}`} className="sr-only">
                      Corrected value for {a.name}
                    </label>
                    <input
                      id={`correct-${a.name}`}
                      type="text"
                      value={newValue}
                      onChange={(e) => setNewValue(e.target.value)}
                      placeholder="Correct value…"
                      className="min-w-0 flex-1 rounded-lg border border-[var(--sr-line)] bg-white/70 px-2.5 py-1.5 text-sm outline-none focus:border-[var(--sr-pine)] focus:ring-2 focus:ring-[var(--sr-pine)]/25"
                    />
                    <button
                      type="submit"
                      className="shrink-0 rounded-lg bg-[var(--sr-pine)] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[var(--sr-pine)]/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sr-pine)]"
                    >
                      Send
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
          {error && (
            <p role="alert" className="mt-2 text-xs text-[var(--sr-clay)]">
              {error}
            </p>
          )}
        </Disclosure>
      )}
      <span className="sr-only">{asString(data["title"], "")}</span>
    </div>
  );
}
