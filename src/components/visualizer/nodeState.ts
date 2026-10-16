/**
 * Pure event-reduction logic for the 3D tool visualizer.
 *
 * This module is deliberately side-effect free: it maps a stream of
 * AgentStreamEvent into node states. The honesty guarantees are encoded
 * here and covered by tests:
 *
 * - A node is created ONLY by a real `tool_call_start` event.
 * - A node becomes success/failed ONLY by a real `tool_call_end` event
 *   for that same id.
 * - A `tool_call_end` for an unknown id is ignored (no phantom nodes).
 * - The phase indicator is set ONLY by real `status` events.
 * - `assistant_text`, `clarify`, `result`, and `error` events never
 *   create or animate tool nodes.
 */

import type { AgentStreamEvent } from "@/lib/events";

export type NodeStatus = "active" | "success" | "failed";

/** One tool call as shown in the visualizer. */
export interface ToolNodeView {
  /** The id from the tool_call_start/end events. */
  id: string;
  /** Tool name, e.g. "compute_forecast". */
  tool: string;
  /** Human label from the start event. */
  label: string;
  /** Driven ONLY by matching start/end events. */
  status: NodeStatus;
  /** Wall-clock ms when the start event was reduced. */
  startedAt: number;
  /** Wall-clock ms when the end event was reduced (null while active). */
  endedAt: number | null;
  /** The agent's own measured duration from the end event. */
  durationMs: number | null;
  /** The agent's own summary from the end event. */
  summary: string | null;
}

/** A task-level result reported by the agent (NOT tied to one tool call). */
export interface AgentResultView {
  component: string;
  data: Record<string, unknown>;
  evidenceLabels: string[];
}

export interface VisualizerState {
  /** All tool nodes in call order. */
  nodes: ToolNodeView[];
  /** Set ONLY by status events. */
  phase: string | null;
  /** True once any start/status/clarify/result/error event arrived. */
  hasTask: boolean;
  /** Task-level results, kept separate from per-node data. */
  results: AgentResultView[];
  /** The agent's own error text, if it reported one. */
  errorMessage: string | null;
  errorRecoverable: boolean;
  /** True after a clarify event until a new status arrives. */
  awaitingClarification: boolean;
}

/** Max nodes drawn in the 3D scene; older ones collapse into a cluster. */
export const MAX_VISIBLE_NODES = 8;

/** Special id for the "+n earlier" cluster node. */
export const CLUSTER_ID = "__earlier__";

/** Keys we accept as "evidence labels" inside result data. */
const EVIDENCE_KEYS = ["evidenceRefs", "evidence", "evidenceLabels"] as const;

/** Extract evidence labels from a result payload — string arrays only. */
export function extractEvidenceLabels(
  data: Record<string, unknown>,
): string[] {
  const out: string[] = [];
  for (const key of EVIDENCE_KEYS) {
    const v = data[key];
    if (Array.isArray(v)) {
      for (const item of v) {
        if (typeof item === "string" && !out.includes(item)) {
          out.push(item);
        }
      }
    }
  }
  return out;
}

export function initialVisualizerState(): VisualizerState {
  return {
    nodes: [],
    phase: null,
    hasTask: false,
    results: [],
    errorMessage: null,
    errorRecoverable: false,
    awaitingClarification: false,
  };
}

/**
 * Reduce one event into the next state. `now` is the wall-clock time
 * (Date.now()) at which the event is being reduced — passed in so the
 * reducer stays pure and testable.
 */
export function reduceVisualizerState(
  state: VisualizerState,
  event: AgentStreamEvent,
  now: number,
): VisualizerState {
  switch (event.type) {
    case "tool_call_start": {
      // Duplicate start for the same id: ignore — one call, one node.
      if (state.nodes.some((n) => n.id === event.id)) {
        return state;
      }
      const node: ToolNodeView = {
        id: event.id,
        tool: event.tool,
        label: event.label,
        status: "active",
        startedAt: now,
        endedAt: null,
        durationMs: null,
        summary: null,
      };
      return { ...state, nodes: [...state.nodes, node], hasTask: true };
    }
    case "tool_call_end": {
      const idx = state.nodes.findIndex((n) => n.id === event.id);
      // End for an unknown id: ignore. We never invent a node from an end.
      if (idx === -1) {
        return state;
      }
      const nodes = state.nodes.slice();
      nodes[idx] = {
        ...nodes[idx],
        status: event.ok ? "success" : "failed",
        endedAt: now,
        durationMs: event.durationMs,
        summary: event.summary,
      };
      return { ...state, nodes, hasTask: true };
    }
    case "status": {
      return {
        ...state,
        phase: event.phase,
        hasTask: true,
        awaitingClarification: false,
      };
    }
    case "clarify": {
      return { ...state, awaitingClarification: true, hasTask: true };
    }
    case "result": {
      return {
        ...state,
        hasTask: true,
        results: [
          ...state.results,
          {
            component: event.component,
            data: event.data,
            evidenceLabels: extractEvidenceLabels(event.data),
          },
        ],
      };
    }
    case "error": {
      return {
        ...state,
        hasTask: true,
        errorMessage: event.message,
        errorRecoverable: event.recoverable,
      };
    }
    case "assistant_text": {
      // Real agent output — marks a task as running, but never makes nodes.
      return { ...state, hasTask: true };
    }
  }
}

export interface VisibleLayout {
  /** Nodes drawn individually, in call order (at most MAX_VISIBLE_NODES). */
  shown: ToolNodeView[];
  /** How many older nodes collapsed into the "+n earlier" cluster. */
  collapsedCount: number;
  /** The collapsed nodes themselves (for the cluster peek panel). */
  collapsed: ToolNodeView[];
}

/** Deterministic layout split: horizontal pipeline, oldest collapse first. */
export function layoutNodes(state: VisualizerState): VisibleLayout {
  const shown = state.nodes.slice(-MAX_VISIBLE_NODES);
  const collapsed = state.nodes.slice(0, state.nodes.length - shown.length);
  return { shown, collapsedCount: collapsed.length, collapsed };
}
