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
  const rawName = asString(data["scenarioName"] ?? data["scenarioType"] ?? data["name"], "Scenario");
  const scenarioName = rawName.replaceAll("_", " ");
  const baseline = data["baseline"];
  const scenario = data["scenario"];
  const baselineRecord = isRecord(baseline) ? baseline : {};
  const scenarioRecord = isRecord(scenario) ? scenario : {};
  const metrics = baselineRecord["minBalance"] !== undefined || scenarioRecord["minBalance"] !== undefined
    ? [
        { label: "Lowest projected balance", baseline: asString(baselineRecord["minBalance"]), scenario: asString(scenarioRecord["minBalance"]), changed: baselineRecord["minBalance"] !== scenarioRecord["minBalance"] },
        { label: "First gap date", baseline: asString(baselineRecord["gapDate"], "No gap"), scenario: asString(scenarioRecord["gapDate"], "No gap"), changed: baselineRecord["gapDate"] !== scenarioRecord["gapDate"] },
        { label: "Shortfall", baseline: asString(baselineRecord["shortfall"], "None"), scenario: asString(scenarioRecord["shortfall"], "None"), changed: baselineRecord["shortfallMinor"] !== scenarioRecord["shortfallMinor"] },
      ]
    : readMetrics(baseline, scenario);
  const changedAssumptions = asArray<unknown>(data["changedAssumptions"]);
  const recoveryOptions = asArray<Record<string, unknown>>(data["recoveryOptions"]).filter(isRecord);

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
      {recoveryOptions.length > 0 && (
        <div className="mt-4">
          <h4 className="text-xs font-bold uppercase tracking-wide text-[var(--sr-ink)]/60">Recovery options against this scenario</h4>
          <ol className="mt-2 space-y-2">
            {recoveryOptions.map((option, index) => (
              <li key={`${asString(option["label"])}-${index}`} className="rounded-xl border border-[var(--sr-line)] bg-white/50 px-3 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-[var(--sr-ink)]">{asNumber(option["rank"]) ? `#${asNumber(option["rank"])} ` : ""}{asString(option["label"], "Recovery option")}</p>
                  <span className="text-xs font-semibold text-[var(--sr-pine)]">{asString(option["verdict"], asString(option["reason"], "Not simulated"))}</span>
                </div>
                {option["valid"] === true && (
                  <p className="mt-1 text-xs text-[var(--sr-ink)]/70">
                    Remaining gap: {asString(option["remainingGap"], "None")} {asString(option["remainingGapDate"]) && `on ${asString(option["remainingGapDate"])}`}
                  </p>
                )}
                {asString(option["assumption"]) && <p className="mt-1 text-xs leading-relaxed text-[var(--sr-ink)]/60">{asString(option["assumption"])}</p>}
              </li>
            ))}
          </ol>
          <p className="mt-2 text-[11px] text-[var(--sr-ink)]/50">Each option is an independent what-if. Funding availability and university approval are not verified, and no plan changes were made.</p>
        </div>
      )}
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
