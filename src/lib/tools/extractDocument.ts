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
import { candidatesFromText } from "../extract";
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

/**
 * Instruction-like phrases that indicate a prompt-injection attempt when
 * they appear inside untrusted document text. Matched against the raw text
 * before any extraction runs.
 */
const INJECTION_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "ignore-instructions", re: /ignore\s+(all\s+|the\s+|these\s+|your\s+)?(previous|prior|above)\s+instructions?/i },
  { name: "disregard-instructions", re: /disregard\s+(all\s+|the\s+|your\s+)?instructions?/i },
  { name: "send-money", re: /\bsend\s+(money|funds|cash|payment|payments)\b/i },
  { name: "transfer-money", re: /\btransfer\s+(money|funds|cash)\s+to\b/i },
  { name: "wire-money", re: /\bwire\s+(money|funds|cash)\b/i },
  { name: "role-override", re: /you\s+are\s+now\b/i },
  { name: "act-as", re: /\bact\s+as\s+(an?\s+)?(assistant|ai|system|admin|root)\b/i },
  { name: "jailbreak", re: /\bjailbreak\b/i },
  { name: "system-prompt", re: /\bsystem\s+prompt\b/i },
  { name: "reveal-instructions", re: /reveal\s+your\s+(system\s+)?(prompt|instructions)/i },
  { name: "forget-instructions", re: /forget\s+(everything|all)\s+(you\s+know|previous|prior)/i },
  { name: "do-not-follow", re: /\bdo\s+not\s+(follow|obey)\s+(your\s+)?(instructions|rules|guidelines)/i },
];

function scanForInjection(text: string): string[] {
  return INJECTION_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.name);
}

export const extractDocumentTool: ToolDefinition = {
  name: "extract_document",
  description:
    "Extract financial facts (amounts, currencies, dates, deadlines) from untrusted document text using the " +
    "engine's heuristic candidate extractor. The text is screened for prompt-injection phrases first — if any " +
    "are found, nothing is extracted. Every candidate carries a confidence level and a needsConfirmation flag; " +
    "nothing is auto-accepted into the plan.",
  parameters: ExtractDocumentParams,
  requiresApproval: false,
  handler: async (args, ctx) =>
    withToolTimeout("extract_document", (): ToolResult => {
      const parsed = ExtractDocumentParams.safeParse(args);
      if (!parsed.success) {
        return { ok: false, summary: `extract_document: invalid parameters — ${zodIssues(parsed.error)}` };
      }
      const { text, documentKind } = parsed.data;

      // UNTRUSTED input: screen for embedded instructions before extracting.
      const probes = scanForInjection(text);
      void ctx;
      if (probes.length > 0) {
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
        const ambiguous = (c.kind === "amount" && amountCount > 1) || (c.kind === "date" && dateCount > 1);
        return {
          label: c.label,
          kind: c.kind,
          valueText: c.valueText,
          amountMinor: c.amountMinor,
          currency: c.currency,
          dateValue: c.dateValue,
          confidence: c.confidence,
          needsConfirmation: c.confidence !== "high" || ambiguous,
        };
      });

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
