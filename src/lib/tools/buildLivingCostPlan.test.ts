/**
 * Unit tests for the build_living_cost_plan tool.
 *
 * Every assertion is against the REAL deterministic engine output —
 * nothing mocked. Known anchors (verified against docs/COST_DATASET.json):
 * - "ie-limerick" exists, EUR, city scope;
 * - "ca-canada" has only a regulatory minimum → insufficient_data;
 * - cross-currency without an explicit FX assumption → insufficient_data.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { buildLivingCostPlanTool } from "./buildLivingCostPlan";
import { TOOLS } from "./index";
import { executeToolCall, ArgsValidationError } from "../agent/orchestrator";
import { findTool, loadRegistry, getModelTools, resetRegistryCache } from "../agent/registry";
import {
  buildLivingCostPlan,
  type LivingCostPlan,
} from "../livingCosts";
import type { ToolContext } from "./types";

const CTX: ToolContext = { sessionId: "test-session", taskId: "test-task" };

const SAMPLE_ARGS = {
  destinationId: "ie-limerick",
  monthlyBudgetMinor: 90000,
  budgetCurrency: "EUR",
  accommodationType: "shared",
  cookingHabit: "cook_at_home",
  insuranceCovered: false,
};

describe("build_living_cost_plan tool", () => {
  it("builds a real plan — figures match the engine exactly (no hard-coding)", async () => {
    const exec = await executeToolCall(buildLivingCostPlanTool, SAMPLE_ARGS, CTX, 5000);
    expect(exec.result.ok).toBe(true);
    const data = exec.result.data as { plan: LivingCostPlan };
    // The single source of truth: the engine itself.
    const expected = buildLivingCostPlan(SAMPLE_ARGS);
    expect(data.plan.monthlyTotals.typicalMinor).toBe(expected.monthlyTotals.typicalMinor);
    expect(data.plan.monthlyTotals.lowMinor).toBe(expected.monthlyTotals.lowMinor);
    expect(data.plan.monthlyTotals.highMinor).toBe(expected.monthlyTotals.highMinor);
    expect(data.plan.verdict).toBe(expected.verdict);
    expect(data.plan.budgetMinor).toBe(expected.budgetMinor);
    expect(data.plan.categories).toHaveLength(expected.categories.length);
    // Concise human summary carries the verdict framing.
    expect(exec.result.summary.length).toBeGreaterThan(20);
    // Sources are attributed as evidence.
    expect(exec.result.evidence!.length).toBeGreaterThan(0);
  });

  it("echoes validated inputs and accommodation options for client re-runs", async () => {
    const exec = await executeToolCall(buildLivingCostPlanTool, SAMPLE_ARGS, CTX, 5000);
    const data = exec.result.data as Record<string, unknown>;
    expect(data["inputs"]).toMatchObject({
      destinationId: "ie-limerick",
      monthlyBudgetMinor: 90000,
      budgetCurrency: "EUR",
    });
    const options = data["accommodationOptions"] as string[];
    expect(options.length).toBeGreaterThan(0);
    expect(options.some((o) => /shared/i.test(o))).toBe(true);
    expect(data["recommendations"]).toBeDefined();
  });

  it("fails with a clear message on malformed args", async () => {
    await expect(
      executeToolCall(
        buildLivingCostPlanTool,
        { destinationId: "ie-limerick" }, // missing required fields
        CTX,
        5000
      )
    ).rejects.toThrow(ArgsValidationError);
    await expect(
      executeToolCall(buildLivingCostPlanTool, { ...SAMPLE_ARGS, monthlyBudgetMinor: -5 }, CTX, 5000)
    ).rejects.toThrow(/monthlyBudgetMinor/);
  });

  it("fails with a clear message on an unknown destinationId", async () => {
    const exec = await executeToolCall(
      buildLivingCostPlanTool,
      { ...SAMPLE_ARGS, destinationId: "xx-nowhere" },
      CTX,
      5000
    );
    expect(exec.result.ok).toBe(false);
    expect(exec.result.summary).toMatch(/Unknown destinationId/);
  });

  it("Canada: insufficient_data — missing data listed, visa minimum never a budget line", async () => {
    const exec = await executeToolCall(
      buildLivingCostPlanTool,
      {
        destinationId: "ca-canada",
        monthlyBudgetMinor: 200000,
        budgetCurrency: "CAD",
        insuranceCovered: true,
      },
      CTX,
      5000
    );
    expect(exec.result.ok).toBe(true);
    const data = exec.result.data as { plan: LivingCostPlan };
    expect(data.plan.verdict).toBe("insufficient_data");
    expect(data.plan.missingData.length).toBeGreaterThan(0);
    // The regulatory visa minimum is separate, never folded into totals.
    expect(data.plan.visaRequirementSeparate).not.toBeNull();
    expect(
      data.plan.categories.some((c) => c.valueKind === "regulatory")
    ).toBe(false);
    expect(exec.result.summary).toMatch(/regulatory minimum, not a budget/);
  });

  it("cross-currency without an explicit FX assumption → insufficient_data", async () => {
    const exec = await executeToolCall(
      buildLivingCostPlanTool,
      { ...SAMPLE_ARGS, budgetCurrency: "GBP" }, // no explicit FX rate
      CTX,
      5000
    );
    expect(exec.result.ok).toBe(true);
    const data = exec.result.data as { plan: LivingCostPlan };
    expect(data.plan.verdict).toBe("insufficient_data");
    expect(exec.result.summary).toMatch(/not enough sourced cost data/i);
  });

  it("is read-only: requiresApproval is false", () => {
    expect(buildLivingCostPlanTool.requiresApproval).toBe(false);
  });
});

describe("build_living_cost_plan registration", () => {
  beforeEach(() => {
    resetRegistryCache();
  });

  it("is in TOOLS and the named exports", () => {
    expect(TOOLS.map((t) => t.name)).toContain("build_living_cost_plan");
  });

  it("loads via the real registry and is visible to the model", async () => {
    const all = await loadRegistry();
    const tool = findTool(all, "build_living_cost_plan");
    expect(tool).toBeDefined();
    expect(tool!.name).not.toMatch(/^__/);
    expect(getModelTools(all).map((t) => t.name)).toContain("build_living_cost_plan");
  });
});
