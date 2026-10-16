/**
 * xAI (Grok) provider adapter — the PRIMARY provider for StudyRunway.
 *
 * VERIFIED 2026-10-15 against official xAI docs:
 * - Models list (https://docs.x.ai/docs/models, page "Last updated:
 *   September 21, 2026"): current flagship model id is `grok-4.7`,
 *   described as supporting "agentic tool calling".
 * - Chat Completions guide (https://docs.x.ai/docs/guides/chat-completions,
 *   published 2026-10-10): POST {base}/chat/completions, OpenAI-compatible
 *   payload, `Authorization: Bearer <key>` header, `XAI_API_KEY=<redacted>`.
 *
 * Because xAI's API is OpenAI-compatible, the tool-call wire shape below is
 * the standard OpenAI chat-completions shape (tools[].function + message
 * .tool_calls), per xAI's own compatibility statement. Model IDs rotate
 * quickly at xAI — XAI_MODEL overrides the default; confirm at
 * https://docs.x.ai/docs/models if calls start 404ing.
 */
import { postJson } from "./http";
import type {
  ChatMessage,
  ChatResult,
  Provider,
  ToolCallRequest,
  ToolSchema,
} from "./types";

export const DEFAULT_XAI_MODEL = "grok-4.7";
export const DEFAULT_XAI_BASE_URL = "https://api.x.ai/v1";

interface XaiToolCallWire {
  id: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

function toWireMessages(messages: ChatMessage[]): unknown[] {
  return messages.map((m) => {
    if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
      return {
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: tc.arguments },
        })),
      };
    }
    if (m.role === "tool") {
      return { role: "tool", tool_call_id: m.toolCallId ?? "", content: m.content };
    }
    return { role: m.role, content: m.content };
  });
}

export interface XaiConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export function readXaiConfig(): XaiConfig | null {
  const apiKey = (process.env.XAI_API_KEY ?? "").trim();
  if (!apiKey || /^(?:<redacted>|placeholder|your[_ -].*)$/i.test(apiKey)) return null;
  const configuredBaseUrl = (process.env.XAI_BASE_URL ?? "").trim();
  const configuredModel = (process.env.XAI_MODEL ?? "").trim();
  const isPlaceholder = (value: string) =>
    /^(?:placeholder|your[_ -].*)$/i.test(value);
  return {
    apiKey,
    baseUrl:
      configuredBaseUrl && !isPlaceholder(configuredBaseUrl)
        ? configuredBaseUrl
        : DEFAULT_XAI_BASE_URL,
    model:
      configuredModel && !isPlaceholder(configuredModel)
        ? configuredModel
        : DEFAULT_XAI_MODEL,
  };
}

/** Build an xAI provider from explicit config (used by tests). */
export function createXaiProvider(
  cfg: XaiConfig,
  fetchImpl: typeof postJson = postJson
): Provider {
  return {
    name: "xai",
    async chat(messages: ChatMessage[], tools: ToolSchema[]): Promise<ChatResult> {
      const body: Record<string, unknown> = {
        model: cfg.model,
        messages: toWireMessages(messages),
      };
      if (tools.length > 0) {
        body.tools = tools.map((t) => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        }));
        body.tool_choice = "auto";
      }
      const raw = (await fetchImpl(`${cfg.baseUrl}/chat/completions`, {
        // The key is used only here, in the Authorization header. It is never
        // logged, never echoed, and never sent to any other host.
        headers: { Authorization: `Bearer ${cfg.apiKey}` },
        body,
        timeoutMs: 45_000,
      })) as {
        choices?: {
          message?: {
            content?: string | null;
            tool_calls?: XaiToolCallWire[];
          };
          finish_reason?: string;
        }[];
      };
      const choice = raw.choices?.[0];
      const msg = choice?.message ?? {};
      const toolCalls: ToolCallRequest[] = (msg.tool_calls ?? [])
        .filter((tc) => tc.function?.name)
        .map((tc, i) => ({
          id: tc.id || `call_${Date.now()}_${i}`,
          name: tc.function!.name as string,
          arguments: tc.function!.arguments ?? "{}",
        }));
      return {
        text: msg.content ?? "",
        toolCalls,
        stopReason: choice?.finish_reason ?? "stop",
      };
    },
  };
}
