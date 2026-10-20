/**
 * Google Vertex AI Gemini provider using Google's OpenAI-compatible Chat
 * Completions endpoint. Authentication is server-side Application Default
 * Credentials (ADC); access tokens are short-lived and refreshed by the auth
 * client. Project IDs and locations are validated before constructing the
 * Google endpoint, so credentials are never sent to a caller-supplied host.
 */
import { GoogleAuth } from "google-auth-library";
import { postJson } from "./http";
import type {
  ChatMessage,
  ChatOptions,
  ChatResult,
  Provider,
  ToolCallRequest,
  ToolSchema,
} from "./types";

export const DEFAULT_VERTEX_AI_LOCATION = "global";
export const DEFAULT_VERTEX_AI_MODEL = "google/gemini-3.5-flash";
export const DEFAULT_VERTEX_AI_TIMEOUT_MS = 90_000;
const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const LOCATION_PATTERN = /^(?:global|[a-z0-9]+(?:-[a-z0-9]+)*)$/;

function isPlaceholder(value: string): boolean {
  return /^(?:<redacted>|placeholder|your[_ -].*)$/i.test(value.trim());
}

function normalizeModel(value: string | undefined): string | null {
  const candidate = (value ?? "").trim();
  if (!candidate || isPlaceholder(candidate)) return DEFAULT_VERTEX_AI_MODEL;
  const model = candidate.startsWith("google/") ? candidate : `google/${candidate}`;
  if (!/^google\/[a-z0-9][a-z0-9._-]{0,127}$/i.test(model)) {
    return null;
  }
  return model;
}

function readVertexTimeoutMs(): number {
  const configured = Number.parseInt(process.env.VERTEX_AI_TIMEOUT_MS ?? "", 10);
  return Number.isSafeInteger(configured) && configured >= 10_000 && configured <= 150_000
    ? configured
    : DEFAULT_VERTEX_AI_TIMEOUT_MS;
}

export interface VertexConfig {
  projectId: string;
  location: string;
  model: string;
}

/** Read standard Google Cloud project settings; credentials are resolved lazily by ADC. */
export function readVertexConfig(): VertexConfig | null {
  const authMode = (process.env.AUTH_MODE ?? "ADC").trim().toUpperCase();
  if (authMode !== "ADC") return null;

  const projectId = [
    process.env.VERTEX_AI_PROJECT_ID,
    process.env.VERTEX_AI_PROJECT,
    process.env.GOOGLE_CLOUD_PROJECT,
  ].map((value) => (value ?? "").trim()).find((value) => value && !isPlaceholder(value)) ?? "";
  if (!PROJECT_ID_PATTERN.test(projectId) || isPlaceholder(projectId)) return null;

  const configuredLocation = (
    process.env.VERTEX_AI_LOCATION ??
    process.env.GOOGLE_CLOUD_LOCATION ??
    DEFAULT_VERTEX_AI_LOCATION
  ).trim();
  if (!LOCATION_PATTERN.test(configuredLocation)) return null;

  const model = normalizeModel(process.env.VERTEX_AI_MODEL);
  if (!model) return null;

  return {
    projectId,
    location: configuredLocation,
    model,
  };
}

function vertexChatCompletionsUrl(projectId: string, location: string): string {
  if (!PROJECT_ID_PATTERN.test(projectId) || !LOCATION_PATTERN.test(location)) {
    throw new Error("Vertex AI requires a valid Google Cloud project ID and location");
  }
  const host = location === "global"
    ? "aiplatform.googleapis.com"
    : `${location}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${projectId}/locations/${location}/endpoints/openapi/chat/completions`;
}

function toWireMessages(messages: ChatMessage[]): unknown[] {
  return messages.map((message) => {
    if (message.role === "assistant" && message.toolCalls?.length) {
      return {
        role: "assistant",
        content: message.content || null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: call.arguments },
          ...(call.providerMetadata
            ? { extra_content: call.providerMetadata }
            : {}),
        })),
      };
    }
    if (message.role === "tool") {
      return {
        role: "tool",
        tool_call_id: message.toolCallId ?? "",
        content: message.content,
      };
    }
    return { role: message.role, content: message.content };
  });
}

interface VertexToolCallWire {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
  extra_content?: Record<string, unknown>;
}

interface VertexChatResponse {
  choices?: {
    message?: { content?: string | null; tool_calls?: VertexToolCallWire[] };
    finish_reason?: string;
  }[];
}

export type VertexAccessTokenSource = () => Promise<string>;

export function createVertexAccessTokenSource(projectId: string): VertexAccessTokenSource {
  const auth = new GoogleAuth({
    projectId,
    scopes: [CLOUD_PLATFORM_SCOPE],
  });
  return async () => {
    const token = await auth.getAccessToken();
    if (!token) {
      throw new Error(
        "Google Cloud ADC returned no access token. Run `gcloud auth application-default login` or configure GOOGLE_APPLICATION_CREDENTIALS.",
      );
    }
    return token;
  };
}

/** Create the Vertex adapter. Optional token source is for deterministic adapter tests. */
export function createVertexProvider(
  cfg: VertexConfig,
  fetchImpl: typeof postJson = postJson,
  tokenSource: VertexAccessTokenSource = createVertexAccessTokenSource(cfg.projectId),
): Provider {
  const url = vertexChatCompletionsUrl(cfg.projectId, cfg.location);
  return {
    name: "vertex",
    async chat(messages: ChatMessage[], tools: ToolSchema[], options?: ChatOptions): Promise<ChatResult> {
      const token = await tokenSource();
      const body: Record<string, unknown> = {
        model: cfg.model,
        messages: toWireMessages(messages),
      };
      // Gemini 3 defaults to medium reasoning. The agent verifies financial
      // figures with deterministic tools, so low reasoning keeps the model's
      // routing/planning calls responsive without delegating calculations to it.
      if (/^google\/gemini-3(?:\.|-)/i.test(cfg.model)) {
        body.reasoning_effort = "low";
        body.max_tokens = 4096;
      }
      if (options?.responseFormat === "json_object") {
        body.response_format = { type: "json_object" };
      } else if (options?.responseFormat?.type === "json_schema") {
        body.response_format = {
          type: "json_schema",
          json_schema: {
            name: options.responseFormat.name,
            schema: options.responseFormat.schema,
          },
        };
      }
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

      const raw = (await fetchImpl(url, {
        headers: { Authorization: `Bearer ${token}` },
        body,
        timeoutMs: readVertexTimeoutMs(),
      })) as VertexChatResponse;

      const choice = raw.choices?.[0];
      const message = choice?.message ?? {};
      const toolCalls: ToolCallRequest[] = (message.tool_calls ?? [])
        .filter((call) => Boolean(call.function?.name))
        .map((call, index) => ({
          id: call.id || `vertex_call_${Date.now()}_${index}`,
          name: call.function!.name as string,
          arguments: call.function!.arguments ?? "{}",
          ...(call.extra_content ? { providerMetadata: call.extra_content } : {}),
        }));

      return {
        text: message.content ?? "",
        toolCalls,
        stopReason: choice?.finish_reason ?? "stop",
      };
    },
  };
}
