/**
 * Destination Budget Planner — deterministic recommendation layer (PART E).
 *
 * buildRecommendations() compares sourced alternatives already present in the
 * dataset (accommodation types, transport figures) against the accepted plan
 * and quantifies the monthly/one-time impact of switching. It is fully
 * deterministic: no LLM, no invented prices.
 *
 * SAFETY RULES (enforced, documented in docs/DESTINATION_BUDGET_SPEC.md):
 *  - NEVER recommend skipping meals, foregoing required insurance, unsafe
 *    accommodation, reckless borrowing, or illegal work.
 *  - NEVER present "reduce everything to minimum" as optimal — the low
 *    scenario is a planning band, not a recommendation.
 *  - protectedEssentials (user-named categories) are never targeted for cuts.
 *  - Suggestions whose source limitations flag safety/legality concerns are
 *    suppressed; every accommodation suggestion carries a verify-safety
 *    tradeoff note.
 */

import type { DestinationProfile } from "./dataset";
import { CATEGORY_LABELS, type LivingCostPlan, type LivingCostPlanInputs } from "./engine";

export interface CostRecommendation {
  /** Human-readable description of the change. */
  change: string;
  /**
   * Monthly or one-time impact in destination minor units.
   * Negative = saves money. null = cannot be quantified from the dataset
   * (never guessed).
   */
  impactMinor: number | null;
  impactKind: "monthly" | "one_time";
  /** What the quantified impact is supported by (source or assumption). */
  supportsBy: string;
  /** The honest downside — always present. */
  tradeoff: string;
}

export interface RecommendationResult {
  recommendations: CostRecommendation[];
  /** Informational notes that are NOT recommendations (unquantifiable). */
  notes: string[];
}

/** Banned suggestion content — defense in depth (we never generate these). */
const BANNED = /skip(ping)?\s+(meals|food)|forego(ing)?\s+.*insurance|drop\s+.*insurance|borrow|loan\s+shark|illegal\s+work|unsafe/i;

function isBanned(text: string): boolean {
  return BANNED.test(text);
}

function shortLimitations(limitations: string | null | undefined, max = 140): string {
  const t = (limitations ?? "").trim();
  if (!t) return "Check the source for caveats.";
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * Ranked, safety-filtered suggestions for the given plan.
 *
 * @param plan    accepted living-cost plan
 * @param profile the destination profile the plan was built from
 * @param inputs  the original plan inputs (for protectedEssentials)
 */
export function buildRecommendations(
  plan: LivingCostPlan,
  profile: DestinationProfile,
  inputs: Pick<LivingCostPlanInputs, "protectedEssentials" | "cookingHabit">,
): RecommendationResult {
  const recommendations: CostRecommendation[] = [];
  const notes: string[] = [];
  const protectedSet = new Set(
    (inputs.protectedEssentials ?? []).map((s) => s.toLowerCase()),
  );

  const currentRent = plan.categories.find((l) => l.category === "rent");

  // --- accommodation alternatives -------------------------------------------
  if (currentRent && !protectedSet.has("rent")) {
    const rentOptions = profile.categories
      .filter((c) => c.category === "rent" && c.valueKind !== "missing")
      .sort((a, b) => (a.estimateMinor as number) - (b.estimateMinor as number));
    for (const opt of rentOptions) {
      if (opt.accommodationType === currentRent.accommodationType) continue;
      if (isBanned(opt.limitations ?? "") || isBanned(opt.accommodationType ?? "")) continue;
      const impact = (opt.estimateMinor as number) - currentRent.estimateMinor;
      const change =
        impact < 0
          ? `Switch accommodation to "${opt.accommodationType}" instead of "${currentRent.accommodationType}"`
          : `Consider "${opt.accommodationType}" (costs more than current choice)`;
      recommendations.push({
        change,
        impactMinor: impact,
        impactKind: "monthly",
        supportsBy: `Sourced figure: ${opt.sourceTitle} — ${opt.sourceUrl}`,
        tradeoff:
          `Verify safety, legality and commute before committing. Source caveat: ` +
          shortLimitations(opt.limitations),
      });
    }
  } else if (protectedSet.has("rent")) {
    notes.push("Rent is in your protected essentials, so no accommodation switches are suggested.");
  }

  // --- transport alternatives -------------------------------------------------
  if (!protectedSet.has("local_transport")) {
    const current = plan.categories.find((l) => l.category === "local_transport");
    const options = profile.categories
      .filter((c) => c.category === "local_transport" && c.valueKind !== "missing")
      .sort((a, b) => (a.estimateMinor as number) - (b.estimateMinor as number));
    if (current) {
      for (const opt of options) {
        const impact = (opt.estimateMinor as number) - current.estimateMinor;
        if (impact === 0) continue;
        if (isBanned(opt.limitations ?? "")) continue;
        recommendations.push({
          change:
            impact < 0
              ? `Switch transport to the cheaper sourced option ("${shortLimitations(opt.sourceTitle, 80)}")`
              : `Note: a pricier sourced transport figure exists ("${shortLimitations(opt.sourceTitle, 80)}")`,
          impactMinor: impact,
          impactKind: "monthly",
          supportsBy: `Sourced figure: ${opt.sourceTitle} — ${opt.sourceUrl}`,
          tradeoff: `Source caveat: ${shortLimitations(opt.limitations)}`,
        });
      }
    }
  }

  // --- cooking habit: no dataset split — note only, never a number ------------
  const foodLine = plan.categories.find(
    (l) => l.category === "groceries" || l.category === "groceries_eating_out",
  );
  if (foodLine) {
    notes.push(
      `Cooking at home usually costs less than eating out, but the dataset has no price split ` +
        `for cooking habits (cookingHabit: ${inputs.cookingHabit ?? "not set"}), so no saving is quantified here. ` +
        `Meal-skipping is never recommended.`,
    );
  }

  // --- insurance: never suggest dropping --------------------------------------
  notes.push(
    "Required insurance (health/visa-mandated cover) is never a suggested cut. " +
      "If cover is missing from your plan, price it separately before you travel.",
  );

  // --- the low scenario is a band, not a target --------------------------------
  notes.push(
    "The plan's low scenario is a planning band, not a target — cutting every category to its " +
      "minimum is not presented as optimal and is not recommended.",
  );

  // --- rank: biggest monthly saving first, then one-time -----------------------
  const monthly = recommendations
    .filter((r) => r.impactKind === "monthly")
    .sort((a, b) => (a.impactMinor ?? 0) - (b.impactMinor ?? 0));
  const oneTime = recommendations
    .filter((r) => r.impactKind === "one_time")
    .sort((a, b) => (a.impactMinor ?? 0) - (b.impactMinor ?? 0));

  return { recommendations: [...monthly, ...oneTime].slice(0, 5), notes };
}

/** Category display labels, re-exported for the later UI phase. */
export { CATEGORY_LABELS };
