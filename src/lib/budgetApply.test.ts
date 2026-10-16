/**
 * Unit tests for apply/revert of a destination budget against a task-state
 * fixture (Part H). Uses the REAL engine + REAL forecast — no mocks.
 *
 * Fixture: a task with a EUR working plan (€8,000 confirmed savings) and a
 * Limerick budget plan built by the real buildLivingCostPlan().
 */
import { describe, expect, it, beforeEach } from "vitest";
import { createTask, getTask, updateTask, clearStore } from "./agent/state";
import { applyBudgetToTask, revertBudgetFromTask, verifyPlanIntegrity } from "./budgetApply";
import { buildLivingCostPlan, type LivingCostPlan } from "./livingCosts";
import type { ToolPlanInput } from "./tools/common";

const SID = "apply-fixture";

function eurPlanInput(): ToolPlanInput {
  return {
    fundingSources: [
      {
        id: "src-savings",
        label: "Savings",
        kind: "savings",
        amountMinor: 800000, // €8,000
        currency: "EUR",
        status: "confirmed_available",
        availableDate: "2026-01-01",
        expectedDate: null,
        notes: "",
        evidenceIds: [],
      },
    ],
    obligations: [],
    planningCurrency: "EUR",
    asOfDate: null,
    fx: { rates: {}, asOf: "2026-10-15", source: "test fixture" },
    evidence: [],
    quotes: [],
  };
}

/** The exact inputs that produced limerickPlan() — sent as planInputs so the
 * server-side integrity check can recompute and verify the plan. */
function limerickInputs(): Record<string, unknown> {
  return {
    destinationId: "ie-limerick",
    monthlyBudgetMinor: 90000,
    budgetCurrency: "EUR",
    accommodationType: "shared",
    cookingHabit: "cook_at_home",
    insuranceCovered: false,
  };
}

function canadaInputs(): Record<string, unknown> {
  return {
    destinationId: "ca-canada",
    monthlyBudgetMinor: 200000,
    budgetCurrency: "CAD",
    insuranceCovered: true,
  };
}

function limerickPlan(): LivingCostPlan {
  return buildLivingCostPlan(limerickInputs());
}

function seed(): void {
  clearStore();
  createTask(SID);
  updateTask(SID, { workingPlan: eurPlanInput() });
}

