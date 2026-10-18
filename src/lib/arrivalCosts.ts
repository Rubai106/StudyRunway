import { z } from "zod";
import { isSupportedCurrency } from "./currency";
import { ISO_DATE } from "./model";

export const ARRIVAL_COSTS_KEY = "studyrunway.arrival-costs.v1";
export const ARRIVAL_COSTS_CHANGE_EVENT = "studyrunway:arrival-costs-changed";

export const ARRIVAL_COST_CATEGORIES = [
  "Housing deposit",
  "First rent",
  "Utilities & setup",
  "Insurance",
  "Health & dental",
  "Emergency reserve",
  "Books & supplies",
  "Travel",
  "Visa & paperwork",
  "Phone & internet",
  "Furniture & household",
  "Other",
] as const;
export type ArrivalCostCategory = (typeof ARRIVAL_COST_CATEGORIES)[number];

export const ARRIVAL_COST_BASES = ["My estimate", "Official source", "Provider quote"] as const;
export type ArrivalCostBasis = (typeof ARRIVAL_COST_BASES)[number];

const currencyCode = z.string().length(3).refine(isSupportedCurrency);
const positiveMinor = z.number().int().positive().refine(Number.isSafeInteger);
const EntrySchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().trim().min(1).max(100),
  category: z.enum(ARRIVAL_COST_CATEGORIES),
  amountMinor: positiveMinor,
  currency: currencyCode,
  dueDate: ISO_DATE.nullable(),
  status: z.enum(["planned", "paid"]),
  basis: z.enum(ARRIVAL_COST_BASES),
  sourceNote: z.string().max(220),
  createdAt: z.string().datetime({ offset: true }),
});

const StateSchema = z.object({
  version: z.literal(1),
  entries: z.array(EntrySchema).max(1_000),
});

export type ArrivalCostEntry = z.infer<typeof EntrySchema>;
export interface ArrivalCostState { version: 1; entries: ArrivalCostEntry[] }

export function emptyArrivalCosts(): ArrivalCostState {
  return { version: 1, entries: [] };
}

export function loadArrivalCosts(): ArrivalCostState {
  if (typeof window === "undefined") return emptyArrivalCosts();
  try {
    const raw = window.localStorage.getItem(ARRIVAL_COSTS_KEY);
    if (!raw) return emptyArrivalCosts();
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return emptyArrivalCosts();
    const record = parsed as Record<string, unknown>;
    if (record["version"] !== 1 || !Array.isArray(record["entries"])) return emptyArrivalCosts();
    const entries = record["entries"].flatMap((entry) => {
      const result = EntrySchema.safeParse(entry);
      return result.success ? [result.data] : [];
    });
    return { version: 1, entries: entries.slice(-1_000) };
  } catch {
    return emptyArrivalCosts();
  }
}

export function saveArrivalCosts(value: ArrivalCostState): boolean {
  if (typeof window === "undefined") return false;
  const parsed = StateSchema.safeParse(value);
  if (!parsed.success) return false;
  try {
    window.localStorage.setItem(ARRIVAL_COSTS_KEY, JSON.stringify(parsed.data));
    window.dispatchEvent(new Event(ARRIVAL_COSTS_CHANGE_EVENT));
    return true;
  } catch {
    return false;
  }
}

export function createArrivalCost(
  input: Omit<ArrivalCostEntry, "id" | "createdAt">,
): ArrivalCostEntry {
  return EntrySchema.parse({
    ...input,
    id: typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `arrival_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    createdAt: new Date().toISOString(),
  });
}
