/**
 * Tests for the tool registry: hidden __ping tool, model allow-list, and
 * zod arg validation rejecting bad args before any handler runs.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import { z } from "zod";
import {
  loadRegistry,
  getModelTools,
  findTool,
  resetRegistryCache,
  PING_TOOL,
} from "../registry";
import { executeToolCall, ArgsValidationError } from "../orchestrator";
import type { ToolContext } from "../tools";

beforeEach(() => {
  resetRegistryCache();
});

const ctx: ToolContext = { sessionId: "s", taskId: "t" };

describe("registry", () => {
  it("includes the hidden __ping tool", async () => {
    const all = await loadRegistry();
    expect(all.map((t) => t.name)).toContain("__ping");
  });

  it("excludes __ping (and any __-prefixed tool) from the model tool list", async () => {
    const all = await loadRegistry();
    const modelTools = getModelTools(all);
    expect(modelTools.map((t) => t.name)).not.toContain("__ping");
    expect(modelTools.every((t) => !t.name.startsWith("__"))).toBe(true);
  });

  it("findTool locates tools by name", async () => {
    const all = await loadRegistry();
    expect(findTool(all, "__ping")?.name).toBe("__ping");
    expect(findTool(all, "nope")).toBeUndefined();
  });

  it("validates args with zod and rejects bad args without running the handler", async () => {
    const handler = vi.fn(async () => ({ ok: true, summary: "ran" }));
    const tool = {
      name: "strict_tool",
      description: "takes a number",
      parameters: z.object({ amount: z.number().positive() }),
      requiresApproval: false,
      handler,
    };
    await expect(
      executeToolCall(tool, { amount: "a lot" }, ctx, 1000)
    ).rejects.toBeInstanceOf(ArgsValidationError);
    expect(handler).not.toHaveBeenCalled();

    const good = await executeToolCall(tool, { amount: 42 }, ctx, 1000);
    expect(good.result.ok).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("__ping echoes through the real execute path", async () => {
    const exec = await executeToolCall(PING_TOOL, { message: "hello" }, ctx, 1000);
    expect(exec.result.ok).toBe(true);
    expect(exec.result.summary).toContain("hello");
    expect(exec.attempts).toBe(1);
  });

  it("merges the real financial tools when @/lib/tools has landed", async () => {
    const all = await loadRegistry();
    const names = all.map((t) => t.name);
    // financial-tools workstream ships these eight
    for (const expected of [
      "analyze_funding_gap",
      "compare_transfers",
      "extract_document",
      "simulate_scenario",
      "research_policy",
      "build_action_plan",
      "draft_email",
    ]) {
      expect(names).toContain(expected);
    }
    const modelTools = getModelTools(all);
    expect(modelTools.map((t) => t.name)).not.toContain("__ping");
    // every model tool satisfies the agent-core contract
    for (const t of modelTools) {
      expect(typeof t.name).toBe("string");
      expect(typeof t.description).toBe("string");
      expect(typeof t.requiresApproval).toBe("boolean");
      expect(typeof t.handler).toBe("function");
      // parameters must be a zod schema (has .parse)
      expect(typeof (t.parameters as { parse?: unknown }).parse).toBe("function");
    }
    // approval-gated tools are visible to the orchestrator
    const draft = findTool(all, "draft_email");
    expect(draft?.requiresApproval).toBe(true);
  });
});
