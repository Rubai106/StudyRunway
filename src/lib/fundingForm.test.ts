import { describe, expect, it } from "vitest";
import { FundingFormRequestSchema, fundingFormToToolInput } from "./fundingForm";
import { AnalyzeFundingGapParams, fundingGapInputToToolPlan } from "./tools/analyzeFundingGap";
import { assemblePlanState } from "./tools/common";
import { buildForecast } from "./forecast";

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

  it("preserves recurrence through tool validation and the canonical plan", () => {
    const parsed = FundingFormRequestSchema.parse({
      ...base,
      expenses: [{ ...base.expenses[0], frequency: "monthly", amount: 700, dueDate: "2027-01-01", occurrences: 6 }],
    });
    const toolInput = fundingFormToToolInput(parsed);
    const validated = AnalyzeFundingGapParams.parse(toolInput);
    const plan = fundingGapInputToToolPlan(validated);
    expect(plan.obligations[0].recurring).toEqual({ everyMonths: 1, occurrences: 6 });
    expect(plan.obligations[0].dueDate).toBe("2027-01-01");
    const forecast = buildForecast(assemblePlanState(plan));
    expect(forecast.rows.filter((row) => row.kind === "outflow").map((row) => row.date)).toEqual([
      "2027-01-01", "2027-02-01", "2027-03-01", "2027-04-01", "2027-05-01", "2027-06-01",
    ]);
    expect(forecast.totalOutflowMinor).toBe(420000);
  });

  it("maps semester and annual frequencies to their configured intervals", () => {
    const parsed = FundingFormRequestSchema.parse({
      ...base,
      expenses: [
        { ...base.expenses[0], frequency: "semester", occurrences: 2 },
        { ...base.expenses[0], id: "annual", frequency: "annual", occurrences: 2 },
      ],
    });
    const validated = AnalyzeFundingGapParams.parse(fundingFormToToolInput(parsed));
    const plan = fundingGapInputToToolPlan(validated);
    expect(plan.obligations.map((obligation) => obligation.recurring)).toEqual([
      { everyMonths: 4, occurrences: 2 },
      { everyMonths: 12, occurrences: 2 },
    ]);
  });

  it("rejects invalid recurrence values and keeps one-time costs unscheduled", () => {
    const oneTime = FundingFormRequestSchema.parse({
      ...base,
      expenses: [{ ...base.expenses[0], frequency: "one_time", occurrences: null }],
    });
    expect(fundingFormToToolInput(oneTime).obligations[0]).not.toHaveProperty("recurring");
    expect(() => AnalyzeFundingGapParams.parse({
      ...fundingFormToToolInput(oneTime),
      obligations: [{ ...fundingFormToToolInput(oneTime).obligations[0], recurring: { everyMonths: 13, occurrences: 6 } }],
    })).toThrow();
    expect(() => AnalyzeFundingGapParams.parse({
      ...fundingFormToToolInput(oneTime),
      obligations: [{ ...fundingFormToToolInput(oneTime).obligations[0], recurring: { everyMonths: 1.5, occurrences: 1.5 } }],
    })).toThrow();
  });

  it("keeps an expense with a missing due date incomplete", () => {
    const parsed = FundingFormRequestSchema.parse({
      ...base,
      expenses: [{ ...base.expenses[0], dueDate: null }],
    });
    const plan = fundingGapInputToToolPlan(AnalyzeFundingGapParams.parse(fundingFormToToolInput(parsed)));
    const forecast = buildForecast(assemblePlanState(plan));
    expect(forecast.rows.filter((row) => row.kind === "outflow")).toHaveLength(0);
    expect(forecast.incomplete).toEqual([expect.objectContaining({ label: "Tuition" })]);
  });
});
