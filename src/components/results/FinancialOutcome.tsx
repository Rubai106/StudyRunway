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
  const hasGap = data["hasGap"] === true;
  const forecastComplete = data["forecastComplete"] !== false;
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
  const confirmedOnly = isRecord(data["confirmedOnly"]) ? data["confirmedOnly"] : null;
  const cashFlow = isRecord(data["cashFlow"]) ? data["cashFlow"] : null;
  const fundingSources = asArray<Record<string, unknown>>(cashFlow?.["fundingSources"]);
  const uncertainSources = fundingSources
    .filter((source) => ["conditional", "estimated", "unverified"].includes(asString(source["status"])));
  const scholarshipsMarkedConfirmed = fundingSources
    .filter((source) => source["kind"] === "scholarship" && source["status"] === "confirmed_pending");
  const sourcesToReview = [...uncertainSources, ...scholarshipsMarkedConfirmed];
  const incomplete = asArray<Record<string, unknown>>(data["incomplete"]);
  const aiAnalysis = isRecord(data["aiAnalysis"]) ? data["aiAnalysis"] : null;

  const [correcting, setCorrecting] = useState<string | null>(null);
  const [newValue, setNewValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const needsCaution = hasGap || !forecastComplete || confirmedOnly?.["hasGap"] === true || scholarshipsMarkedConfirmed.length > 0;
  const resultTitle = hasGap
    ? "A funding gap appears in this plan"
    : !forecastComplete
      ? "Some details are still missing"
      : confirmedOnly?.["hasGap"] === true
        ? "Coverage depends on unconfirmed funding"
        : scholarshipsMarkedConfirmed.length > 0
          ? "Check the scholarship schedule"
        : "No gap in the listed plan";

  const certaintyLabel = (status: string) => ({
    conditional: "Conditional award",
    estimated: "Expected, not confirmed",
    unverified: "Not verified",
  } as Record<string, string>)[status] ?? "Status needs review";

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
        <section
          role="status"
          aria-label="Funding result"
          className={`rounded-xl border px-4 py-3 ${needsCaution ? "border-[var(--sr-amber)]/45 bg-[#fbf3e2]/65" : "border-[var(--sr-pine)]/25 bg-[var(--sr-pine)]/5"}`}
        >
          <p className={`text-sm font-semibold ${needsCaution ? "text-[var(--sr-amber)]" : "text-[var(--sr-pine)]"}`}>{resultTitle}</p>
          <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-[var(--sr-ink)]">{verdict}</p>
          {confirmedOnly && (
            <div className="mt-3 grid gap-2 sm:grid-cols-2" aria-label="Compare forecast certainty">
              <div className="rounded-lg border border-[var(--sr-line)] bg-white/75 px-3 py-2.5">
                <p className="text-xs font-semibold text-[var(--sr-ink)]">All listed incoming funds</p>
                <p className="mt-1 text-xs text-[var(--sr-ink)]/70">
                  {hasGap
                    ? `Short by ${asString(data["shortfall"], formatMinorMoney(asNumber(data["shortfallMinor"]), currency))}${asString(data["gapDate"]) ? ` on ${asString(data["gapDate"])}` : ""}.`
                    : forecastComplete ? "No gap on the dates and amounts listed." : "The result is incomplete; review the missing items below."}
                </p>
              </div>
              <div className={`rounded-lg border px-3 py-2.5 ${confirmedOnly["hasGap"] === true ? "border-[var(--sr-amber)]/35 bg-[var(--sr-amber)]/5" : "border-[var(--sr-line)] bg-white/75"}`}>
                <p className="text-xs font-semibold text-[var(--sr-ink)]">Funds listed as confirmed only</p>
                <p className="mt-1 text-xs text-[var(--sr-ink)]/70">
                  {confirmedOnly["hasGap"] === true
                    ? `Short by ${asString(confirmedOnly["shortfall"], "an unknown amount")}${asString(confirmedOnly["gapDate"]) ? ` on ${asString(confirmedOnly["gapDate"] as string)}` : ""}.`
                    : forecastComplete ? "No gap using the confirmed amounts listed." : "Known amounts only; missing details could change this."}
                </p>
              </div>
            </div>
          )}
        </section>
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
        <div className="mt-3 rounded-xl border border-[var(--sr-line)] bg-[var(--sr-mist)]/35 px-3 py-3">
          <p className="text-sm font-semibold text-[var(--sr-ink)]">Where the money comes from</p>
          <dl className="mt-2 grid gap-x-5 gap-y-2 text-xs sm:grid-cols-2">
            <div className="flex justify-between gap-3"><dt>Available now</dt><dd className="font-semibold tabular-nums">{asString(fundingSplit["inHand"])}</dd></div>
            <div className="flex justify-between gap-3"><dt>Listed as confirmed and scheduled</dt><dd className="font-semibold tabular-nums">{asString(fundingSplit["confirmedInflow"])}</dd></div>
            <div className="flex justify-between gap-3"><dt>Expected or unconfirmed</dt><dd className="font-semibold tabular-nums">{asString(fundingSplit["uncertainInflow"])}</dd></div>
            <div className="flex justify-between gap-3"><dt>Costs in this plan</dt><dd className="font-semibold tabular-nums">{asString(fundingSplit["totalOutflow"])}</dd></div>
          </dl>
        </div>
      )}
      {sourcesToReview.length > 0 && (
        <section className="mt-3 rounded-xl border border-[var(--sr-amber)]/40 bg-[#fbf3e2]/55 px-3 py-3" aria-label="Review funding certainty">
          <h3 className="text-sm font-semibold text-[var(--sr-ink)]">Review funding certainty</h3>
          <p className="mt-1 text-xs leading-relaxed text-[var(--sr-ink)]/70">StudyRunway does not verify funding with the source. Expected or conditional money is not guaranteed. Count a scholarship as confirmed only after its award and payment schedule are confirmed.</p>
          <ul className="mt-2 divide-y divide-[var(--sr-amber)]/15">
            {sourcesToReview.map((source, index) => {
              const label = asString(source["label"], "Funding source");
              const status = asString(source["status"]);
              const amountMinor = asNumber(source["amountMinor"]);
              const sourceCurrency = asString(source["currency"], currency);
              const date = asString(source["expectedDate"] ?? source["availableDate"]);
              const statusText = scholarshipsMarkedConfirmed.includes(source)
                ? "Listed as confirmed · verify award and date"
                : certaintyLabel(status);
              return (
                <li key={`${label}-${date}-${index}`} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 first:pt-1 last:pb-0">
                  <span className="min-w-0 text-xs font-medium text-[var(--sr-ink)]">{label}<span className="ml-2 font-normal text-[var(--sr-ink)]/60">{statusText}{date ? ` · ${date}` : " · date not provided"}</span></span>
                  <span className="shrink-0 text-xs font-semibold tabular-nums text-[var(--sr-ink)]">{amountMinor === null ? "Amount missing" : formatMinorMoney(amountMinor, sourceCurrency)}</span>
                </li>
              );
            })}
          </ul>
        </section>
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
