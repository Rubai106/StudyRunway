/**
 * Tests for plan -> obligations conversion (toObligations.ts).
 *
 * Areas: (14) valid ObligationSchema records, (15) pure revert semantics,
 * (11) tuition included vs excluded.
 */
import { describe, expect, it } from "vitest";
import { ObligationSchema, type Obligation } from "@/lib/model";
import {
  LivingCostPlanInputsSchema,
  buildLivingCostPlan,
  classifyOneTimeKind,
  describePlanRevert,
  planToObligations,
} from "../index";

function iePlan(overrides: Record<string, unknown> = {}) {
  return buildLivingCostPlan(
    LivingCostPlanInputsSchema.parse({
      destinationId: "ie-limerick",
      monthlyBudgetMinor: 160000,
      budgetCurrency: "EUR",
      accommodationType: "off-campus",
      insuranceCovered: true,
      ...overrides,
    }),
  );
}

describe("planToObligations", () => {
  it("(14) produces valid obligations: recurring rent/living, one-time visa fee", () => {
    const plan = iePlan();
    const { obligations } = planToObligations(plan, {
      startDate: "2026-11-01",
      studyMonths: 12,
    });
    // 7 sourced monthly lines + contingency + 1 one-time visa fee = 9
    expect(obligations).toHaveLength(9);
    for (const o of obligations) {
      expect(() => ObligationSchema.parse(o)).not.toThrow();
      expect(o.status).toBe("planned");
      expect(o.currency).toBe("EUR");
      expect(o.notes).toContain("Estimated budget item, not a committed bill.");
      expect(o.id.startsWith("lcp-ie-limerick-")).toBe(true);
    }
    const rent = obligations.find((o) => o.kind === "rent")!;
    expect(rent.amountMinor).toBe(77500); // typical estimate
    expect(rent.recurring).toEqual({ everyMonths: 1, occurrences: 12 });
    expect(rent.dueDate).toBe("2026-11-01");
    const living = obligations.filter((o) => o.kind === "living");
    expect(living.length).toBeGreaterThan(0);
    expect(living.every((o) => o.recurring?.occurrences === 12)).toBe(true);
    const visa = obligations.find((o) => o.kind === "visa")!;
    expect(visa.amountMinor).toBe(6000);
    expect(visa.recurring).toBeNull();
    expect(visa.dueDate).toBeNull();
  });

  it("keeps one-time costs undated until a date is explicitly supplied", () => {
    const plan = iePlan();
    const undated = planToObligations(plan, { startDate: "2026-11-01", studyMonths: 12 });
    expect(undated.undatedOneTimeLabels).toContain("Student visa application fee (single journey)");
    expect(undated.obligations.find((o) => o.kind === "visa")?.dueDate).toBeNull();

    const dated = planToObligations(plan, {
      startDate: "2026-11-01",
      studyMonths: 12,
      oneTimeDueDates: { "0": "2026-09-15" },
    });
    expect(dated.undatedOneTimeLabels).toEqual([]);
    expect(dated.obligations.find((o) => o.kind === "visa")?.dueDate).toBe("2026-09-15");
  });

  it("rejects impossible calendar dates for one-time costs", () => {
    expect(() => planToObligations(iePlan(), {
      startDate: "2026-11-01", studyMonths: 12, oneTimeDueDates: { "0": "2026-02-30" },
    })).toThrow(/real calendar date/);
  });

  it("(14b) studyMonths=1 produces non-recurring obligations", () => {
    const plan = iePlan();
    const { obligations } = planToObligations(plan, {
      startDate: "2026-11-01",
      studyMonths: 1,
    });
    expect(obligations.every((o) => o.recurring === null)).toBe(true);
  });

  it("(11) tuition EXCLUDED by default — prominently stated", () => {
    const plan = iePlan();
    const { obligations, tuitionIncluded, tuitionNote } = planToObligations(plan, {
      startDate: "2026-11-01",
      studyMonths: 12,
    });
    expect(tuitionIncluded).toBe(false);
    expect(obligations.some((o) => o.kind === "tuition")).toBe(false);
    expect(tuitionNote).toMatch(/TUITION EXCLUDED/);
  });

  it("(11b) tuition included when the plan carries it", () => {
    const plan = iePlan({
      includeTuition: true,
      tuitionAmountMinor: 900000,
      tuitionCurrency: "EUR",
    });
    const { obligations, tuitionIncluded, tuitionNote } = planToObligations(plan, {
      startDate: "2026-11-01",
      studyMonths: 12,
    });
    expect(tuitionIncluded).toBe(true);
    const tuition = obligations.find((o) => o.kind === "tuition")!;
    expect(tuition.amountMinor).toBe(900000);
    expect(tuition.recurring).toBeNull();
    expect(tuitionNote).toMatch(/TUITION INCLUDED/);
  });

  it("refuses insufficient_data plans and bad options", () => {
    const ca = buildLivingCostPlan(
      LivingCostPlanInputsSchema.parse({
        destinationId: "ca-canada",
        monthlyBudgetMinor: 200000,
        budgetCurrency: "CAD",
        insuranceCovered: true,
      }),
    );
    expect(() =>
      planToObligations(ca, { startDate: "2026-11-01", studyMonths: 12 }),
    ).toThrow(/insufficient_data/);
    expect(() =>
      planToObligations(iePlan(), { startDate: "not-a-date", studyMonths: 12 }),
    ).toThrow();
    expect(() =>
      planToObligations(iePlan(), { startDate: "2026-11-01", studyMonths: 99 }),
    ).toThrow();
  });

  it("classifies one-time kinds deterministically", () => {
    expect(classifyOneTimeKind("Student visa application fee")).toBe("visa");
    expect(classifyOneTimeKind("Second-hand bicycle purchase")).toBe("travel");
    expect(classifyOneTimeKind("Accommodation deposit")).toBe("deposit");
    expect(classifyOneTimeKind("Bedding and kitchen starter pack")).toBe("living");
  });
});

describe("describePlanRevert", () => {
  it("(15) pure revert description: lists removals, mutates nothing", () => {
    const plan = iePlan();
    const { obligations } = planToObligations(plan, {
      startDate: "2026-11-01",
      studyMonths: 12,
    });
    const frozen: Obligation[] = JSON.parse(JSON.stringify(obligations));
    Object.freeze(obligations);
    const desc = describePlanRevert(obligations);
    expect(desc.count).toBe(9);
    expect(desc.obligationIds).toHaveLength(9);
    expect(desc.obligationIds[0]).toBe("lcp-ie-limerick-rent");
    expect(desc.summary).toContain("9 planned obligation(s)");
    expect(desc.summary).toMatch(/committed or paid items are never touched/);
    // input untouched
    expect(obligations).toEqual(frozen);
  });

  it("(15b) empty plan -> removes nothing", () => {
    const desc = describePlanRevert([]);
    expect(desc.count).toBe(0);
    expect(desc.summary).toMatch(/removes nothing/);
  });
});
