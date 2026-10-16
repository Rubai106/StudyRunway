/**
 * Tests for the cost-dataset loader (src/lib/livingCosts/dataset.ts).
 *
 * Areas: (1) every destination profile loads valid, (2) source metadata
 * present, (3) invalid/incomplete profile data rejected.
 */
import { describe, expect, it } from "vitest";
import {
  DESTINATIONS,
  getDestination,
  validateDataset,
  type DestinationProfile,
} from "../dataset";

function baseEntry(overrides: Record<string, unknown> = {}) {
  return {
    category: "rent",
    minMinor: 50000,
    estimateMinor: 60000,
    maxMinor: 70000,
    estimateMethod: "midpoint of stated range",
    sourceTitle: "Test Source",
    sourceUrl: "https://example.com/costs",
    publishedDate: null,
    checkedDate: "2026-10-15",
    valueKind: "official_estimate",
    confidence: "medium",
    limitations: "Test limitations.",
    ...overrides,
  };
}

function baseProfile(overrides: Record<string, unknown> = {}): DestinationProfile {
  return {
    destinationId: "xx-test",
    country: "Testland",
    city: null,
    currency: "EUR",
    geographicScope: "country",
    checkedDate: "2026-10-15",
    categories: [baseEntry()],
    oneTimeCosts: [],
    visaRequirement: {
      amount: 1000000,
      period: "year",
      sourceTitle: "Test Visa Source",
      sourceUrl: "https://example.com/visa",
      publishedDate: null,
      checkedDate: "2026-10-15",
      note: "Regulatory minimum, NOT a typical-cost estimate.",
    },
    ...overrides,
  } as DestinationProfile;
}

describe("dataset loading", () => {
  it("(1) loads all six destination profiles, valid", () => {
    expect(DESTINATIONS).toHaveLength(6);
    const ids = DESTINATIONS.map((d) => d.destinationId).sort();
    expect(ids).toEqual([
      "au-australia",
      "ca-canada",
      "de-germany",
      "dk-denmark",
      "ie-limerick",
      "uk-united-kingdom",
    ]);
    for (const d of DESTINATIONS) {
      expect(["city", "country"]).toContain(d.geographicScope);
      expect(d.currency).toMatch(/^[A-Z]{3}$/);
      expect(d.categories.length).toBeGreaterThan(0);
    }
    // Ireland is city-scoped to Limerick; the rest are country-scoped
    expect(getDestination("ie-limerick").geographicScope).toBe("city");
    expect(getDestination("de-germany").geographicScope).toBe("country");
  });

  it("(2) every sourced entry carries source metadata with a valid URL and dates", () => {
    for (const d of DESTINATIONS) {
      for (const c of d.categories) {
        if (c.valueKind === "missing") {
          // missing entries must explain the gap instead of citing a source
          expect(c.minMinor ?? null).toBeNull();
          expect(c.sourceUrl ?? null).toBeNull();
          expect(c.limitations).toBeTruthy();
          continue;
        }
        expect(c.sourceTitle, `${d.destinationId}/${c.category}`).toBeTruthy();
        expect(c.sourceUrl, `${d.destinationId}/${c.category}`).toMatch(/^https?:\/\//);
        expect(c.checkedDate, `${d.destinationId}/${c.category}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(c.minMinor).toBeGreaterThanOrEqual(0);
        expect(c.minMinor!).toBeLessThanOrEqual(c.estimateMinor!);
        expect(c.estimateMinor!).toBeLessThanOrEqual(c.maxMinor!);
      }
      for (const o of d.oneTimeCosts) {
        expect(o.sourceUrl).toMatch(/^https?:\/\//);
        expect(o.label).toBeTruthy();
      }
      expect(d.visaRequirement.sourceUrl).toMatch(/^https?:\/\//);
      expect(d.visaRequirement.note).toBeTruthy();
    }
  });

  it("(2b) regulatory figures never appear in monthly categories", () => {
    for (const d of DESTINATIONS) {
      for (const c of d.categories) {
        expect(
          c.valueKind,
          `${d.destinationId}/${c.category} must not be regulatory`,
        ).not.toBe("regulatory");
      }
    }
  });
});

describe("dataset validation rejects bad data", () => {
  it("(3) rejects min > estimate, negative costs, bad currency, bad scope", () => {
    expect(() =>
      validateDataset({ destinations: [baseProfile({ categories: [baseEntry({ minMinor: 80000 })] })] }),
    ).toThrow(/minMinor.*> estimateMinor/);

    expect(() =>
      validateDataset({ destinations: [baseProfile({ categories: [baseEntry({ minMinor: -5 })] })] }),
    ).toThrow(/negative/i);

    expect(() =>
      validateDataset({ destinations: [baseProfile({ currency: "EURO" })] }),
    ).toThrow(/currency/i);

    expect(() =>
      validateDataset({
        destinations: [baseProfile({ geographicScope: "planet" })],
      }),
    ).toThrow();
  });

  it("(3b) rejects regulatory entries in monthly categories", () => {
    expect(() =>
      validateDataset({
        destinations: [
          baseProfile({ categories: [baseEntry({ valueKind: "regulatory" })] }),
        ],
      }),
    ).toThrow(/regulatory/);
  });

  it("(3c) rejects sourced entries missing sourceUrl/sourceTitle", () => {
    expect(() =>
      validateDataset({
        destinations: [baseProfile({ categories: [baseEntry({ sourceUrl: null })] })],
      }),
    ).toThrow(/sourceUrl/);
  });

  it("(3d) rejects missing entries that carry numbers or sources", () => {
    expect(() =>
      validateDataset({
        destinations: [
          baseProfile({
            categories: [
              {
                category: "eating_out",
                checkedDate: "2026-10-15",
                confidence: "none",
                limitations: "No data.",
                valueKind: "missing",
                estimateMinor: 1000,
              },
            ],
          }),
        ],
      }),
    ).toThrow(/must not carry numbers/);
  });

  it("(3e) rejects duplicate destinationIds and invalid dates", () => {
    expect(() =>
      validateDataset({ destinations: [baseProfile(), baseProfile()] }),
    ).toThrow(/duplicate destinationId/);
    expect(() =>
      validateDataset({
        destinations: [baseProfile({ checkedDate: "2026-13-40" })],
      }),
    ).toThrow(/calendar date/);
  });

  it("(3f) the error message lists the bad entry's path", () => {
    let message = "";
    try {
      validateDataset({
        destinations: [
          baseProfile({
            destinationId: "xx-broken",
            categories: [baseEntry({ maxMinor: 100 })],
          }),
        ],
      });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("xx-broken");
    expect(message).toContain("estimateMinor");
  });
});
