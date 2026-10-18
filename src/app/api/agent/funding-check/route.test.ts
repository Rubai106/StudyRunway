import { describe, expect, it } from "vitest";
import { POST } from "./route";

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/agent/funding-check", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}

const valid = {
  planningCurrency: "EUR",
  asOfDate: "2026-10-18",
  expenses: [{ id: "e1", label: "Tuition", category: "tuition", amount: 1200, currency: "EUR", dueDate: "2027-01-10", frequency: "one_time", occurrences: null, notes: "" }],
  fundingSources: [
    { id: "s1", label: "Savings", kind: "savings", amount: 500, currency: "EUR", status: "confirmed_available", availableDate: null, expectedDate: null, notes: "" },
    { id: "s2", label: "Expected scholarship", kind: "scholarship", amount: 800, currency: "EUR", status: "estimated", availableDate: null, expectedDate: "2026-12-01", notes: "" },
  ],
};

describe("POST /api/agent/funding-check", () => {
  it("runs the real deterministic forecast and preserves the funding split", async () => {
    const response = await POST(request(valid));
    expect(response.status).toBe(200);
    const body = await response.json() as { ok: boolean; data: Record<string, unknown> };
    expect(body.ok).toBe(true);
    expect(body.data["planningCurrency"]).toBe("EUR");
    expect(body.data["fundingSplit"]).toMatchObject({ inHandMinor: 50000, uncertainInflowMinor: 80000 });
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
