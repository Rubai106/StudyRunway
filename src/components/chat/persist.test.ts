import { describe, expect, it } from "vitest";
import { filterPersistableResults, textForTranscriptStorage } from "./persist";

describe("transcript privacy", () => {
  it("does not persist unconfirmed document-review candidates", () => {
    const results = filterPersistableResults([
      { component: "document_review", data: { fields: [{ valueText: "£9,500", sourceSnippet: "private excerpt" }] } },
      { component: "financial_outcome", data: { shortfallMinor: 950_000 } },
    ]);
    expect(results).toEqual([{ component: "financial_outcome", data: { shortfallMinor: 950_000 } }]);
    expect(JSON.stringify(results)).not.toContain("private excerpt");
    expect(textForTranscriptStorage("The amount is £9,500.00", [
      { component: "document_review", data: { amount: "£9,500.00" } },
    ])).not.toContain("£9,500.00");
  });
});
