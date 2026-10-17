import { sessionIdError, requestOriginError } from "@/lib/agent/session";
import {
  getSafeToSendActionApprovalAck,
  getSafeToSendExecutionRecord,
  runSafeToSendAction,
} from "@/lib/tools/safeToSend";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 256 * 1024;

export async function GET(req: Request): Promise<Response> {
  const originError = requestOriginError(req);
  if (originError) {
    return Response.json({ ok: false, error: originError }, { status: 403 });
  }
  const url = new URL(req.url);
  const sessionIdRaw = url.searchParams.get("sessionId");
  const sidErr = sessionIdError(sessionIdRaw);
  if (sidErr) {
    return Response.json({ ok: false, error: sidErr }, { status: 400 });
  }
  const simulationId = url.searchParams.get("simulationId") ?? undefined;
  const download = url.searchParams.get("download") === "1";
  const result = getSafeToSendExecutionRecord(sessionIdRaw as string, simulationId);
  if (!result.ok) {
    return Response.json({ ok: false, error: result.error }, { status: 404 });
  }
  if (download) {
    return new Response(JSON.stringify(result.record, null, 2), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="studyrunway-sandbox-record-${simulationId ?? "latest"}.json"`,
      },
    });
  }
  return Response.json({ ok: true, record: result.record }, { status: 200 });
}

export async function POST(req: Request): Promise<Response> {
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
    action?: unknown;
    payload?: unknown;
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
  const sessionId = body.sessionId as string;
  const action = typeof body.action === "string" ? body.action : "";
  if (!action) {
    return Response.json({ ok: false, error: "action is required" }, { status: 400 });
  }
  const payload =
    body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
      ? (body.payload as Record<string, unknown>)
      : {};

  const requiredApprovalAck = getSafeToSendActionApprovalAck(action);
  if (requiredApprovalAck && payload["approvalAck"] !== requiredApprovalAck) {
    return Response.json(
      {
        ok: false,
        error: `Explicit approval is required for ${action}. Confirm the action in the app and retry.`,
      },
      { status: 400 },
    );
  }

  const result = await runSafeToSendAction(sessionId, action, payload);
  return Response.json(result, { status: result.ok ? 200 : 400 });
}
