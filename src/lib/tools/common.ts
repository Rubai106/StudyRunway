/**
 * Shared helpers for the financial tools (src/lib/tools/**).
 *
 * - ToolPlanSchema: the "plan object" parameter every plan-consuming tool
 *   accepts. Funding sources and obligations reuse the zod schemas from
 *   src/lib/model.ts; the extra fields (planningCurrency, asOfDate, fx,
 *   evidence, quotes) are what the deterministic engine needs to compute
 *   without inventing anything.
 * - assemblePlanState: builds a full PlanState for the engine from the
 *   tool input. `.passthrough()` lets callers hand over a whole PlanState.
 * - withToolTimeout: 15s internal timeout discipline for every handler.
 */

import { z } from "zod";
import { isSupportedCurrency } from "../currency";
import {
  EvidenceFactSchema,
  FundingSourceSchema,
  FxTableSchema,
  ISO_DATE,
  ObligationSchema,
  PlanState,
  TransferQuoteSchema,
} from "../model";

export const currencyCodeSchema = z
  .string()
  .length(3)
  .transform((s) => s.toUpperCase())
  .refine(isSupportedCurrency, "Unsupported currency code");

/**
 * Plan subset accepted by the tools. The agent core passes the session's
 * plan; only the listed fields are used, everything else passes through
 * ignored.
 */
export const ToolPlanSchema = z
  .object({
    fundingSources: z.array(FundingSourceSchema),
    obligations: z.array(ObligationSchema),
    planningCurrency: currencyCodeSchema.describe("Planning currency (ISO code), e.g. GBP"),
    asOfDate: ISO_DATE.nullable()
      .default(null)
      .describe('Override for "today" (YYYY-MM-DD). Null = the real current date.'),
    fx: FxTableSchema.describe("Exchange-rate assumptions table"),
    evidence: z.array(EvidenceFactSchema).default([]),
    quotes: z.array(TransferQuoteSchema).default([]),
  })
  .passthrough();

export type ToolPlanInput = z.infer<typeof ToolPlanSchema>;

/** Assemble a full PlanState the deterministic engine can run on. */
export function assemblePlanState(input: ToolPlanInput): PlanState {
  return {
    version: 1,
    profile: {
      studentName: "",
      homeCountry: "Not specified",
      destinationCountry: "Not specified",
      homeCurrency: input.planningCurrency,
      planningCurrency: input.planningCurrency,
      asOfDate: input.asOfDate,
    },
    fundingSources: input.fundingSources,
    obligations: input.obligations,
    evidence: input.evidence,
    quotes: input.quotes,
    scenarios: [],
    fx: input.fx,
    updatedAt: new Date().toISOString(),
  };
}

/** Internal timeout discipline: no tool handler may run longer than this. */
export const TOOL_TIMEOUT_MS = 15_000;

/** Wrap a handler body so it rejects if it exceeds the tool timeout. */
export async function withToolTimeout<T>(label: string, fn: () => T | Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(fn),
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label}: exceeded the ${TOOL_TIMEOUT_MS / 1000}s tool timeout`)),
          TOOL_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Build an ok:false ToolResult for parameter validation failures. */
export function invalidParams(toolName: string, issues: string): {
  ok: false;
  summary: string;
} {
  return {
    ok: false,
    summary: `${toolName}: invalid parameters — ${issues}`,
  };
}

/** Flatten a zod error into one readable line. */
export function zodIssues(error: z.ZodError): string {
  return error.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}
