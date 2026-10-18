/**
 * POST /api/agent/chat — run (or resume) the agent loop for a session.
 *
 * Body: { sessionId: string, message: string }
 * Response: text/event-stream, one JSON object per `data:` line, using the
 * exact event shapes defined in lib/agent/orchestrator.ts.
 *
 * Protections (competition-demo grade):
 * - state-changing browser requests with an Origin header must be same-origin;
 * - sessionId must match the strict allowlist (400 otherwise);
 * - request bodies are size-capped (413 on oversize);
 * - simple in-memory per-IP rate limiting (429 on exceed).
 *
 * Abort: closing the request stream stops the loop promptly (the client stop
 * button wires to this).
 *
 * DELETE /api/agent/chat?sessionId=... — delete a session's in-memory state.
 * Requires a valid sessionId (400), an Origin check against the request host
 * when an Origin header is present (403), and returns 404 for unknown
 * sessions — one session can never read or delete another's state.
 */
import { runAgent, type AgentEvent } from "@/lib/agent/orchestrator";
import { deleteSession, getTask } from "@/lib/agent/state";
import { writeAuditEvent } from "@/lib/agent/audit";
import { requestOriginError, sessionIdError, sessionPersistenceResponse } from "@/lib/agent/session";
import { checkRateLimit, RATE_MAX_REQUESTS, RATE_WINDOW_MS } from "@/lib/agent/rateLimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 256 * 1024;

function encodeEvent(ev: AgentEvent): string {
  return `data: ${JSON.stringify(ev)}\n\n`;
}

function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return (
    req.headers.get("x-real-ip") ??
    req.headers.get("cf-connecting-ip") ??
    "unknown"
  );
}


export async function POST(req: Request): Promise<Response> {
  const persistenceError = sessionPersistenceResponse();
  if (persistenceError) return persistenceError;
  const originError = requestOriginError(req);
  if (originError) {
    return Response.json({ error: originError }, { status: 403 });
  }
  // Demo-grade rate limit: per-IP, fixed window.
  const rl = checkRateLimit(`chat:${clientIp(req)}`);
  if (!rl.allowed) {
    return Response.json(
      {
        error:
          `rate limit exceeded (${RATE_MAX_REQUESTS} requests per ${RATE_WINDOW_MS / 1000}s, demo-grade limit). ` +
          "Please wait a moment and try again.",
      },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
      }
    );
  }

  const len = req.headers.get("content-length");
  if (len && Number(len) > MAX_BODY_BYTES) {
    return Response.json({ error: "request body too large" }, { status: 413 });
  }

  let body: { sessionId?: unknown; message?: unknown };
  try {
    body = (await req.json()) as { sessionId?: unknown; message?: unknown };
  } catch {
    return Response.json(
      { error: "request body must be JSON" },
      { status: 400 }
    );
  }
  const sidErr = sessionIdError(body.sessionId);
  if (sidErr) {
    return Response.json({ error: sidErr }, { status: 400 });
  }
  const sessionId = body.sessionId as string;
  const message = typeof body.message === "string" ? body.message : "";
  const signal = req.signal;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        for await (const ev of runAgent({ sessionId, message, signal })) {
          if (signal.aborted) break;
          controller.enqueue(encoder.encode(encodeEvent(ev)));
        }
      } catch {
        // The orchestrator already yields recoverable errors as events;
        // an unexpected throw here just ends the stream.
        try {
          controller.enqueue(
            encoder.encode(
              encodeEvent({
                type: "error",
                message: "stream interrupted unexpectedly",
                recoverable: true,
              })
            )
          );
        } catch {
          /* controller already closed */
        }
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      // Client disconnected — runAgent observes req.signal and stops.
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function DELETE(req: Request): Promise<Response> {
  const persistenceError = sessionPersistenceResponse();
  if (persistenceError) return persistenceError;
  if (requestOriginError(req)) {
    return Response.json(
      { error: "origin not allowed for this request" },
      { status: 403 }
    );
  }
  const { searchParams } = new URL(req.url);
  const sidErr = sessionIdError(searchParams.get("sessionId"));
  if (sidErr) {
    return Response.json({ error: sidErr }, { status: 400 });
  }
  const sessionId = searchParams.get("sessionId") as string;
  const taskId = getTask(sessionId)?.taskId;
  const deleted = deleteSession(sessionId);
  if (!deleted) {
    return Response.json({ ok: false, error: "unknown session" }, { status: 404 });
  }
  if (taskId) writeAuditEvent({ type: "agent.session.deleted", taskId });
  return Response.json({ ok: true, deleted: true });
}
