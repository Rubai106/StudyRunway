/**
 * Clarification answer payloads and follow-up message formatting.
 * Pure functions — unit tested in node, no DOM required.
 */

import type { ClarifyQuestion } from "@/lib/events";
import { CURRENCIES, isSupportedCurrency } from "@/lib/currency";

export type AnswerValues = Record<string, string>;

export interface AnswerPayload {
  sessionId: string;
  questionId: string;
  answers: Record<string, string | number | boolean>;
}

/**
 * Return valid ISO currency codes for a currency clarification. Models sometimes
 * omit `options`; the UI must still provide a usable, finite list rather than
 * rendering a select that contains only its placeholder. If a model supplies a
 * valid subset, preserve that subset. Unsupported labels are never offered as
 * values.
 */
export function currencyOptionsForQuestion(
  question: Pick<ClarifyQuestion, "options">,
): string[] {
  const requested = [...new Set(
    (question.options ?? [])
      .map((value) => value.trim().toUpperCase())
      .filter(isSupportedCurrency),
  )];
  return requested.length > 0 ? requested : CURRENCIES.map(({ code }) => code);
}

/** Supply currency choices for select fields that are clearly currency fields. */
export function optionsForSelectField(
  field: { name: string; label: string; options?: string[] },
): string[] {
  if (!/currenc/i.test(`${field.name} ${field.label}`)) {
    return field.options ?? [];
  }
  return currencyOptionsForQuestion({ options: field.options });
}

/** Human-readable option label while retaining the ISO code as the value. */
export function currencyOptionLabel(code: string): string {
  const currency = CURRENCIES.find((item) => item.code === code.toUpperCase());
  return currency ? `${currency.code} — ${currency.name}` : code;
}

/** Build the POST /api/agent/answer payload from raw form values. */
export function buildAnswerPayload(
  sessionId: string,
  question: ClarifyQuestion,
  values: AnswerValues,
): AnswerPayload {
  const answers: Record<string, string | number | boolean> = {};
  for (const [key, raw] of Object.entries(values)) {
    const value = raw.trim();
    if (question.kind === "amount" && key === "amount") {
      const n = Number(value);
      answers[key] = Number.isFinite(n) ? n : value;
    } else if (key === "currency") {
      answers[key] = value.toUpperCase();
    } else {
      answers[key] = value;
    }
  }
  return { sessionId, questionId: question.id, answers };
}

/** Format an assumption correction as a follow-up chat message. */
export function formatAssumptionCorrection(
  name: string,
  oldValue: string,
  newValue: string,
): string {
  return (
    `I want to correct an assumption. ` +
    `Assumption "${name}" was "${oldValue}". ` +
    `The correct value is "${newValue}". ` +
    `Please re-run your analysis with this correction.`
  );
}

/** Validate values for a clarification question. Returns an error map keyed by field. */
export function validateAnswer(
  question: ClarifyQuestion,
  values: AnswerValues,
): Record<string, string> {
  const errors: Record<string, string> = {};
  switch (question.kind) {
    case "quick_replies": {
      if (!(values["choice"] ?? "").trim()) {
        errors["choice"] = "Pick one of the options.";
      }
      break;
    }
    case "date": {
      const v = (values["date"] ?? "").trim();
      if (!v) {
        errors["date"] = "Choose a date.";
      } else if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) {
        errors["date"] = "Enter a valid date.";
      }
      break;
    }
    case "amount": {
      const v = (values["amount"] ?? "").trim();
      if (!v) {
        errors["amount"] = "Enter an amount.";
      } else if (!Number.isFinite(Number(v)) || Number(v) <= 0) {
        errors["amount"] = "Enter a positive number.";
      }
      if (question.options?.length) {
        const currency = (values["currency"] ?? "").trim().toUpperCase();
        const allowed = currencyOptionsForQuestion(question);
        if (!currency) {
          errors["currency"] = "Choose a currency.";
        } else if (!allowed.includes(currency)) {
          errors["currency"] = "Choose a supported currency from the list.";
        }
      }
      break;
    }
    case "currency": {
      const currency = (values["currency"] ?? "").trim().toUpperCase();
      const allowed = currencyOptionsForQuestion(question);
      if (!currency) {
        errors["currency"] = "Choose a currency.";
      } else if (!allowed.includes(currency)) {
        errors["currency"] = "Choose a supported currency from the list.";
      }
      break;
    }
    case "form": {
      for (const field of question.fields ?? []) {
        const v = (values[field.name] ?? "").trim();
        if (field.required) {
          if (!v) {
            errors[field.name] = `${field.label} is required.`;
          } else if (
            /currenc/i.test(`${field.name} ${field.label}`) &&
            !isSupportedCurrency(v.toUpperCase())
          ) {
            errors[field.name] = "Enter a supported 3-letter currency code, such as USD or EUR.";
          } else if (field.type === "number" && !Number.isFinite(Number(v))) {
            errors[field.name] = `${field.label} must be a number.`;
          } else if (
            field.type === "date" &&
            (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v)))
          ) {
            errors[field.name] = `${field.label} must be a valid date.`;
          }
        } else if (v && field.type === "number" && !Number.isFinite(Number(v))) {
          errors[field.name] = `${field.label} must be a number.`;
        }
      }
      break;
    }
  }
  return errors;
}

/** Extract the submitted values for a question from a submitted form element. */
export function valuesForKind(
  question: ClarifyQuestion,
  formData: FormData,
): AnswerValues {
  const values: AnswerValues = {};
  const names =
    question.kind === "form"
      ? (question.fields ?? []).map((f) => f.name)
      : question.kind === "date"
        ? ["date"]
        : question.kind === "amount"
          ? ["amount", "currency"]
          : question.kind === "currency"
            ? ["currency"]
            : ["choice"];
  for (const name of names) {
    const v = formData.get(name);
    values[name] = typeof v === "string" ? v : "";
  }
  return values;
}
