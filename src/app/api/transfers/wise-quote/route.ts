import { randomUUID } from "node:crypto";
import { z } from "zod";
import { isSupportedCurrency } from "@/lib/currency";
import { requestOriginError } from "@/lib/agent/session";
import { checkRateLimit, requestClientKey, RATE_WINDOW_MS, WISE_RATE_MAX_REQUESTS } from "@/lib/agent/rateLimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 4 * 1024;
const MAX_SOURCE_AMOUNT = 1_000_000;
const API_VERSION = "2026Q4";
const QUOTE_TIMEOUT_MS = 12_000;

const WiseQuoteRequestSchema = z.object({
  sourceCurrency: z.string().trim().toUpperCase().length(3).refine(isSupportedCurrency),
  targetCurrency: z.string().trim().toUpperCase().length(3).refine(isSupportedCurrency),
  sourceAmount: z.number().finite().positive().max(MAX_SOURCE_AMOUNT),
}).strict().refine((value) => value.sourceCurrency !== value.targetCurrency, {
  message: "Choose two different currencies.",
});

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

interface WiseMoney {
  amount: number | null;
  currency: string | null;
}

function wiseMoney(value: unknown): WiseMoney {
  const object = record(value);
  if (!object) return { amount: numeric(value), currency: null };

  const nestedValue = record(object["value"]);
  return {
    amount: numeric(object["amount"])
      ?? numeric(nestedValue?.["amount"])
      ?? numeric(object["value"])
      ?? numeric(object["total"]),
    currency: text(object["currency"]) ?? text(nestedValue?.["currency"]),
  };
}

function safeJsonError(status: number): { status: number; message: string } {
  if (status === 400 || status === 422) {
    return { status: 422, message: "Wise could not quote this amount and currency route. Check the currencies and amount, then try again." };
  }
  if (status === 401 || status === 403) {
    return { status: 502, message: "Wise did not authorize the quote request. Check the deployment's Wise Platform access and configuration." };
  }
  if (status === 429) {
    return { status: 429, message: "Wise is rate limiting quote requests. Wait briefly and try again." };
  }
  return { status: 502, message: "Wise's quote service is temporarily unavailable. No estimate was substituted." };
}

