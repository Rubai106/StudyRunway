import { FundingFormRequestSchema } from "@/lib/fundingForm";
import { formatFundingAnalysis, generateFundingAnalysis } from "@/lib/fundingAnalysis";
import { requestOriginError } from "@/lib/agent/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const MAX_BODY_BYTES = 256 * 1024;

export async function POST(req: Request): Promise<Response> {
  const originError = requestOriginError(req);
  if (originError) return Response.json({ ok: false, error: originError }, { status: 403 });
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) return Response.json({ ok: false, error: "request body is too large" }, { status: 413 });
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ ok: false, error: "request body must be valid JSON" }, { status: 400 });
  }
  const parsed = FundingFormRequestSchema.safeParse(raw);
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
