import { z } from "zod";
import { ISO_DATE } from "./model";
import { isSupportedCurrency } from "./currency";

const currency = z.string().length(3).transform((value) => value.toUpperCase()).refine(isSupportedCurrency, "Unsupported currency code");
const amount = z.number().finite().positive().max(1_000_000_000, "Amount is too large");

export const FUNDING_FORM_CATEGORIES = ["tuition", "accommodation", "living", "insurance", "travel", "other"] as const;
export const FUNDING_FORM_FREQUENCIES = ["one_time", "monthly", "semester", "annual"] as const;

export const FundingFormExpenseSchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().trim().min(1, "Add a name for this cost").max(120),
  category: z.enum(FUNDING_FORM_CATEGORIES),
  amount,
  currency,
  dueDate: ISO_DATE.nullable(),
  frequency: z.enum(FUNDING_FORM_FREQUENCIES),
  occurrences: z.number().int().min(2).max(60).nullable(),
  notes: z.string().max(500),
});

export const FundingFormSourceSchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().trim().min(1, "Add a name for this funding source").max(120),
  kind: z.enum(["savings", "scholarship", "family", "loan", "other"]),
  amount,
  currency,
  status: z.enum(["confirmed_available", "confirmed_pending", "conditional", "estimated", "unverified"]),
  availableDate: ISO_DATE.nullable(),
  expectedDate: ISO_DATE.nullable(),
  notes: z.string().max(500),
});

export const FundingFormRequestSchema = z.object({
  planningCurrency: currency,
  asOfDate: ISO_DATE.nullable(),
  expenses: z.array(FundingFormExpenseSchema).max(60),
  fundingSources: z.array(FundingFormSourceSchema).max(60),
}).superRefine((value, ctx) => {
  if (value.expenses.length === 0 && value.fundingSources.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["expenses"], message: "Add at least one cost or funding source" });
  }
  value.expenses.forEach((expense, index) => {
    if (expense.frequency !== "one_time" && !expense.occurrences) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["expenses", index, "occurrences"], message: "Enter the number of scheduled payments" });
    }
    if (expense.frequency === "one_time" && expense.occurrences !== null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["expenses", index, "occurrences"], message: "One-time costs do not have occurrences" });
    }
  });
  value.fundingSources.forEach((source, index) => {
    if (source.status === "confirmed_available" && source.expectedDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["fundingSources", index, "expectedDate"], message: "Use available date for funds already in hand" });
    }
    // A missing availability date is valid input: the forecast engine will keep
    // that source in `incomplete` rather than inventing a timing assumption.
  });
});

export type FundingFormRequest = z.infer<typeof FundingFormRequestSchema>;

const categoryToKind: Record<(typeof FUNDING_FORM_CATEGORIES)[number], "tuition" | "rent" | "living" | "insurance" | "travel" | "other"> = {
  tuition: "tuition",
  accommodation: "rent",
  living: "living",
  insurance: "insurance",
  travel: "travel",
  other: "other",
};

export function fundingFormToToolInput(input: FundingFormRequest) {
  return {
    planningCurrency: input.planningCurrency,
    ...(input.asOfDate ? { asOfDate: input.asOfDate } : {}),
    fundingSources: input.fundingSources.map((source) => ({
      label: source.label,
      amount: source.amount,
      currency: source.currency,
      status: source.status,
      kind: source.kind,
      ...(source.availableDate ? { availableDate: source.availableDate } : {}),
      ...(source.expectedDate ? { expectedDate: source.expectedDate } : {}),
    })),
    obligations: input.expenses.map((expense) => ({
      label: expense.label,
      amount: expense.amount,
      currency: expense.currency,
      status: "planned" as const,
      kind: categoryToKind[expense.category],
      ...(expense.dueDate ? { dueDate: expense.dueDate } : {}),
      ...(expense.frequency !== "one_time" ? {
        recurring: {
          everyMonths: expense.frequency === "monthly" ? 1 : expense.frequency === "semester" ? 4 : 12,
          occurrences: expense.occurrences ?? 2,
        },
      } : {}),
    })),
    fxRates: {},
    fxAsOf: input.asOfDate ?? undefined,
    fxSource: "No exchange-rate assumption supplied by the form",
  };
}
