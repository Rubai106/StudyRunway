import { GoogleAuth } from "google-auth-library";
import { deleteSession, getTask, restoreTask, type TaskState } from "./state";

const FIRESTORE_SCOPE = "https://www.googleapis.com/auth/datastore";
const COLLECTION = "studyrunway_sessions";
const RETENTION_DAYS = 180;

interface SessionSnapshot {
  sessionId: string;
  updateTime: string | null;
  stateJson: string | null;
}

interface FirestoreDocument {
  updateTime?: string;
  fields?: {
    stateJson?: { stringValue?: string };
    expiresAt?: { timestampValue?: string };
  };
}

class FirestoreSessionError extends Error {
  constructor(readonly conflict = false) {
    super(conflict ? "Firestore session changed concurrently" : "Firestore session storage failed");
  }
}

function firestoreProjectId(): string | null {
  const projectId = [
    process.env.FIRESTORE_PROJECT_ID,
    process.env.GOOGLE_CLOUD_PROJECT,
    process.env.GCLOUD_PROJECT,
    process.env.VERTEX_AI_PROJECT,
  ].map((value) => value?.trim()).find(Boolean);
  return projectId && /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)
    ? projectId
    : null;
}

function documentUrl(sessionId: string): string {
  const projectId = firestoreProjectId();
  if (!projectId) throw new FirestoreSessionError();
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${COLLECTION}/${encodeURIComponent(sessionId)}`;
}

async function firestoreRequest(
  sessionId: string,
  method: "GET" | "PATCH" | "DELETE",
  url: string,
  body?: unknown,
): Promise<Response> {
  try {
    const auth = new GoogleAuth({
      projectId: firestoreProjectId() ?? undefined,
      scopes: [FIRESTORE_SCOPE],
    });
    const token = await auth.getAccessToken();
    if (!token) throw new FirestoreSessionError();
    const response = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(8_000),
    });
    if (response.status === 409 || response.status === 412) {
      throw new FirestoreSessionError(true);
    }
    return response;
  } catch (error) {
    if (error instanceof FirestoreSessionError) throw error;
    // Do not propagate ADC, network, or provider error details into API output.
    console.error("StudyRunway Firestore session operation failed", { method, sessionIdHash: sessionId.slice(-12) });
    throw new FirestoreSessionError();
  }
}

async function loadSession(sessionId: string): Promise<SessionSnapshot> {
  const response = await firestoreRequest(sessionId, "GET", documentUrl(sessionId));
  if (response.status === 404) {
    return { sessionId, updateTime: null, stateJson: null };
  }
  if (!response.ok) throw new FirestoreSessionError();

  let document: FirestoreDocument;
  try {
    document = (await response.json()) as FirestoreDocument;
  } catch {
    throw new FirestoreSessionError();
  }
  const updateTime = document.updateTime;
  const stateJson = document.fields?.stateJson?.stringValue;
  if (!updateTime || !stateJson) throw new FirestoreSessionError();

  let state: TaskState;
  try {
    state = JSON.parse(stateJson) as TaskState;
    if (state.sessionId !== sessionId || !state.updatedAt) throw new Error("invalid task state");
  } catch {
    throw new FirestoreSessionError();
  }

  const expiration = document.fields?.expiresAt?.timestampValue
    ? Date.parse(document.fields.expiresAt.timestampValue)
    : Date.parse(state.updatedAt) + RETENTION_DAYS * 24 * 60 * 60 * 1000;
  if (Number.isFinite(expiration) && expiration <= Date.now()) {
    await deleteStoredSession(sessionId, updateTime);
    return { sessionId, updateTime: null, stateJson: null };
  }

  restoreTask(state);
  return { sessionId, updateTime, stateJson };
}

async function deleteStoredSession(sessionId: string, updateTime: string): Promise<void> {
  const url = new URL(documentUrl(sessionId));
  url.searchParams.set("currentDocument.updateTime", updateTime);
  const response = await firestoreRequest(sessionId, "DELETE", url.toString());
  if (!response.ok && response.status !== 404) throw new FirestoreSessionError();
}

async function persistSession(snapshot: SessionSnapshot): Promise<void> {
  const task = getTask(snapshot.sessionId);
  if (!task) {
    if (snapshot.updateTime) await deleteStoredSession(snapshot.sessionId, snapshot.updateTime);
    return;
  }

  const stateJson = JSON.stringify(task);
  if (stateJson === snapshot.stateJson) return;

  const url = new URL(documentUrl(snapshot.sessionId));
  url.searchParams.set("updateMask.fieldPaths", "stateJson");
  url.searchParams.append("updateMask.fieldPaths", "expiresAt");
  if (snapshot.updateTime) {
    url.searchParams.set("currentDocument.updateTime", snapshot.updateTime);
  } else {
    url.searchParams.set("currentDocument.exists", "false");
  }
  const expiresAt = new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const response = await firestoreRequest(snapshot.sessionId, "PATCH", url.toString(), {
    fields: {
      stateJson: { stringValue: stateJson },
      expiresAt: { timestampValue: expiresAt },
    },
  });
  if (!response.ok) throw new FirestoreSessionError();
}

function failedPersistenceResponse(error: unknown): Response {
  const conflict = error instanceof FirestoreSessionError && error.conflict;
  return Response.json(
    {
      error: conflict
        ? "This financial session changed in another request. Reload it and try again."
        : "Durable session storage is unavailable. No session state was confirmed saved.",
      code: conflict ? "SESSION_WRITE_CONFLICT" : "SESSION_STORAGE_UNAVAILABLE",
    },
    { status: conflict ? 409 : 503, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * Hydrate one user-scoped task from Firestore, execute its existing synchronous
 * agent workflow, then commit the updated snapshot with a Firestore version
 * precondition. The version check rejects concurrent writes instead of silently
 * overwriting another request's financial state.
 */
export async function withPersistentSession(
  sessionId: string,
  operation: () => Promise<Response>,
): Promise<Response> {
  const mode = (process.env.STUDYRUNWAY_SESSION_STORE ?? "memory").trim().toLowerCase();
  if (mode !== "firestore") return operation();

  let snapshot: SessionSnapshot;
  try {
    snapshot = await loadSession(sessionId);
    if (!snapshot.stateJson) deleteSession(sessionId);
  } catch (error) {
    return failedPersistenceResponse(error);
  }

  let response: Response;
  try {
    response = await operation();
  } catch (error) {
    try {
      await persistSession(snapshot);
    } catch (persistenceError) {
      return failedPersistenceResponse(persistenceError);
    }
    throw error;
  }

  const isEventStream = response.headers.get("content-type")?.includes("text/event-stream") ?? false;
  if (!response.body || !isEventStream) {
    try {
      const body = response.body ? await response.arrayBuffer() : null;
      await persistSession(snapshot);
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (error) {
      return failedPersistenceResponse(error);
    }
  }

  const reader = response.body.getReader();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
        await persistSession(snapshot);
        controller.close();
      } catch (error) {
        try {
          if (isEventStream) {
            const failure = error instanceof FirestoreSessionError && error.conflict
              ? "Session state changed concurrently; reload before continuing."
              : "The response finished, but durable session state could not be saved.";
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: "error", message: failure, recoverable: true })}\n\n`));
            controller.close();
          } else {
            controller.error(error);
          }
        } catch {
          /* downstream already closed */
        }
      } finally {
        reader.releaseLock();
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
        await persistSession(snapshot);
      } catch {
        // The consumer has already disconnected; the next request can recover
        // from Firestore's last acknowledged state.
      }
    },
  });

  return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
}
