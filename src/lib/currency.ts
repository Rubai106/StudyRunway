/**
 * Currency metadata: ISO codes, minor-unit conventions and symbols.
 * Minor units follow ISO 4217 (e.g. JPY 0, BHD 3, most others 2).
 */

export interface CurrencyInfo {
  code: string;
  name: string;
  minorUnits: number;
  symbol: string;
}

export const CURRENCIES: CurrencyInfo[] = [
  { code: "USD", name: "US Dollar", minorUnits: 2, symbol: "$" },
  { code: "EUR", name: "Euro", minorUnits: 2, symbol: "€" },
  { code: "GBP", name: "British Pound", minorUnits: 2, symbol: "£" },
  { code: "BDT", name: "Bangladeshi Taka", minorUnits: 2, symbol: "৳" },
  { code: "INR", name: "Indian Rupee", minorUnits: 2, symbol: "₹" },
  { code: "PKR", name: "Pakistani Rupee", minorUnits: 2, symbol: "₨" },
  { code: "LKR", name: "Sri Lankan Rupee", minorUnits: 2, symbol: "₨" },
  { code: "NPR", name: "Nepalese Rupee", minorUnits: 2, symbol: "₨" },
  { code: "CNY", name: "Chinese Yuan", minorUnits: 2, symbol: "¥" },
  { code: "JPY", name: "Japanese Yen", minorUnits: 0, symbol: "¥" },
  { code: "KRW", name: "South Korean Won", minorUnits: 0, symbol: "₩" },
  { code: "SGD", name: "Singapore Dollar", minorUnits: 2, symbol: "$" },
  { code: "MYR", name: "Malaysian Ringgit", minorUnits: 2, symbol: "RM" },
  { code: "AUD", name: "Australian Dollar", minorUnits: 2, symbol: "$" },
  { code: "CAD", name: "Canadian Dollar", minorUnits: 2, symbol: "$" },
  { code: "AED", name: "UAE Dirham", minorUnits: 2, symbol: "د.إ" },
  { code: "SAR", name: "Saudi Riyal", minorUnits: 2, symbol: "﷼" },
  { code: "QAR", name: "Qatari Riyal", minorUnits: 2, symbol: "﷼" },
  { code: "KWD", name: "Kuwaiti Dinar", minorUnits: 3, symbol: "د.ك" },
  { code: "BHD", name: "Bahraini Dinar", minorUnits: 3, symbol: ".د.ب" },
  { code: "OMR", name: "Omani Rial", minorUnits: 3, symbol: "﷼" },
  { code: "THB", name: "Thai Baht", minorUnits: 2, symbol: "฿" },
  { code: "VND", name: "Vietnamese Dong", minorUnits: 0, symbol: "₫" },
  { code: "IDR", name: "Indonesian Rupiah", minorUnits: 2, symbol: "Rp" },
  { code: "PHP", name: "Philippine Peso", minorUnits: 2, symbol: "₱" },
  { code: "NGN", name: "Nigerian Naira", minorUnits: 2, symbol: "₦" },
  { code: "KES", name: "Kenyan Shilling", minorUnits: 2, symbol: "KSh" },
  { code: "ZAR", name: "South African Rand", minorUnits: 2, symbol: "R" },
  { code: "CHF", name: "Swiss Franc", minorUnits: 2, symbol: "Fr" },
  { code: "SEK", name: "Swedish Krona", minorUnits: 2, symbol: "kr" },
  { code: "NOK", name: "Norwegian Krone", minorUnits: 2, symbol: "kr" },
  { code: "DKK", name: "Danish Krone", minorUnits: 2, symbol: "kr" },
];

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));

export function getCurrency(code: string): CurrencyInfo {
  const info = BY_CODE.get(code.toUpperCase());
  if (!info) throw new Error(`Unsupported currency code: ${code}`);
  return info;
}

export function isSupportedCurrency(code: string): boolean {
  return BY_CODE.has(code.toUpperCase());
}

/**
 * Amounts are integer counts of minor units — a fractional minor unit is a
 * bug, never a rounding choice. (Lives here rather than money.ts so
 * formatMinor() can use it without a currency↔money import cycle.)
 */
export function assertMinorInteger(n: number, what = "amount"): void {
  if (!Number.isInteger(n)) {
    throw new Error(`${what} must be an integer number of minor units, got ${n}`);
  }
}

/** Format an integer minor-unit amount, e.g. 123456 (minor) + "GBP" -> "£1,234.56". */
export function formatMinor(
  amountMinor: number,
  code: string,
  opts: { locale?: string; showCode?: boolean } = {},
): string {
  assertMinorInteger(amountMinor, "formatMinor amountMinor");
  const info = getCurrency(code);
  const major = amountMinor / 10 ** info.minorUnits;
  const formatted = new Intl.NumberFormat(opts.locale ?? "en-GB", {
    style: "currency",
    currency: code,
    minimumFractionDigits: info.minorUnits,
    maximumFractionDigits: info.minorUnits,
  }).format(major);
  return opts.showCode && !formatted.includes(code) ? `${formatted} ${code}` : formatted;
}

/** Compact formatting for chart axes, e.g. "£1.2k". Never used for exact figures.
 *  Negative values use a proper minus before the symbol: "−£1.8k". */
export function formatCompact(amountMinor: number, code: string): string {
  const info = getCurrency(code);
  const major = amountMinor / 10 ** info.minorUnits;
  const abs = Math.abs(major);
  const suffix = abs >= 1_000_000 ? "m" : abs >= 1_000 ? "k" : "";
  const scaled = abs >= 1_000_000 ? abs / 1_000_000 : abs >= 1_000 ? abs / 1_000 : abs;
  const rounded = Math.round(scaled * 10) / 10;
  const sign = major < 0 ? "−" : "";
  return `${sign}${info.symbol}${rounded}${suffix}`;
}
