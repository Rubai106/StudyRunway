/**
 * research_policy — HONEST STUB.
 *
 * There is no live web-search integration in this build, so this tool can
 * never return a real policy, deadline, or citation. It always returns
 * ok:true with answer:null, a note telling the user to verify directly
 * with the authoritative body, and a fixed list of generic source
 * categories. It must NEVER fabricate a policy, deadline, or citation —
 * fabricating one would be worse than returning nothing.
 */

import { z } from "zod";
import { withToolTimeout, zodIssues } from "./common";
import type { ToolDefinition, ToolResult } from "./types";

export const ResearchPolicyParams = z.object({
  query: z
    .string()
    .min(1, "query must not be empty")
    .max(500, "query is too long (max 500 characters)")
    .describe("The policy question, e.g. 'What is the tuition refund deadline?'"),
  topic: z
    .string()
    .max(80, "topic is too long (max 80 characters)")
    .default("")
    .describe("Topic area, e.g. 'tuition', 'visa', 'scholarship'"),
});

const STUB_NOTE =
  "Live policy research is not connected in this build — verify directly with the university/scholarship body";

/** Generic, non-fabricated source categories. Nothing here is a real citation. */
const SUGGESTED_SOURCES = [
  "The university's official admissions or finance pages (the offer letter names the authoritative source)",
  "The scholarship awarding body's official guidance",
  "The relevant immigration authority's official guidance (for visa questions)",
  "The university's international student office",
] as const;

export const researchPolicyTool: ToolDefinition = {
  name: "research_policy",
  description:
    "Look up an official policy (tuition rules, scholarship terms, visa guidance). HONEST STUB: no live " +
    "web-search integration exists in this build, so this tool always returns answer:null with a note to " +
    "verify directly with the authoritative body. It never fabricates a policy, deadline, or citation.",
  parameters: ResearchPolicyParams,
  requiresApproval: false,
  handler: async (args, ctx) =>
    withToolTimeout("research_policy", (): ToolResult => {
      const parsed = ResearchPolicyParams.safeParse(args);
      if (!parsed.success) {
        return { ok: false, summary: `research_policy: invalid parameters — ${zodIssues(parsed.error)}` };
      }
      void ctx;
      const { query, topic } = parsed.data;
      return {
        ok: true,
        summary:
          `Could not look up "${query.slice(0, 80)}${query.length > 80 ? "…" : ""}" — ${STUB_NOTE}. ` +
          "No policy, deadline, or citation was retrieved or invented.",
        data: {
          answer: null,
          note: STUB_NOTE,
          query,
          topic: topic || null,
          suggestedSources: [...SUGGESTED_SOURCES],
        },
        evidence: [{
          label: "unverified — user must confirm",
          detail:
            "No live web search in this build. Nothing was retrieved; nothing was invented. " +
            "Check the suggested official sources directly.",
        }],
      };
    }),
};
