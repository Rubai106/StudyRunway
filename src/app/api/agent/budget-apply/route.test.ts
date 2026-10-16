/**
 * Budget apply/revert route tests (Part H): validation, the exact
 * planToObligations conversion path, and clear errors.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { POST as applyPOST } from "@/app/api/agent/budget-apply/route";
import { POST as revertPOST } from "@/app/api/agent/budget-revert/route";
import { createTask, clearStore, getTask } from "@/lib/agent/state";
import { buildLivingCostPlan } from "@/lib/livingCosts";

function post(route: (req: Request) => Promise<Response>, body: unknown, extraHeaders: Record<string, string> = {}): Promise<Response> {
  return route(
    new Request("http://localhost/api/agent/budget", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...extraHeaders },
      body: JSON.stringify(body),
    })
  );
}

function limerickPlan() {
  return buildLivingCostPlan({
    destinationId: "ie-limerick",
    monthlyBudgetMinor: 90000,
    budgetCurrency: "EUR",
    accommodationType: "shared",
    cookingHabit: "cook_at_home",
    insuranceCovered: false,
  });
}

/** The exact inputs that produced limerickPlan() — required by the route's
 * plan-integrity check (server recomputes the deterministic engine). */
function limerickInputs() {
  return {
    destinationId: "ie-limerick",
    monthlyBudgetMinor: 90000,
    budgetCurrency: "EUR",
    accommodationType: "shared",
    cookingHabit: "cook_at_home",
    insuranceCovered: false,
  };
}

function canadaInputs() {
  return {
    destinationId: "ca-canada",
    monthlyBudgetMinor: 200000,
    budgetCurrency: "CAD",
    insuranceCovered: true,
  };
}

function applyBody(extra: Record<string, unknown> = {}) {
  return {
    sessionId: "route-session",
    plan: limerickPlan(),
    planInputs: limerickInputs(),
    startDate: "2027-09-01",
    studyMonths: 12,
    ...extra,
  };
}

describe("POST /api/agent/budget-apply", () => {
  beforeEach(() => {
    clearStore();
    createTask("route-session");
  });

  it("rejects cross-origin budget writes before mutating session state", async () => {
    const res = await post(applyPOST, applyBody(), { origin: "https://attacker.example" });
    expect(res.status).toBe(403);
    expect(getTask("route-session")!.workingPlan).toBeNull();
    expect(getTask("route-session")!.appliedBudget).toBeNull();
  });

  it("rejects invalid sessionIds with 400", async () => {
    const res = await post(applyPOST, { sessionId: "bad id", plan: {} });
    expect(res.status).toBe(400);
  });

  it("rejects unknown sessions with a clear error", async () => {
    const res = await post(applyPOST, applyBody({ sessionId: "ghost-session" }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/unknown session/);
  });

  it("applies through the exact conversion path and records the task state", async () => {
    const res = await post(applyPOST, applyBody({
      fxRateToPlanning: 0.85,
      fxRateDate: "2026-10-15",
      fxRateSource: "test quote",
      oneTimeDueDates: { "0": "2027-08-01" },
    }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["ok"]).toBe(true);
    expect(body["obligationCount"]).toBeGreaterThan(0);
    expect(body["tuitionNote"]).toMatch(/TUITION EXCLUDED/);
    expect(body["gapAfter"]).toBeDefined();
    const state = getTask("route-session")!;
    expect(state.appliedBudget?.destinationId).toBe("ie-limerick");
    const lcp = state.workingPlan!.obligations.filter((o) => o.id.startsWith("lcp-"));
    expect(lcp).toHaveLength(body["obligationCount"] as number);
    expect(lcp.every((o) => o.status === "planned")).toBe(true);
  });

  it("refuses cross-currency application without an explicit rate and leaves state unchanged", async () => {
    const res = await post(applyPOST, applyBody());
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/explicit exchange rate/i);
    expect(getTask("route-session")!.appliedBudget).toBeNull();
    expect(getTask("route-session")!.workingPlan).toBeNull();
  });

  it("rejects a fabricated destinationId that is not in the server dataset", async () => {
    const fakePlan = {
      ...JSON.parse(JSON.stringify(limerickPlan())),
      destinationId: "xx-fabricated",
    };
    const res = await post(applyPOST, applyBody({
      plan: fakePlan,
      planInputs: { ...limerickInputs(), destinationId: "xx-fabricated" },
    }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/Unknown destinationId/);
    expect(getTask("route-session")!.appliedBudget).toBeNull();
  });

  it("rejects a client-tampered plan whose amounts no longer match the engine", async () => {
    const tampered = JSON.parse(JSON.stringify(limerickPlan())) as Record<string, unknown>;
    const categories = tampered["categories"] as Array<Record<string, unknown>>;
    categories[0]["estimateMinor"] = (categories[0]["estimateMinor"] as number) + 1;
    const res = await post(applyPOST, applyBody({ plan: tampered }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/integrity check failed/);
    expect(getTask("route-session")!.appliedBudget).toBeNull();
    expect(getTask("route-session")!.workingPlan).toBeNull();
  });

  it("rejects a request with no planInputs", async () => {
    const res = await post(applyPOST, {
      sessionId: "route-session",
      plan: limerickPlan(),
      startDate: "2027-09-01",
      studyMonths: 12,
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/planInputs is required/);
  });

  it("refuses a second apply and an insufficient_data plan", async () => {
    const args = applyBody({
      fxRateToPlanning: 0.85,
      fxRateDate: "2026-10-15",
      fxRateSource: "test quote",
      oneTimeDueDates: { "0": "2027-08-01" },
    });
    expect((await post(applyPOST, args)).status).toBe(200);
    const again = await post(applyPOST, args);
    expect(again.status).toBe(400);
    expect(((await again.json()) as { error: string }).error).toMatch(/already applied/);

    const canada = buildLivingCostPlan({
      destinationId: "ca-canada",
      monthlyBudgetMinor: 200000,
      budgetCurrency: "CAD",
      insuranceCovered: true,
    });
    const bad = await post(applyPOST, { ...args, plan: canada, planInputs: canadaInputs() });
    expect(bad.status).toBe(400);
  });
});

describe("POST /api/agent/budget-revert", () => {
  beforeEach(() => {
    clearStore();
    createTask("route-session");
  });

  it("rejects invalid sessionIds and reverts with nothing applied", async () => {
    expect((await post(revertPOST, { sessionId: "bad id" })).status).toBe(400);
    const res = await post(revertPOST, { sessionId: "route-session" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/nothing to revert/);
  });

  it("reverts an applied budget and clears the task record", async () => {
    await post(applyPOST, applyBody({
      fxRateToPlanning: 0.85,
      fxRateDate: "2026-10-15",
      fxRateSource: "test quote",
      oneTimeDueDates: { "0": "2027-08-01" },
    }));
    const res = await post(revertPOST, { sessionId: "route-session" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["ok"]).toBe(true);
    expect(body["removedCount"]).toBeGreaterThan(0);
    expect(getTask("route-session")!.appliedBudget).toBeNull();
    // Only the lcp- budget obligations are removed; the seeded sample-plan
    // obligations stay.
    const remaining = getTask("route-session")!.workingPlan!.obligations;
    expect(remaining.some((o) => o.id.startsWith("lcp-"))).toBe(false);
  });
});
