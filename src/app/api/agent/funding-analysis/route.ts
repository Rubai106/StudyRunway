import { FundingFormRequestSchema } from "@/lib/fundingForm";
import { formatFundingAnalysis, generateFundingAnalysis } from "@/lib/fundingAnalysis";
import { requestOriginError, sessionIdError, sessionPersistenceResponse } from "@/lib/agent/session";
import { checkRateLimit, requestClientKey, FUNDING_ANALYSIS_RATE_MAX_REQUESTS, RATE_WINDOW_MS } from "@/lib/agent/rateLimit";
import { requireApiUser } from "@/lib/auth/requireUser";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const MAX_BODY_BYTES = 256 * 1024;

export async function POST(req: Request): Promise<Response> {
  const user = await requireApiUser();
  if (user instanceof Response) return user;
  const persistenceError = sessionPersistenceResponse();
  if (persistenceError) return persistenceError;
  const originError = requestOriginError(req);
  if (originError) return Response.json({ ok: false, error: originError }, { status: 403 });
  const rateLimit = checkRateLimit(`funding-analysis:${requestClientKey(req)}`, Date.now(), FUNDING_ANALYSIS_RATE_MAX_REQUESTS, RATE_WINDOW_MS);
  if (!rateLimit.allowed) {
    return Response.json(
      { ok: false, error: "Too many funding-analysis requests. Wait a minute before trying again." },
      { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil(rateLimit.retryAfterMs / 1000))) } },
    );
  }
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) return Response.json({ ok: false, error: "request body is too large" }, { status: 413 });
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ ok: false, error: "request body must be valid JSON" }, { status: 400 });
  }
  const rawRecord = raw !== null && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : null;
  const sidErr = sessionIdError(rawRecord?.sessionId);
  if (sidErr) return Response.json({ ok: false, error: sidErr }, { status: 400 });
  const { sessionId: _ignoredSessionId, ...formRaw } = rawRecord as Record<string, unknown>;
  void _ignoredSessionId;
  const parsed = FundingFormRequestSchema.safeParse(formRaw);
  if (!parsed.success) {
    return Response.json({ ok: false, error: parsed.error.issues.map((issue) => `${issue.path.join(".") || "form"}: ${issue.message}`).join("; ") }, { status: 400 });
  }
  try {
    const result = await generateFundingAnalysis(parsed.data);
    return Response.json({ ok: true, analysis: formatFundingAnalysis(result.analysis), provider: result.provider, model: result.model });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google Gemini analysis is temporarily unavailable.";
    return Response.json({ ok: false, error: message, retryable: true }, { status: 503 });
  }
}
