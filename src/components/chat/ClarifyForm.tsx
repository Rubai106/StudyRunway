"use client";

import { useState } from "react";
import type { ClarifyQuestion } from "@/lib/events";
import {
  buildAnswerPayload,
  validateAnswer,
  valuesForKind,
  currencyOptionsForQuestion,
  optionsForSelectField,
  currencyOptionLabel,
  type AnswerValues,
} from "./answers";

interface Props {
  question: ClarifyQuestion;
  sessionId: string;
  /** Called after a successful POST so the parent can mark the question answered. */
  onAnswered: (questionId: string) => void;
  /** Submit answers through this hook (defaults to POST /api/agent/answer). */
  submitAnswers?: (
    sessionId: string,
    questionId: string,
    answers: Record<string, string | number | boolean>,
  ) => Promise<void>;
}

async function defaultSubmit(
  sessionId: string,
  questionId: string,
  answers: Record<string, string | number | boolean>,
): Promise<void> {
  const res = await fetch("/api/agent/answer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, questionId, answers }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      (body as { error?: string } | null)?.error ??
        `Answer was not accepted (HTTP ${res.status}).`,
    );
  }
}

const inputClass =
  "w-full rounded-xl border border-[var(--sr-line)] bg-white/70 px-3 py-2 text-sm text-[var(--sr-ink)] placeholder:text-[var(--sr-ink)]/40 outline-none transition focus:border-[var(--sr-pine)] focus:ring-2 focus:ring-[var(--sr-pine)]/25";

