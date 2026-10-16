"use client";

import { useState } from "react";
import {
  Disclosure,
  asArray,
  asNumber,
  asString,
  formatMoney,
  isRecord,
} from "./shared";
import { formatAssumptionCorrection } from "../chat/answers";

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
  const verdict = asString(data["verdict"]);
  const currency = asString(data["currency"]);
  const deadline = asString(data["deadline"]);
  const amounts = asArray<Record<string, unknown>>(data["amounts"]);
  const shortfall = isRecord(data["shortfall"]) ? data["shortfall"] : null;
  const assumptions = readAssumptions(data["assumptions"]);

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
            {formatMoney(
              asNumber(shortfall["amount"]),
              asString(shortfall["currency"], currency),
            )}
          </span>
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
