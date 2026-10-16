/**
 * Destination Budget Planner — source-attributed cost dataset loader.
 *
 * Loads docs/COST_DATASET.json at import time, validates every entry with
 * Zod, and FAILS FAST with a single clear error listing each bad entry.
 *
 * Validation rules (documented in docs/DESTINATION_BUDGET_SPEC.md):
 *  - currency is a supported ISO 4217 code (checked against lib/currency.ts)
 *  - geographicScope is explicitly "city" | "country"
 *  - costs are non-negative integers in minor units, min <= estimate <= max
 *  - every sourced entry carries sourceTitle + sourceUrl (https? URL)
 *  - missing entries carry no numbers and no source, but MUST explain the
 *    gap in `limitations`
 *  - checkedDate is a real calendar date (YYYY-MM-DD); publishedDate is a
 *    real date or null
 *  - valueKind "regulatory" is forbidden in monthly categories — regulatory
 *    figures live in oneTimeCosts/visaRequirement only and are never mixed
 *    into typical-expense totals
 */

import { z } from "zod";
import { isSupportedCurrency } from "@/lib/currency";
import datasetJson from "../../../docs/COST_DATASET.json";

const ISODateLike = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
  .refine((d) => {
    const [y, m, day] = d.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, day));
    return (
      dt.getUTCFullYear() === y &&
      dt.getUTCMonth() === m - 1 &&
      dt.getUTCDate() === day
    );
  }, "Date is not a real calendar date");

const IsoCurrency = z
  .string()
  .regex(/^[A-Z]{3}$/, "Currency must be a 3-letter ISO code")
  .refine(isSupportedCurrency, "Unsupported currency code");

const ValueKind = z.enum([
  "measured_statistic",
  "official_estimate",
  "student_reported",
  "crowdsourced",
  "regulatory",
  "missing",
]);

const Confidence = z.enum(["high", "medium", "low", "none"]);

const SourceUrl = z
  .string()
  .min(1)
  .refine(
    (u) => u.startsWith("http://") || u.startsWith("https://"),
    "sourceUrl must be an http(s) URL",
  );

const minorNonNegative = z
  .number()
  .int("Amount must be an integer number of minor units")
  .min(0, "Cost cannot be negative")
  .refine(Number.isSafeInteger, "Cost must be a safe integer number of minor units");

/** Monthly category entry. Missing entries carry no numbers/sources. */
const CategoryEntrySchema = z
  .object({
    category: z.string().min(1),
    accommodationType: z.string().min(1).nullable().optional(),
    lifestyle: z.string().min(1).nullable().optional(),
    minMinor: minorNonNegative.nullable().optional(),
    estimateMinor: minorNonNegative.nullable().optional(),
    maxMinor: minorNonNegative.nullable().optional(),
    estimateMethod: z.string().min(1).nullable().optional(),
    sourceTitle: z.string().min(1).nullable().optional(),
    sourceUrl: SourceUrl.nullable().optional(),
    publishedDate: ISODateLike.nullable().optional(),
    checkedDate: ISODateLike,
    valueKind: ValueKind,
    confidence: Confidence,
    limitations: z.string().min(1).nullable().optional(),
  })
  .superRefine((e, ctx) => {
    if (e.valueKind === "missing") {
      for (const f of ["minMinor", "estimateMinor", "maxMinor"] as const) {
        if (e[f] != null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `missing entries must not carry numbers (${f} is set)`,
          });
        }
      }
      if (e.sourceTitle != null || e.sourceUrl != null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "missing entries must not carry source attribution",
        });
      }
      if (!e.limitations) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "missing entries must explain the gap in limitations",
        });
      }
      return;
    }
    if (e.valueKind === "regulatory") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'regulatory figures are forbidden in monthly categories — they belong in oneTimeCosts/visaRequirement and must never enter typical-expense totals',
      });
      return;
    }
    for (const f of ["minMinor", "estimateMinor", "maxMinor"] as const) {
      if (e[f] == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `sourced entries must carry ${f}`,
        });
      }
    }
    if (e.minMinor != null && e.estimateMinor != null && e.minMinor > e.estimateMinor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `minMinor (${e.minMinor}) > estimateMinor (${e.estimateMinor})`,
      });
    }
    if (e.estimateMinor != null && e.maxMinor != null && e.estimateMinor > e.maxMinor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `estimateMinor (${e.estimateMinor}) > maxMinor (${e.maxMinor})`,
      });
    }
    if (!e.sourceTitle) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "sourced entries must carry sourceTitle",
      });
    }
    if (!e.sourceUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "sourced entries must carry sourceUrl",
      });
    }
  });

