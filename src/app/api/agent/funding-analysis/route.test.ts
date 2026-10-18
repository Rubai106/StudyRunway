import { describe, expect, it, vi } from "vitest";

const { generateFundingAnalysis } = vi.hoisted(() => ({ generateFundingAnalysis: vi.fn() }));
vi.mock("@/lib/fundingAnalysis", () => ({
  generateFundingAnalysis,
  formatFundingAnalysis: (value: { overall: string }) => value.overall,
}));

import { POST } from "./route";

const valid = {
  planningCurrency: "EUR",
  asOfDate: "2026-10-18",
  expenses: [{ id: "e1", label: "Tuition", category: "tuition", amount: 1200, currency: "EUR", dueDate: "2027-01-10", frequency: "one_time", occurrences: null, notes: "" }],
  fundingSources: [{ id: "s1", label: "Savings", kind: "savings", amount: 500, currency: "EUR", status: "confirmed_available", availableDate: null, expectedDate: null, notes: "" }],
};

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/agent/funding-analysis", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}

describe("POST /api/agent/funding-analysis", () => {
  it("returns the validated server-side analysis", async () => {
    generateFundingAnalysis.mockResolvedValueOnce({ analysis: { overall: "Grounded" }, provider: "gemini", model: "gemini-test" });
    const response = await POST(request(valid));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, analysis: "Grounded", provider: "gemini" });
    expect(generateFundingAnalysis).toHaveBeenCalledWith(expect.objectContaining({ planningCurrency: "EUR" }));
  });

  it("preserves deterministic flow when the provider is unavailable", async () => {
    generateFundingAnalysis.mockRejectedValueOnce(new Error("Google Gemini is not configured for funding analysis."));
    const response = await POST(request(valid));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, retryable: true });
  });

  it("rejects malformed form data and hostile origins", async () => {
    expect((await POST(request({ ...valid, planningCurrency: "ZZZ" }))).status).toBe(400);
    expect((await POST(request(valid, { origin: "https://attacker.example" }))).status).toBe(403);
  });
});