describe("applyBudgetToTask", () => {
  beforeEach(seed);

  it("converts the plan into planned obligations with honest notes", () => {
    const plan = limerickPlan();
    const res = applyBudgetToTask(SID, plan, {
      startDate: "2027-09-01",
      studyMonths: 12,
    }, limerickInputs());
    expect(res.obligationCount).toBeGreaterThan(0);
    expect(res.obligations).toHaveLength(res.obligationCount);
    for (const o of res.obligations) {
      expect(o.id.startsWith("lcp-")).toBe(true);
      expect(o.status).toBe("planned");
      expect(o.notes).toContain("Estimated budget item, not a committed bill.");
      expect(o.currency).toBe("EUR");
      if (o.recurring) expect(o.dueDate).toBe("2027-09-01");
    }
    expect(res.obligations.find((o) => o.kind === "visa")?.dueDate).toBeNull();
    expect(res.obligations.find((o) => o.kind === "visa")?.notes).toMatch(/Due date not supplied/);
    // Stored in the task's working plan.
    const state = getTask(SID)!;
    expect(state.workingPlan!.obligations).toHaveLength(res.obligationCount);
    expect(state.appliedBudget).not.toBeNull();
    expect(state.appliedBudget!.destinationId).toBe("ie-limerick");
    expect(state.appliedBudget!.obligationIds).toHaveLength(res.obligationCount);
  });

  it("validates client-returned plan amounts and currencies before applying", () => {
    const negative = JSON.parse(JSON.stringify(limerickPlan())) as Record<string, unknown>;
    const categories = negative["categories"] as Array<Record<string, unknown>>;
    categories[0]["estimateMinor"] = -1;
    expect(() => applyBudgetToTask(SID, negative, {
      startDate: "2027-09-01", studyMonths: 12,
    }, limerickInputs())).toThrow();
    expect(getTask(SID)!.workingPlan!.obligations).toHaveLength(0);
    expect(getTask(SID)!.appliedBudget).toBeNull();

    const invalidCurrency = JSON.parse(JSON.stringify(limerickPlan())) as Record<string, unknown>;
    invalidCurrency["currency"] = "XYZ";
    expect(() => applyBudgetToTask(SID, invalidCurrency, {
      startDate: "2027-09-01", studyMonths: 12,
    }, limerickInputs())).toThrow(/unsupported currency/i);
    expect(getTask(SID)!.workingPlan!.obligations).toHaveLength(0);
  });

  it("rejects non-HTTPS or credential-bearing source URLs in client-returned plans", () => {
    const badSource = JSON.parse(JSON.stringify(limerickPlan())) as Record<string, unknown>;
    const categories = badSource["categories"] as Array<Record<string, unknown>>;
    categories[0]["sourceUrl"] = "http://untrusted.example/source";
    expect(() => applyBudgetToTask(SID, badSource, {
      startDate: "2027-09-01", studyMonths: 12,
    }, limerickInputs())).toThrow(/HTTPS/);
    expect(getTask(SID)!.workingPlan!.obligations).toHaveLength(0);

    const credentialUrl = JSON.parse(JSON.stringify(limerickPlan())) as Record<string, unknown>;
    const credentialCategories = credentialUrl["categories"] as Array<Record<string, unknown>>;
    credentialCategories[0]["sourceUrl"] = "https://user:password@trusted.example/source";
    expect(() => applyBudgetToTask(SID, credentialUrl, {
      startDate: "2027-09-01", studyMonths: 12,
    }, limerickInputs())).toThrow(/HTTPS/);
  });

  it("rejects implausibly large FX rates and mismatched tuition currencies", () => {
    clearStore();
    createTask(SID);
    const gbpInput: ToolPlanInput = {
      fundingSources: [{
        id: "src-gbp", label: "GBP savings", kind: "savings", amountMinor: 2_500_000,
        currency: "GBP", status: "confirmed_available", availableDate: "2026-01-01",
        expectedDate: null, notes: "", evidenceIds: [],
      }],
      obligations: [], planningCurrency: "GBP", asOfDate: null,
      fx: { rates: {}, asOf: "2026-10-15", source: "test fixture" }, evidence: [], quotes: [],
    };
    updateTask(SID, { workingPlan: gbpInput });
    expect(() => applyBudgetToTask(SID, limerickPlan(), {
      startDate: "2027-09-01", studyMonths: 12,
      fxRateToPlanning: 1e99, fxRateDate: "2026-10-15", fxRateSource: "test source",
    }, limerickInputs())).toThrow();
    expect(getTask(SID)!.workingPlan!.obligations).toHaveLength(0);

    seed(); // EUR working plan; destination is EUR but tuition is deliberately USD.
    const mismatchedTuition = JSON.parse(JSON.stringify(limerickPlan())) as Record<string, unknown>;
    mismatchedTuition["tuition"] = {
      included: true, amountMinor: 100000, currency: "USD", note: "user-supplied tuition",
    };
    // The tampered tuition figure no longer reaches the conversion check:
    // the plan-integrity gate rejects it first, because the amounts no longer
    // match a server-side recomputation of the deterministic engine.
    expect(() => applyBudgetToTask(SID, mismatchedTuition, {
      startDate: "2027-09-01", studyMonths: 12,
      tuitionDueDate: "2027-08-01",
    }, limerickInputs())).toThrow(/integrity/i);
    expect(getTask(SID)!.workingPlan!.obligations).toHaveLength(0);
  });

  it("excludes tuition unless explicitly included", () => {
    const res = applyBudgetToTask(SID, limerickPlan(), {
      startDate: "2027-09-01",
      studyMonths: 12,
    }, limerickInputs());
    expect(res.obligations.some((o) => o.kind === "tuition")).toBe(false);
    expect(res.tuitionNote).toMatch(/TUITION EXCLUDED/);
  });

  it("moves the funding-gap forecast: new projected gap appears", () => {
    const res = applyBudgetToTask(SID, limerickPlan(), {
      startDate: "2027-09-01",
      studyMonths: 12,
    }, limerickInputs());
    expect(res.gapBefore.hasGap).toBe(false);
    expect(res.gapAfter.hasGap).toBe(true);
    expect(res.gapAfter.shortfallMinor).toBeGreaterThan(0);
    // The gap opens when the €8,000 runs out — after the 2027-09-01 start.
    expect(res.gapAfter.gapDate! > "2027-09-01").toBe(true);
    expect(res.gapAfter.planningCurrency).toBe("EUR");
  });

  it("refuses cross-currency apply without an explicit, sourced exchange rate", () => {
    clearStore();
    createTask(SID);
    const gbpInput: ToolPlanInput = {
      fundingSources: [{
        id: "src-gbp", label: "GBP savings", kind: "savings", amountMinor: 2_500_000,
        currency: "GBP", status: "confirmed_available", availableDate: "2026-01-01",
        expectedDate: null, notes: "", evidenceIds: [],
      }],
      obligations: [], planningCurrency: "GBP", asOfDate: null,
      fx: { rates: {}, asOf: "2026-10-15", source: "test fixture" }, evidence: [], quotes: [],
    };
    updateTask(SID, { workingPlan: gbpInput });
    expect(() => applyBudgetToTask(SID, limerickPlan(), {
      startDate: "2027-09-01", studyMonths: 12,
    }, limerickInputs())).toThrow(/explicit exchange rate/i);
    expect(getTask(SID)!.workingPlan!.obligations).toHaveLength(0);
    expect(getTask(SID)!.appliedBudget).toBeNull();
  });

  it("converts every obligation using the explicit rate before forecast integration", () => {
    clearStore();
    createTask(SID);
    const gbpInput: ToolPlanInput = {
      fundingSources: [{
        id: "src-gbp", label: "GBP savings", kind: "savings", amountMinor: 2_500_000,
        currency: "GBP", status: "confirmed_available", availableDate: "2026-01-01",
        expectedDate: null, notes: "", evidenceIds: [],
      }],
      obligations: [], planningCurrency: "GBP", asOfDate: null,
      fx: { rates: {}, asOf: "2026-10-15", source: "test fixture" }, evidence: [], quotes: [],
    };
    updateTask(SID, { workingPlan: gbpInput });
    const res = applyBudgetToTask(SID, limerickPlan(), {
      startDate: "2027-09-01", studyMonths: 12,
      oneTimeDueDates: { "0": "2027-08-01" },
      fxRateToPlanning: 0.85, fxRateDate: "2026-10-15", fxRateSource: "test bank quote",
    }, limerickInputs());
    expect(res.currency).toBe("GBP");
    expect(res.fxConversion).toEqual({ from: "EUR", to: "GBP", rate: 0.85, asOf: "2026-10-15", source: "test bank quote" });
    expect(res.obligations.every((o) => o.currency === "GBP")).toBe(true);
    expect(res.obligations.find((o) => o.kind === "visa")?.dueDate).toBe("2027-08-01");
    expect(res.obligations.every((o) => o.notes.includes("test bank quote"))).toBe(true);
    expect(res.monthlyEstimateMinor).toBeGreaterThan(0);
    expect(res.gapAfter.minBalanceMinor).toBeLessThan(res.gapBefore.minBalanceMinor);
  });

  it("rejects impossible FX and one-time dates", () => {
    expect(() => applyBudgetToTask(SID, limerickPlan(), {
      startDate: "2027-09-01", studyMonths: 12,
      fxRateToPlanning: 0.85, fxRateDate: "2026-02-30", fxRateSource: "test source",
    }, limerickInputs())).toThrow(/real calendar date/i);
    expect(() => applyBudgetToTask(SID, limerickPlan(), {
      startDate: "2027-09-01", studyMonths: 12,
      oneTimeDueDates: { "0": "2026-02-30" },
    }, limerickInputs())).toThrow(/real calendar date/i);
  });

  it("refuses a second apply without an explicit revert", () => {
    applyBudgetToTask(SID, limerickPlan(), { startDate: "2027-09-01", studyMonths: 12 }, limerickInputs());
    expect(() =>
      applyBudgetToTask(SID, limerickPlan(), { startDate: "2027-09-01", studyMonths: 12 }, limerickInputs())
    ).toThrow(/already applied/);
  });

  it("refuses insufficient_data plans and unknown sessions with clear errors", () => {
    const canada = buildLivingCostPlan({
      destinationId: "ca-canada",
      monthlyBudgetMinor: 200000,
      budgetCurrency: "CAD",
      insuranceCovered: true,
    });
    expect(canada.verdict).toBe("insufficient_data");
    expect(() =>
      applyBudgetToTask(SID, canada, { startDate: "2027-09-01", studyMonths: 12 }, canadaInputs())
    ).toThrow(/insufficient_data/);
    expect(() =>
      applyBudgetToTask("no-such-session", limerickPlan(), {
        startDate: "2027-09-01",
        studyMonths: 12,
      }, limerickInputs())
    ).toThrow(/unknown session/);
    expect(() =>
      applyBudgetToTask(SID, limerickPlan(), { startDate: "not-a-date", studyMonths: 12 }, limerickInputs())
    ).toThrow();
  });
});