export async function POST(req: Request): Promise<Response> {
  if (process.env.WISE_QUOTES_ENABLED?.trim().toLowerCase() !== "true") {
    return Response.json(
      { ok: false, error: "Wise quote previews are disabled on this deployment. Set WISE_QUOTES_ENABLED=true on the server to enable them." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const originError = requestOriginError(req);
  if (originError) {
    return Response.json({ ok: false, error: originError }, { status: 403 });
  }
  const rateLimit = checkRateLimit(`wise:${requestClientKey(req)}`, Date.now(), WISE_RATE_MAX_REQUESTS, RATE_WINDOW_MS);
  if (!rateLimit.allowed) {
    return Response.json(
      { ok: false, error: "Too many Wise quote requests. Wait a minute before trying again." },
      { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil(rateLimit.retryAfterMs / 1000))), "Cache-Control": "no-store" } },
    );
  }

  let raw: unknown;
  try {
    const bodyText = await req.text();
    if (Buffer.byteLength(bodyText, "utf8") > MAX_BODY_BYTES) {
      return Response.json({ ok: false, error: "Request body is too large." }, { status: 413 });
    }
    raw = JSON.parse(bodyText) as unknown;
  } catch {
    return Response.json({ ok: false, error: "Request body must be valid JSON." }, { status: 400 });
  }
  const parsed = WiseQuoteRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: parsed.error.issues.map((issue) => issue.message).join(" ") },
      { status: 400 },
    );
  }

  const configuredEnvironment = process.env.WISE_QUOTES_ENV?.trim().toLowerCase();
  if (configuredEnvironment && configuredEnvironment !== "sandbox" && configuredEnvironment !== "production") {
    return Response.json({ ok: false, error: "Wise quote environment is misconfigured. Use production or sandbox." }, { status: 503 });
  }
  const environment = configuredEnvironment === "sandbox" ? "sandbox" : "production";
  const host = environment === "sandbox" ? "api.wise-sandbox.com" : "api.wise.com";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-External-Correlation-Id": randomUUID(),
  };

  let wiseResponse: Response;
  try {
    wiseResponse = await fetch(`https://${host}/${API_VERSION}/quotes`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        sourceCurrency: parsed.data.sourceCurrency,
        targetCurrency: parsed.data.targetCurrency,
        sourceAmount: parsed.data.sourceAmount,
        targetAmount: null,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(QUOTE_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return Response.json(
      { ok: false, error: timedOut ? "Wise's quote request timed out. No estimate was substituted." : "Could not reach Wise's quote service. No estimate was substituted." },
      { status: timedOut ? 504 : 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!wiseResponse.ok) {
    const safeError = safeJsonError(wiseResponse.status);
    return Response.json({ ok: false, error: safeError.message }, {
      status: safeError.status,
      headers: { "Cache-Control": "no-store" },
    });
  }

  let quote: Record<string, unknown> | null = null;
  try {
    quote = record(await wiseResponse.json());
  } catch {
    quote = null;
  }
  if (!quote) {
    return Response.json({ ok: false, error: "Wise returned an invalid quote response. No estimate was shown." }, { status: 502 });
  }

  const sourceCurrency = text(quote["sourceCurrency"])?.toUpperCase();
  const targetCurrency = text(quote["targetCurrency"])?.toUpperCase();
  const rawOptions = Array.isArray(quote["paymentOptions"]) ? quote["paymentOptions"] : [];
  const enabledOptions = rawOptions
    .map(record)
    .filter((option): option is Record<string, unknown> => option !== null && option["disabled"] !== true);
  const fallbackOption = enabledOptions[0];
  const sourceAmount = numeric(quote["sourceAmount"])
    ?? numeric(fallbackOption?.["sourceAmount"])
    ?? parsed.data.sourceAmount;
  const targetAmount = numeric(quote["targetAmount"])
    ?? numeric(fallbackOption?.["targetAmount"]);
  const rate = numeric(quote["rate"])
    ?? numeric(fallbackOption?.["rate"]);
  if (
    sourceCurrency !== parsed.data.sourceCurrency ||
    targetCurrency !== parsed.data.targetCurrency ||
    sourceAmount <= 0 ||
    targetAmount == null || targetAmount <= 0 ||
    rate == null || rate <= 0
  ) {
    return Response.json({ ok: false, error: "Wise's quote response was incomplete or did not match the requested currency route. No estimate was shown." }, { status: 502 });
  }

  const checkedAt = new Date().toISOString();
  const options = rawOptions.flatMap((value, index) => {
    const option = record(value);
    if (!option || option["disabled"] === true) return [];
    const feeObject = record(option["fee"]);
    const priceObject = record(option["price"]);
    const fee = wiseMoney(feeObject?.["total"]);
    const priceTotal = wiseMoney(priceObject?.["total"]);
    const optionSourceAmount = numeric(option["sourceAmount"]) ?? sourceAmount;
    const optionTargetAmount = numeric(option["targetAmount"]) ?? targetAmount;
    if (optionSourceAmount <= 0 || optionTargetAmount <= 0) return [];
    return [{
      id: `${index}-${text(option["payIn"]) ?? "unknown"}-${text(option["payOut"]) ?? "unknown"}`,
      payIn: text(option["payIn"]) ?? "Not specified",
      payOut: text(option["payOut"]) ?? text(quote["payOut"]) ?? "Not specified",
      sourceAmount: optionSourceAmount,
      targetAmount: optionTargetAmount,
      rate: numeric(option["rate"]) ?? rate,
      feeAmount: fee.amount,
      feeCurrency: fee.currency ?? text(feeObject?.["currency"]) ?? sourceCurrency,
      priceTotal: priceTotal.amount,
      priceCurrency: priceTotal.currency ?? text(priceObject?.["currency"]) ?? sourceCurrency,
      estimatedDelivery: text(option["estimatedDelivery"]),
      formattedEstimatedDelivery: text(option["formattedEstimatedDelivery"]),
    }];
  });
  if (options.length === 0) {
    return Response.json({ ok: false, error: "Wise returned no enabled payment options for this route. No estimate was shown." }, { status: 422 });
  }

  return Response.json({
    ok: true,
    data: {
      provider: "Wise",
      quoteType: "unauthenticated indicative quote",
      environment,
      sourceCurrency,
      targetCurrency,
      requestedSourceAmount: parsed.data.sourceAmount,
      sourceAmount,
      targetAmount,
      rate,
      checkedAt,
      createdTime: text(quote["createdTime"]) ?? checkedAt,
      expirationTime: text(quote["expirationTime"]),
      rateExpirationTime: text(quote["rateExpirationTime"]),
      options,
      sourceUrl: "https://docs.wise.com/guides/product/send-money/quotes",
      canCreateTransfer: false,
      rateLocked: false,
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
