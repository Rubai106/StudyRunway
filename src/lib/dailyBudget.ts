import { z } from "zod";
import { isSupportedCurrency } from "./currency";
import { ISO_DATE } from "./model";

export const DAILY_BUDGET_KEY = "studyrunway.daily-budget.v1";
export const DAILY_BUDGET_CHANGE_EVENT = "studyrunway:daily-budget-changed";

export const DAILY_EXPENSE_CATEGORIES = [
  "Food",
  "Transport",
  "Housing",
  "Study",
  "Phone & data",
  "Health",
  "Personal",
  "Other",
] as const;
export type DailyExpenseCategory = (typeof DAILY_EXPENSE_CATEGORIES)[number];

const currencyCode = z.string().length(3).refine(isSupportedCurrency);
const safeMinor = z.number().int().refine(Number.isSafeInteger);
const positiveMinor = safeMinor.refine((amount) => amount > 0);

const ExpenseSchema = z.object({
  id: z.string().min(1).max(80),
  date: ISO_DATE,
  amountMinor: positiveMinor,
  currency: currencyCode,
  category: z.enum(DAILY_EXPENSE_CATEGORIES),
  note: z.string().max(100),
  createdAt: z.string().datetime({ offset: true }),
});

const DailyBudgetSchema = z.object({
  version: z.literal(1),
  currency: currencyCode.nullable(),
  dailyLimitMinor: positiveMinor.nullable(),
  expenses: z.array(ExpenseSchema).max(20_000),
}).refine((value) => value.currency !== null || value.dailyLimitMinor === null);

export type DailyExpense = z.infer<typeof ExpenseSchema>;
export type DailyBudgetState = z.infer<typeof DailyBudgetSchema>;

export function emptyDailyBudget(): DailyBudgetState {
  return { version: 1, currency: null, dailyLimitMinor: null, expenses: [] };
}

/** Load only validated local entries; one bad row does not hide the other rows. */
export function loadDailyBudget(): DailyBudgetState {
  if (typeof window === "undefined") return emptyDailyBudget();
  try {
    const raw = window.localStorage.getItem(DAILY_BUDGET_KEY);
    if (!raw) return emptyDailyBudget();
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return emptyDailyBudget();
    const record = parsed as Record<string, unknown>;
    if (record["version"] !== 1) return emptyDailyBudget();
    const currencyResult = currencyCode.nullable().safeParse(record["currency"] ?? null);
    const limitResult = positiveMinor.nullable().safeParse(record["dailyLimitMinor"] ?? null);
    const expenses = Array.isArray(record["expenses"])
      ? record["expenses"].flatMap((expense) => {
          const result = ExpenseSchema.safeParse(expense);
          return result.success ? [result.data] : [];
        })
      : [];
    return {
      version: 1,
      currency: currencyResult.success ? currencyResult.data : null,
      dailyLimitMinor: currencyResult.success && currencyResult.data !== null && limitResult.success ? limitResult.data : null,
      expenses: expenses.slice(-20_000),
    };
  } catch {
    return emptyDailyBudget();
  }
}

/** Save a validated local snapshot. Returns false when browser storage is unavailable. */
export function saveDailyBudget(value: DailyBudgetState): boolean {
  if (typeof window === "undefined") return false;
  const parsed = DailyBudgetSchema.safeParse(value);
  if (!parsed.success) return false;
  try {
    window.localStorage.setItem(DAILY_BUDGET_KEY, JSON.stringify(parsed.data));
    window.dispatchEvent(new Event(DAILY_BUDGET_CHANGE_EVENT));
    return true;
  } catch {
    return false;
  }
}

export function createDailyExpense(
  input: Omit<DailyExpense, "id" | "createdAt">,
): DailyExpense {
  const expense = ExpenseSchema.parse({
    ...input,
    id: typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `expense_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    createdAt: new Date().toISOString(),
  });
  return expense;
}