describe("revertBudgetFromTask", () => {
  beforeEach(seed);

  it("removes exactly the applied obligations and restores the forecast", () => {
    const applied = applyBudgetToTask(SID, limerickPlan(), {
      startDate: "2027-09-01",
      studyMonths: 12,
    }, limerickInputs());
    const reverted = revertBudgetFromTask(SID);
    expect(reverted.removedCount).toBe(applied.obligationCount);
    expect(reverted.removedIds).toHaveLength(applied.obligationCount);
    expect(reverted.removedIds.every((id) => id.startsWith("lcp-"))).toBe(true);
    const state = getTask(SID)!;
    expect(state.workingPlan!.obligations).toHaveLength(0);
    expect(state.appliedBudget).toBeNull();
    expect(reverted.gapAfter.hasGap).toBe(false);
    expect(reverted.summary).toMatch(/Reverting this plan removes/);
  });

  it("never touches committed or paid records", () => {
    applyBudgetToTask(SID, limerickPlan(), { startDate: "2027-09-01", studyMonths: 12 }, limerickInputs());
    const state = getTask(SID)!;
    const first = state.workingPlan!.obligations[0];
    updateTask(SID, {
      workingPlan: {
        ...state.workingPlan!,
        obligations: state.workingPlan!.obligations.map((o) =>
          o.id === first.id ? { ...o, status: "committed" as const } : o
        ),
      },
    });
    const reverted = revertBudgetFromTask(SID);
    const after = getTask(SID)!;
    expect(after.workingPlan!.obligations).toHaveLength(1);
    expect(after.workingPlan!.obligations[0].id).toBe(first.id);
    expect(after.workingPlan!.obligations[0].status).toBe("committed");
    expect(reverted.removedCount).toBeGreaterThan(0);
  });

  it("fails clearly when nothing is applied or the session is unknown", () => {
    expect(() => revertBudgetFromTask(SID)).toThrow(/nothing to revert/);
    expect(() => revertBudgetFromTask("no-such-session")).toThrow(/unknown session/);
  });

  it("apply → revert → apply works again (full cycle)", () => {
    const opts = { startDate: "2027-09-01", studyMonths: 12 };
    const first = applyBudgetToTask(SID, limerickPlan(), opts, limerickInputs());
    revertBudgetFromTask(SID);
    const second = applyBudgetToTask(SID, limerickPlan(), opts, limerickInputs());
    expect(second.obligationCount).toBe(first.obligationCount);
    expect(getTask(SID)!.workingPlan!.obligations).toHaveLength(second.obligationCount);
  });
});

