/**
 * extract_document — heuristic evidence extraction from document text.
 *
 * Treats the input text as UNTRUSTED: it is scanned for embedded
 * instruction-like phrases (prompt injection probes) BEFORE any extraction.
 * If a probe is found, the tool returns ok:false, extracts nothing, and
 * never follows the embedded instructions.
 *
 * Otherwise it runs the engine's candidatesFromText() heuristics and
 * returns each candidate with confidence and a needsConfirmation flag.
 * Nothing is auto-accepted: ambiguous candidates are flagged for the user.
 */

import { z } from "zod";
import { candidatesFromText, hasDocumentPromptInjection, scanForDocumentInjection } from "../extract";
import { withToolTimeout, zodIssues } from "./common";
import type { ToolDefinition, ToolResult } from "./types";

export const ExtractDocumentParams = z.object({
  text: z
    .string()
    .min(1, "text must not be empty")
    .max(200_000, "text is too long (max 200,000 characters)")
    .describe("The document's text content (already extracted, e.g. from a PDF)"),
  documentKind: z
    .enum(["invoice", "scholarship_letter", "fee_schedule", "other"])
    .describe("What kind of document this is"),
});

export const extractDocumentTool: ToolDefinition = {
  name: "extract_document",
  description:
    "Extract financial facts (amounts, currencies, dates, deadlines) from untrusted document text using the " +
    "engine's heuristic candidate extractor. The text is screened for prompt-injection phrases first — if any " +
    "are found, nothing is extracted. Every candidate carries a confidence level and a needsConfirmation flag; " +
    "nothing is auto-accepted into the plan.",
  parameters: ExtractDocumentParams,
  requiresApproval: false,
  safeToReplayForVerification: true,
  handler: async (args, ctx) =>
    withToolTimeout("extract_document", (): ToolResult => {
      const parsed = ExtractDocumentParams.safeParse(args);
      if (!parsed.success) {
        return { ok: false, summary: `extract_document: invalid parameters — ${zodIssues(parsed.error)}` };
      }
      const { text, documentKind } = parsed.data;

      // UNTRUSTED input: screen for embedded instructions before extracting.
      const probes = scanForDocumentInjection(text);
      void ctx;
      if (hasDocumentPromptInjection(text)) {
        return {
          ok: false,
          summary:
            "Possible prompt injection detected — extracted nothing; ask user to confirm. " +
            `Matched patterns: ${probes.join(", ")}.`,
          data: {
            extracted: false,
            documentKind,
            matchedPatterns: probes,
            fields: [],
          },
          evidence: [{
            label: "Injection screen",
            detail:
              "The document text contained instruction-like phrases, so extraction was refused. " +
              "No figures were extracted and no embedded instruction was followed.",
          }],
        };
      }

      const candidates = candidatesFromText(text);

      // Ambiguity: when several candidates of the same kind appear, each one
      // needs confirmation because we cannot know which is authoritative.
      const amountCount = candidates.filter((c) => c.kind === "amount").length;
      const dateCount = candidates.filter((c) => c.kind === "date").length;

      const fields = candidates.map((c) => {
        return {
          label: c.label,
          kind: c.kind,
          valueText: c.valueText,
          amountMinor: c.amountMinor,
          currency: c.currency,
          dateValue: c.dateValue,
          confidence: c.confidence,
          // The extractor only proposes candidates. Even a high-confidence
          // single match must be explicitly reviewed before use in a forecast.
          needsConfirmation: true,
          page: c.page,
          sourceSnippet: c.sourceSnippet,
        };
      });

      const attachedName = text.match(/I've attached the text of ["“]([^"”\r\n]{1,180})["”]/i)?.[1];

      const needsCount = fields.filter((f) => f.needsConfirmation).length;
      const summary =
        fields.length === 0
          ? "No amounts, dates or deadlines could be extracted from this document. Ask the user to enter the figures manually."
          : `Extracted ${fields.length} candidate(s) (${amountCount} amount(s), ${dateCount} date(s)) from the ${documentKind.replaceAll("_", " ")}. ` +
            `${needsCount} need${needsCount === 1 ? "s" : ""} user confirmation. Nothing was auto-accepted into the plan.`;

      return {
        ok: true,
        summary,
        data: {
          extracted: true,
          source: attachedName ?? "Attached document text",
          documentKind,
          injectionScreen: "passed — no instruction-like phrases detected",
          fields,
          counts: { amounts: amountCount, dates: dateCount, needingConfirmation: needsCount },
        },
        evidence: [{
          label: "Heuristic text extraction",
          detail:
            "candidatesFromText(): pattern-based amount/date candidates only. " +
            "Every candidate must be confirmed or corrected by the user before it enters the forecast.",
        }],
      };
    }),
};
