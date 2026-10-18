import { FundingFormRequestSchema, fundingFormToToolInput } from "@/lib/fundingForm";
import { analyzeFundingGapTool } from "@/lib/tools/analyzeFundingGap";
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
  const result = await analyzeFundingGapTool.handler(fundingFormToToolInput(parsed.data), {
    sessionId: "structured-form",
    taskId: "structured-form",
  });
  if (!result.ok || !result.data) return Response.json({ ok: false, error: result.summary }, { status: 422 });
  return Response.json({ ok: true, summary: result.summary, data: result.data });
}
