/**
 * draft_email — draft (never send) an email.
 *
 * requiresApproval: true. Drafting is fine; sending is NOT implemented and
 * the tool never performs any side effect. The returned draft is editable
 * and the summary always states "Draft only — not sent".
 */

import { z } from "zod";
import { withToolTimeout, zodIssues } from "./common";
import type { ToolDefinition, ToolResult } from "./types";

export const DraftEmailParams = z.object({
  recipient: z
    .string()
    .email("recipient must be a valid email address")
    .describe("Recipient email address"),
  subject: z
    .string()
    .min(1, "subject must not be empty")
    .max(200, "subject is too long (max 200 characters)")
    .describe("Email subject line"),
  body: z
    .string()
    .min(1, "body must not be empty")
    .max(10_000, "body is too long (max 10,000 characters)")
    .describe("Email body (plain text)"),
  context: z
    .string()
    .max(1000, "context is too long (max 1,000 characters)")
    .default("")
    .describe("Why this draft exists, e.g. 'follow up on scholarship decision'"),
});

export const draftEmailTool: ToolDefinition = {
  name: "draft_email",
  description:
    "Draft an email for the user to review and send themselves. Draft only — sending is not implemented " +
    "and this tool performs no side effects. Requires user approval before the agent may call it.",
  parameters: DraftEmailParams,
  requiresApproval: true,
  handler: async (args, ctx) =>
    withToolTimeout("draft_email", (): ToolResult => {
      const parsed = DraftEmailParams.safeParse(args);
      if (!parsed.success) {
        return { ok: false, summary: `draft_email: invalid parameters — ${zodIssues(parsed.error)}` };
      }
      const { recipient, subject, body, context } = parsed.data;
      void ctx;
      return {
        ok: true,
        summary: `Draft only — not sent. Email draft prepared for ${recipient} ("${subject}"). No message was sent; sending is not implemented.`,
        data: {
          to: recipient,
          subject,
          body,
          context: context || null,
          status: "draft",
          sent: false,
        },
        evidence: [{
          label: "No side effects",
          detail: "draft_email returns an editable draft. It cannot send email; requiresApproval=true means the agent must get user approval even to draft.",
        }],
      };
    }),
};
