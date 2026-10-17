/**
 * Google Gemini provider adapter using Google's OpenAI-compatible endpoint.
 *
 * Official docs: https://ai.google.dev/gemini-api/docs/openai
 * Default endpoint: https://generativelanguage.googleapis.com/v1beta/openai/
 * Obtain GEMINI_API_KEY from Google AI Studio. The key stays server-side.
 *
 * This adapter supports standard chat completions and custom function/tool
 * calls. It does not expose Gemini-native-only tools such as Google Search
 * grounding; those require the native Gemini API rather than the compatibility
 * endpoint.
 */
import { postJson } from "./http";
import type {
  ChatMessage,
  ChatResult,
  Provider,
  ToolCallRequest,
  ToolSchema,
} from "./types";

export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
export const DEFAULT_GEMINI_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai";

interface GeminiToolCallWire {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
  extra_content?: Record<string, unknown>;
}

function isPlaceholder(value: string): boolean {
  return /^(?:<redacted>|placeholder|your[_ -].*)$/i.test(value.trim());
}

function normalizeGeminiBaseUrl(value: string | undefined): string | null {
  const candidate = (value ?? "").trim();
  if (!candidate || isPlaceholder(candidate)) return DEFAULT_GEMINI_BASE_URL;
  try {
    const url = new URL(candidate);
    // Never send a Gemini API key to an arbitrary host accidentally.
    if (
      url.protocol !== "https:" ||
      url.hostname !== "generativelanguage.googleapis.com" ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^\/v1beta\/openai\/?$/.test(url.pathname)
    ) {
      return null;
    }
    return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
  } catch {
    return null;
  }
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
          ...(tc.providerMetadata !== undefined
            ? { extra_content: tc.providerMetadata }
            : {}),
        })),
      };
    }
    if (m.role === "tool") {
      return {
        role: "tool",
        tool_call_id: m.toolCallId ?? "",
        content: m.content,
      };
    }
    return { role: m.role, content: m.content };
  });
}

export interface GeminiConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export function readGeminiConfig(): GeminiConfig | null {
  const apiKey = (process.env.GEMINI_API_KEY ?? "").trim();
  if (!apiKey || isPlaceholder(apiKey)) return null;

  const baseUrl = normalizeGeminiBaseUrl(process.env.GEMINI_BASE_URL);
  // A malformed/overridden host should never receive a Google API key.
  if (!baseUrl) return null;

  const configuredModel = (process.env.GEMINI_MODEL ?? "").trim();
  return {
    apiKey,
    baseUrl,
    model:
      configuredModel && !isPlaceholder(configuredModel)
        ? configuredModel
        : DEFAULT_GEMINI_MODEL,
  };
}

/** Build a Gemini provider from explicit config (also used by mocked tests). */
export function createGeminiProvider(
  cfg: GeminiConfig,
  fetchImpl: typeof postJson = postJson,
): Provider {
  const safeBaseUrl = normalizeGeminiBaseUrl(cfg.baseUrl);
  if (!safeBaseUrl) {
    throw new Error("Gemini base URL must be Google's HTTPS OpenAI-compatible endpoint");
  }
  return {
    name: "gemini",
    async chat(messages: ChatMessage[], tools: ToolSchema[]): Promise<ChatResult> {
      const body: Record<string, unknown> = {
        model: cfg.model,
        messages: toWireMessages(messages),
      };
      if (tools.length > 0) {
        body.tools = tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        }));
        body.tool_choice = "auto";
      }

      const raw = (await fetchImpl(`${safeBaseUrl}/chat/completions`, {
        // Google's OpenAI-compatible endpoint accepts the API key as Bearer.
        // It is never logged, echoed, or sent to a non-Google hostname.
        headers: { Authorization: `Bearer ${cfg.apiKey}` },
        body,
        timeoutMs: 45_000,
      })) as {
        choices?: {
          message?: {
            content?: string | null;
            tool_calls?: GeminiToolCallWire[];
          };
          finish_reason?: string;
        }[];
      };

      const choice = raw.choices?.[0];
      const message = choice?.message ?? {};
      const toolCalls: ToolCallRequest[] = (message.tool_calls ?? [])
        .filter((call) => Boolean(call.function?.name))
        .map((call, index) => ({
          id: call.id || `gemini_call_${Date.now()}_${index}`,
          name: call.function!.name as string,
          arguments: call.function!.arguments ?? "{}",
          ...(call.extra_content !== undefined
            ? { providerMetadata: call.extra_content }
            : {}),
        }));

      return {
        text: message.content ?? "",
        toolCalls,
        stopReason: choice?.finish_reason ?? "stop",
      };
    },
  };
}
