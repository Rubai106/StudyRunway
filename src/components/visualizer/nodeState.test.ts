/**
 * Honesty tests for the event-reduction logic.
 *
 * These tests encode the cardinal rule: the visualization must show ONLY
 * real orchestration events. Each test feeds the reducer event sequences
 * that LOOK plausible and asserts the reducer refuses to fabricate:
 * - nodes appear only from real tool_call_start events
 * - success/failed styling appears only from real tool_call_end events
 * - the phase comes only from real status events
 */

import { describe, expect, it } from "vitest";
import type { AgentStreamEvent } from "@/lib/events";
import {
  MAX_VISIBLE_NODES,
  extractEvidenceLabels,
  initialVisualizerState,
  layoutNodes,
  reduceVisualizerState,
  type VisualizerState,
} from "./nodeState";

function reduceAll(
  events: AgentStreamEvent[],
  startAt = 1_000_000,
): VisualizerState {
  let state = initialVisualizerState();
  let now = startAt;
  for (const e of events) {
    now += 50;
    state = reduceVisualizerState(state, e, now);
  }
  return state;
}

const start = (
  id: string,
  tool = "compute_forecast",
  label = "Computing forecast",
): AgentStreamEvent => ({ type: "tool_call_start", id, tool, label });

const end = (
  id: string,
  ok = true,
  summary = "Forecast computed",
  durationMs = 320,
): AgentStreamEvent => ({
  type: "tool_call_end",
  id,
  tool: "compute_forecast",
  ok,
  summary,
  durationMs,
});

describe("node creation — only from real tool_call_start", () => {
  it("creates a node for a real start event", () => {
    const state = reduceAll([start("t1")]);
    expect(state.nodes).toHaveLength(1);
    expect(state.nodes[0]).toMatchObject({
      id: "t1",
      tool: "compute_forecast",
      label: "Computing forecast",
      status: "active",
      endedAt: null,
      durationMs: null,
      summary: null,
    });
    expect(state.hasTask).toBe(true);
  });

  it("creates NO node from an end event with no matching start", () => {
    // This is the fabrication case: an end arriving without a start must
    // not conjure a node out of thin air.
    const state = reduceAll([end("ghost")]);
    expect(state.nodes).toHaveLength(0);
  });

  it("creates NO nodes from status/assistant_text/clarify/result events alone", () => {
    const state = reduceAll([
      { type: "status", phase: "planning" },
      { type: "assistant_text", text: "Let me check that." },
      {
        type: "clarify",
        questions: [
          {
            id: "q1",
            kind: "quick_replies",
            prompt: "Which currency?",
            options: ["GBP", "BDT"],
          },
        ],
      },
      { type: "result", component: "GapCard", data: { gap: 450 } },
      { type: "error", message: "boom", recoverable: true },
    ]);
    expect(state.nodes).toHaveLength(0);
    // But the task is honestly marked as running / having reported things.
    expect(state.hasTask).toBe(true);
    expect(state.phase).toBe("planning");
    expect(state.awaitingClarification).toBe(true);
    expect(state.results).toHaveLength(1);
    expect(state.errorMessage).toBe("boom");
  });

  it("ignores a duplicate start for the same id", () => {
    const state = reduceAll([start("t1"), start("t1", "other_tool")]);
    expect(state.nodes).toHaveLength(1);
    expect(state.nodes[0].tool).toBe("compute_forecast");
  });
});

