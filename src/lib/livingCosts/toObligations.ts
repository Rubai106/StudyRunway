/**
 * Destination Budget Planner — plan → obligations conversion (PART E).
 *
 * planToObligations() converts an ACCEPTED typical living-cost plan into
 * ObligationSchema-compatible records (lib/model.ts) so the funding-gap
 * forecast can consume them. Every obligation carries source attribution in
 * its notes plus the explicit marker "estimated budget item, not a
 * committed bill".
 *
 * Tuition is EXCLUDED unless the plan was built with includeTuition=true —
 * and when excluded, the returned tuitionNote says so prominently. One-time
 * costs and tuition require their own dates; they are never silently scheduled
 * on the plan start/arrival date.
 */

import { z } from "zod";
import { ObligationSchema, type Obligation } from "@/lib/model";
import type { LivingCostPlan, PlanCategoryLine, OneTimeItem } from "./engine";

const ValidDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
  .refine((d) => {
    const [y, m, day] = d.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, day));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === day;
  }, "Date is not a real calendar date");

export const PlanToObligationsOptionsSchema = z.object({
  /** First due date (YYYY-MM-DD); first occurrence for monthly recurring costs. */
  startDate: ValidDate,
  studyMonths: z.number().int().min(1).max(60),
  /** Individual, user-confirmed due dates indexed by the plan.oneTime.items order. */
  oneTimeDueDates: z.record(z.string(), ValidDate).default({}),
  /** Tuition due date is separate because it is a different obligation. */
  tuitionDueDate: ValidDate.optional(),
});

export type PlanToObligationsOptions = z.infer<typeof PlanToObligationsOptionsSchema>;

export interface PlanConversion {
  obligations: Obligation[];
  tuitionIncluded: boolean;
  /** Prominent statement about tuition handling — never silent. */
  tuitionNote: string;
  /** One-time costs without confirmed user-entered due dates remain incomplete in the forecast. */
  undatedOneTimeLabels: string[];
  tuitionDueDateMissing: boolean;
}

const ESTIMATED_MARKER = "Estimated budget item, not a committed bill.";

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function monthlyNotes(line: PlanCategoryLine): string {
  const src = `${line.sourceTitle} — ${line.sourceUrl}`;
  return truncate(
    `${ESTIMATED_MARKER} Typical monthly ${line.label.toLowerCase()} for ${line.accommodationType ? `"${line.accommodationType}" ` : ""}(${line.estimateMethod}). Source: ${src}`,
    500,
  );
}

function oneTimeNotes(item: OneTimeItem): string {
  return truncate(
    `${ESTIMATED_MARKER} One-time cost. Source: ${item.sourceTitle} — ${item.sourceUrl}`,
    500,
  );
}

/** Classify a one-time item into an ObligationSchema kind. */
export function classifyOneTimeKind(label: string): "visa" | "travel" | "deposit" | "living" {
  const l = label.toLowerCase();
  if (/visa/.test(l)) return "visa";
  if (/deposit/.test(l)) return "deposit";
  if (/bike|bicycle|transport|travel|flight/.test(l)) return "travel";
  return "living";
}

/**
 * Convert an accepted plan into obligations. Pure: no store writes.
 * The actual forecast integration (with explicit user approval) and the
 * store-level revert come in later phases; see describePlanRevert().
 */