describe("verifyPlanIntegrity", () => {
  it("accepts a genuine engine plan together with the inputs that built it", () => {
    expect(() => verifyPlanIntegrity(limerickPlan(), limerickInputs())).not.toThrow();
  });

  it("rejects missing or invalid planInputs", () => {
    expect(() => verifyPlanIntegrity(limerickPlan(), undefined)).toThrow(
      /planInputs is required/
    );
    expect(() => verifyPlanIntegrity(limerickPlan(), { destinationId: 42 })).toThrow(
      /planInputs is required/
    );
  });

  it("rejects a fabricated destinationId against the server-side dataset", () => {
    const fakeInputs = { ...limerickInputs(), destinationId: "xx-fabricated" };
    const fakePlan = {
      ...JSON.parse(JSON.stringify(limerickPlan())),
      destinationId: "xx-fabricated",
    };
    expect(() =>
      verifyPlanIntegrity(fakePlan as LivingCostPlan, fakeInputs)
    ).toThrow(/Unknown destinationId/);
  });

  it("rejects a plan whose destination does not match the supplied inputs", () => {
    const mismatched = JSON.parse(JSON.stringify(limerickPlan())) as Record<
      string,
      unknown
    >;
    mismatched["destinationId"] = "de-germany";
    expect(() =>
      verifyPlanIntegrity(mismatched as unknown as LivingCostPlan, limerickInputs())
    ).toThrow(/does not match/);
  });

  it("rejects tampered category amounts", () => {
    const tampered = JSON.parse(JSON.stringify(limerickPlan())) as Record<
      string,
      unknown
    >;
    const categories = tampered["categories"] as Array<Record<string, unknown>>;
    categories[0]["estimateMinor"] =
      (categories[0]["estimateMinor"] as number) + 1;
    expect(() =>
      verifyPlanIntegrity(tampered as unknown as LivingCostPlan, limerickInputs())
    ).toThrow(/integrity check failed/);
  });

  it("rejects a duplicate category that would omit another category", () => {
    const tampered = JSON.parse(JSON.stringify(limerickPlan())) as Record<string, unknown>;
    const categories = tampered["categories"] as Array<Record<string, unknown>>;
    expect(categories.length).toBeGreaterThan(2);
    // Keep the array length and monetary totals unchanged, but duplicate the
    // first category in place of the second. A lookup-only integrity check
    // would previously accept this shape and the forecast could double count it.
    categories[1] = { ...categories[0] };
    expect(() =>
      verifyPlanIntegrity(tampered as unknown as LivingCostPlan, limerickInputs())
    ).toThrow(/integrity check failed/);
  });

  it("rejects client-tampered source attribution", () => {
    const tampered = JSON.parse(JSON.stringify(limerickPlan())) as Record<string, unknown>;
    const categories = tampered["categories"] as Array<Record<string, unknown>>;
    categories[0]["sourceTitle"] = "Fake official source";
    categories[0]["sourceUrl"] = "https://attacker.example/fake-source";
    expect(() =>
      verifyPlanIntegrity(tampered as unknown as LivingCostPlan, limerickInputs())
    ).toThrow(/integrity check failed/);
  });

  it("rejects client-tampered one-time cost labels or source attribution", () => {
    const tampered = JSON.parse(JSON.stringify(limerickPlan())) as Record<string, unknown>;
    const oneTime = tampered["oneTime"] as { items: Array<Record<string, unknown>> };
    expect(oneTime.items.length).toBeGreaterThan(0);
    oneTime.items[0]["label"] = "Fake government fee";
    oneTime.items[0]["sourceTitle"] = "Fake official authority";
    expect(() =>
      verifyPlanIntegrity(tampered as unknown as LivingCostPlan, limerickInputs())
    ).toThrow(/integrity check failed/);
  });

  it("rejects tampered monthly totals", () => {
    const tampered = JSON.parse(JSON.stringify(limerickPlan())) as Record<
      string,
      unknown
    >;
    const totals = tampered["monthlyTotals"] as Record<string, unknown>;
    totals["typicalMinor"] = (totals["typicalMinor"] as number) - 100;
    expect(() =>
      verifyPlanIntegrity(tampered as unknown as LivingCostPlan, limerickInputs())
    ).toThrow(/integrity check failed/);
  });
});
