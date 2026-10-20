/**
 * GET /api/agent/status — which model provider (if any) is configured.
 *
 * Response: { provider: 'xai'|'gemini'|'vertex'|'openai'|'anthropic'|'demo', model: string|null,
 *             configured: boolean, label: string }
 * The label never contains an API key.
 */
import { selectProvider } from "@/lib/providers";
import { requireApiUser } from "@/lib/auth/requireUser";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const user = await requireApiUser();
  if (user instanceof Response) return user;
  const sel = selectProvider();
  return Response.json({
    provider: sel.name,
    model: sel.model,
    configured: sel.configured,
    label: sel.label,
  });
}