describe("node settlement — only from real tool_call_end", () => {
  it("settles to success with the agent's own summary and duration", () => {
    const state = reduceAll([
      start("t1"),
      end("t1", true, "Forecast ready: £1,820 gap on 4 Nov", 410),
    ]);
    expect(state.nodes[0]).toMatchObject({
      status: "success",
      summary: "Forecast ready: £1,820 gap on 4 Nov",
      durationMs: 410,
    });
    expect(state.nodes[0].endedAt).toBeGreaterThan(state.nodes[0].startedAt);
  });

  it("settles to failed ONLY from a real end with ok:false", () => {
    const state = reduceAll([start("t1"), end("t1", false, "FX API timed out", 1200)]);
    expect(state.nodes[0].status).toBe("failed");
    expect(state.nodes[0].summary).toBe("FX API timed out");
  });

  it("never marks a node failed without a real end event", () => {
    const state = reduceAll([
      start("t1"),
      { type: "error", message: "something broke", recoverable: true },
      { type: "status", phase: "recovering" },
    ]);
    // The error is shown honestly as an error banner; the node's status
    // is untouched — an error event is not a tool_call_end.
    expect(state.nodes[0].status).toBe("active");
    expect(state.errorMessage).toBe("something broke");
  });

  it("an end for one id never settles a different node", () => {
    const state = reduceAll([start("t1"), start("t2"), end("t1", false, "x", 5)]);
    expect(state.nodes.find((n) => n.id === "t1")?.status).toBe("failed");
    expect(state.nodes.find((n) => n.id === "t2")?.status).toBe("active");
  });
});

describe("phase — only from real status events", () => {
  it("reflects the latest real status phase", () => {
    const state = reduceAll([
      { type: "status", phase: "understanding" },
      start("t1"),
      { type: "status", phase: "calling_tools" },
    ]);
    expect(state.phase).toBe("calling_tools");
  });

  it("starts unset and is never invented", () => {
    const state = reduceAll([start("t1")]);
    expect(state.phase).toBeNull();
  });
});

describe("layout — deterministic, max 8, older collapse", () => {
  it("shows all nodes when within the limit", () => {
    const events = Array.from({ length: 5 }, (_, i) => start(`t${i}`));
    const { shown, collapsedCount } = layoutNodes(reduceAll(events));
    expect(shown).toHaveLength(5);
    expect(collapsedCount).toBe(0);
  });

  it("collapses older nodes into a +n cluster beyond the limit", () => {
    const events = Array.from({ length: 12 }, (_, i) => start(`t${i}`));
    const state = reduceAll(events);
    const { shown, collapsedCount, collapsed } = layoutNodes(state);
    expect(shown).toHaveLength(MAX_VISIBLE_NODES);
    expect(collapsedCount).toBe(4);
    expect(collapsed.map((n) => n.id)).toEqual(["t0", "t1", "t2", "t3"]);
    // Collapsed nodes keep their REAL data for the cluster peek panel.
    expect(shown.map((n) => n.id)).toEqual([
      "t4", "t5", "t6", "t7", "t8", "t9", "t10", "t11",
    ]);
  });

  it("keeps call order deterministic (no re-sorting)", () => {
    const events = [start("b"), start("a"), start("c")];
    const { shown } = layoutNodes(reduceAll(events));
    expect(shown.map((n) => n.id)).toEqual(["b", "a", "c"]);
  });
});

describe("results and evidence — shown only when actually reported", () => {
  it("extracts evidence labels only from string arrays", () => {
    expect(
      extractEvidenceLabels({
        evidenceRefs: ["tuition-invoice.pdf", "bank-statement.csv"],
        evidence: "not-an-array",
      }),
    ).toEqual(["tuition-invoice.pdf", "bank-statement.csv"]);
    expect(extractEvidenceLabels({})).toEqual([]);
    expect(extractEvidenceLabels({ evidenceLabels: [42, null] })).toEqual([]);
  });

  it("keeps results task-level, never attributed to a node", () => {
    const state = reduceAll([
      start("t1"),
      end("t1", true, "done", 10),
      {
        type: "result",
        component: "GapCard",
        data: { evidenceRefs: ["invoice.pdf"] },
      },
    ]);
    expect(state.nodes[0].summary).toBe("done");
    expect(state.results).toHaveLength(1);
    expect(state.results[0].evidenceLabels).toEqual(["invoice.pdf"]);
  });
});

describe("clarify — real events only", () => {
  it("marks awaiting clarification until a real status arrives", () => {
    let state = reduceAll([
      { type: "status", phase: "planning" },
      {
        type: "clarify",
        questions: [
          { id: "q1", kind: "quick_replies", prompt: "When?", options: ["Nov"] },
        ],
      },
    ]);
    expect(state.awaitingClarification).toBe(true);
    state = reduceVisualizerState(state, { type: "status", phase: "resuming" }, 999);
    expect(state.awaitingClarification).toBe(false);
  });
});
