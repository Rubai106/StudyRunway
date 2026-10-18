import { describe, expect, it } from "vitest";
import { POST } from "./route";
import { clearStore, getTask, updateTask } from "@/lib/agent/state";

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/agent/funding-check", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}

const valid = {
  sessionId: "funding-route-test",
  planningCurrency: "EUR",
  asOfDate: "2026-10-18",
  expenses: [{ id: "e1", label: "Tuition", category: "tuition", amount: 1200, currency: "EUR", dueDate: "2027-01-10", frequency: "one_time", occurrences: null, notes: "" }],
  fundingSources: [
    { id: "s1", label: "Savings", kind: "savings", amount: 500, currency: "EUR", status: "confirmed_available", availableDate: null, expectedDate: null, notes: "" },
    { id: "s2", label: "Expected scholarship", kind: "scholarship", amount: 800, currency: "EUR", status: "estimated", availableDate: null, expectedDate: "2026-12-01", notes: "" },
  ],
};

describe("POST /api/agent/funding-check", () => {
  it("persists the validated canonical plan for the same agent session", async () => {
    clearStore();
    updateTask(valid.sessionId, {
      appliedBudget: {
        destinationId: "uk-london",
        destinationLabel: "London",
        appliedAt: "2026-10-18T00:00:00.000Z",
        obligationIds: ["lcp-1"],
        startDate: "2027-01-01",
        studyMonths: 12,
      },
      pendingApproval: { id: "stale", tool: "draft_email", label: "old", argsSummary: "old", args: {} },
      approvedCalls: [{ id: "approved", tool: "draft_email", args: {} }],
    });
    const response = await POST(request(valid));
    expect(response.status).toBe(200);
    const task = getTask(valid.sessionId);
    expect(task?.workingPlan?.planningCurrency).toBe("EUR");
    expect(task?.workingPlan?.obligations[0]).toMatchObject({ label: "Tuition", amountMinor: 120000, dueDate: "2027-01-10", recurring: null });
    expect(task?.appliedBudget).toBeNull();
    expect(task?.pendingApproval).toBeNull();
    expect(task?.approvedCalls).toEqual([]);
  });

  it("runs the real deterministic forecast and preserves the funding split", async () => {
    const response = await POST(request(valid));
    expect(response.status).toBe(200);
    const body = await response.json() as { ok: boolean; data: Record<string, unknown> };
    expect(body.ok).toBe(true);
    expect(body.data["planningCurrency"]).toBe("EUR");
    expect(body.data["fundingSplit"]).toMatchObject({ inHandMinor: 50000, uncertainInflowMinor: 80000 });
  });

  it("expands a monthly structured expense into the complete dated schedule", async () => {
    const response = await POST(request({
      ...valid,
      expenses: [{ ...valid.expenses[0], amount: 700, dueDate: "2027-01-01", frequency: "monthly", occurrences: 6 }],
    }));
    expect(response.status).toBe(200);
    const body = await response.json() as { data: { fundingSplit: { totalOutflowMinor: number }; cashFlow: { bills: Array<{ recurring: unknown; dueDate: string | null }> } } };
    expect(body.data.fundingSplit.totalOutflowMinor).toBe(420000);
    expect(body.data.cashFlow.bills[0]).toMatchObject({ dueDate: "2027-01-01", recurring: { everyMonths: 1, occurrences: 6 } });
  });

  it("rejects invalid form data without running a calculation", async () => {
    const response = await POST(request({ ...valid, planningCurrency: "ZZZ" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/Unsupported currency/);
  });

  it("rejects hostile browser origins", async () => {
    const response = await POST(request(valid, { origin: "https://attacker.example" }));
    expect(response.status).toBe(403);
  });
});
