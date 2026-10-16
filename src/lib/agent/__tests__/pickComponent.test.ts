/**
 * pickComponent routing tests — the budget tool must land on the interactive
 * living_cost_plan component and never fall through to the generic
 * action plan.
 */
import { describe, expect, it } from "vitest";
import { pickComponent } from "../orchestrator";

describe("pickComponent", () => {
  it("maps build_living_cost_plan to living_cost_plan", () => {
    expect(pickComponent(["build_living_cost_plan"])).toBe("living_cost_plan");
  });

  it("maps budget-ish tool names to living_cost_plan", () => {
    expect(pickComponent(["living_cost_planner"])).toBe("living_cost_plan");
    expect(pickComponent(["budget_tool"])).toBe("living_cost_plan");
  });

  it("keeps the existing mappings intact", () => {
    expect(pickComponent(["analyze_funding_gap"])).toBe("financial_outcome");
    expect(pickComponent(["forecast_runway"])).toBe("financial_outcome");
    expect(pickComponent(["compare_transfers"])).toBe("transfer_comparison");
    expect(pickComponent(["simulate_scenario"])).toBe("scenario_comparison");
    expect(pickComponent(["build_action_plan"])).toBe("action_plan");
    expect(pickComponent(["extract_document"])).toBe("document_review");
    expect(pickComponent(["draft_email"])).toBe("draft_email");
  });

  it("falls back to action_plan for unknown tools", () => {
    expect(pickComponent(["something_else"])).toBe("action_plan");
    expect(pickComponent([])).toBe("action_plan");
  });
});
