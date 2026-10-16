/**
 * StudyRunway domain model + validation schemas.
 *
 * Amounts are integer minor units (see lib/money.ts). Dates are ISO
 * "YYYY-MM-DD" strings so they sort and compare lexicographically.
 */

import { z } from "zod";
import { isSupportedCurrency } from "./currency";

export const ISO_DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
  .refine((d) => {
    const [y, m, day] = d.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, day));
    return (
      dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === day
    );
  }, "Date is not a real calendar date");

const currencyCode = z
  .string()
  .length(3)
  .transform((s) => s.toUpperCase())
  .refine(isSupportedCurrency, "Unsupported currency code");

const minorInt = z.number().int("Amount must be an integer number of minor units");

export function newId(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${rand}`;
}

// ---------------------------------------------------------------------------
// Funding sources
// ---------------------------------------------------------------------------

export const FUNDING_STATUSES = [
  "confirmed_available",
  "confirmed_pending",
  "conditional",
  "estimated",
  "unverified",
] as const;
export type FundingStatus = (typeof FUNDING_STATUSES)[number];

export const FUNDING_STATUS_LABEL: Record<FundingStatus, string> = {
  confirmed_available: "Confirmed — in hand",
  confirmed_pending: "Confirmed — not yet received",
  conditional: "Conditional",
  estimated: "Estimated",
  unverified: "Unverified",
};

export const FUNDING_KINDS = [
  "savings",
  "scholarship",
  "family",
  "income",
  "loan",
  "other",
] as const;
export type FundingKind = (typeof FUNDING_KINDS)[number];

export const FundingSourceSchema = z.object({
  id: z.string(),
  label: z.string().min(1).max(120),
  kind: z.enum(FUNDING_KINDS),
  amountMinor: minorInt.nullable(),
  currency: currencyCode,
  status: z.enum(FUNDING_STATUSES),
  /** For confirmed_available: date it became available (defaults to plan start). */
  availableDate: ISO_DATE.nullable(),
  /** For other statuses: date the funds are expected. */
  expectedDate: ISO_DATE.nullable(),
  notes: z.string().max(500).default(""),
  evidenceIds: z.array(z.string()).default([]),
});
export type FundingSource = z.infer<typeof FundingSourceSchema>;

// ---------------------------------------------------------------------------
// Obligations (money going out)
// ---------------------------------------------------------------------------

export const OBLIGATION_KINDS = [
  "tuition",
  "deposit",
  "rent",
  "living",
  "travel",
  "visa",
  "insurance",
  "other",
] as const;
export type ObligationKind = (typeof OBLIGATION_KINDS)[number];

export const OBLIGATION_STATUS = ["planned", "committed", "paid"] as const;
export type ObligationStatus = (typeof OBLIGATION_STATUS)[number];

export const ObligationSchema = z.object({
  id: z.string(),
  label: z.string().min(1).max(120),
  kind: z.enum(OBLIGATION_KINDS),
  amountMinor: minorInt.nullable(),
  currency: currencyCode,
  dueDate: ISO_DATE.nullable(),
  recurring: z
    .object({ everyMonths: z.number().int().min(1).max(12), occurrences: z.number().int().min(2).max(60) })
    .nullable(),
  status: z.enum(OBLIGATION_STATUS),
  notes: z.string().max(500).default(""),
  evidenceIds: z.array(z.string()).default([]),
});
export type Obligation = z.infer<typeof ObligationSchema>;

// ---------------------------------------------------------------------------
// Evidence ledger
// ---------------------------------------------------------------------------

export const EvidenceFactSchema = z.object({
  id: z.string(),
  documentLabel: z.string().min(1).max(160),
  factLabel: z.string().min(1).max(160),
  kind: z.enum(["amount", "date", "text"]),
  valueText: z.string().min(1).max(300),
  amountMinor: minorInt.nullable(),
  currency: currencyCode.nullable(),
  dateValue: ISO_DATE.nullable(),
  page: z.number().int().min(1).nullable(),
  confidence: z.enum(["high", "medium", "low"]),
  verified: z.boolean(),
  /** ids of other facts this one conflicts with (user must resolve). */
  conflictsWith: z.array(z.string()).default([]),
  extractedAt: z.string(),
  /** Set when the fact was applied to a financial record (audit trail). */
  appliedTo: z.object({
    recordKind: z.enum(["fundingSource", "obligation"]),
    recordId: z.string(),
    recordLabel: z.string(),
    field: z.string(),
  }).nullable().default(null),
});
export type EvidenceFact = z.infer<typeof EvidenceFactSchema>;

// ---------------------------------------------------------------------------
// Transfer quotes
// ---------------------------------------------------------------------------

export const TransferQuoteSchema = z.object({
  id: z.string(),
  provider: z.string().min(1).max(80),
  sendAmountMinor: minorInt,
  sendCurrency: currencyCode,
  receiveCurrency: currencyCode,
  /** Units of receive currency per 1 unit of send currency. */
  exchangeRate: z.number().positive().finite(),
  feeMinor: minorInt.nullable(),
  feeCurrency: currencyCode.nullable(),
  otherCostsMinor: minorInt.nullable().default(null),
  otherCostsCurrency: currencyCode.nullable().default(null),
  deliveryDaysMin: z.number().int().min(0).max(60),
  deliveryDaysMax: z.number().int().min(0).max(60),
  quoteDate: ISO_DATE,
  /** The payment deadline this transfer is meant to meet (optional). */
  paymentDeadline: ISO_DATE.nullable().default(null),
  notes: z.string().max(300).default(""),
}).refine(
  (q) => q.deliveryDaysMax >= q.deliveryDaysMin,
  "Max delivery days must be >= min delivery days",
);
export type TransferQuote = z.infer<typeof TransferQuoteSchema>;

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

export const ScenarioTransformSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("delay_funding"), sourceId: z.string(), days: z.number().int().min(1).max(365) }),
  z.object({
    type: z.literal("fx_shift"),
    percent: z.number().min(-50).max(50),
    /** Restrict to currency pairs; empty = all pairs touching future events. */
    pairs: z.array(z.string()).default([]),
  }),
  z.object({
    type: z.literal("expense_increase"),
    percent: z.number().min(0).max(200),
    kinds: z.array(z.enum(OBLIGATION_KINDS)).default([]),
  }),
]);
export type ScenarioTransform = z.infer<typeof ScenarioTransformSchema>;

export const ScenarioSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(80),
  description: z.string().max(400).default(""),
  transforms: z.array(ScenarioTransformSchema).min(1),
  createdAt: z.string(),
});
export type Scenario = z.infer<typeof ScenarioSchema>;

// ---------------------------------------------------------------------------
// Whole plan
// ---------------------------------------------------------------------------

export const FxTableSchema = z.object({
  /** Key "FROM>TO", value = units of TO per 1 unit of FROM. */
  rates: z.record(z.string(), z.number().positive().finite()),
  asOf: ISO_DATE,
  source: z.string().max(200),
});
export type FxTable = z.infer<typeof FxTableSchema>;

export const ProfileSchema = z.object({
  studentName: z.string().max(80).default(""),
  homeCountry: z.string().min(1).max(80),
  destinationCountry: z.string().min(1).max(80),
  homeCurrency: currencyCode,
  planningCurrency: currencyCode,
  /** Override "today" for deterministic demos/tests. Defaults to the real date. */
  asOfDate: ISO_DATE.nullable().default(null),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const PlanStateSchema = z.object({
  version: z.literal(1),
  profile: ProfileSchema,
  fundingSources: z.array(FundingSourceSchema),
  obligations: z.array(ObligationSchema),
  evidence: z.array(EvidenceFactSchema),
  quotes: z.array(TransferQuoteSchema),
  scenarios: z.array(ScenarioSchema),
  fx: FxTableSchema,
  updatedAt: z.string(),
});
export type PlanState = z.infer<typeof PlanStateSchema>;

export const STORAGE_KEY = "studyrunway.plan.v1";

/** Validate an unknown value as a PlanState; returns null when invalid. */
export function parsePlanState(value: unknown): PlanState | null {
  const r = PlanStateSchema.safeParse(value);
  return r.success ? r.data : null;
}

// ---------------------------------------------------------------------------
// Date helpers (pure, UTC)
// ---------------------------------------------------------------------------

export function todayISO(asOfDate: string | null): string {
  if (asOfDate) return asOfDate;
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

export function addDaysISO(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function addMonthsISO(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  // Clamp the day to the target month's length.
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const nd = Math.min(d, lastDay);
  return `${String(ny).padStart(4, "0")}-${String(nm).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}

export function formatDateLong(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
