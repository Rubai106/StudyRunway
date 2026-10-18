import { describe, expect, it } from "vitest";
import type { Provider } from "./providers/types";
import { generateFundingAnalysis } from "./fundingAnalysis";
import type { FundingFormRequest } from "./fundingForm";

const form: FundingFormRequest = {
  planningCurrency: "EUR",
  asOfDate: "2026-10-18",
  expenses: [{ id: "e1", label: "Tuition", category: "tuition", amount: 1200, currency: "EUR", dueDate: "2027-01-10", frequency: "one_time", occurrences: null, notes: "" }],
  fundingSources: [{ id: "s1", label: "Savings", kind: "savings", amount: 500, currency: "EUR", status: "confirmed_available", availableDate: null, expectedDate: null, notes: "" }],
};

const output = JSON.stringify({
  overall: "Available savings do not cover the known tuition cost.",
  fundingGap: "The authoritative calculation shows a EUR 700 shortfall.",
  deadlines: "Tuition is due on 2027-01-10.",
  certainty: "Savings are available now; no future funding was supplied.",
  risks: ["The shortfall remains unresolved."],
  nextSteps: ["Confirm an additional funding source before the deadline."],
  followUpQuestions: ["Will any scholarship or family contribution arrive before 2027-01-10?"],
});

function provider(text: string): Provider {
  return { name: "gemini", chat: async (messages) => {
    expect(messages[0].content).toContain("deterministic calculation");
    expect(messages[1].content).toContain('"inHandMinor":50000');
    return { text, toolCalls: [], stopReason: "stop" };
  } };
}

describe("hosted funding analysis", () => {
  it("recomputes authoritative results and returns a validated Gemini explanation", async () => {
    const result = await generateFundingAnalysis(form, { provider: provider(output), name: "gemini", model: "gemini-test" });
    expect(result.provider).toBe("gemini");
    expect(result.analysis.fundingGap).toContain("EUR 700");
  });

  it("rejects empty or malformed model output", async () => {
    await expect(generateFundingAnalysis(form, { provider: provider(""), name: "gemini", model: "gemini-test" })).rejects.toThrow(/incomplete/);
    await expect(generateFundingAnalysis(form, { provider: provider("not json"), name: "gemini", model: "gemini-test" })).rejects.toThrow(/invalid analysis JSON/);
  });

  it("does not expose client-supplied fabricated totals to the model", async () => {
    let prompt = "";
    const capture: Provider = { name: "gemini", chat: async (messages) => { prompt = messages[1].content; return { text: output, toolCalls: [], stopReason: "stop" }; } };
    await generateFundingAnalysis(form, { provider: capture, name: "gemini", model: "gemini-test" });
    expect(prompt).not.toContain("999999");
    expect(prompt).toContain('"inHandMinor":50000');
  });
});
