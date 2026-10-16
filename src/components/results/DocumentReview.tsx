"use client";

import { useState } from "react";
import { Disclosure, asArray, asNumber, asString, isRecord } from "./shared";

interface Field {
  name: string;
  value: string;
  confidence: number | null;
}

function readFields(v: unknown): Field[] {
  if (isRecord(v) && !Array.isArray(v)) {
    return Object.entries(v).map(([name, raw]) => {
      if (isRecord(raw))
        return {
          name,
          value: asString(raw["value"]),
          confidence: asNumber(raw["confidence"]),
        };
      return { name, value: asString(raw), confidence: null };
    });
  }
  return asArray<Record<string, unknown>>(v)
    .filter(isRecord)
    .map((r) => ({
      name: asString(r["name"] ?? r["label"]),
      value: asString(r["value"]),
      confidence: asNumber(r["confidence"]),
    }))
    .filter((f) => f.name);
}

interface Props {
  data: Record<string, unknown>;
  onCorrected?: (message: string) => void;
}

export default function DocumentReview({ data, onCorrected }: Props) {
  const source = asString(data["source"] ?? data["fileName"]);
  const fields = readFields(data["fields"]);
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [corrections, setCorrections] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);

  const submitCorrection = (field: Field) => {
    const value = (corrections[field.name] ?? "").trim();
    if (!value) return;
    onCorrected?.(
      `Correction from document review (${source || "uploaded document"}): ` +
        `field "${field.name}" was "${field.value}". ` +
        `The correct value is "${value}". Please update it.`,
    );
    setEditing(null);
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
            key={f.name}
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
                  {Math.round(f.confidence * (f.confidence <= 1 ? 100 : 1))}%
                </span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  setConfirmed((c) => ({ ...c, [f.name]: !c[f.name] }))
                }
                aria-pressed={!!confirmed[f.name]}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sr-pine)] ${
                  confirmed[f.name]
                    ? "bg-[var(--sr-pine)]/15 text-[var(--sr-pine)]"
                    : "border border-[var(--sr-line)] text-[var(--sr-ink)]/70 hover:bg-[var(--sr-mist)]/60"
                }`}
              >
                {confirmed[f.name] ? "✓ Confirmed" : "Confirm"}
              </button>
              {onCorrected && (
                <button
                  type="button"
                  onClick={() =>
                    setEditing(editing === f.name ? null : f.name)
                  }
                  aria-expanded={editing === f.name}
                  className="rounded-lg border border-[var(--sr-line)] px-2.5 py-1 text-xs font-medium text-[var(--sr-ink)]/70 transition hover:bg-[var(--sr-mist)]/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sr-pine)]"
                >
                  Correct
                </button>
              )}
            </div>
            {editing === f.name && (
              <form
                className="mt-2 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  submitCorrection(f);
                }}
              >
                <label htmlFor={`doc-correct-${f.name}`} className="sr-only">
                  Correct value for {f.name}
                </label>
                <input
                  id={`doc-correct-${f.name}`}
                  type="text"
                  value={corrections[f.name] ?? ""}
                  onChange={(e) =>
                    setCorrections((c) => ({ ...c, [f.name]: e.target.value }))
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
          Values were extracted automatically — confirm each one before relying
          on it. Anything wrong? Use “Correct” and the agent will update its
          record.
        </p>
      </Disclosure>
    </div>
  );
}
