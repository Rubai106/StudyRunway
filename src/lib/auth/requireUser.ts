import { createHmac } from "node:crypto";
import { getGoogleAuthConfiguration } from "./config";

export interface AuthenticatedUser {
  id: string;
}

/** Fail closed when Google OAuth is incomplete or a request has no session. */
export async function requireApiUser(): Promise<AuthenticatedUser | Response> {
  // Route unit tests exercise handlers directly without an HTTP auth boundary.
  // This identity is never available in development or production runtimes.
  if (process.env.NODE_ENV === "test") return { id: "route-test-user" };

  if (!getGoogleAuthConfiguration().configured) {
    return Response.json(
      { error: "Google sign-in is not configured on this deployment." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  // Keep auth.js out of unit-test route imports; NextAuth's runtime depends on
  // Next's server module loader and is only needed for real HTTP requests.
  const { auth } = await import("@/auth");
  const session = await auth();
  const id = session?.user?.id;
  if (!id) {
    return Response.json(
      { error: "Sign in with Google to use StudyRunway." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  return { id };
}

/** Map a browser-visible session ID into a private, user-bound server key. */
export function scopeSessionId(userId: string, clientSessionId: string): string {
  if (process.env.NODE_ENV === "test") return clientSessionId;
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is required to scope user sessions.");
  const digest = createHmac("sha256", secret)
    .update(`${userId}\0${clientSessionId}`)
    .digest("hex");
  return `user_${digest}`;
}
