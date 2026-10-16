import { describe, expect, it } from "vitest";
import type { ClarifyQuestion } from "@/lib/events";
import {
  buildAnswerPayload,
  formatAssumptionCorrection,
  validateAnswer,
  currencyOptionsForQuestion,
  currencyOptionLabel,
} from "./answers";

const quickReplies: ClarifyQuestion = {
  id: "q1",
  kind: "quick_replies",
  prompt: "Which one?",
  options: ["Approve", "Deny"],
};

const dateQ: ClarifyQuestion = {
  id: "q2",
  kind: "date",
  prompt: "When is tuition due?",
};

const amountQ: ClarifyQuestion = {
  id: "q3",
  kind: "amount",
  prompt: "How much?",
  options: ["EUR", "GBP", "USD"],
};

const currencyQ: ClarifyQuestion = {
  id: "q4",
  kind: "currency",
  prompt: "Which currency?",
  options: ["EUR", "GBP"],
};

const formQ: ClarifyQuestion = {
  id: "q5",
  kind: "form",
  prompt: "Tell me more",
  fields: [
    { name: "university", label: "University", type: "text", required: true },
    { name: "tuition", label: "Tuition", type: "number", required: true },
    { name: "deadline", label: "Deadline", type: "date", required: false },
    {
      name: "term",
      label: "Term",
      type: "select",
      options: ["Fall", "Spring"],
      required: false,
    },
  ],
};

describe("currency clarification fallbacks", () => {
  it("provides supported currency options when the model omits them", () => {
    const options = currencyOptionsForQuestion({ options: [] });
    expect(options).toContain("BDT");
    expect(options).toContain("EUR");
    expect(options).toContain("GBP");
    expect(options.length).toBeGreaterThan(10);
  });

  it("keeps a valid model-supplied subset and labels it clearly", () => {
    expect(currencyOptionsForQuestion({ options: ["gbp", "USD", "not-a-currency"] })).toEqual(["GBP", "USD"]);
    expect(currencyOptionLabel("BDT")).toBe("BDT — Bangladeshi Taka");
  });

  it("rejects unsupported currency codes", () => {
    expect(validateAnswer({ ...currencyQ, options: [] }, { currency: "XYZ" })).toMatchObject({
      currency: "Choose a supported currency from the list.",
    });
  });
});

describe("validateAnswer", () => {
  it("requires a choice for quick replies", () => {
    expect(validateAnswer(quickReplies, {})).toEqual({
      choice: "Pick one of the options.",
    });
    expect(validateAnswer(quickReplies, { choice: "Approve" })).toEqual({});
  });

  it("validates dates strictly", () => {
    expect(validateAnswer(dateQ, {})).toEqual({ date: "Choose a date." });
    expect(validateAnswer(dateQ, { date: "not-a-date" })).toEqual({
      date: "Enter a valid date.",
    });
    expect(validateAnswer(dateQ, { date: "2026-11-04" })).toEqual({});
  });

  it("rejects non-positive amounts and requires currency", () => {
    expect(validateAnswer(amountQ, { amount: "", currency: "" })).toEqual({
      amount: "Enter an amount.",
      currency: "Choose a currency.",
    });
    expect(
      validateAnswer(amountQ, { amount: "-5", currency: "EUR" }),
    ).toEqual({ amount: "Enter a positive number." });
    expect(
      validateAnswer(amountQ, { amount: "3000", currency: "EUR" }),
    ).toEqual({});
  });

  it("requires a currency choice", () => {
    expect(validateAnswer(currencyQ, { currency: "" })).toEqual({
      currency: "Choose a currency.",
    });
    expect(validateAnswer(currencyQ, { currency: "GBP" })).toEqual({});
  });

  it("validates form fields by type and required flag", () => {
    const errors = validateAnswer(formQ, {
      university: "",
      tuition: "abc",
      deadline: "2026-13-40",
      term: "",
    });
    expect(errors["university"]).toBe("University is required.");
    expect(errors["tuition"]).toBe("Tuition must be a number.");
    // Optional date with a bad value is tolerated (only required fields are strict).
    expect(errors["deadline"]).toBeUndefined();
    expect(
      validateAnswer(formQ, {
        university: "BRAC",
        tuition: "12000",
        deadline: "",
        term: "Fall",
      }),
    ).toEqual({});
  });
});

describe("buildAnswerPayload", () => {
  it("builds the /api/agent/answer payload shape", () => {
    const payload = buildAnswerPayload("sess-1", quickReplies, {
      choice: "Approve",
    });
    expect(payload).toEqual({
      sessionId: "sess-1",
      questionId: "q1",
      answers: { choice: "Approve" },
    });
  });

  it("coerces numeric amounts", () => {
    const payload = buildAnswerPayload("sess-1", amountQ, {
      amount: "3000",
      currency: "EUR",
    });
    expect(payload.answers).toEqual({ amount: 3000, currency: "EUR" });
  });

  it("trims whitespace from values", () => {
    const payload = buildAnswerPayload("sess-1", formQ, {
      university: "  BRAC  ",
      tuition: "12000",
      deadline: "",
      term: "",
    });
    expect(payload.answers["university"]).toBe("BRAC");
  });
});

describe("formatAssumptionCorrection", () => {
  it("formats a follow-up correction message", () => {
    const msg = formatAssumptionCorrection(
      "Tuition deadline",
      "2026-11-04",
      "2026-12-01",
    );
    expect(msg).toContain('Assumption "Tuition deadline" was "2026-11-04"');
    expect(msg).toContain('The correct value is "2026-12-01"');
    expect(msg).toContain("re-run your analysis");
  });
});
