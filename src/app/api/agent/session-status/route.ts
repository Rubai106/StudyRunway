/**
 * GET /api/agent/session-status?sessionId=...
 *
 * Lets the client tell whether a locally restored transcript still has a live
 * server-side task. Task state is in-memory in this demo and is lost on a server
 * restart, so stale transcripts must not present live clarification/apply controls.
 */
import { getTask } from "@/lib/agent/state";
import { sessionIdError, sessionPersistenceResponse } from "@/lib/agent/session";
import { requireApiUser, scopeSessionId } from "@/lib/auth/requireUser";
import { withPersistentSession } from "@/lib/agent/firestoreSessionStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  const user = await requireApiUser();
  if (user instanceof Response) return user;
  const persistenceError = sessionPersistenceResponse();
  if (persistenceError) return persistenceError;
  const sessionId = new URL(req.url).searchParams.get("sessionId");
  const error = sessionIdError(sessionId);
  if (error) return Response.json({ active: false, error }, { status: 400 });

  const scopedSessionId = scopeSessionId(user.id, sessionId as string);
  return withPersistentSession(scopedSessionId, async () => {
    const task = getTask(scopedSessionId);
    return Response.json(
      { active: Boolean(task), status: task?.status ?? null },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
