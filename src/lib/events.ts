/**
 * StudyRunway agent event bus.
 *
 * Shared contract between the chat UI workstream (which publishes every SSE
 * event it receives from /api/agent/chat) and the 3D tool visualizer
 * workstream (which subscribes to render only real orchestration events).
 *
 * The API below is fixed — do not rename or reshape it without coordinating
 * with both workstreams.
 */

export type AgentStreamEvent =
  | { type: "status"; phase: string }
  | {
      type: "tool_call_start";
      id: string;
      tool: string;
      label: string;
    }
  | {
      type: "tool_call_end";
      id: string;
      tool: string;
      ok: boolean;
      summary: string;
      durationMs: number;
    }
  | { type: "assistant_text"; text: string }
  | { type: "clarify"; questions: ClarifyQuestion[] }
  | { type: "result"; component: string; data: Record<string, unknown> }
  | { type: "error"; message: string; recoverable: boolean };

export interface ClarifyQuestion {
  id: string;
  kind: "quick_replies" | "date" | "amount" | "currency" | "form";
  prompt: string;
  options?: string[];
  fields?: {
    name: string;
    label: string;
    type: "text" | "number" | "date" | "select";
    options?: string[];
    required: boolean;
  }[];
}

type Listener = (e: AgentStreamEvent) => void;

const listeners = new Set<Listener>();

/**
 * Publish an agent stream event to every subscriber (the 3D visualizer and
 * any other workstream that needs real orchestration events). Every SSE
 * event received by the chat UI must be passed through here.
 */
export function publishAgentEvent(e: AgentStreamEvent): void {
  for (const fn of listeners) {
    try {
      fn(e);
    } catch {
      // One misbehaving subscriber must not break the stream or the others.
    }
  }
}

/**
 * Subscribe to agent stream events. Returns an unsubscribe function.
 */
export function subscribeAgentEvent(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
