"use client";

import { useState } from "react";
import { Disclosure, asArray, asNumber, asString, isRecord } from "./shared";

interface Field {
  key: string;
  name: string;
  value: string;
  confidence: string | number | null;
  page: number | null;
  sourceSnippet: string;
  needsConfirmation: boolean;
}

function readFields(v: unknown): Field[] {
  if (isRecord(v) && !Array.isArray(v)) {
    return Object.entries(v).map(([name, raw]) => {
      if (isRecord(raw))
        return {
          key: `${name}:${asString(raw["valueText"] ?? raw["value"])}`,
          name,
          value: asString(raw["valueText"] ?? raw["value"]),
          confidence: asString(raw["confidence"]) || asNumber(raw["confidence"]),
          page: asNumber(raw["page"]),
          sourceSnippet: asString(raw["sourceSnippet"]),
          needsConfirmation: raw["needsConfirmation"] !== false,
        };
      return { key: `${name}:${asString(raw)}`, name, value: asString(raw), confidence: null, page: null, sourceSnippet: "", needsConfirmation: true };
    });
  }
  return asArray<Record<string, unknown>>(v)
    .filter(isRecord)
    .map((r) => ({
      key: `${asString(r["name"] ?? r["label"])}:${asString(r["valueText"] ?? r["value"])}`,
      name: asString(r["name"] ?? r["label"]),
      value: asString(r["valueText"] ?? r["value"]),
      confidence: asString(r["confidence"]) || asNumber(r["confidence"]),
      page: asNumber(r["page"]),
      sourceSnippet: asString(r["sourceSnippet"]),
      needsConfirmation: r["needsConfirmation"] !== false,
    }))
    .filter((f) => f.name);
}

interface Props {
  data: Record<string, unknown>;
  onConfirmed?: (message: string) => void;
  onCorrected?: (message: string) => void;
}

export default function DocumentReview({ data, onConfirmed, onCorrected }: Props) {
  const source = asString(data["source"] ?? data["fileName"]);
  const fields = readFields(data["fields"]);
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [corrections, setCorrections] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);

  const submitCorrection = (field: Field) => {
    const value = (corrections[field.key] ?? "").trim();
    if (!value) return;
    onCorrected?.(
      `Correction from document review (${source || "uploaded document"}): ` +
        `field "${field.name}" was extracted as "${field.value}". ` +
        `I correct it to "${value}". Use this correction for any next calculation, but do not change or submit anything externally.`,
    );
    setEditing(null);
  };

  const confirmField = (field: Field) => {
    if (confirmed[field.key]) return;
    setConfirmed((current) => ({ ...current, [field.key]: true }));
    onConfirmed?.(
      `I reviewed and confirm the extracted ${field.name} value "${field.value}" from ${source || "the attached document"}` +
        `${field.page ? `, page ${field.page}` : ""}` +
        `${field.sourceSnippet ? ` (source excerpt: “${field.sourceSnippet}”)` : ""}. You may use only this confirmed value in the next student-finance calculation. Do not make any external change or send anything.`,
    );
  };

  return (
    <div>
      {source && (
        <p className="text-xs text-[var(--sr-ink)]/60">
          Reviewed document: <span className="font-medium">{source}</span>
        </p>
      )}
      <dl className="mt-3 space-y-2">
        {fields.map((f) => (
          <div
            key={f.key}
            className="rounded-xl border border-[var(--sr-line)] bg-white/50 px-3 py-2.5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <dt className="text-[11px] font-medium uppercase tracking-wide text-[var(--sr-ink)]/50">
                  {f.name}
                </dt>
                <dd className="text-sm text-[var(--sr-ink)]">{f.value || "—"}</dd>
              </div>
              {f.confidence !== null && (
                <span
                  className="shrink-0 rounded-full bg-[var(--sr-mist)] px-2 py-0.5 text-[11px] font-medium tabular-nums text-[var(--sr-ink)]/70"
                  title="Extraction confidence"
                >
                  {typeof f.confidence === "number"
                    ? `${Math.round(f.confidence * (f.confidence <= 1 ? 100 : 1))}% confidence`
                    : `${f.confidence} confidence`}
                </span>
              )}
            </div>
            {(f.page || f.sourceSnippet) && (
              <div className="mt-2 rounded-lg bg-[var(--sr-mist)]/70 px-2.5 py-2 text-xs text-[var(--sr-ink)]/70">
                <p className="font-semibold">Source evidence{f.page ? ` · page ${f.page}` : ""}</p>
                {f.sourceSnippet && <blockquote className="mt-1 leading-relaxed">“{f.sourceSnippet}”</blockquote>}
              </div>
            )}
            {f.needsConfirmation && !confirmed[f.key] && (
              <p className="mt-2 text-xs font-medium text-[var(--sr-amber)]">Review this value against the source before using it.</p>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => confirmField(f)}
                aria-pressed={!!confirmed[f.key]}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sr-pine)] ${
                  confirmed[f.key]
                    ? "bg-[var(--sr-pine)]/15 text-[var(--sr-pine)]"
                    : "border border-[var(--sr-line)] text-[var(--sr-ink)]/70 hover:bg-[var(--sr-mist)]/60"
                }`}
              >
                {confirmed[f.key] ? "✓ Confirmed and shared with agent" : "Confirm value"}
              </button>
              {onCorrected && (
                <button
                  type="button"
                  onClick={() =>
                    setEditing(editing === f.key ? null : f.key)
                  }
                  aria-expanded={editing === f.key}
                  className="rounded-lg border border-[var(--sr-line)] px-2.5 py-1 text-xs font-medium text-[var(--sr-ink)]/70 transition hover:bg-[var(--sr-mist)]/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sr-pine)]"
                >
                  Correct
                </button>
              )}
            </div>
            {editing === f.key && (
              <form
                className="mt-2 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  submitCorrection(f);
                }}
              >
                <label htmlFor={`doc-correct-${f.key}`} className="sr-only">
                  Correct value for {f.name}
                </label>
                <input
                  id={`doc-correct-${f.key}`}
                  type="text"
                  value={corrections[f.key] ?? ""}
                  onChange={(e) =>
                    setCorrections((c) => ({ ...c, [f.key]: e.target.value }))
                  }
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
          </div>
        ))}
      </dl>
      <Disclosure label="How to read this">
        <p className="text-xs leading-relaxed text-[var(--sr-ink)]/70">
          These are heuristic candidates, not verified document facts. Each
          value includes the source excerpt and PDF page when available. A
          confirmation sends that exact value to the agent for a later
          calculation; it does not silently change your plan. Use “Correct”
          if the value differs from the document.
        </p>
      </Disclosure>
    </div>
  );
}
