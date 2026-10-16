/**
 * Tests for the deterministic budget engine (src/lib/livingCosts/engine.ts).
 *
 * Every expected figure below was hand-computed from docs/COST_DATASET.json
 * (see the arithmetic notes in each test). Nothing is asserted as merely
 * "non-empty".
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  LivingCostPlanInputsSchema,
  buildLivingCostPlan,
  buildLivingCostPlanFromProfile,
  getDestination,
  listDestinations,
  sourceWarnings,
  type LivingCostPlanInputs,
} from "../index";
import type { DestinationProfile } from "../dataset";

function ieInputs(overrides: Record<string, unknown> = {}): LivingCostPlanInputs {
  return LivingCostPlanInputsSchema.parse({
    destinationId: "ie-limerick",
    monthlyBudgetMinor: 160000, // €1,600
    budgetCurrency: "EUR",
    accommodationType: "off-campus",
    insuranceCovered: true,
    ...overrides,
  });
}

describe("input safety", () => {
  it("rejects unsafe integer minor-unit amounts", () => {
    expect(() => LivingCostPlanInputsSchema.parse({
      destinationId: "ie-limerick",
      monthlyBudgetMinor: Number.MAX_SAFE_INTEGER + 1,
      budgetCurrency: "EUR",
      insuranceCovered: true,
    })).toThrow(/safe integer/i);
    expect(() => LivingCostPlanInputsSchema.parse({
      destinationId: "ie-limerick",
      monthlyBudgetMinor: 100000,
      budgetCurrency: "EUR",
      insuranceCovered: true,
      categoryOverridesMinor: { groceries: Number.MAX_SAFE_INTEGER + 1 },
    })).toThrow(/safe integer/i);
  });
});

describe("budget totals (Ireland–Limerick, off-campus)", () => {
  // Hand computation from COST_DATASET.json (minor units, EUR):
  //  rent            65000 /  77500 /  90000
  //  groceries       17333 /  21667 /  26000
  //  utilities        5000 /   7500 /  10000
  //  local_transport  5000 /   7500 /  10000
  //  mobile           1100 /   1550 /   2000
  //  study_materials  7500 /   7500 /   7500
  //  personal_leisure 10000 / 20000 /  30000
  // subtotals: low 110933, typical 143217, high 175500
  // contingency 5%: low round(5546.65)=5547, typical round(7160.85)=7161, high 8775
  // totals: low 116480, typical 150378, high 184275

  it("(4) computes low/typical/high totals with per-scenario 5% contingency", () => {
    const plan = buildLivingCostPlan(ieInputs());
    expect(plan.monthlyTotals.lowMinor).toBe(116480);
    expect(plan.monthlyTotals.typicalMinor).toBe(150378);
    expect(plan.monthlyTotals.highMinor).toBe(184275);
    expect(plan.contingencyMinor).toEqual({
      lowMinor: 5547,
      typicalMinor: 7161,
      highMinor: 8775,
    });
    // contingency is a labelled line, from no source
    const cont = plan.categories.find((c) => c.category === "contingency")!;
    expect(cont.valueKind).toBe("assumption");
    expect(cont.estimateMinor).toBe(7161);
    expect(plan.assumptions.some((a) => a.tag === "contingency")).toBe(true);
  });

  it("(4b) deterministic: two runs produce identical output", () => {
    const a = buildLivingCostPlan(ieInputs());
    const b = buildLivingCostPlan(ieInputs());
    expect(a).toEqual(b);
  });

  it("(5) verdict is tight: thin headroom AND missing essential data", () => {
    const plan = buildLivingCostPlan(ieInputs());
    // remaining = 160000 - 150378 = 9622; 9622*10 = 96220 < 150378 -> thin
    expect(plan.remainingMinor).toBe(9622);
    expect(plan.verdict).toBe("tight");
    expect(plan.verdictReason).toMatch(/tight/i);
    // health_insurance has no sourced figure for Limerick
    expect(plan.missingData.some((m) => m.category === "health_insurance")).toBe(true);
  });

  it("(6) negative remaining -> shortfall with exact shortfallMinor", () => {
    const plan = buildLivingCostPlan(ieInputs({ monthlyBudgetMinor: 100000 }));
    expect(plan.verdict).toBe("shortfall");
    expect(plan.shortfallMinor).toBe(150378 - 100000); // 50378
    expect(plan.remainingMinor).toBe(100000 - 150378); // -50378
  });

  it("(10) one-time setup costs are sourced and summed once", () => {
    const plan = buildLivingCostPlan(ieInputs());
    expect(plan.oneTime.items).toHaveLength(1);
    expect(plan.oneTime.items[0].label).toMatch(/visa/i);
    expect(plan.oneTime.items[0].estimateMinor).toBe(6000);
    expect(plan.oneTime.totalMinor).toBe(6000);
  });

  it("(13) no double counting: deposit absent, cross-check total excluded", () => {
    const plan = buildLivingCostPlan(ieInputs());
    expect(plan.categories.some((c) => c.category === "deposit")).toBe(false);
    expect(plan.categories.some((c) => c.category === "total_monthly_living")).toBe(false);
    const labels = plan.oneTime.items.map((i) => i.label);
    expect(new Set(labels).size).toBe(labels.length);
    // top contributors are real categories, contingency excluded
    expect(plan.topContributors.map((t) => t.category)).toEqual([
      "rent",
      "groceries",
      "personal_leisure",
    ]);
  });

  it("(18b) visa requirement is separate and never enters totals", () => {
    const plan = buildLivingCostPlan(ieInputs());
    expect(plan.visaRequirementSeparate).not.toBeNull();
    expect(plan.visaRequirementSeparate!.amount).toBe(1000000); // €10,000/year
    expect(plan.visaRequirementSeparate!.period).toBe("year");
    // 1,000,000 minor is far above the typical total — proof it isn't summed in
    expect(plan.monthlyTotals.typicalMinor).toBe(150378);
  });

  it("uses manual food and transport overrides as actual amounts, not additive extras", () => {
    const baseline = buildLivingCostPlan(ieInputs());
    const changed = buildLivingCostPlan(ieInputs({
      categoryOverridesMinor: { groceries: 15000, local_transport: 6000 },
    }));
    expect(changed.categories.find((c) => c.category === "groceries")?.estimateMinor).toBe(15000);
    expect(changed.categories.find((c) => c.category === "local_transport")?.estimateMinor).toBe(6000);
    expect(changed.monthlyTotals.typicalMinor).toBeLessThan(baseline.monthlyTotals.typicalMinor);
    expect(changed.assumptions.some((a) => a.tag === "user_override" && /Groceries/.test(a.text))).toBe(true);
    expect(changed.verdict).toBe("tight"); // user-entered essential values are explicitly weak/unverified
  });

  it("supports a manual food estimate when a profile has no sourced food value but has rent", () => {
    const profile = getDestination("ie-limerick");
    const synthetic = {
      ...profile,
      categories: profile.categories.map((entry) =>
        entry.category === "groceries" ? {
          ...entry, minMinor: null, estimateMinor: null, maxMinor: null,
          sourceTitle: null, sourceUrl: null, valueKind: "missing" as const,
          confidence: "none" as const, limitations: "No sourced grocery price for this test.",
        } : entry,
      ),
    };
    const plan = buildLivingCostPlanFromProfile(
      LivingCostPlanInputsSchema.parse({
        destinationId: "ie-limerick", monthlyBudgetMinor: 160000,
        budgetCurrency: "EUR", accommodationType: "off-campus",
        insuranceCovered: true, categoryOverridesMinor: { groceries: 21000 },
      }),
      synthetic,
    );
    expect(plan.verdict).not.toBe("insufficient_data");
    expect(plan.categories.find((c) => c.category === "groceries")?.estimateMinor).toBe(21000);
    expect(plan.missingData.some((m) => m.category === "groceries")).toBe(false);
  });

  it("cross-checks Limerick's core subtotal with its published monthly benchmark", () => {
    const plan = buildLivingCostPlan(ieInputs());
    expect(plan.benchmarkCrossCheck).not.toBeNull();
    expect(plan.benchmarkCrossCheck?.sourceMinMinor).toBe(100000);
    expect(plan.benchmarkCrossCheck?.sourceMaxMinor).toBe(120000);
    expect(plan.benchmarkCrossCheck?.comparableEstimateMinor).toBe(106667);
    expect(plan.benchmarkCrossCheck?.additionalMonthlyMinor).toBe(43711);
    expect(plan.benchmarkCrossCheck?.includesUserEnteredAssumption).toBe(false);
    expect(plan.benchmarkCrossCheck?.overlapsSourceRange).toBe(true);
    // Full monthly total includes other expense lines and the 5% buffer; benchmark is not added.
    expect(plan.monthlyTotals.typicalMinor).toBe(150378);
    expect(plan.warnings.some((w) => /falls outside the source range/i.test(w))).toBe(false);
  });

});

describe("insufficient data (Canada)", () => {
  it("(8) Canada -> insufficient_data: no rent, no groceries, no invented figures", () => {
    const plan = buildLivingCostPlan(
      LivingCostPlanInputsSchema.parse({
        destinationId: "ca-canada",
        monthlyBudgetMinor: 200000,
        budgetCurrency: "CAD",
        insuranceCovered: true,
      }),
    );
    expect(plan.verdict).toBe("insufficient_data");
    expect(plan.categories).toHaveLength(0);
    expect(plan.monthlyTotals.typicalMinor).toBe(0);
    expect(plan.missingData.length).toBeGreaterThan(0);
    // but the regulatory requirement is still surfaced, separately
    expect(plan.visaRequirementSeparate!.amount).toBe(2344800); // C$23,448/year
    expect(plan.warnings.some((w) => /cannot be estimated|no sourced rent/i.test(w))).toBe(true);
  });
});

describe("currency handling", () => {
  // Denmark is DKK-priced. Budget €2,000 with explicit 1 EUR = 7.46 DKK.
  // fxToDestinationMinor = 746 (øre per 1 EUR).
  // budgetMinor = round(200000 * 746 / 100) = 1,492,000 øre.
  // Danish typical subtotal: 475000+30000+20000+52500+25000+25000+275000+30000+200000 = 1132500
  // contingency = round(1132500*0.05) = 56625 -> typical 1189125
  // remaining = 1492000 - 1189125 = 302875; health_insurance missing -> tight
  it("(9) explicit FX assumption converts the budget; totals stay in DKK", () => {
    const plan = buildLivingCostPlan(
      LivingCostPlanInputsSchema.parse({
        destinationId: "dk-denmark",
        monthlyBudgetMinor: 200000,
        budgetCurrency: "EUR",
        fxToDestinationMinor: 746,
        insuranceCovered: true,
      }),
    );
    expect(plan.currency).toBe("DKK");
    expect(plan.budgetCurrencyOriginal).toBe("EUR");
    expect(plan.budgetMinor).toBe(1492000);
    expect(plan.monthlyTotals.typicalMinor).toBe(1189125);
    expect(plan.remainingMinor).toBe(302875);
    expect(plan.verdict).toBe("tight"); // health_insurance has no sourced figure
    const fx = plan.assumptions.find((a) => a.tag === "fx")!;
    expect(fx.text).toMatch(/user-supplied, not fetched/);
  });

  it("rejects an out-of-range explicit FX assumption", () => {
    expect(() => buildLivingCostPlan({
      destinationId: "dk-denmark",
      monthlyBudgetMinor: 200000,
      budgetCurrency: "EUR",
      fxToDestinationMinor: 100_000_001,
      insuranceCovered: true,
    })).toThrow(/supported rate range/i);
  });

  it("supports fractional destination minor-units per source major-unit FX rates", () => {
    // 10,000 BDT × €0.008 per BDT = €80. A rate below one EUR cent
    // per BDT must be expressible without rounding the rate to 1 cent.
    const plan = buildLivingCostPlan(
      LivingCostPlanInputsSchema.parse({
        destinationId: "ie-limerick",
        monthlyBudgetMinor: 1_000_000, // BDT 10,000
        budgetCurrency: "BDT",
        fxToDestinationMinor: 0.8, // 0.8 EUR cents per BDT = EUR 0.008 per BDT
        insuranceCovered: true,
      }),
    );
    expect(plan.currency).toBe("EUR");
    expect(plan.budgetMinor).toBe(8_000); // EUR 80.00
    expect(plan.assumptions.find((a) => a.tag === "fx")?.text).toContain("0.00800000 EUR");
  });

  it("(9b) missing FX with mismatched currencies -> insufficient_data + warning", () => {
    const plan = buildLivingCostPlan(
      LivingCostPlanInputsSchema.parse({
        destinationId: "dk-denmark",
        monthlyBudgetMinor: 200000,
        budgetCurrency: "EUR",
        insuranceCovered: true,
      }),
    );
    expect(plan.verdict).toBe("insufficient_data");
    expect(plan.warnings.some((w) => /FX/i.test(w))).toBe(true);
  });

  it("(9c) same-currency budgets need no FX", () => {
    const plan = buildLivingCostPlan(ieInputs());
    expect(plan.budgetMinor).toBe(160000);
    expect(plan.assumptions.some((a) => a.tag === "fx")).toBe(false);
  });
});

describe("lifestyle scenario changes (Germany rent choice)", () => {
  it("(12) different accommodation types change totals deterministically", () => {
    const base = {
      destinationId: "de-germany",
      monthlyBudgetMinor: 200000,
      budgetCurrency: "EUR",
      insuranceCovered: true,
    };
    const cheap = buildLivingCostPlan(
      LivingCostPlanInputsSchema.parse({ ...base, accommodationType: "student residence" }),
    );
    const pricey = buildLivingCostPlan(
      LivingCostPlanInputsSchema.parse({ ...base, accommodationType: "private housing, room" }),
    );
    const cheapRent = cheap.categories.find((c) => c.category === "rent")!;
    const priceyRent = pricey.categories.find((c) => c.category === "rent")!;
    expect(cheapRent.estimateMinor).toBe(29000); // Bielefeld student residence
    expect(priceyRent.estimateMinor).toBe(80000); // Munich private room
    expect(pricey.monthlyTotals.typicalMinor).toBeGreaterThan(cheap.monthlyTotals.typicalMinor);
    // city-slice matching is recorded as an assumption
    expect(
      cheap.assumptions.some((a) => /Bielefeld/i.test(a.text)),
    ).toBe(true);
  });

  it("(12b) unknown accommodation type falls back to cheapest with a warning", () => {
    const plan = buildLivingCostPlan(
      LivingCostPlanInputsSchema.parse({
        destinationId: "de-germany",
        monthlyBudgetMinor: 200000,
        budgetCurrency: "EUR",
        accommodationType: "igloo",
        insuranceCovered: true,
      }),
    );
    const rent = plan.categories.find((c) => c.category === "rent")!;
    expect(rent.estimateMinor).toBe(29000); // cheapest sourced
    expect(plan.warnings.some((w) => /igloo/i.test(w))).toBe(true);
  });
});

describe("tuition handling", () => {
  it("(11) tuition excluded by default, stated plainly", () => {
    const plan = buildLivingCostPlan(ieInputs());
    expect(plan.tuition.included).toBe(false);
    expect(plan.tuition.note).toMatch(/EXCLUDED/);
  });

  it("(11b) tuition included when explicitly requested (same currency)", () => {
    const plan = buildLivingCostPlan(
      ieInputs({ includeTuition: true, tuitionAmountMinor: 900000, tuitionCurrency: "EUR" }),
    );
    expect(plan.tuition.included).toBe(true);
    expect(plan.tuition.amountMinor).toBe(900000);
    expect(plan.tuition.currency).toBe("EUR");
  });
});

describe("within-budget on fully-sourced synthetic data", () => {
  function testProfile(): DestinationProfile {
    const entry = (category: string, min: number, est: number, max: number) => ({
      category,
      minMinor: min,
      estimateMinor: est,
      maxMinor: max,
      estimateMethod: "test figure",
      sourceTitle: "Test Source",
      sourceUrl: "https://example.com/test",
      publishedDate: null,
      checkedDate: "2026-10-15",
      valueKind: "official_estimate",
      confidence: "medium",
      limitations: "Test.",
    });
    return {
      destinationId: "xx-testland",
      country: "Testland",
      city: null,
      currency: "EUR",
      geographicScope: "country",
      checkedDate: "2026-10-15",
      categories: [
        entry("rent", 80000, 100000, 120000),
        entry("groceries", 20000, 25000, 30000),
        entry("health_insurance", 10000, 12000, 14000),
        entry("local_transport", 3000, 5000, 7000),
        entry("utilities", 5000, 6000, 7000),
      ],
      oneTimeCosts: [],
      visaRequirement: {
        amount: 1000000,
        period: "year",
        sourceTitle: "Test Visa",
        sourceUrl: "https://example.com/visa",
        publishedDate: null,
        checkedDate: "2026-10-15",
        note: "Regulatory minimum.",
      },
    } as DestinationProfile;
  }

  // subtotals: low 118000, typical 148000, high 178000
  // contingency: 5900 / 7400 / 8900 -> totals 123900 / 155400 / 186900
  // budget 200000: remaining 44600; 44600*10 = 446000 >= 155400 -> within_budget
  it("(7) within_budget when headroom >= 10% and essentials are solid", () => {
    const inputs = LivingCostPlanInputsSchema.parse({
      destinationId: "xx-testland",
      monthlyBudgetMinor: 200000,
      budgetCurrency: "EUR",
      insuranceCovered: true,
    });
    const plan = buildLivingCostPlanFromProfile(inputs, testProfile());
    expect(plan.monthlyTotals.lowMinor).toBe(123900);
    expect(plan.monthlyTotals.typicalMinor).toBe(155400);
    expect(plan.monthlyTotals.highMinor).toBe(186900);
    expect(plan.remainingMinor).toBe(44600);
    expect(plan.verdict).toBe("within_budget");
  });

  it("(7b) low-confidence essential degrades within_budget to tight", () => {
    const profile = testProfile();
    (profile.categories[1] as { confidence: string }).confidence = "low"; // groceries
    const inputs = LivingCostPlanInputsSchema.parse({
      destinationId: "xx-testland",
      monthlyBudgetMinor: 200000,
      budgetCurrency: "EUR",
      insuranceCovered: true,
    });
    const plan = buildLivingCostPlanFromProfile(inputs, profile);
    expect(plan.verdict).toBe("tight");
    expect(plan.verdictReason).toMatch(/low confidence/i);
  });
});

describe("input validation and defaults", () => {
  it("(16) malformed engine inputs are rejected by Zod", () => {
    expect(() =>
      LivingCostPlanInputsSchema.parse({
        destinationId: "ie-limerick",
        monthlyBudgetMinor: -1,
        budgetCurrency: "EUR",
        insuranceCovered: true,
      }),
    ).toThrow(z.ZodError);
    expect(() =>
      LivingCostPlanInputsSchema.parse({
        destinationId: "ie-limerick",
        monthlyBudgetMinor: 100000,
        budgetCurrency: "EURO",
        insuranceCovered: true,
      }),
    ).toThrow(z.ZodError);
    expect(() =>
      LivingCostPlanInputsSchema.parse({
        destinationId: "ie-limerick",
        monthlyBudgetMinor: 100000,
        budgetCurrency: "EUR",
        includeTuition: true, // missing tuitionAmountMinor/tuitionCurrency
        insuranceCovered: true,
      }),
    ).toThrow(/tuitionAmountMinor/);
    expect(() =>
      buildLivingCostPlan({
        destinationId: "xx-nowhere",
        monthlyBudgetMinor: 100000,
        budgetCurrency: "EUR",
        insuranceCovered: true,
      }),
    ).toThrow(/Unknown destinationId/);
  });

  it("(17) missing optional inputs use documented defaults", () => {
    const inputs = LivingCostPlanInputsSchema.parse({
      destinationId: "ie-limerick",
      monthlyBudgetMinor: 160000,
      budgetCurrency: "EUR",
      insuranceCovered: true,
    });
    expect(inputs.studyMonths).toBe(12);
    expect(inputs.includeTuition).toBe(false);
    expect(inputs.protectedEssentials).toEqual([]);
    // default rent = cheapest sourced (on-campus UL residence, €750)
    const plan = buildLivingCostPlan(inputs);
    const rent = plan.categories.find((c) => c.category === "rent")!;
    expect(rent.estimateMinor).toBe(75000);
    expect(rent.accommodationType).toMatch(/on-campus/);
    expect(plan.assumptions.some((a) => /cheapest sourced/i.test(a.text))).toBe(true);
  });
});

describe("staleness and regulatory handling", () => {
  it("(18) stale sources surface warnings", () => {
    const profile = getDestination("ie-limerick");
    const fresh = sourceWarnings(profile, new Date("2026-10-20"));
    expect(fresh.filter((w) => /stale/i.test(w))).toHaveLength(0);
    const stale = sourceWarnings(profile, new Date("2028-06-01"));
    expect(stale.some((w) => /stale/i.test(w))).toBe(true);
  });

  it("(18b) verify-before-use visa cautions are surfaced as warnings", () => {
    const ca = getDestination("ca-canada");
    const warnings = sourceWarnings(ca, new Date("2026-10-20"));
    expect(warnings.some((w) => /canada\.ca/i.test(w))).toBe(true);
  });

  it("listDestinations exposes the six options for the future tool", () => {
    expect(listDestinations()).toHaveLength(6);
    expect(listDestinations()[0]).toHaveProperty("id");
  });
});