const OneTimeCostSchema = z
  .object({
    label: z.string().min(1),
    minMinor: minorNonNegative,
    estimateMinor: minorNonNegative,
    maxMinor: minorNonNegative,
    estimateMethod: z.string().min(1).nullable().optional(),
    sourceTitle: z.string().min(1),
    sourceUrl: SourceUrl,
    publishedDate: ISODateLike.nullable().optional(),
    checkedDate: ISODateLike,
    valueKind: ValueKind,
    confidence: Confidence,
    limitations: z.string().min(1).nullable().optional(),
  })
  .superRefine((e, ctx) => {
    if (e.valueKind === "missing") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "one-time costs with no data must be omitted, not listed as missing",
      });
    }
    if (e.minMinor > e.estimateMinor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `minMinor (${e.minMinor}) > estimateMinor (${e.estimateMinor})`,
      });
    }
    if (e.estimateMinor > e.maxMinor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `estimateMinor (${e.estimateMinor}) > maxMinor (${e.maxMinor})`,
      });
    }
  });

const VisaRequirementSchema = z.object({
  amount: minorNonNegative,
  period: z.enum(["year", "month"]),
  sourceTitle: z.string().min(1),
  sourceUrl: SourceUrl,
  publishedDate: ISODateLike.nullable().optional(),
  checkedDate: ISODateLike,
  note: z.string().min(1),
});

const DestinationProfileSchema = z.object({
  destinationId: z.string().min(1),
  country: z.string().min(1),
  city: z.string().min(1).nullable().optional(),
  currency: IsoCurrency,
  geographicScope: z.enum(["city", "country"]),
  checkedDate: ISODateLike,
  categories: z.array(CategoryEntrySchema).min(1),
  oneTimeCosts: z.array(OneTimeCostSchema),
  visaRequirement: VisaRequirementSchema,
});

export type CostEntry = z.infer<typeof CategoryEntrySchema>;
export type OneTimeCost = z.infer<typeof OneTimeCostSchema>;
export type VisaRequirement = z.infer<typeof VisaRequirementSchema>;
export type DestinationProfile = z.infer<typeof DestinationProfileSchema>;

export type ValueKindLabel = z.infer<typeof ValueKind>;
export type ConfidenceLabel = z.infer<typeof Confidence>;

/**
 * Validate a raw (unknown) dataset object. Exported so tests and future
 * dataset rounds can validate without importing the bundled JSON.
 * Throws a single Error listing every bad entry on failure.
 */
export function validateDataset(raw: unknown): DestinationProfile[] {
  const outer = z.object({ destinations: z.array(z.unknown()).min(1) }).safeParse(raw);
  if (!outer.success) {
    throw new Error(
      `COST_DATASET validation failed: "destinations" must be a non-empty array.`,
    );
  }
  const profiles: DestinationProfile[] = [];
  const problems: string[] = [];
  outer.data.destinations.forEach((d, i) => {
    const r = DestinationProfileSchema.safeParse(d);
    if (!r.success) {
      const rawId = (d as { destinationId?: unknown } | null)?.destinationId;
      const tag =
        typeof rawId === "string" && rawId.length > 0 ? `"${rawId}"` : `#${i}`;
      for (const issue of r.error.issues) {
        const path = issue.path.join(".") || "(destination)";
        problems.push(`  - [destination ${tag}] ${path}: ${issue.message}`);
      }
      return;
    }
    profiles.push(r.data);
  });
  if (problems.length > 0) {
    throw new Error(
      `COST_DATASET validation failed (${problems.length} issue(s)):\n${problems.join("\n")}`,
    );
  }
  const ids = new Set<string>();
  for (const d of profiles) {
    if (ids.has(d.destinationId)) {
      throw new Error(
        `COST_DATASET validation failed:\n  - duplicate destinationId "${d.destinationId}"`,
      );
    }
    ids.add(d.destinationId);
  }
  return profiles;
}

/** The validated, typed destination profiles. Fails fast at import. */
export const DESTINATIONS: DestinationProfile[] = validateDataset(datasetJson);

/** Look up a destination profile by id; throws on unknown id. */
export function getDestination(destinationId: string): DestinationProfile {
  const found = DESTINATIONS.find((d) => d.destinationId === destinationId);
  if (!found) {
    const known = DESTINATIONS.map((d) => d.destinationId).join(", ");
    throw new Error(
      `Unknown destinationId "${destinationId}". Known destinations: ${known}.`,
    );
  }
  return found;
}
