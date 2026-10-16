/**
 * Destination Budget Planner — deterministic budget engine (PART D).
 *
 * buildLivingCostPlan() turns validated user inputs + a source-attributed
 * destination profile into a monthly budget plan. It is fully deterministic:
 * no randomness, no LLM, no invented prices, integer minor-unit arithmetic
 * only (halves rounded away from zero via lib/money.ts roundHalfUp).
 *
 * Scenario method (documented in docs/DESTINATION_BUDGET_SPEC.md):
 *  - lowMinor    = sum of minMinor over included categories
 *  - typicalMinor= sum of estimateMinor over included categories
 *  - highMinor   = sum of maxMinor over included categories
 *  - a 5% contingency is added to EACH scenario, computed as
 *    roundHalfUp(subtotal * 5 / 100) and carried as its own labelled line.
 *
 * Categories with no sourced data are OMITTED from totals and listed in
 * missingData — never filled with guesses. Regulatory figures (visa
 * requirements) are kept strictly separate and never enter totals.
 */

import { z } from "zod";
import { formatMinor, getCurrency, isSupportedCurrency } from "@/lib/currency";
import { convertMinor, roundHalfUp } from "@/lib/money";
import {
  DESTINATIONS,
  getDestination,
  type CostEntry,
  type DestinationProfile,
} from "./dataset";

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

const SafeMinorAmount = z.number().int().min(0).refine(
  Number.isSafeInteger,
  "Amount must be a safe integer number of minor units",
);

export const LivingCostPlanInputsSchema = z
  .object({
    destinationId: z.string().min(1, "destinationId is required"),
    monthlyBudgetMinor: SafeMinorAmount.refine(
      (n) => n >= 0,
      "monthlyBudgetMinor cannot be negative",
    ),
    budgetCurrency: z
      .string()
      .length(3, "budgetCurrency must be a 3-letter ISO code")
      .transform((s) => s.toUpperCase())
      .refine(isSupportedCurrency, "Unsupported budgetCurrency code"),
    accommodationType: z.string().min(1).optional(),
    cookingHabit: z.enum(["cook_at_home", "mixed", "eat_out"]).optional(),
    transportPreference: z
      .enum(["public_transport", "cycling", "walking", "mixed"])
      .optional(),
    insuranceCovered: z.boolean(),
    utilitiesIncluded: z.boolean().optional(),
    arrivalDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "arrivalDate must be YYYY-MM-DD")
      .optional(),
    studyMonths: z.number().int().min(1).max(60).default(12),
    includeTuition: z.boolean().default(false),
    tuitionAmountMinor: SafeMinorAmount.optional(),
    tuitionCurrency: z
      .string()
      .length(3)
      .transform((s) => s.toUpperCase())
      .refine(isSupportedCurrency, "Unsupported tuitionCurrency code")
      .optional(),
    /**
     * Explicit user-supplied FX assumption: destination minor units per 1
     * whole unit of budgetCurrency. This rate may be fractional (e.g. 0.8
     * euro cents per 1 BDT), because exchange rates can be below one target
     * minor unit per source major unit. Never fetched or guessed.
     */
    fxToDestinationMinor: z.number().finite().positive().max(
      100_000_000,
      "fxToDestinationMinor is outside the supported rate range",
    ).optional().describe(
      "Explicit user-supplied FX assumption: destination currency minor units per one whole unit of budgetCurrency. It may be fractional (e.g. 0.8 euro cents per BDT, meaning EUR 0.008 per BDT). Never fetch or guess this value.",
    ),
    protectedEssentials: z.array(z.string().min(1)).default([]),
    /** Optional per-category monthly amounts entered by the user, in destination-currency minor units. */
    categoryOverridesMinor: z.record(z.string(), SafeMinorAmount).default({}),
  })
  .superRefine((v, ctx) => {
    const overrideable = new Set([
      "groceries", "groceries_eating_out", "eating_out", "utilities", "local_transport",
      "mobile", "mobile_internet", "internet", "study_materials", "personal_leisure",
      "health_insurance", "insurance", "media_licence",
    ]);
    for (const key of Object.keys(v.categoryOverridesMinor ?? {})) {
      if (!overrideable.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["categoryOverridesMinor", key],
          message: `Category ${key} cannot be manually overridden.`,
        });
      }
    }
    if (v.includeTuition && (v.tuitionAmountMinor == null || v.tuitionCurrency == null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "includeTuition is true but tuitionAmountMinor/tuitionCurrency were not provided",
      });
    }
  });

export type LivingCostPlanInputs = z.infer<typeof LivingCostPlanInputsSchema>;

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export type PlanVerdict = "insufficient_data" | "shortfall" | "tight" | "within_budget";

export interface PlanCategoryLine {
  category: string;
  label: string;
  accommodationType?: string;
  lifestyle?: string;
  minMinor: number;
  maxMinor: number;
  estimateMinor: number;
  estimateMethod: string;
  sourceTitle: string;
  sourceUrl: string;
  valueKind: string;
  confidence: string;
  limitations?: string;
}

