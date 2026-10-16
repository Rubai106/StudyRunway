/**
 * Integer minor-unit money arithmetic.
 *
 * Every financial value in StudyRunway is stored and computed as an integer
 * count of minor currency units (e.g. pence for GBP, poisha for BDT, yen for
 * JPY). Binary floating point is never used for stored amounts or ledger
 * math; it appears only transiently inside a single conversion, which is
 * rounded back to an integer immediately with an explicit rule.
 *
 * Rounding rule: half away from zero (symmetric half-up), documented in
 * docs/CALC_SPEC.md and applied at every conversion boundary.
 */

import { getCurrency, assertMinorInteger } from "./currency";

/** Round to the nearest integer, halves away from zero. */
export function roundHalfUp(n: number): number {
  if (!Number.isFinite(n)) throw new Error("Cannot round a non-finite number");
  return Math.sign(n) * Math.round(Math.abs(n));
}

// Re-exported for compatibility: canonical home is now ./currency.
export { assertMinorInteger };

/** Convert a major-unit decimal (e.g. 1234.56) to integer minor units. */
export function toMinor(major: number, currencyCode: string): number {
  if (!Number.isFinite(major)) throw new Error("Amount must be a finite number");
  const { minorUnits } = getCurrency(currencyCode);
  return roundHalfUp(major * 10 ** minorUnits);
}

/** Convert integer minor units back to a major-unit decimal (display only). */
export function toMajor(amountMinor: number, currencyCode: string): number {
  assertMinorInteger(amountMinor);
  const { minorUnits } = getCurrency(currencyCode);
  return amountMinor / 10 ** minorUnits;
}

/**
 * Convert an integer minor-unit amount between currencies.
 * @param rate units of `to` per 1 unit of `from` (e.g. 0.0079 GBP per 1 BDT).
 * The result is rounded to the target currency's minor units (half away from zero).
 */
export function convertMinor(
  amountMinor: number,
  fromCode: string,
  toCode: string,
  rate: number,
): number {
  assertMinorInteger(amountMinor);
  if (fromCode.toUpperCase() === toCode.toUpperCase()) return amountMinor;
  if (!(rate > 0) || !Number.isFinite(rate)) {
    throw new Error(`Exchange rate must be a positive finite number, got ${rate}`);
  }
  const fromUnits = getCurrency(fromCode).minorUnits;
  const toUnits = getCurrency(toCode).minorUnits;
  // Single transient float, rounded immediately at the conversion boundary.
  const majorTo = (amountMinor / 10 ** fromUnits) * rate;
  const converted = roundHalfUp(majorTo * 10 ** toUnits);
  if (!Number.isSafeInteger(converted)) {
    throw new Error("Converted amount exceeds the supported safe integer range");
  }
  return converted;
}

/** Multiply an integer minor-unit amount by a decimal factor (e.g. 1.10). */
export function scaleMinor(amountMinor: number, factor: number): number {
  assertMinorInteger(amountMinor);
  if (!Number.isFinite(factor) || factor < 0) {
    throw new Error(`Scale factor must be a finite non-negative number, got ${factor}`);
  }
  return roundHalfUp(amountMinor * factor);
}

export function addMinor(a: number, b: number): number {
  assertMinorInteger(a, "a");
  assertMinorInteger(b, "b");
  return a + b;
}

export function subMinor(a: number, b: number): number {
  assertMinorInteger(a, "a");
  assertMinorInteger(b, "b");
  return a - b;
}