export function planToObligations(
  plan: LivingCostPlan,
  rawOptions: unknown,
): PlanConversion {
  const { startDate, studyMonths, oneTimeDueDates, tuitionDueDate } = PlanToObligationsOptionsSchema.parse(rawOptions);

  if (plan.verdict === "insufficient_data") {
    throw new Error(
      "Cannot convert a plan with verdict insufficient_data into obligations — there are no estimates to convert.",
    );
  }

  const obligations: Obligation[] = [];
  const recurring =
    studyMonths >= 2 ? { everyMonths: 1, occurrences: studyMonths } : null;

  for (const line of plan.categories) {
    const kind = line.category === "rent" ? "rent" : "living";
    obligations.push(
      ObligationSchema.parse({
        id: `lcp-${plan.destinationId}-${line.category}`,
        label: `Living costs — ${line.label} (estimated, monthly)`,
        kind,
        amountMinor: line.estimateMinor,
        currency: plan.currency,
        dueDate: startDate,
        recurring,
        status: "planned",
        notes: monthlyNotes(line),
        evidenceIds: [],
      }),
    );
  }

  const undatedOneTimeLabels: string[] = [];
  plan.oneTime.items.forEach((item, i) => {
    const itemDueDate = oneTimeDueDates[String(i)] ?? null;
    if (!itemDueDate) undatedOneTimeLabels.push(item.label);
    obligations.push(
      ObligationSchema.parse({
        id: `lcp-${plan.destinationId}-onetime-${i}`,
        label: `Living costs — ${item.label} (one-time)`,
        kind: classifyOneTimeKind(item.label),
        amountMinor: item.estimateMinor,
        currency: plan.currency,
        // A due date must be supplied for this event to affect the dated forecast.
        dueDate: itemDueDate,
        recurring: null,
        status: "planned",
        notes: truncate(
          `${oneTimeNotes(item)}${itemDueDate ? "" : " Due date not supplied; this item remains incomplete in the forecast until you confirm its date."}`,
          500,
        ),
        evidenceIds: [],
      }),
    );
  });

  // --- tuition: excluded unless explicitly included -----------------------------
  let tuitionIncluded = false;
  let tuitionNote: string;
  let tuitionDueDateMissing = false;
  if (plan.tuition.included && plan.tuition.amountMinor != null && plan.tuition.currency) {
    tuitionIncluded = true;
    obligations.push(
      ObligationSchema.parse({
        id: `lcp-${plan.destinationId}-tuition`,
        label: "Tuition (user-supplied figure)",
        kind: "tuition",
        amountMinor: plan.tuition.amountMinor,
        currency: plan.tuition.currency,
        dueDate: tuitionDueDate ?? null,
        recurring: null,
        status: "planned",
        notes: truncate(
          `${ESTIMATED_MARKER} ${plan.tuition.note}${tuitionDueDate ? "" : " Tuition due date not supplied; this item remains incomplete in the forecast until you confirm its date."}`,
          500,
        ),
        evidenceIds: [],
      }),
    );
    tuitionDueDateMissing = !tuitionDueDate;
    tuitionNote = tuitionDueDate
      ? "TUITION INCLUDED: a tuition obligation was created from the user-supplied figure and confirmed due date."
      : "TUITION INCLUDED, DATE MISSING: the amount is recorded, but the obligation remains incomplete in the dated forecast until you enter its due date.";
  } else {
    tuitionNote =
      "TUITION EXCLUDED: this plan was built without tuition (includeTuition was not set), " +
      "so NO tuition obligation was created. Add tuition separately if it applies — it is usually " +
      "the largest cost and is deliberately never assumed.";
  }

  return { obligations, tuitionIncluded, tuitionNote, undatedOneTimeLabels, tuitionDueDateMissing };
}

export interface PlanRevertDescription {
  /** Obligation ids that removing this plan would delete. */
  obligationIds: string[];
  count: number;
  summary: string;
}

/**
 * Pure revert-semantics helper: describes what accepting-then-reverting a
 * plan would remove. Does NOT touch any store — the store-level revert is a
 * later phase. Pure: input is never mutated.
 */
export function describePlanRevert(obligations: Obligation[]): PlanRevertDescription {
  const ids = obligations.map((o) => o.id);
  return {
    obligationIds: ids,
    count: ids.length,
    summary:
      ids.length === 0
        ? "Reverting this plan removes nothing — it produced no obligations."
        : `Reverting this plan removes ${ids.length} planned obligation(s): ${ids.join(", ")}. ` +
          `Only obligations whose id starts with "lcp-" and whose status is still "planned" are removed; ` +
          `committed or paid items are never touched.`,
  };
}
