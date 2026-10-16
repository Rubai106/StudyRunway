/**
 * OpenAI provider adapter — fallback provider for StudyRunway.
 *
 * API SHAPE VERIFIED against OpenAI's official API reference pattern
 * (https://platform.openai.com/docs/api-reference): POST
 * https://api.openai.com/v1/chat/completions with `Authorization: Bearer`
 * auth and the standard chat-completions tool-calling shape
 * (tools[].function / message.tool_calls). The same shape is documented in
 * OpenAI's official cookbook examples.
 *
 * DEFAULT MODEL NOTE (UNVERIFIED against the live models list): the default
 * below reflects model families documented in recent (2026) third-party
 * references to OpenAI's docs. Model IDs change — set OPENAI_MODEL
 * explicitly, or confirm at https://platform.openai.com/docs/models.
 */
import { postJson } from "./http";
import type {
  ChatMessage,
  ChatResult,
  Provider,
  ToolCallRequest,
  ToolSchema,
} from "./types";

/** Best-effort default — UNVERIFIED against the live models list; prefer OPENAI_MODEL. */
export const DEFAULT_OPENAI_MODEL = "gpt-5";
export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

interface OpenAiToolCallWire {
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

export interface OpenAiConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export function readOpenAiConfig(): OpenAiConfig | null {
  const apiKey = (process.env.OPENAI_API_KEY ?? "").trim();
  if (!apiKey || /^(?:<redacted>|placeholder|your[_ -].*)$/i.test(apiKey)) return null;
  const configuredModel = (process.env.OPENAI_MODEL ?? "").trim();
  const modelIsPlaceholder = /^(?:<redacted>|placeholder|your[_ -].*)$/i.test(configuredModel);
  const configuredBaseUrl = (process.env.OPENAI_BASE_URL ?? "").trim();
  const baseUrlIsPlaceholder = /^(?:placeholder|your[_ -].*)$/i.test(configuredBaseUrl);
  return {
    apiKey,
    baseUrl: configuredBaseUrl && !baseUrlIsPlaceholder
      ? configuredBaseUrl.replace(/\/+$/, "")
      : DEFAULT_OPENAI_BASE_URL,
    model: configuredModel && !modelIsPlaceholder ? configuredModel : DEFAULT_OPENAI_MODEL,
  };
}

/** Build an OpenAI provider from explicit config (used by tests). */
export function createOpenAiProvider(
  cfg: OpenAiConfig,
  fetchImpl: typeof postJson = postJson
): Provider {
  return {
    name: "openai",
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
            tool_calls?: OpenAiToolCallWire[];
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