export default function ClarifyForm({
  question,
  sessionId,
  onAnswered,
  submitAnswers = defaultSubmit,
}: Props) {
  const [values, setValues] = useState<AnswerValues>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const set = (name: string, value: string) => {
    setValues((v) => ({ ...v, [name]: value }));
    setErrors((e) => {
      if (!e[name]) return e;
      const next = { ...e };
      delete next[name];
      return next;
    });
  };

  const handleSubmit = async (formValues?: AnswerValues) => {
    const v = formValues ?? values;
    const validation = validateAnswer(question, v);
    setErrors(validation);
    if (Object.keys(validation).length > 0) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const payload = buildAnswerPayload(sessionId, question, v);
      await submitAnswers(
        payload.sessionId,
        payload.questionId,
        payload.answers,
      );
      onAnswered(question.id);
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Could not send your answer.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const quickPick = (option: string) => {
    // Chips submit immediately — a single tap answers the question.
    handleSubmit({ choice: option });
  };

  const isApprovePrompt =
    question.kind === "quick_replies" &&
    (question.options ?? []).some((o) => /approve/i.test(o)) &&
    (question.options ?? []).some((o) => /deny|reject/i.test(o));

  const renderFieldError = (name: string) =>
    errors[name] ? (
      <p role="alert" className="mt-1 text-xs text-[var(--sr-clay)]">
        {errors[name]}
      </p>
    ) : null;

  return (
    <div
      className="mt-3 rounded-2xl border border-[var(--sr-pine)]/25 bg-[var(--sr-pine)]/5 p-4"
      data-testid={`clarify-${question.kind}`}
    >
      <p className="text-sm font-medium text-[var(--sr-ink)]">
        {question.prompt}
      </p>

      {question.kind === "quick_replies" && (
        <div
          className={`mt-3 flex flex-wrap gap-2 ${isApprovePrompt ? "gap-3" : ""}`}
        >
          {(question.options ?? []).map((option) => {
            const approve = /approve/i.test(option);
            const deny = /deny|reject/i.test(option);
            const style = isApprovePrompt
              ? approve
                ? "bg-[var(--sr-pine)] text-white hover:bg-[var(--sr-pine)]/85"
                : deny
                  ? "border border-[var(--sr-clay)]/40 text-[var(--sr-clay)] hover:bg-[var(--sr-clay)]/10"
                  : ""
              : "border border-[var(--sr-line)] bg-white/80 hover:border-[var(--sr-pine)] hover:bg-[var(--sr-pine)]/10";
            return (
              <button
                key={option}
                type="button"
                onClick={() => quickPick(option)}
                disabled={submitting}
                className={`rounded-full px-4 py-2 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sr-pine)] disabled:opacity-50 ${style}`}
                aria-label={
                  isApprovePrompt
                    ? `${option} — consequential action`
                    : `Answer: ${option}`
                }
              >
                {option}
              </button>
            );
          })}
        </div>
      )}

      {question.kind === "date" && (
        <form
          noValidate
          className="mt-3"
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
        >
          <label
            htmlFor={`clarify-date-${question.id}`}
            className="sr-only"
          >
            {question.prompt}
          </label>
          <input
            id={`clarify-date-${question.id}`}
            type="date"
            value={values["date"] ?? ""}
            onChange={(e) => set("date", e.target.value)}
            className={`${inputClass} max-w-xs`}
            aria-invalid={!!errors["date"]}
            aria-describedby={
              errors["date"] ? `clarify-date-${question.id}-err` : undefined
            }
          />
          <span id={`clarify-date-${question.id}-err`}>
            {renderFieldError("date")}
          </span>
          <SubmitButton submitting={submitting} />
        </form>
      )}

      {question.kind === "amount" && (
        <form
          noValidate
          className="mt-3 flex flex-wrap items-start gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
        >
          <div className="min-w-32 flex-1">
            <label htmlFor={`clarify-amount-${question.id}`} className="sr-only">
              Amount
            </label>
            <input
              id={`clarify-amount-${question.id}`}
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={values["amount"] ?? ""}
              onChange={(e) => set("amount", e.target.value)}
              className={inputClass}
              aria-invalid={!!errors["amount"]}
            />
            {renderFieldError("amount")}
          </div>
          {question.options?.length ? (
            <div className="min-w-28 flex-1">
              <label
                htmlFor={`clarify-currency-${question.id}`}
                className="sr-only"
              >
                Currency
              </label>
              <select
                id={`clarify-currency-${question.id}`}
                value={values["currency"] ?? ""}
                onChange={(e) => set("currency", e.target.value)}
                className={inputClass}
                aria-invalid={!!errors["currency"]}
              >
                <option value="">Currency…</option>
                {currencyOptionsForQuestion(question).map((c) => (
                  <option key={c} value={c}>
                    {currencyOptionLabel(c)}
                  </option>
                ))}
              </select>
              {renderFieldError("currency")}
            </div>
          ) : null}
          <SubmitButton submitting={submitting} />
        </form>
      )}

      {question.kind === "currency" && (
        <form
          className="mt-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void handleSubmit();
          }}
        >
          <label
            htmlFor={`clarify-cur-${question.id}`}
            className="sr-only"
          >
            {question.prompt}
          </label>

          <select
            id={`clarify-cur-${question.id}`}
            value={values["currency"] ?? ""}
            onChange={(e) => set("currency", e.target.value)}
            className={`${inputClass} max-w-xs`}
            aria-invalid={!!errors["currency"]}
            aria-describedby={
              errors["currency"]
                ? `clarify-cur-${question.id}-err`
                : undefined
            }
          >
            <option value="">Choose a currency…</option>
            {currencyOptionsForQuestion(question).map((c) => (
              <option key={c} value={c}>
                {currencyOptionLabel(c)}
              </option>
            ))}
          </select>

          <span id={`clarify-cur-${question.id}-err`}>
            {renderFieldError("currency")}
          </span>

          <div>
            <SubmitButton submitting={submitting} />
          </div>
        </form>
      )}

      {question.kind === "form" && (
        <form
          noValidate
          className="mt-3 grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            handleSubmit(valuesForKind(question, formData));
          }}
        >
          {(question.fields ?? []).map((field) => (
            <div
              key={field.name}
              className={
                field.type === "text" ? "sm:col-span-2" : "sm:col-span-1"
              }
            >
              <label
                htmlFor={`clarify-${question.id}-${field.name}`}
                className="mb-1 block text-xs font-medium text-[var(--sr-ink)]/70"
              >
                {field.label}
                {field.required && (
                  <span aria-hidden="true" className="text-[var(--sr-clay)]">
                    {" "}
                    *
                  </span>
                )}
              </label>
              {field.type === "select" ? (
                <select
                  id={`clarify-${question.id}-${field.name}`}
                  name={field.name}
                  value={values[field.name] ?? ""}
                  onChange={(e) => set(field.name, e.target.value)}
                  className={inputClass}
                  aria-invalid={!!errors[field.name]}
                  required={false}
                >
                  <option value="">Choose…</option>
                  {optionsForSelectField(field).map((o) => (
                    <option key={o} value={o}>
                      {/currenc/i.test(`${field.name} ${field.label}`) ? currencyOptionLabel(o) : o}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={`clarify-${question.id}-${field.name}`}
                  name={field.name}
                  type={field.type === "number" ? "number" : field.type}
                  inputMode={field.type === "number" ? "decimal" : undefined}
                  value={values[field.name] ?? ""}
                  onChange={(e) => set(field.name, e.target.value)}
                  className={inputClass}
                  aria-invalid={!!errors[field.name]}
                />
              )}
              {renderFieldError(field.name)}
            </div>
          ))}
          <div className="sm:col-span-2">
            <SubmitButton submitting={submitting} />
          </div>
        </form>
      )}

      {submitError && (
        <p role="alert" className="mt-3 text-xs text-[var(--sr-clay)]">
          {submitError}
        </p>
      )}
    </div>
  );
}

function SubmitButton({ submitting }: { submitting: boolean }) {
  return (
    <button
      type="submit"
      disabled={submitting}
      className="mt-0 inline-flex items-center rounded-xl bg-[var(--sr-pine)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--sr-pine)]/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sr-pine)] disabled:opacity-50"
    >
      {submitting ? "Sending…" : "Submit"}
    </button>
  );
}
