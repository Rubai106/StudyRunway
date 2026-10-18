import { describe, expect, it } from "vitest";
import { FundingFormRequestSchema, fundingFormToToolInput } from "./fundingForm";

const base = {
  planningCurrency: "EUR",
  asOfDate: "2026-10-18",
  expenses: [{ id: "e1", label: "Tuition", category: "tuition", amount: 1200, currency: "EUR", dueDate: "2027-01-10", frequency: "semester", occurrences: 2, notes: "" }],
  fundingSources: [{ id: "s1", label: "Scholarship", kind: "scholarship", amount: 800, currency: "EUR", status: "confirmed_pending", availableDate: null, expectedDate: "2026-12-01", notes: "" }],
} as const;

describe("structured funding form adapter", () => {
  it("preserves repeated schedules and funding certainty in the authoritative tool input", () => {
    const parsed = FundingFormRequestSchema.parse(base);
    const input = fundingFormToToolInput(parsed);
    expect(input.obligations[0]).toMatchObject({ kind: "tuition", amount: 1200, dueDate: "2027-01-10", recurring: { everyMonths: 4, occurrences: 2 } });
    expect(input.fundingSources[0]).toMatchObject({ status: "confirmed_pending", expectedDate: "2026-12-01" });
  });

  it("rejects unsupported currencies and missing scheduled payment counts", () => {
    expect(() => FundingFormRequestSchema.parse({ ...base, expenses: [{ ...base.expenses[0], frequency: "monthly", occurrences: null }] })).toThrow(/occurrences/);
    expect(() => FundingFormRequestSchema.parse({ ...base, planningCurrency: "ZZZ" })).toThrow(/Unsupported currency/);
  });

  it("keeps future funding without a date incomplete instead of inventing timing", () => {
    const parsed = FundingFormRequestSchema.parse({ ...base, fundingSources: [{ ...base.fundingSources[0], expectedDate: null }] });
    expect(parsed.fundingSources[0].expectedDate).toBeNull();
  });
});
