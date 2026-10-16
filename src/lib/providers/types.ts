/**
 * Model-provider abstraction — owned by the AGENT CORE workstream.
 *
 * Every adapter speaks the same contract: given a message list and a set of
 * tool schemas, return the model's text and/or its tool-call requests.
 * Adapters are thin HTTP clients; orchestration lives in `lib/agent`.
 */

export type ProviderName = "xai" | "gemini" | "vertex" | "openai" | "anthropic";

export type ChatRole = "system" | "user" | "assistant" | "tool";

/** A single turn in provider-neutral form. */
export interface ChatMessage {
  role: ChatRole;
  /** Plain text content. */
  content: string;
  /** For role "tool": the id of the tool call this is the result of. */
  toolCallId?: string;
  /** For role "assistant": tool calls the assistant is making. */
  toolCalls?: ToolCallRequest[];
}

/** A model-requested tool invocation. `arguments` is a JSON string. */
export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: string;
  /** Provider-native metadata that must round-trip with assistant tool calls (e.g. Vertex thought signatures). */
  providerMetadata?: Record<string, unknown>;
}

/** A tool exposed to the model. `parameters` is a JSON Schema object. */
export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** What a provider returns for one chat turn. */
export interface ChatResult {
  /** Assistant text (may be empty when the model only calls tools). */
  text: string;
  /** Tool calls requested by the model (may be empty). */
  toolCalls: ToolCallRequest[];
  /** Provider-native finish reason, e.g. "stop" | "tool_calls" | "length". */
  stopReason: string;
}

/** Thin adapter interface every provider implements. */
export interface Provider {
  name: ProviderName;
  /**
   * One non-streaming chat turn with tool-calling support.
   * Implementations must apply their own HTTP timeout and surface HTTP
   * failures as thrown errors (never swallow them into `text`).
   */
  chat(messages: ChatMessage[], tools: ToolSchema[]): Promise<ChatResult>;
}
