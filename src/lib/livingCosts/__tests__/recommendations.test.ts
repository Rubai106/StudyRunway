/**
 * Tests for the deterministic recommendation layer (recommendations.ts).
 *
 * Safety rules under test: no meal-skipping / insurance-dropping / unsafe /
 * borrowing suggestions; protectedEssentials respected; low scenario never
 * presented as optimal; impacts quantified from sourced figures only.
 */
import { describe, expect, it } from "vitest";
import {
  LivingCostPlanInputsSchema,
  buildLivingCostPlan,
  buildRecommendations,
  getDestination,
} from "../index";

const BANNED = /skip(ping)?\s+(meals|food)|forego(ing)?\s+.*insurance|drop\s+.*insurance|borrow|illegal\s+work/i;

function iePlan() {
  return buildLivingCostPlan(
    LivingCostPlanInputsSchema.parse({
      destinationId: "ie-limerick",
      monthlyBudgetMinor: 160000,
      budgetCurrency: "EUR",
      accommodationType: "off-campus",
      insuranceCovered: true,
    }),
  );
}

function dePlan() {
  return buildLivingCostPlan(
    LivingCostPlanInputsSchema.parse({
      destinationId: "de-germany",
      monthlyBudgetMinor: 200000,
      budgetCurrency: "EUR",
      accommodationType: "student residence",
      insuranceCovered: true,
    }),
  );
}

describe("recommendations", () => {
  it("quantifies an accommodation switch from sourced figures (IE: off-campus -> on-campus)", () => {
    const plan = iePlan();
    const { recommendations } = buildRecommendations(plan, getDestination("ie-limerick"), {
      protectedEssentials: [],
      cookingHabit: undefined,
    });
    // on-campus €750 vs off-campus €775 -> saves 2500 minor/month
    const sw = recommendations.find((r) => r.impactMinor === -2500 && r.impactKind === "monthly");
    expect(sw).toBeDefined();
    expect(sw!.change).toMatch(/on-campus/i);
    expect(sw!.supportsBy).toMatch(/educationinireland\.com/);
    expect(sw!.tradeoff).toMatch(/safety/i);
  });

  it("respects protectedEssentials: no rent suggestions when rent is protected", () => {
    const plan = iePlan();
    const { recommendations, notes } = buildRecommendations(plan, getDestination("ie-limerick"), {
      protectedEssentials: ["rent"],
      cookingHabit: undefined,
    });
    expect(recommendations.every((r) => !/accommodation/i.test(r.change))).toBe(true);
    expect(notes.some((n) => /protected essentials/i.test(n))).toBe(true);
  });

  it("quantifies transport alternatives where the dataset has distinct values (DE)", () => {
    const plan = dePlan();
    const { recommendations } = buildRecommendations(plan, getDestination("de-germany"), {
      protectedEssentials: [],
      cookingHabit: undefined,
    });
    // current transport = 6000 (Hohenheim fallback); cheaper 3800 exists -> -2200
    const cheaper = recommendations.find(
      (r) => r.impactKind === "monthly" && r.impactMinor === -2200,
    );
    expect(cheaper).toBeDefined();
  });

  it("ranks biggest monthly saving first", () => {
    const plan = dePlan();
    const { recommendations } = buildRecommendations(plan, getDestination("de-germany"), {
      protectedEssentials: [],
      cookingHabit: undefined,
    });
    const monthly = recommendations.filter((r) => r.impactKind === "monthly");
    const impacts = monthly.map((r) => r.impactMinor as number);
    expect([...impacts].sort((a, b) => a - b)).toEqual(impacts);
  });

  it("never suggests banned content; notes rule out meal-skipping and insurance cuts", () => {
    for (const [plan, id] of [
      [iePlan(), "ie-limerick"],
      [dePlan(), "de-germany"],
    ] as const) {
      const { recommendations, notes } = buildRecommendations(plan, getDestination(id), {
        protectedEssentials: [],
        cookingHabit: "eat_out",
      });
      for (const r of recommendations) {
        expect(BANNED.test(r.change), r.change).toBe(false);
        expect(BANNED.test(r.tradeoff), r.tradeoff).toBe(false);
        expect(r.tradeoff).toBeTruthy();
      }
      expect(notes.some((n) => /never recommended/i.test(n))).toBe(true);
      expect(notes.some((n) => /never a suggested cut/i.test(n))).toBe(true);
      expect(notes.some((n) => /not presented as optimal/i.test(n))).toBe(true);
    }
  });

  it("does not quantify cooking-habit savings (no dataset split)", () => {
    const plan = iePlan();
    const { notes } = buildRecommendations(plan, getDestination("ie-limerick"), {
      protectedEssentials: [],
      cookingHabit: "cook_at_home",
    });
    expect(notes.some((n) => /no price split for cooking habits/i.test(n))).toBe(true);
  });
});
