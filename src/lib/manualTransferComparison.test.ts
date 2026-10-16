import { describe, expect, it } from "vitest";
import { toMinor } from "./money";
import { compareManualTransferQuotes } from "./manualTransferComparison";

const base = {
  sendAmountMinor: toMinor(1000, "GBP"),
  sendCurrency: "GBP",
  receiveCurrency: "USD",
  deadlineIso: "2026-11-01",
  objective: "max_received" as const,
  midMarketRate: 2.1,
};

function quote(overrides: Partial<{
  provider: string;
  exchangeRate: number;
  feeTreatment: "deducted" | "added";
  feeMinor: number | null;
  recipientFeeMinor: number | null;
  deliveryDaysMin: number;
  deliveryDaysMax: number;
  quoteDate: string;
  quoteCheckedAt: string;
  minimumSendMinor: number | null;
  maximumSendMinor: number | null;
}> = {}) {
  return {
    provider: "Fast Transfer",
    exchangeRate: 2,
    feeTreatment: "added" as const,
    feeMinor: toMinor(5, "GBP"),
    recipientFeeMinor: toMinor(10, "USD"),
    deliveryDaysMin: 1,
    deliveryDaysMax: 2,
    quoteDate: "2026-10-28",
    quoteCheckedAt: "2026-10-28T10:00:00.000Z",
    minimumSendMinor: null,
    maximumSendMinor: null,
    ...overrides,
  };
}

describe("manual transfer quote comparison", () => {
  it("computes recipient fees, total sender outlay, spread, and max received ranking", () => {
    const result = compareManualTransferQuotes({
      ...base,
      quotes: [
        quote(),
        quote({ provider: "Lower Rate", exchangeRate: 1.99, feeMinor: toMinor(2, "GBP") }),
      ],
    });
    expect(result.ranked[0].provider).toBe("Fast Transfer");
    expect(result.ranked[0].receivedMinor).toBe(toMinor(1990, "USD"));
    expect(result.ranked[0].totalCostMinor).toBe(toMinor(1005, "GBP"));
    expect(result.ranked[0].deadlineVerdict).toBe("meets");
    expect(result.ranked[0].spreadBasisPoints).toBeCloseTo(476.1904, 3);
  });

  it("calculates a fee deducted from the transfer principal", () => {
    const result = compareManualTransferQuotes({
      ...base,
      quotes: [quote({ feeTreatment: "deducted" })],
    });
    expect(result.ranked[0].receivedMinor).toBe(toMinor(1980, "USD"));
    expect(result.ranked[0].totalCostMinor).toBe(toMinor(1000, "GBP"));
  });

  it("excludes deadline misses, uncertain arrivals, limit failures, and unknown charges", () => {
    const result = compareManualTransferQuotes({
      ...base,
      quotes: [
        quote({ provider: "Misses", deliveryDaysMin: 5, deliveryDaysMax: 6 }),
        quote({ provider: "Uncertain", quoteDate: "2026-10-30", deliveryDaysMin: 1, deliveryDaysMax: 3 }),
        quote({ provider: "Limit", minimumSendMinor: toMinor(1500, "GBP") }),
        quote({ provider: "Unknown fee", feeMinor: null }),
        quote({ provider: "Unknown recipient charge", recipientFeeMinor: null }),
      ],
    });
    expect(result.ranked).toHaveLength(0);
    expect(result.excluded).toHaveLength(5);
    expect(result.excluded.map((option) => option.provider)).toEqual([
      "Misses", "Uncertain", "Limit", "Unknown fee", "Unknown recipient charge",
    ]);
    expect(result.excluded[3].exclusionReason).toContain("not treated as zero");
  });
});
