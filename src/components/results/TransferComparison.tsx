"use client";

import { Disclosure, EstimateBadge, asArray, asNumber, asString, formatMoney, formatMinorMoney, isRecord } from "./shared";
import ManualTransferComparison from "./ManualTransferComparison";

interface TransferOption {
  provider: string;
  totalCost: number | null;
  currency: string;
  recipientAmount: number | null;
  timing: string;
  source: string;
  receivedDisplay: string;
  totalCostDisplay: string;
}

function readOptions(v: unknown, currency: string): TransferOption[] {
  return asArray<Record<string, unknown>>(v)
    .filter(isRecord)
    .map((r) => ({
      provider: asString(r["provider"], "Unknown provider"),
      totalCost: asNumber(r["totalCost"] ?? r["cost"]),
      currency: asString(r["currency"], currency),
      recipientAmount: asNumber(r["recipientAmount"] ?? r["receives"]),
      timing: asString(r["arrivalWindow"] ?? r["timing"] ?? r["arrival"]),
      source: asString(r["figureLabel"] ?? r["source"]),
      receivedDisplay: r["receivedMinor"] !== undefined
        ? formatMinorMoney(asNumber(r["receivedMinor"]), currency)
        : formatMoney(asNumber(r["recipientAmount"] ?? r["receives"]), currency),
      totalCostDisplay: r["totalCostMinor"] !== undefined
        ? formatMinorMoney(asNumber(r["totalCostMinor"]), currency)
        : formatMoney(asNumber(r["totalCost"] ?? r["cost"]), currency),
    }));
}

export default function TransferComparison({
  data,
}: {
  data: Record<string, unknown>;
}) {
  const currency = asString(data["currency"]);
  const corridor = asString(data["corridor"]);
  const toCurrency = currency || corridor.split(">")[1] || "";
  const options = readOptions(data["ranked"] ?? data["options"] ?? data["quotes"], toCurrency);
  const note = asString(data["note"] ?? data["summary"]);
  const figureLabel = asString(data["figureLabel"]);
  const excluded = asArray<Record<string, unknown>>(data["excluded"]).filter(isRecord);
  const benchmark = isRecord(data["worldBankBenchmark"]) ? data["worldBankBenchmark"] : null;

  // Highlight the cheapest option that has a comparable total cost.
  const priced = options
    .map((o, i) => ({ o, i }))
    .filter(({ o }) => o.totalCost !== null);
  const cheapestIdx =
    priced.length > 0
      ? priced.reduce((a, b) =>
          (a.o.totalCost ?? Infinity) <= (b.o.totalCost ?? Infinity) ? a : b,
        ).i
      : -1;

  return (
    <div>
      {note && <p className="text-sm text-[var(--sr-ink)]/80">{note}</p>}
      <div className="mt-3 space-y-2" role="table" aria-label="Transfer options">
        {options.map((o, i) => (
          <div
            key={`${o.provider}-${i}`}
            role="row"
            className={`rounded-xl border px-3 py-2.5 ${
              i === cheapestIdx
                ? "border-[var(--sr-pine)]/50 bg-[var(--sr-pine)]/5"
                : "border-[var(--sr-line)] bg-white/50"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-[var(--sr-ink)]">
                {o.provider}
                {i === cheapestIdx && (
                  <span className="ml-2 rounded-full bg-[var(--sr-pine)]/15 px-2 py-0.5 text-[11px] font-medium text-[var(--sr-pine)]">
                    lowest total cost
                  </span>
                )}
              </p>
              {figureLabel.includes("not a live quote") && <EstimateBadge />}
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
              <div>
                <dt className="text-[var(--sr-ink)]/50">Total cost</dt>
                <dd className="font-semibold tabular-nums text-[var(--sr-ink)]">
                  {o.totalCostDisplay || formatMoney(o.totalCost, o.currency || toCurrency)}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--sr-ink)]/50">Recipient gets</dt>
                <dd className="font-semibold tabular-nums text-[var(--sr-ink)]">
                  {o.receivedDisplay || formatMoney(o.recipientAmount, o.currency || toCurrency)}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--sr-ink)]/50">Timing</dt>
                <dd className="font-medium text-[var(--sr-ink)]">
                  {o.timing || "—"}
                </dd>
              </div>
            </dl>
            {o.source && (
              <p className="mt-1.5 text-[11px] text-[var(--sr-ink)]/50">
                Source: {o.source}
              </p>
            )}
          </div>
        ))}
      </div>
      <ManualTransferComparison data={data} />
      {excluded.length > 0 && (
        <Disclosure label={`Excluded options (${excluded.length})`}>
          <ul className="space-y-2 text-xs text-[var(--sr-ink)]/70">
            {excluded.map((raw, index) => (
              <li key={`${asString(raw["provider"])}-${index}`} className="rounded-lg border border-[var(--sr-line)] px-3 py-2">
                <span className="font-semibold">{asString(raw["provider"], "Unknown provider")}</span>
                <span>: {asString(raw["exclusionReason"], "Not comparable")}</span>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
      {benchmark && (
        <div className="mt-4 rounded-xl border border-[var(--sr-line)] bg-[var(--sr-mist)]/60 px-3 py-2.5">
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--sr-ink)]/60">Remittance cost benchmark</p>
          <p className="mt-1 text-sm text-[var(--sr-ink)]">
            World Bank RPW reported an average total cost of <strong>{asNumber(benchmark["globalAverageTotalCostPercent"])}%</strong> for US$200 remittances in {asString(benchmark["referencePeriod"])}; digital remittances averaged <strong>{asNumber(benchmark["globalDigitalAveragePercent"])}%</strong>.
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--sr-ink)]/55">
            Context only — this is a historical market benchmark, not a live quote and not directly comparable to a tuition-sized transfer. Checked {asString(benchmark["checkedAt"])}.
          </p>
          {asString(benchmark["sourceUrl"]).startsWith("https://") && (
            <a href={asString(benchmark["sourceUrl"])} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs font-medium text-[var(--sr-pine)] underline underline-offset-2">{asString(benchmark["source"])}</a>
          )}
          <p className="mt-1 text-[10px] text-[var(--sr-ink)]/45">{asString(benchmark["attribution"])}</p>
        </div>
      )}
      <Disclosure label="About these figures">
        <p className="text-xs leading-relaxed text-[var(--sr-ink)]/70">
          These are reference estimates for comparison, not live quotes. Fees
          and exchange rates move constantly — always confirm the final fee,
          rate, and delivery time with the provider before sending money.
        </p>
      </Disclosure>
    </div>
  );
}
