import { describe, expect, it, vi } from "vitest";
import {
  publishAgentEvent,
  subscribeAgentEvent,
  type AgentStreamEvent,
} from "./events";

describe("agent event bus", () => {
  it("delivers published events to every subscriber", () => {
    const seen: AgentStreamEvent[] = [];
    const seen2: AgentStreamEvent[] = [];
    const unsub1 = subscribeAgentEvent((e) => seen.push(e));
    const unsub2 = subscribeAgentEvent((e) => seen2.push(e));
    const event: AgentStreamEvent = {
      type: "tool_call_start",
      id: "t1",
      tool: "compare_transfers",
      label: "Comparing transfer quotes",
    };
    publishAgentEvent(event);
    expect(seen).toEqual([event]);
    expect(seen2).toEqual([event]);
    unsub1();
    unsub2();
  });

  it("unsubscribe stops delivery", () => {
    const fn = vi.fn();
    const unsub = subscribeAgentEvent(fn);
    unsub();
    publishAgentEvent({ type: "status", phase: "planning" });
    expect(fn).not.toHaveBeenCalled();
  });

  it("a throwing subscriber does not break the others", () => {
    const good = vi.fn();
    const unsubBad = subscribeAgentEvent(() => {
      throw new Error("boom");
    });
    const unsubGood = subscribeAgentEvent(good);
    expect(() =>
      publishAgentEvent({ type: "status", phase: "done" }),
    ).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
    unsubBad();
    unsubGood();
  });
});