export interface OneTimeItem {
  label: string;
  minMinor: number;
  estimateMinor: number;
  maxMinor: number;
  sourceTitle: string;
  sourceUrl: string;
  valueKind: string;
}

export interface PlanAssumption {
  tag: string;
  text: string;
}

export interface MissingDatum {
  category: string;
  label: string;
  reason: "no_data" | "bundled";
  note: string;
}

export interface PlanSource {
  title: string;
  url: string;
  publishedDate: string | null;
  checkedDate: string;
  scope: "city" | "country";
}

export interface BenchmarkCrossCheck {
  label: string;
  sourceTitle: string;
  sourceUrl: string;
  sourceMinMinor: number;
  sourceEstimateMinor: number;
  sourceMaxMinor: number;
  comparableMinMinor: number;
  comparableEstimateMinor: number;
  comparableMaxMinor: number;
  comparableCategories: string[];
  /** Difference between the full typical plan and comparable core subtotal, never part of the source benchmark. */
  additionalMonthlyMinor: number;
  /** True if a user-entered category override is included in the comparison. */
  includesUserEnteredAssumption: boolean;
  overlapsSourceRange: boolean;
  note: string;
}

export interface LivingCostPlan {
  destinationId: string;
  destinationLabel: string;
  currency: string;
  scope: "city" | "country";
  city: string | null;
  categories: PlanCategoryLine[];
  monthlyTotals: { lowMinor: number; typicalMinor: number; highMinor: number };
  contingencyMinor: { lowMinor: number; typicalMinor: number; highMinor: number };
  oneTime: { items: OneTimeItem[]; totalMinor: number };
  /** Monthly budget expressed in DESTINATION currency minor units (post-FX). */
  budgetMinor: number;
  budgetCurrencyOriginal: string;
  verdict: PlanVerdict;
  verdictReason: string;
  /** budgetMinor - typicalMinor (negative only when verdict is shortfall). */
  remainingMinor: number;
  shortfallMinor?: number;
  topContributors: { category: string; label: string; estimateMinor: number }[];
  assumptions: PlanAssumption[];
  missingData: MissingDatum[];
  sources: PlanSource[];
  warnings: string[];
  /** Source total used only as a benchmark; never included in spending totals. */
  benchmarkCrossCheck: BenchmarkCrossCheck | null;
  tuition: {
    included: boolean;
    amountMinor: number | null;
    currency: string | null;
    note: string;
  };
  visaRequirementSeparate: {
    amount: number;
    period: "year" | "month";
    sourceTitle: string;
    sourceUrl: string;
    note: string;
  } | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Categories whose absence or low confidence degrades the verdict to tight. */
export const ESSENTIAL_CATEGORIES = [
  "rent",
  "groceries",
  "groceries_eating_out",
  "health_insurance",
  "local_transport",
  "utilities",
] as const;

/** Categories never summed into monthlyTotals (cross-checks, not expenses). */
const EXCLUDED_FROM_TOTALS = new Set(["total_monthly_living"]);

/** 5% contingency, applied per scenario, labelled as an assumption. */
const CONTINGENCY_RATE_NUM = 5;
const CONTINGENCY_RATE_DEN = 100;

export const CATEGORY_LABELS: Record<string, string> = {
  rent: "Rent",
  groceries: "Groceries",
  groceries_eating_out: "Groceries & eating out",
  utilities: "Utilities",
  local_transport: "Local transport",
  mobile: "Mobile",
  mobile_internet: "Mobile & internet",
  internet: "Internet",
  study_materials: "Study materials",
  personal_leisure: "Personal & leisure",
  health_insurance: "Health insurance",
  insurance: "Insurance (contents/personal)",
  media_licence: "Media licence/streaming",
  eating_out: "Eating out",
  total_monthly_living: "Total monthly living (source cross-check)",
};

const CITY_KEYWORDS = [
  "Munich",
  "Bielefeld",
  "Cottbus",
  "Erlangen",
  "Nuremberg",
  "Stuttgart",
  "Hohenheim",
  "Limerick",
  "Leeds",
  "London",
  "Sydney",
];

/** Heuristic: does a missing-data note say the cost is bundled elsewhere? */
export function isBundledNote(limitations: string | null | undefined): boolean {
  if (!limitations) return false;
  return /\b(bundled|bundling|included in rent|includes bills)\b/i.test(limitations);
}

function detectCity(entry: CostEntry): string | null {
  const hay = `${entry.limitations ?? ""} ${entry.sourceTitle ?? ""}`;
  for (const city of CITY_KEYWORDS) {
    if (new RegExp(`\\b${city}\\b`, "i").test(hay)) return city;
  }
  return null;
}

function labelOf(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

function toLine(e: CostEntry): PlanCategoryLine {
  return {
    category: e.category,
    label: labelOf(e.category),
    accommodationType: e.accommodationType ?? undefined,
    lifestyle: e.lifestyle ?? undefined,
    minMinor: e.minMinor as number,
    maxMinor: e.maxMinor as number,
    estimateMinor: e.estimateMinor as number,
    estimateMethod: e.estimateMethod ?? "figure stated by source",
    sourceTitle: e.sourceTitle as string,
    sourceUrl: e.sourceUrl as string,
    valueKind: e.valueKind,
    confidence: e.confidence,
    limitations: e.limitations ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

function sourced(entries: CostEntry[]): CostEntry[] {
  return entries.filter((e) => e.valueKind !== "missing");
}

/** Pick one rent entry: requested accommodationType (substring match), else cheapest sourced. */
function selectRent(
  profile: DestinationProfile,
  requested: string | undefined,
): { entry: CostEntry | null; assumption: PlanAssumption; warning: string | null } {
  const rents = sourced(profile.categories.filter((c) => c.category === "rent")).sort(
    (a, b) => (a.estimateMinor as number) - (b.estimateMinor as number),
  );
  if (rents.length === 0) {
    return {
      entry: null,
      assumption: {
        tag: "rent_selection",
        text: "No sourced rent figure exists for this destination — rent cannot be estimated.",
      },
      warning: null,
    };
  }
  if (requested) {
    const needle = requested.toLowerCase();
    const hit = rents.find((r) => (r.accommodationType ?? "").toLowerCase().includes(needle));
    if (hit) {
      return {
        entry: hit,
        assumption: {
          tag: "rent_selection",
          text: `Rent matched to requested accommodation type "${requested}" → "${hit.accommodationType}" (source: ${hit.sourceTitle}).`,
        },
        warning: null,
      };
    }
    const cheapest = rents[0];
    return {
      entry: cheapest,
      assumption: {
        tag: "rent_selection",
        text: `Requested accommodation type "${requested}" not found in sourced rent figures — fell back to cheapest sourced option "${cheapest.accommodationType}".`,
      },
      warning: `Accommodation type "${requested}" has no sourced rent figure; cheapest sourced option used instead.`,
    };
  }
  const cheapest = rents[0];
  return {
    entry: cheapest,
    assumption: {
      tag: "rent_selection",
      text: `No accommodation type requested — used cheapest sourced rent option "${cheapest.accommodationType}".`,
    },
    warning: null,
  };
}

/**
 * Pick one entry per non-rent category. When a category has several sourced
 * entries (e.g. Germany's city slices), prefer the entry from the same city
 * as the selected rent; otherwise take the median estimate. Deterministic.
 */
function selectOtherCategories(
  profile: DestinationProfile,
  rentEntry: CostEntry | null,
  cookingHabit: string | undefined,
): { lines: PlanCategoryLine[]; assumptions: PlanAssumption[] } {
  const lines: PlanCategoryLine[] = [];
  const assumptions: PlanAssumption[] = [];
  const rentCity = rentEntry ? detectCity(rentEntry) : null;

  const cats = new Map<string, CostEntry[]>();
  for (const c of profile.categories) {
    if (c.category === "rent" || EXCLUDED_FROM_TOTALS.has(c.category)) continue;
    if (!cats.has(c.category)) cats.set(c.category, []);
    cats.get(c.category)!.push(c);
  }

  // groceries vs groceries_eating_out: prefer plain groceries when sourced.
  if (cats.has("groceries") && cats.has("groceries_eating_out")) {
    const plain = sourced(cats.get("groceries")!);
    if (plain.length > 0) {
      assumptions.push({
        tag: "category_selection",
        text: `Food estimated from "groceries" entries (cookingHabit${cookingHabit ? ` "${cookingHabit}"` : " not set"} — the dataset has no cooking-habit price split, so no habit-based adjustment is applied).`,
      });
      cats.delete("groceries_eating_out");
    }
  }

  for (const [category, entries] of cats) {
    const options = sourced(entries).sort(
      (a, b) => (a.estimateMinor as number) - (b.estimateMinor as number),
    );
    if (options.length === 0) continue; // handled as missingData by caller
    let chosen: CostEntry;
    let why: string;
    if (options.length === 1) {
      chosen = options[0];
      why = "only sourced figure";
    } else if (rentCity) {
      const cityMatch = options.find((o) => detectCity(o) === rentCity);
      if (cityMatch) {
        chosen = cityMatch;
        why = `matched to rent's city slice (${rentCity})`;
      } else {
        chosen = options[Math.floor((options.length - 1) / 2)];
        why = `no ${rentCity} figure for this category — median estimate of ${options.length} sourced figures`;
      }
    } else {
      chosen = options[Math.floor((options.length - 1) / 2)];
      why = `median estimate of ${options.length} sourced figures`;
    }
    lines.push(toLine(chosen));
    if (options.length > 1) {
      assumptions.push({
        tag: "category_selection",
        text: `${labelOf(category)}: ${options.length} sourced figures exist; used "${chosen.sourceTitle}" (${why}).`,
      });
    }
  }
  return { lines, assumptions };
}

// ---------------------------------------------------------------------------
// Warnings / staleness
// ---------------------------------------------------------------------------

const STALE_AFTER_MS = 365 * 24 * 60 * 60 * 1000; // 12 months

/**
 * Source-freshness warnings. Exported for tests and the later UI phase.
 * `asOf` defaults to now; pass an explicit date to test staleness.
 */
export function sourceWarnings(profile: DestinationProfile, asOf: Date = new Date()): string[] {
  const warnings: string[] = [];
  const cutoff = asOf.getTime() - STALE_AFTER_MS;
  const seen = new Set<string>();
  const check = (title: string | null | undefined, checkedDate: string | null | undefined) => {
    if (!title || !checkedDate || seen.has(title)) return;
    seen.add(title);
    const t = new Date(`${checkedDate}T00:00:00Z`).getTime();
    if (Number.isFinite(t) && t < cutoff) {
      warnings.push(
        `Source may be stale — re-check before relying on it: "${title}" (last checked ${checkedDate}).`,
      );
    }
  };
  for (const c of profile.categories) {
    if (c.valueKind !== "missing") check(c.sourceTitle, c.checkedDate);
  }
  for (const o of profile.oneTimeCosts) check(o.sourceTitle, o.checkedDate);
  const v = profile.visaRequirement;
  check(v.sourceTitle, v.checkedDate);
  if (/verify|recheck/i.test(v.note)) {
    warnings.push(
      `Visa requirement caution: ${v.note} (verify on the official page: ${v.sourceUrl})`,
    );
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

/**
 * Build a deterministic living-cost plan. Also exported as
 * buildLivingCostPlanFromProfile(inputs, profile) for tests / synthetic data.
 */
export function buildLivingCostPlan(rawInputs: unknown): LivingCostPlan {
  const inputs = LivingCostPlanInputsSchema.parse(rawInputs);
  return buildLivingCostPlanFromProfile(inputs, getDestination(inputs.destinationId));
}

export function buildLivingCostPlanFromProfile(
  inputs: LivingCostPlanInputs,
  profile: DestinationProfile,
): LivingCostPlan {
  const assumptions: PlanAssumption[] = [];
  const warnings: string[] = [];
  const missingData: MissingDatum[] = [];
  const categories: PlanCategoryLine[] = [];

  // --- FX: budget -> destination currency ---------------------------------
  const destCurrency = profile.currency;
  const budgetCurrency = inputs.budgetCurrency;
  let budgetMinor: number;
  if (budgetCurrency === destCurrency) {
    budgetMinor = inputs.monthlyBudgetMinor;
  } else if (inputs.fxToDestinationMinor == null) {
    return insufficientDataPlan(profile, inputs, {
      reason:
        `Budget is in ${budgetCurrency} but ${profile.destinationId} costs are in ${destCurrency}, ` +
        `and no explicit FX assumption (fxToDestinationMinor) was supplied. No rate is fetched or guessed.`,
    });
  } else {
    const rateMajor = inputs.fxToDestinationMinor / 10 ** getCurrency(destCurrency).minorUnits;
    budgetMinor = convertMinor(inputs.monthlyBudgetMinor, budgetCurrency, destCurrency, rateMajor);
    if (!Number.isSafeInteger(budgetMinor) || budgetMinor < 0) {
      throw new Error("Converted monthly budget is outside the supported safe amount range.");
    }
    assumptions.push({
      tag: "fx",
      text:
        `Explicit FX assumption (user-supplied, not fetched): 1 ${budgetCurrency} = ` +
        `${rateMajor.toPrecision(6)} ${destCurrency}. ` +
        `Monthly budget ${formatMinor(inputs.monthlyBudgetMinor, budgetCurrency)} converts to ` +
        `${formatMinor(budgetMinor, destCurrency)} using that assumption.`,
    });
  }

  // --- rent/food presence gate -------------------------------------------------
  // No sourced rent or no sourced food => no monthly budget can be estimated.
  // Return the empty insufficient-data plan rather than inventing figures.
  const hasSourcedRent = profile.categories.some(
    (c) => c.category === "rent" && c.valueKind !== "missing",
  );
  const hasSourcedFood = profile.categories.some(
    (c) =>
      (c.category === "groceries" || c.category === "groceries_eating_out") &&
      c.valueKind !== "missing",
  ) || Object.keys(inputs.categoryOverridesMinor ?? {}).some((key) =>
    key === "groceries" || key === "groceries_eating_out" || key === "eating_out",
  );
  if (!hasSourcedRent || !hasSourcedFood) {
    return insufficientDataPlan(profile, inputs, {
      reason: !hasSourcedRent
        ? "No sourced rent figure exists for this destination, so a monthly budget cannot be estimated."
        : "No sourced groceries figure exists for this destination, so a monthly budget cannot be estimated.",
    });
  }

  // --- rent ----------------------------------------------------------------
  const rentSel = selectRent(profile, inputs.accommodationType);
  assumptions.push(rentSel.assumption);
  if (rentSel.warning) warnings.push(rentSel.warning);
  if (rentSel.entry) categories.push(toLine(rentSel.entry));
  if (profile.destinationId === "de-germany") {
    warnings.push("Germany costs use reference points from several named university cities (including different cost levels); this is not a single-city estimate or a representative national average. Confirm prices for your actual university city.");
  }
  if (profile.destinationId === "uk-united-kingdom") {
    warnings.push("Some UK cost references are based on Leeds-specific student experience. They are not a representative UK-wide average; London and other cities may differ substantially.");
  }

  // --- other categories -----------------------------------------------------
  const others = selectOtherCategories(profile, rentSel.entry, inputs.cookingHabit);
  categories.push(...others.lines);
  assumptions.push(...others.assumptions);

  // --- explicit user-entered monthly category amounts ------------------------
  // These overrides are planning assumptions, not sourced prices. They replace
  // the category estimate rather than being added on top of it, avoiding double-counting.
  for (const [category, amountMinor] of Object.entries(inputs.categoryOverridesMinor ?? {})) {
    if (!Number.isInteger(amountMinor) || amountMinor < 0) continue; // schema normally rejects this
    const label = labelOf(category);
    const existing = categories.findIndex((line) => line.category === category);
    const overrideLine: PlanCategoryLine = {
      category,
      label,
      minMinor: amountMinor,
      maxMinor: amountMinor,
      estimateMinor: amountMinor,
      estimateMethod: "user-entered monthly amount; replaces the reference estimate",
      sourceTitle: "User-entered planning assumption",
      sourceUrl: "https://studyrunway.local/assumptions#user-entered",
      valueKind: "assumption",
      confidence: "none",
      limitations: "Entered by the student; not a published price. Confirm that it reflects your own expected spending.",
    };
    if (existing >= 0) categories[existing] = { ...categories[existing], ...overrideLine };
    else categories.push(overrideLine);
    assumptions.push({
      tag: "user_override",
      text: `${label} was set to ${formatMinor(amountMinor, destCurrency)} per month by the user. This replaces the reference estimate for planning and is not a sourced price.`,
    });
  }

  // --- missing data ----------------------------------------------------------
  for (const c of profile.categories) {
    if (c.valueKind !== "missing" || EXCLUDED_FROM_TOTALS.has(c.category)) continue;
    if (inputs.categoryOverridesMinor?.[c.category] != null) continue;
    const bundled = isBundledNote(c.limitations);
    missingData.push({
      category: c.category,
      label: labelOf(c.category),
      reason: bundled ? "bundled" : "no_data",
      note: bundled
        ? `No separate figure: ${c.limitations}`
        : (c.limitations ?? "No sourced figure available."),
    });
    if (bundled) {
      assumptions.push({
        tag: "bundling",
        text: `${labelOf(c.category)}: counted inside another line, not separately — ${c.limitations}`,
      });
    }
  }

  // --- totals + contingency --------------------------------------------------
  const sub = (f: (l: PlanCategoryLine) => number) =>
    categories.reduce((acc, l) => acc + f(l), 0);
  const lowSub = sub((l) => l.minMinor);
  const typSub = sub((l) => l.estimateMinor);
  const highSub = sub((l) => l.maxMinor);
  const contingency = {
    lowMinor: roundHalfUp((lowSub * CONTINGENCY_RATE_NUM) / CONTINGENCY_RATE_DEN),
    typicalMinor: roundHalfUp((typSub * CONTINGENCY_RATE_NUM) / CONTINGENCY_RATE_DEN),
    highMinor: roundHalfUp((highSub * CONTINGENCY_RATE_NUM) / CONTINGENCY_RATE_DEN),
  };
  categories.push({
    category: "contingency",
    label: "Contingency (5% planning buffer)",
    minMinor: contingency.lowMinor,
    maxMinor: contingency.highMinor,
    estimateMinor: contingency.typicalMinor,
    estimateMethod: "assumption — 5% of scenario subtotal, not from a source",
    sourceTitle: "StudyRunway planning assumption (no source)",
    sourceUrl: "https://studyrunway.local/assumptions#contingency",
    valueKind: "assumption",
    confidence: "none",
    limitations: "Deliberately source-free buffer for unexpected costs.",
  });
  assumptions.push({
    tag: "contingency",
    text: "A 5% contingency is added to each scenario as a labelled planning assumption — it comes from no source and covers unexpected costs.",
  });

  const monthlyTotals = {
    lowMinor: lowSub + contingency.lowMinor,
    typicalMinor: typSub + contingency.typicalMinor,
    highMinor: highSub + contingency.highMinor,
  };

  // Compare a published source-level total against only its corresponding categories.
  // The benchmark is informational and is never added to monthly spending.
  let benchmarkCrossCheck: BenchmarkCrossCheck | null = null;
  const benchmarkEntry = profile.categories.find(
    (entry) => entry.category === "total_monthly_living" && entry.valueKind !== "missing",
  );
  if (benchmarkEntry) {
    const foodCategory = categories.some((line) => line.category === "groceries")
      ? "groceries"
      : "groceries_eating_out";
    const comparableKeys = ["rent", foodCategory, "local_transport"];
    const comparableLines = comparableKeys.map((key) => categories.find((line) => line.category === key));
    if (comparableLines.every((line): line is PlanCategoryLine => Boolean(line))) {
      const sumField = (field: "minMinor" | "estimateMinor" | "maxMinor") =>
        comparableLines.reduce((sum, line) => sum + (line ? line[field] : 0), 0);
      const comparableMinMinor = sumField("minMinor");
      const comparableEstimateMinor = sumField("estimateMinor");
      const comparableMaxMinor = sumField("maxMinor");
      const sourceMinMinor = benchmarkEntry.minMinor as number;
      const sourceEstimateMinor = benchmarkEntry.estimateMinor as number;
      const sourceMaxMinor = benchmarkEntry.maxMinor as number;
      const overlapsSourceRange = comparableMaxMinor >= sourceMinMinor && comparableMinMinor <= sourceMaxMinor;
      const includesUserEnteredAssumption = comparableLines.some((line) => line.valueKind === "assumption");
      const additionalMonthlyMinor = monthlyTotals.typicalMinor - comparableEstimateMinor;
      benchmarkCrossCheck = {
        label: "Comparable core costs: rent, food and local transport",
        sourceTitle: benchmarkEntry.sourceTitle as string,
        sourceUrl: benchmarkEntry.sourceUrl as string,
        sourceMinMinor,
        sourceEstimateMinor,
        sourceMaxMinor,
        comparableMinMinor,
        comparableEstimateMinor,
        comparableMaxMinor,
        comparableCategories: comparableKeys,
        additionalMonthlyMinor,
        includesUserEnteredAssumption,
        overlapsSourceRange,
        note: includesUserEnteredAssumption
          ? "This core subtotal includes at least one user-entered category amount, so it is a planning comparison rather than an independent validation of the user's figure."
          : overlapsSourceRange
            ? "The comparable core subtotal overlaps the source range. Other categories and the labelled 5% planning contingency account for the difference from the full StudyRunway total."
            : "The comparable subtotal falls outside the source range. Sources may use different dates, lifestyles or scopes; review category values before relying on this plan.",
      };
      assumptions.push({
        tag: "benchmark_cross_check",
        text: `Comparable core subtotal (rent, food and transport): ${formatMinor(comparableEstimateMinor, destCurrency)}; source benchmark range: ${formatMinor(sourceMinMinor, destCurrency)}–${formatMinor(sourceMaxMinor, destCurrency)}. The benchmark is informational only and is not added to the plan total.`,
      });
      if (!overlapsSourceRange || includesUserEnteredAssumption) warnings.push(benchmarkCrossCheck.note);
    }
  }

  // --- cross-check lines excluded from totals --------------------------------
  for (const c of profile.categories) {
    if (EXCLUDED_FROM_TOTALS.has(c.category) && c.valueKind !== "missing") {
      assumptions.push({
        tag: "category_selection",
        text: `Source's own "${labelOf(c.category)}" figure (${formatMinor(c.estimateMinor as number, destCurrency)}) is shown as a cross-check only and is NOT summed into monthlyTotals (would double-count).`,
      });
    }
  }

  // --- one-time costs ----------------------------------------------------------
  const oneTimeItems: OneTimeItem[] = profile.oneTimeCosts.map((o) => ({
    label: o.label,
    minMinor: o.minMinor,
    estimateMinor: o.estimateMinor,
    maxMinor: o.maxMinor,
    sourceTitle: o.sourceTitle,
    sourceUrl: o.sourceUrl,
    valueKind: o.valueKind,
  }));
  const oneTimeTotal = oneTimeItems.reduce((a, i) => a + i.estimateMinor, 0);

  // --- tuition -----------------------------------------------------------------
  let tuition: LivingCostPlan["tuition"];
  if (inputs.includeTuition) {
    const tCur = inputs.tuitionCurrency as string;
    const tAmt = inputs.tuitionAmountMinor as number;
    if (tCur === destCurrency) {
      tuition = {
        included: true,
        amountMinor: tAmt,
        currency: tCur,
        note: `Tuition of ${formatMinor(tAmt, tCur)} included explicitly by user request (not from the cost dataset).`,
      };
    } else if (tCur === budgetCurrency && inputs.fxToDestinationMinor != null) {
      const rateMajor = inputs.fxToDestinationMinor / 10 ** getCurrency(destCurrency).minorUnits;
      const converted = convertMinor(tAmt, tCur, destCurrency, rateMajor);
      if (!Number.isSafeInteger(converted) || converted < 0) {
        throw new Error("Converted tuition is outside the supported safe amount range.");
      }
      tuition = {
        included: true,
        amountMinor: converted,
        currency: destCurrency,
        note: `Tuition of ${formatMinor(tAmt, tCur)} converted with the same explicit user-supplied FX assumption to ${formatMinor(converted, destCurrency)}.`,
      };
    } else {
      tuition = {
        included: false,
        amountMinor: null,
        currency: null,
        note: `Tuition requested but tuition currency ${tCur} cannot be converted to ${destCurrency} with the available explicit FX assumption — tuition EXCLUDED rather than guessed.`,
      };
      warnings.push(tuition.note);
    }
  } else {
    tuition = {
      included: false,
      amountMinor: null,
      currency: null,
      note: "Tuition EXCLUDED from this plan (includeTuition not set). Tuition is a major cost — add it separately if it applies to you.",
    };
  }

  // --- verdict -------------------------------------------------------------------
  const hasRent = categories.some((l) => l.category === "rent");
  const hasFood = categories.some(
    (l) => l.category === "groceries" || l.category === "groceries_eating_out",
  );
  const typical = monthlyTotals.typicalMinor;
  let verdict: PlanVerdict;
  let verdictReason: string;
  let shortfallMinor: number | undefined;

  if (!hasRent || !hasFood) {
    verdict = "insufficient_data";
    verdictReason = !hasRent
      ? "No sourced rent figure exists for this destination, so a monthly budget cannot be estimated."
      : "No sourced groceries figure exists for this destination, so a monthly budget cannot be estimated.";
  } else if (typical > budgetMinor) {
    verdict = "shortfall";
    shortfallMinor = typical - budgetMinor;
    verdictReason = `Typical monthly cost (${formatMinor(typical, destCurrency)}) exceeds the monthly budget (${formatMinor(budgetMinor, destCurrency)}) by ${formatMinor(shortfallMinor, destCurrency)} per month.`;
  } else {
    const remaining = budgetMinor - typical;
    const thin = remaining * 10 < typical; // remaining < 10% of typical
    const weakEssentials: string[] = [];
    for (const cat of ESSENTIAL_CATEGORIES) {
      const line = categories.find((l) => l.category === cat);
      if (!line) {
        const md = missingData.find((m) => m.category === cat);
        if (md && md.reason === "no_data") weakEssentials.push(`${labelOf(cat)} (no data)`);
        // bundled essentials (e.g. utilities in rent) are NOT a weakness
      } else if (line.valueKind === "assumption") {
        weakEssentials.push(`${labelOf(cat)} (user-entered estimate; not independently sourced)`);
      } else if (line.confidence === "low") {
        weakEssentials.push(`${labelOf(cat)} (low confidence)`);
      }
    }
    if (thin || weakEssentials.length > 0) {
      verdict = "tight";
      const why: string[] = [];
      if (thin) why.push(`only ${formatMinor(remaining, destCurrency)} (${((remaining * 100) / typical).toFixed(1)}%) headroom, below the 10% cushion`);
      if (weakEssentials.length > 0) why.push(`weak essential data: ${weakEssentials.join(", ")}`);
      verdictReason = `Budget covers the typical cost but is tight — ${why.join("; ")}.`;
    } else {
      verdict = "within_budget";
      verdictReason = `Typical monthly cost (${formatMinor(typical, destCurrency)}) fits the budget (${formatMinor(budgetMinor, destCurrency)}) with ${formatMinor(remaining, destCurrency)} headroom and solid essential data.`;
    }
  }

  // --- low-confidence + lifestyle warnings ---------------------------------------
  for (const l of categories) {
    if (l.confidence === "low" && l.category !== "contingency") {
      warnings.push(`Low-confidence figure used for ${l.label}: "${l.sourceTitle}". Treat as a rough band.`);
    }
  }
  if (inputs.cookingHabit || inputs.transportPreference) {
    assumptions.push({
      tag: "lifestyle",
      text: `Lifestyle preferences recorded (cookingHabit: ${inputs.cookingHabit ?? "not set"}, transportPreference: ${inputs.transportPreference ?? "not set"}). The published dataset does not quantify separate prices for these preferences, so they do not change the total unless an explicit category override is supplied.`,
    });
  }
  if (inputs.insuranceCovered === false) {
    warnings.push(
      "You indicated insurance is not already covered. Health-insurance costs are missing or unpriced in several profiles — confirm mandatory cover (e.g. OSHC, statutory student insurance) separately.",
    );
  }
  warnings.push(...sourceWarnings(profile));

  // --- sources ---------------------------------------------------------------------
  const seenUrls = new Set<string>();
  const sources: PlanSource[] = [];
  for (const l of categories) {
    if (l.valueKind === "assumption" || seenUrls.has(l.sourceUrl)) continue;
    seenUrls.add(l.sourceUrl);
    sources.push({
      title: l.sourceTitle,
      url: l.sourceUrl,
      publishedDate: null,
      checkedDate: "",
      scope: profile.geographicScope,
    });
  }
  // fill real dates from entries
  const urlToMeta = new Map<string, { publishedDate: string | null; checkedDate: string }>();
  for (const c of profile.categories) {
    if (c.sourceUrl && !urlToMeta.has(c.sourceUrl)) {
      urlToMeta.set(c.sourceUrl, {
        publishedDate: c.publishedDate ?? null,
        checkedDate: c.checkedDate,
      });
    }
  }
  for (const s of sources) {
    const meta = urlToMeta.get(s.url);
    if (meta) {
      s.publishedDate = meta.publishedDate;
      s.checkedDate = meta.checkedDate;
    }
  }

  // --- top contributors ---------------------------------------------------------------
  const topContributors = categories
    .filter((l) => l.category !== "contingency")
    .sort((a, b) => b.estimateMinor - a.estimateMinor)
    .slice(0, 3)
    .map((l) => ({ category: l.category, label: l.label, estimateMinor: l.estimateMinor }));

  const destinationLabel = profile.city
    ? `${profile.city}, ${profile.country}`
    : profile.country;

  return {
    destinationId: profile.destinationId,
    destinationLabel,
    currency: destCurrency,
    scope: profile.geographicScope,
    city: profile.city ?? null,
    categories,
    monthlyTotals,
    contingencyMinor: contingency,
    oneTime: { items: oneTimeItems, totalMinor: oneTimeTotal },
    budgetMinor,
    budgetCurrencyOriginal: budgetCurrency,
    verdict,
    verdictReason,
    remainingMinor: budgetMinor - typical,
    ...(shortfallMinor !== undefined ? { shortfallMinor } : {}),
    topContributors,
    assumptions,
    missingData,
    sources,
    warnings,
    benchmarkCrossCheck,
    tuition,
    visaRequirementSeparate: {
      amount: profile.visaRequirement.amount,
      period: profile.visaRequirement.period,
      sourceTitle: profile.visaRequirement.sourceTitle,
      sourceUrl: profile.visaRequirement.sourceUrl,
      note: profile.visaRequirement.note,
    },
  };
}

/** Plan returned when the budget cannot be estimated — never invents figures. */
function insufficientDataPlan(
  profile: DestinationProfile,
  inputs: LivingCostPlanInputs,
  opts: { reason: string },
): LivingCostPlan {
  const missingData: MissingDatum[] = [];
  for (const c of profile.categories) {
    if (c.valueKind !== "missing" || EXCLUDED_FROM_TOTALS.has(c.category)) continue;
    missingData.push({
      category: c.category,
      label: labelOf(c.category),
      reason: isBundledNote(c.limitations) ? "bundled" : "no_data",
      note: c.limitations ?? "No sourced figure available.",
    });
  }
  return {
    destinationId: profile.destinationId,
    destinationLabel: profile.city ? `${profile.city}, ${profile.country}` : profile.country,
    currency: profile.currency,
    scope: profile.geographicScope,
    city: profile.city ?? null,
    categories: [],
    monthlyTotals: { lowMinor: 0, typicalMinor: 0, highMinor: 0 },
    contingencyMinor: { lowMinor: 0, typicalMinor: 0, highMinor: 0 },
    oneTime: {
      items: profile.oneTimeCosts.map((o) => ({
        label: o.label,
        minMinor: o.minMinor,
        estimateMinor: o.estimateMinor,
        maxMinor: o.maxMinor,
        sourceTitle: o.sourceTitle,
        sourceUrl: o.sourceUrl,
        valueKind: o.valueKind,
      })),
      totalMinor: profile.oneTimeCosts.reduce((a, o) => a + o.estimateMinor, 0),
    },
    // In an insufficient-data result this field is interpreted as destination-currency
    // minor units. Keep it zero when the original amount could not be converted.
    budgetMinor: inputs.budgetCurrency === profile.currency ? inputs.monthlyBudgetMinor : 0,
    budgetCurrencyOriginal: inputs.budgetCurrency,
    verdict: "insufficient_data",
    verdictReason: opts.reason,
    remainingMinor: 0,
    topContributors: [],
    assumptions: [
      {
        tag: "insufficient_data",
        text: "No category estimates were produced — totals would be guesses, so none are given.",
      },
    ],
    missingData,
    sources: [],
    warnings: [opts.reason, ...sourceWarnings(profile)],
    benchmarkCrossCheck: null,
    tuition: {
      included: false,
      amountMinor: null,
      currency: null,
      note: "Tuition EXCLUDED from this plan (plan has insufficient data for living costs).",
    },
    visaRequirementSeparate: {
      amount: profile.visaRequirement.amount,
      period: profile.visaRequirement.period,
      sourceTitle: profile.visaRequirement.sourceTitle,
      sourceUrl: profile.visaRequirement.sourceUrl,
      note: profile.visaRequirement.note,
    },
  };
}

/** All destination ids, for UIs and the future build_living_cost_plan tool. */
export function listDestinations(): { id: string; label: string; currency: string }[] {
  return DESTINATIONS.map((d) => ({
    id: d.destinationId,
    label: d.city ? `${d.city}, ${d.country}` : d.country,
    currency: d.currency,
  }));
}
