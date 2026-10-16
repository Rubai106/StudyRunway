/**
 * Agent tool contract — owned by the AGENT CORE workstream.
 *
 * This is the EXACT interface every tool (including the financial tools built
 * by the financial-tools workstream in `@/lib/tools`) must satisfy. Other
 * workstreams code against these three interfaces; do not change them without
 * coordinating.
 */
import type { z } from "zod";

/** Execution context handed to every tool handler. */
export interface ToolContext {
  /** Chat session the tool call belongs to. */
  sessionId: string;
  /** Agent task the tool call belongs to. */
  taskId: string;
}

/** Result returned by every tool handler. */
export interface ToolResult {
  /** Whether the tool completed its job. */
  ok: boolean;
  /** One-to-two sentence human-readable summary of what happened. */
  summary: string;
  /** Structured payload for the model / UI. Plain JSON-serialisable data. */
  data?: Record<string, unknown>;
  /** Pointers back to sources (documents, rows, quotes) the result relies on. */
  evidence?: { label: string; detail?: string }[];
}

/**
 * A tool the model may call. Arguments are validated with `parameters`
 * (a zod schema) BEFORE the handler runs — a tool never sees invalid args.
 */
export interface ToolDefinition {
  /** Unique snake_case name, e.g. "forecast_runway". */
  name: string;
  /** What the tool does and when the model should prefer it. */
  description: string;
  /** Zod schema for the tool's arguments. */
  parameters: z.ZodTypeAny;
  /** If true, the orchestrator pauses and asks the user to Approve/Deny first. */
  requiresApproval: boolean;
  /** The implementation. Must never move money, submit payments, or contact anyone. */
  handler: (
    args: Record<string, unknown>,
    ctx: ToolContext
  ) => Promise<ToolResult>;
}
