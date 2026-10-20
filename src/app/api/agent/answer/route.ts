/**
 * POST /api/agent/answer — answer a pending clarification or approval gate.
 *
 * Body: { sessionId: string, questionId: string, answers: unknown }
 * Response: { ok: true } when recorded (the client then re-opens
 * /api/agent/chat to resume the paused task), or { ok: false, error }.
 *
 * For approval gates, `answers` should be { decision: "approve" | "deny" }.
 */
import { submitAnswers } from "@/lib/agent/orchestrator";
import { writeAuditEvent } from "@/lib/agent/audit";
import { getTask } from "@/lib/agent/state";
import { requestOriginError, sessionIdError, sessionPersistenceResponse } from "@/lib/agent/session";
import { requireApiUser, scopeSessionId } from "@/lib/auth/requireUser";
import { withPersistentSession } from "@/lib/agent/firestoreSessionStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 64 * 1024;

export async function POST(req: Request): Promise<Response> {
  const user = await requireApiUser();
  if (user instanceof Response) return user;
  const persistenceError = sessionPersistenceResponse();
  if (persistenceError) return Response.json({ ok: false, ...(await persistenceError.json()) }, { status: 503 });
  const originError = requestOriginError(req);
  if (originError) {
    return Response.json({ ok: false, error: originError }, { status: 403 });
  }
  const len = req.headers.get("content-length");
  if (len && Number(len) > MAX_BODY_BYTES) {
    return Response.json({ ok: false, error: "request body too large" }, { status: 413 });
  }
  let body: { sessionId?: unknown; questionId?: unknown; answers?: unknown };
  try {
    body = (await req.json()) as {
      sessionId?: unknown;
      questionId?: unknown;
      answers?: unknown;
    };
  } catch {
    return Response.json({ error: "request body must be JSON" }, { status: 400 });
  }
  const sidErr = sessionIdError(body.sessionId);
  if (sidErr) {
    return Response.json({ ok: false, error: sidErr }, { status: 400 });
  }
  const sessionId = scopeSessionId(user.id, body.sessionId as string);
  return withPersistentSession(sessionId, async () => {
    const questionId = typeof body.questionId === "string" ? body.questionId : "";
    if (!questionId) {
      return Response.json(
        { ok: false, error: "sessionId and questionId are required" },
        { status: 400 }
      );
    }
    const previous = getTask(sessionId);
    const approval = previous?.pendingApproval?.id === questionId ? previous.pendingApproval : null;
    const question = previous?.pendingQuestions.find((item) => item.id === questionId);
    const result = submitAnswers(sessionId, questionId, body.answers);
    if (!result.ok) {
      return Response.json(result, { status: 404 });
    }
    if (previous && approval) {
      const rawDecision = body.answers && typeof body.answers === "object"
        ? (body.answers as Record<string, unknown>).decision
        : undefined;
      await writeAuditEvent({
        type: "agent.approval.decided",
        taskId: previous.taskId,
        tool: approval.tool,
        decision: String(rawDecision ?? "").toLowerCase() === "approve" ? "approved" : "denied",
      });
    } else if (previous && question) {
      const answerFieldCount = body.answers && typeof body.answers === "object"
        ? Math.min(Object.keys(body.answers).length, 10)
        : typeof body.answers === "string" ? 1 : 0;
      await writeAuditEvent({
        type: "agent.answer.submitted",
        taskId: previous.taskId,
        questionKind: question.kind,
        answerFieldCount,
      });
    }
    return Response.json(result);
  });
}
