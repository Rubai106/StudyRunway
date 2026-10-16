"use client";

import { Disclosure, EstimateBadge, asArray, asNumber, asString, formatMoney, isRecord } from "./shared";

interface TransferOption {
  provider: string;
  totalCost: number | null;
  currency: string;
  recipientAmount: number | null;
  timing: string;
  source: string;
}

function readOptions(v: unknown): TransferOption[] {
  return asArray<Record<string, unknown>>(v)
    .filter(isRecord)
    .map((r) => ({
      provider: asString(r["provider"], "Unknown provider"),
      totalCost: asNumber(r["totalCost"] ?? r["cost"]),
      currency: asString(r["currency"]),
      recipientAmount: asNumber(r["recipientAmount"] ?? r["receives"]),
      timing: asString(r["timing"] ?? r["arrival"]),
      source: asString(r["source"]),
    }));
}

export default function TransferComparison({
  data,
}: {
  data: Record<string, unknown>;
}) {
  const currency = asString(data["currency"]);
  const options = readOptions(data["options"] ?? data["quotes"]);
  const note = asString(data["note"]);

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
              <EstimateBadge />
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
              <div>
                <dt className="text-[var(--sr-ink)]/50">Total cost</dt>
                <dd className="font-semibold tabular-nums text-[var(--sr-ink)]">
                  {formatMoney(o.totalCost, o.currency || currency)}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--sr-ink)]/50">Recipient gets</dt>
                <dd className="font-semibold tabular-nums text-[var(--sr-ink)]">
                  {formatMoney(o.recipientAmount, o.currency || currency)}
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
