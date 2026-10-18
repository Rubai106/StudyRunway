/**
 * POST /api/agent/budget-revert — revert the applied destination budget.
 *
 * Body: { sessionId }
 * Removes exactly the applied obligations that are still "planned"
 * (describePlanRevert ids) and recalculates the funding-gap forecast.
 */
import { revertBudgetFromTask } from "@/lib/budgetApply";
import { requestOriginError, sessionIdError, sessionPersistenceResponse } from "@/lib/agent/session";
import { BUDGET_ACTION_ACKS } from "@/lib/budgetApproval";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 64 * 1024;

export async function POST(req: Request): Promise<Response> {
  const persistenceError = sessionPersistenceResponse();
  if (persistenceError) return persistenceError;
  const originError = requestOriginError(req);
  if (originError) {
    return Response.json({ ok: false, error: originError }, { status: 403 });
  }
  const len = req.headers.get("content-length");
  if (len && Number(len) > MAX_BODY_BYTES) {
    return Response.json({ ok: false, error: "request body too large" }, { status: 413 });
  }
  let body: { sessionId?: unknown; approvalAck?: unknown };
  try {
    body = (await req.json()) as { sessionId?: unknown };
  } catch {
    return Response.json({ ok: false, error: "request body must be JSON" }, { status: 400 });
  }
  const sidErr = sessionIdError(body.sessionId);
  if (sidErr) {
    return Response.json({ ok: false, error: sidErr }, { status: 400 });
  }
  if (body.approvalAck !== BUDGET_ACTION_ACKS.revert) {
    return Response.json({ ok: false, error: "Explicit approval is required before reverting this budget." }, { status: 400 });
  }
  try {
    const result = revertBudgetFromTask(body.sessionId as string);
    return Response.json({ ok: true, ...result });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "revert failed" },
      { status: 400 }
    );
  }
}
