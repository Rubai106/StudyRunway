import { FundingFormRequestSchema, fundingFormToToolInput } from "@/lib/fundingForm";
import { AnalyzeFundingGapParams, analyzeFundingGapTool, fundingGapInputToToolPlan } from "@/lib/tools/analyzeFundingGap";
import { requestOriginError, sessionIdError, sessionPersistenceResponse } from "@/lib/agent/session";
import { getTask, updateTask } from "@/lib/agent/state";
import { writeAuditEvent } from "@/lib/agent/audit";
import { requireApiUser, scopeSessionId } from "@/lib/auth/requireUser";
import { withPersistentSession } from "@/lib/agent/firestoreSessionStore";

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
  const sessionId = scopeSessionId(user.id, rawRecord?.sessionId as string);
  const { sessionId: _ignoredSessionId, ...formRaw } = rawRecord as Record<string, unknown>;
  void _ignoredSessionId;
  const parsed = FundingFormRequestSchema.safeParse(formRaw);
  if (!parsed.success) {
    return Response.json({ ok: false, error: parsed.error.issues.map((issue) => `${issue.path.join(".") || "form"}: ${issue.message}`).join("; ") }, { status: 400 });
  }
  return withPersistentSession(sessionId, async () => {
    const toolInput = AnalyzeFundingGapParams.parse(fundingFormToToolInput(parsed.data));
    const plan = fundingGapInputToToolPlan(toolInput);
    // The same validated canonical plan powers this response and all later
    // turns in the session. Invalidate only controls/results tied to the old
    // financial inputs; approval history remains an audit record.
    updateTask(sessionId, {
      workingPlan: plan,
      appliedBudget: null,
      pendingQuestions: [],
      pendingApproval: null,
      approvedCalls: [],
    });
    const result = await analyzeFundingGapTool.handler({ plan }, {
      sessionId: "structured-form",
      taskId: "structured-form",
    });
    const task = getTask(sessionId);
    if (task) {
      await writeAuditEvent({ type: "agent.plan.changed", taskId: task.taskId, action: "funding_check", ok: Boolean(result.ok && result.data) });
    }
    if (!result.ok || !result.data) return Response.json({ ok: false, error: result.summary }, { status: 422 });
    return Response.json({ ok: true, summary: result.summary, data: result.data });
  });
}
