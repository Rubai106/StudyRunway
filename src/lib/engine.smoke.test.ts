/**
 * Smoke test: the deterministic financial engine copied from the previous
 * build works inside this project. The full 12-scenario evaluation suite
 * is built in a later workstream.
 */
import { describe, expect, it } from "vitest";
import { buildForecast } from "./forecast";
import { buildSamplePlan } from "./sample";
import { toMinor, convertMinor } from "./money";

describe("copied engine smoke test", () => {
  it("builds a forecast from the sample plan without inventing data", () => {
    const state = buildSamplePlan();
    const f = buildForecast(state);
    expect(f.planningCurrency).toBe(state.profile.planningCurrency);
    expect(Number.isInteger(f.openingMinor)).toBe(true);
    expect(f.assumptionsUsed.length).toBeGreaterThan(0);
    for (const row of f.rows) {
      expect(Number.isInteger(row.amountMinor)).toBe(true);
      expect(Number.isInteger(row.balanceAfterMinor)).toBe(true);
    }
  });

  it("converts low-valued currencies using fractional major-unit FX rates safely", () => {
    // BDT 10,000 at EUR 0.008 per BDT equals EUR 80.00.
    expect(convertMinor(1_000_000, "BDT", "EUR", 0.008)).toBe(8_000);
    expect(() => convertMinor(Number.MAX_SAFE_INTEGER, "BDT", "EUR", 1e10)).toThrow(/safe integer range/i);
  });

  it("keeps all stored amounts in integer minor units", () => {
    expect(toMinor(12.34, "GBP")).toBe(1234);
    expect(toMinor(100, "JPY")).toBe(100);
    expect(convertMinor(100_00, "GBP", "GBP", 0.5)).toBe(100_00);
    expect(() => toMinor(NaN, "GBP")).toThrow();
  });
});
