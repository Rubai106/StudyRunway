/**
 * Destination Budget Planner — public API for the next phases.
 *
 * Next phase (tool registration) needs:
 *  - buildLivingCostPlan(inputs)          -> LivingCostPlan (engine.ts)
 *  - LivingCostPlanInputsSchema           -> zod schema for the tool's parameters
 *  - listDestinations()                   -> destination picker options
 *  - buildRecommendations(plan, profile, inputs) -> CostRecommendation[]
 *  - planToObligations(plan, {startDate, studyMonths}) -> PlanConversion
 *  - describePlanRevert(obligations)      -> pure revert description
 */

export {
  validateDataset,
  getDestination,
  DESTINATIONS,
  type CostEntry,
  type OneTimeCost,
  type VisaRequirement,
  type DestinationProfile,
  type ValueKindLabel,
  type ConfidenceLabel,
} from "./dataset";

export {
  LivingCostPlanInputsSchema,
  buildLivingCostPlan,
  buildLivingCostPlanFromProfile,
  listDestinations,
  sourceWarnings,
  isBundledNote,
  ESSENTIAL_CATEGORIES,
  CATEGORY_LABELS,
  type LivingCostPlanInputs,
  type LivingCostPlan,
  type PlanCategoryLine,
  type OneTimeItem,
  type PlanAssumption,
  type MissingDatum,
  type PlanSource,
  type PlanVerdict,
  type BenchmarkCrossCheck,
} from "./engine";

export {
  buildRecommendations,
  type CostRecommendation,
  type RecommendationResult,
} from "./recommendations";

export {
  PlanToObligationsOptionsSchema,
  planToObligations,
  describePlanRevert,
  classifyOneTimeKind,
  type PlanToObligationsOptions,
  type PlanConversion,
  type PlanRevertDescription,
} from "./toObligations";
