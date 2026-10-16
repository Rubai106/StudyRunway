"use client";

import { Disclosure, asArray, asNumber, asString, formatMoney, isRecord } from "./shared";

interface Metric {
  label: string;
  baseline: string;
  scenario: string;
  changed: boolean;
}

function readMetrics(baseline: unknown, scenario: unknown): Metric[] {
  const b = isRecord(baseline) ? baseline : {};
  const s = isRecord(scenario) ? scenario : {};
  const labels = new Set([...Object.keys(b), ...Object.keys(s)]);
  return [...labels].map((label) => ({
    label,
    baseline: metricText(b[label]),
    scenario: metricText(s[label]),
    changed: JSON.stringify(b[label]) !== JSON.stringify(s[label]),
  }));
}

function metricText(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") {
    const r = v as Record<string, unknown>;
    const amount = asNumber(r["amount"] ?? r["value"]);
    if (amount !== null)
      return formatMoney(amount, asString(r["currency"]));
    return JSON.stringify(v);
  }
  return String(v);
}

export default function ScenarioComparison({
  data,
}: {
  data: Record<string, unknown>;
}) {
  const scenarioName = asString(data["scenarioName"] ?? data["name"], "Scenario");
  const baseline = data["baseline"];
  const scenario = data["scenario"];
  const metrics = readMetrics(baseline, scenario);
  const changedAssumptions = asArray<unknown>(data["changedAssumptions"]);

  return (
    <div>
      <div className="grid grid-cols-2 gap-2" role="table" aria-label="Scenario comparison">
        <div className="rounded-t-xl bg-[var(--sr-mist)]/80 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--sr-ink)]/60">
          Baseline
        </div>
        <div className="rounded-t-xl bg-[var(--sr-pine)]/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--sr-pine)]">
          {scenarioName}
        </div>
      </div>
      <div className="divide-y divide-[var(--sr-line)] rounded-b-xl border border-[var(--sr-line)]">
        {metrics.map((m) => (
          <div
            key={m.label}
            className="grid grid-cols-2 gap-2 px-3 py-2"
            role="row"
          >
            <div>
              <p className="text-[11px] uppercase tracking-wide text-[var(--sr-ink)]/50">
                {m.label}
              </p>
              <p className="text-sm tabular-nums text-[var(--sr-ink)]">
                {m.baseline}
              </p>
            </div>
            <div
              className={
                m.changed
                  ? "rounded-lg bg-[var(--sr-amber)]/10 px-2"
                  : ""
              }
            >
              <p className="text-[11px] uppercase tracking-wide text-[var(--sr-ink)]/50">
                {m.label}
              </p>
              <p className="text-sm font-semibold tabular-nums text-[var(--sr-ink)]">
                {m.scenario}
              </p>
            </div>
          </div>
        ))}
      </div>
      {changedAssumptions.length > 0 && (
        <Disclosure label="Changed assumptions">
          <ul className="list-disc space-y-1 pl-5 text-xs text-[var(--sr-ink)]/80">
            {changedAssumptions.map((a, i) => (
              <li key={i}>
                {typeof a === "string"
                  ? a
                  : isRecord(a)
                    ? `${asString(a["name"])}: ${asString(a["from"])} → ${asString(a["to"])}`
                    : JSON.stringify(a)}
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </div>
  );
}
