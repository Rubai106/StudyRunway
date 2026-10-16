/**
 * Currency formatting tests: formatMinor() must reject fractional minor-unit
 * amounts, consistent with toMajor() (which throws via assertMinorInteger).
 * The engine only ever passes integers, so this is a fail-fast guard against
 * upstream bugs silently rendering rounded figures.
 */
import { describe, expect, it } from "vitest";
import { formatMinor, assertMinorInteger } from "./currency";
import { assertMinorInteger as assertFromMoney } from "./money";

describe("assertMinorInteger", () => {
  it("accepts integers and rejects fractional amounts", () => {
    expect(() => assertMinorInteger(1050)).not.toThrow();
    expect(() => assertMinorInteger(0)).not.toThrow();
    expect(() => assertMinorInteger(-5)).not.toThrow();
    expect(() => assertMinorInteger(1050.5)).toThrow(/integer number of minor units/);
  });

  it("is re-exported from money.ts for compatibility", () => {
    expect(assertFromMoney).toBe(assertMinorInteger);
    expect(() => assertFromMoney(1.5)).toThrow(/integer number of minor units/);
  });
});

describe("formatMinor", () => {
  it("formats integer minor amounts", () => {
    expect(formatMinor(123456, "GBP")).toBe("£1,234.56");
    expect(formatMinor(1050, "EUR")).toBe("€10.50");
  });

  it("throws on non-integer minor units instead of silently rounding", () => {
    // Before the fix this silently rendered €10.51; toMajor() already threw.
    expect(() => formatMinor(1050.5, "EUR")).toThrow(/integer number of minor units/);
    expect(() => formatMinor(NaN, "EUR")).toThrow();
  });
});
