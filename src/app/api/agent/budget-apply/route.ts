/**
 * POST /api/agent/budget-apply — apply an accepted destination budget to the
 * session's working plan.
 *
 * Body: { sessionId, plan, planInputs, startDate, studyMonths }
 * - plan: the LivingCostPlan object from a build_living_cost_plan result
 *   (the UI sends back the accepted — possibly adjusted — plan).
 * - planInputs: the LivingCostPlanInputs that produced `plan`. Required: the
 *   server cross-checks destinationId against the cost dataset and re-verifies
 *   the plan's applied category/one-time data, source attribution and key
 *   amounts against a server-side recomputation of the deterministic engine;
 *   mismatches are rejected with HTTP 400.
 * - Converts via planToObligations (exact function), appends to the task's
 *   workingPlan, re-runs the funding-gap forecast, and returns the new
 *   projected minimum balance / gap. The UI must get explicit user
 *   confirmation (approval-gate pattern) before calling this.
 */
import { applyBudgetToTask } from "@/lib/budgetApply";
import { requestOriginError, sessionIdError, sessionPersistenceResponse } from "@/lib/agent/session";
import { BUDGET_ACTION_ACKS } from "@/lib/budgetApproval";
import { getTask } from "@/lib/agent/state";
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
  if (originError) {
    return Response.json({ ok: false, error: originError }, { status: 403 });
  }
  const len = req.headers.get("content-length");
  if (len && Number(len) > MAX_BODY_BYTES) {
    return Response.json({ ok: false, error: "request body too large" }, { status: 413 });
  }
  let body: {
    sessionId?: unknown;
    approvalAck?: unknown;
    plan?: unknown;
    planInputs?: unknown;
    startDate?: unknown;
    studyMonths?: unknown;
    oneTimeDueDates?: unknown;
    tuitionDueDate?: unknown;
    fxRateToPlanning?: unknown;
    fxRateDate?: unknown;
    fxRateSource?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "request body must be JSON" }, { status: 400 });
  }
  const sidErr = sessionIdError(body.sessionId);
  if (sidErr) {
    return Response.json({ ok: false, error: sidErr }, { status: 400 });
  }
  const sessionId = scopeSessionId(user.id, body.sessionId as string);
  if (body.approvalAck !== BUDGET_ACTION_ACKS.apply) {
    return Response.json({ ok: false, error: "Explicit approval is required before applying this budget." }, { status: 400 });
  }
  if (body.plan == null) {
    return Response.json({ ok: false, error: "plan is required" }, { status: 400 });
  }
  return withPersistentSession(sessionId, async () => {
    try {
      const result = applyBudgetToTask(
        sessionId,
        body.plan,
        {
          startDate: body.startDate,
          studyMonths: body.studyMonths,
          oneTimeDueDates: body.oneTimeDueDates,
          tuitionDueDate: body.tuitionDueDate,
          fxRateToPlanning: body.fxRateToPlanning,
          fxRateDate: body.fxRateDate,
          fxRateSource: body.fxRateSource,
        },
        body.planInputs
      );
      const task = getTask(sessionId);
      if (task) await writeAuditEvent({ type: "agent.plan.changed", taskId: task.taskId, action: "budget_apply", ok: true });
      return Response.json({ ok: true, ...result });
    } catch (err) {
      const task = getTask(sessionId);
      if (task) await writeAuditEvent({ type: "agent.plan.changed", taskId: task.taskId, action: "budget_apply", ok: false });
      return Response.json(
        { ok: false, error: err instanceof Error ? err.message : "apply failed" },
        { status: 400 }
      );
    }
  });
}
