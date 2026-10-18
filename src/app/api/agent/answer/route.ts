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
import { requestOriginError, sessionIdError, sessionPersistenceResponse } from "@/lib/agent/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 64 * 1024;

export async function POST(req: Request): Promise<Response> {
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
  const sessionId = body.sessionId as string;
  const questionId = typeof body.questionId === "string" ? body.questionId : "";
  if (!questionId) {
    return Response.json(
      { ok: false, error: "sessionId and questionId are required" },
      { status: 400 }
    );
  }
  const result = submitAnswers(sessionId, questionId, body.answers);
  if (!result.ok) {
    return Response.json(result, { status: 404 });
  }
  return Response.json(result);
}
