/**
 * Anthropic (Claude) provider adapter — fallback provider for StudyRunway.
 *
 * API SHAPE VERIFIED against Anthropic's official Messages API pattern
 * (https://docs.anthropic.com / platform.claude.com/docs/en/api/messages):
 * POST https://api.anthropic.com/v1/messages with `x-api-key` + the
 * `anthropic-version: 2023-06-01` header; system prompt as a top-level
 * `system` field; tools as [{name, description, input_schema}]; tool use
 * returned as `tool_use` content blocks with stop_reason "tool_use"; tool
 * results sent back as `tool_result` blocks in a user message.
 *
 * DEFAULT MODEL NOTE (UNVERIFIED against the live models list): the default
 * below mirrors the Claude 4.x family IDs in recent mirrors of Anthropic's
 * docs. Model IDs change — set ANTHROPIC_MODEL explicitly, or confirm at
 * https://docs.anthropic.com/en/docs/about-claude/models.
 */
import { postJson } from "./http";
import type {
  ChatMessage,
  ChatResult,
  Provider,
  ToolCallRequest,
  ToolSchema,
} from "./types";

/** Best-effort default — UNVERIFIED against the live models list; prefer ANTHROPIC_MODEL. */
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6";
export const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_MAX_TOKENS = 4096;

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string };

interface AnthropicWireMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

/**
 * Convert provider-neutral messages to the Anthropic Messages shape:
 * system → top-level `system`; consecutive same-role turns merged (Anthropic
 * requires strict user/assistant alternation); tool results → tool_result
 * blocks inside one user message.
 */
function toWire(messages: ChatMessage[]): {
  system?: string;
  wire: AnthropicWireMessage[];
} {
  const systemParts: string[] = [];
  const wire: AnthropicWireMessage[] = [];

  const push = (role: "user" | "assistant", block: ContentBlock) => {
    const last = wire[wire.length - 1];
    if (last && last.role === role) {
      const existing: ContentBlock[] =
        typeof last.content === "string"
          ? [{ type: "text", text: last.content }]
          : last.content;
      existing.push(block);
      last.content = existing;
    } else {
      wire.push({ role, content: [block] });
    }
  };

  for (const m of messages) {
    if (m.role === "system") {
      systemParts.push(m.content);
      continue;
    }
    if (m.role === "assistant") {
      if (m.content) push("assistant", { type: "text", text: m.content });
      for (const tc of m.toolCalls ?? []) {
        let input: unknown = {};
        try {
          input = JSON.parse(tc.arguments);
        } catch {
          input = {};
        }
        push("assistant", { type: "tool_use", id: tc.id, name: tc.name, input });
      }
      continue;
    }
    if (m.role === "tool") {
      push("user", {
        type: "tool_result",
        tool_use_id: m.toolCallId ?? "",
        content: m.content,
      });
      continue;
    }
    // role "user"
    push("user", { type: "text", text: m.content });
  }

  return {
    system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
    wire,
  };
}

export interface AnthropicConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export function readAnthropicConfig(): AnthropicConfig | null {
  const apiKey = (process.env.ANTHROPIC_API_KEY ?? "").trim();
  if (!apiKey || /^(?:<redacted>|placeholder|your[_ -].*)$/i.test(apiKey)) return null;
  const configuredModel = (process.env.ANTHROPIC_MODEL ?? "").trim();
  const modelIsPlaceholder = /^(?:placeholder|your[_ -].*)$/i.test(configuredModel);
  return {
    apiKey,
    baseUrl: DEFAULT_ANTHROPIC_BASE_URL,
    model: configuredModel && !modelIsPlaceholder ? configuredModel : DEFAULT_ANTHROPIC_MODEL,
  };
}

/** Build an Anthropic provider from explicit config (used by tests). */
export function createAnthropicProvider(
  cfg: AnthropicConfig,
  fetchImpl: typeof postJson = postJson
): Provider {
  return {
    name: "anthropic",
    async chat(messages: ChatMessage[], tools: ToolSchema[]): Promise<ChatResult> {
      const { system, wire } = toWire(messages);
      const body: Record<string, unknown> = {
        model: cfg.model,
        max_tokens: ANTHROPIC_MAX_TOKENS,
        messages: wire,
      };
      if (system) body.system = system;
      if (tools.length > 0) {
        body.tools = tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters,
        }));
        body.tool_choice = { type: "auto" };
      }
      const raw = (await fetchImpl(`${cfg.baseUrl}/v1/messages`, {
        // The key is used only here, in the x-api-key header. It is never
        // logged, never echoed, and never sent to any other host.
        headers: {
          "x-api-key": cfg.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body,
        timeoutMs: 45_000,
      })) as {
        content?: ContentBlock[];
        stop_reason?: string;
      };
      const textParts: string[] = [];
      const toolCalls: ToolCallRequest[] = [];
      for (const block of raw.content ?? []) {
        if (block.type === "text") textParts.push(block.text);
        else if (block.type === "tool_use") {
          toolCalls.push({
            id: block.id,
            name: block.name,
            arguments: JSON.stringify(block.input ?? {}),
          });
        }
      }
      return {
        text: textParts.join("\n"),
        toolCalls,
        stopReason: raw.stop_reason ?? "end_turn",
      };
    },
  };
}
