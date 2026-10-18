import { CURRENCIES } from "./currency";

export interface ExplicitMoneyMention {
  amount: number;
  currency: string;
  start: number;
  end: number;
}

const CURRENCY_PATTERN = CURRENCIES
  .map(({ code }) => code)
  .sort((a, b) => b.length - a.length)
  .join("|");
const DOLLAR_CURRENCIES = new Set(["USD", "CAD", "AUD", "SGD"]);
const MONEY_PATTERN = new RegExp(
  `(?<![A-Z0-9-])(?:(?<before>${CURRENCY_PATTERN})\\s*)?(?<symbol>US\\$|\\$)?\\s*(?<amount>(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d{1,3})?)(?:\\s*(?<after>${CURRENCY_PATTERN}))?(?![A-Z0-9-])`,
  "gi",
);

/**
 * Parse only amounts accompanied by an ISO code or a dollar sign. A bare $
 * defaults to USD (the caller should disclose the assumption); an explicit
 * supported dollar code such as CAD takes precedence.
 */
export function extractExplicitMoneyMentions(text: string): ExplicitMoneyMention[] {
  const mentions: ExplicitMoneyMention[] = [];
  for (const match of text.matchAll(MONEY_PATTERN)) {
    const before = match.groups?.before?.toUpperCase();
    const after = match.groups?.after?.toUpperCase();
    const hasDollarSymbol = Boolean(match.groups?.symbol);
    if (!before && !after && !hasDollarSymbol) continue;
    if (before && after && before !== after) continue;
    const explicitCode = before ?? after;
    if (hasDollarSymbol && explicitCode && !DOLLAR_CURRENCIES.has(explicitCode)) continue;
    const amount = Number(match.groups?.amount?.replaceAll(",", ""));
    if (!Number.isFinite(amount)) continue;
    const start = match.index ?? 0;
    mentions.push({
      amount,
      currency: explicitCode ?? "USD",
      start,
      end: start + match[0].length,
    });
  }
  return mentions;
}
