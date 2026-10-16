/**
 * Tests for the model-driven orchestrator loop: approval gates, retries,
 * timeouts, arg validation, allow-list enforcement, demo-mode labelling,
 * pause/resume, abort, and exact SSE event shapes.
 *
 * The model is a scripted fake — these tests verify the LOOP (the agent
 * core's responsibility), not any real provider.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import { z } from "zod";
import {
  runAgent,
  submitAnswers,
  executeToolCall,
  sanitizeForModel,
  DEMO_LABEL,
  DEMO_SAMPLE_ARGS,
  AgentEventSchemas,
  type AgentEvent,
} from "../orchestrator";
import { clearStore, getTask } from "../state";
import { PING_TOOL } from "../registry";
import { buildLivingCostPlanTool } from "../../tools/buildLivingCostPlan";
import { buildLivingCostPlan, getDestination } from "../../livingCosts";
import { HttpError } from "../../providers/http";
import type { Provider, ChatResult, ChatMessage, ToolSchema } from "../../providers/types";
import type { ToolDefinition, ToolResult } from "../tools";

beforeEach(() => {
  clearStore();
  vi.restoreAllMocks();
});

/** Scripted stand-in for a real model provider. */
class ScriptedProvider implements Provider {
  name = "xai" as const;
  calls: { messages: ChatMessage[]; tools: ToolSchema[] }[] = [];
  constructor(private queue: ChatResult[]) {}
  async chat(messages: ChatMessage[], tools: ToolSchema[]): Promise<ChatResult> {
    this.calls.push({ messages, tools });
    const next = this.queue.shift();
    if (!next) throw new Error("scripted provider: response queue exhausted");
    return next;
  }
}

const json = (v: unknown): ChatResult => ({
  text: JSON.stringify(v),
  toolCalls: [],
  stopReason: "stop",
});
const textOnly = (text: string): ChatResult => ({ text, toolCalls: [], stopReason: "stop" });
const toolTurn = (calls: { id: string; name: string; args: unknown }[]): ChatResult => ({
  text: "",
  toolCalls: calls.map((c) => ({
    id: c.id,
    name: c.name,
    arguments: JSON.stringify(c.args),
  })),
  stopReason: "tool_calls",
});

const UNDERSTANDING = {
  summary: "User wants a runway forecast.",
  keyFacts: [],
  assumptions: [],
  missingInfo: [],
  currencies: ["GBP"],
  questions: [],
};
const PLAN = { steps: [{ id: "s1", title: "Run the calculation" }] };

async function collect(
  gen: AsyncGenerator<AgentEvent>
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

/** Every emitted event must match its exact SSE shape schema. */
function expectValidEvents(events: AgentEvent[]): void {
  expect(events.length).toBeGreaterThan(0);
  for (const ev of events) {
    const schema =
      AgentEventSchemas[ev.type as keyof typeof AgentEventSchemas];
    expect(schema, `event ${JSON.stringify(ev).slice(0, 120)}`).toBeDefined();
    expect(() => schema.parse(ev)).not.toThrow();
  }
}

function calcTool(): ToolDefinition {
  return {
    name: "forecast_calc",
    description: "Doubles a number deterministically.",
    parameters: z.object({ x: z.number() }),
    requiresApproval: false,
    handler: async (args): Promise<ToolResult> => {
      const x = args["x"] as number;
      return {
        ok: true,
        summary: `computed ${x * 2}`,
        data: { input: x, output: x * 2 },
        evidence: [{ label: "calc-engine" }],
      };
    },
  };
}

describe("model-driven loop", () => {
  it("answers a plain greeting without asking for financial details", async () => {
    const provider = new ScriptedProvider([]);
    const events = await collect(
      runAgent({ sessionId: "s-greeting", message: "hi", tools: [PING_TOOL], provider })
    );
    expectValidEvents(events);
    expect(events.some((event) => event.type === "clarify")).toBe(false);
    expect(events.find((event) => event.type === "assistant_text")).toMatchObject({
      text: expect.stringContaining("Hi! I'm StudyRunway"),
    });
    expect(provider.calls).toHaveLength(0);
    expect(getTask("s-greeting")).toBeUndefined();
  });

  it("fills omitted currency options before returning clarification to the UI", async () => {
    const provider = new ScriptedProvider([
      json({
        ...UNDERSTANDING,
        summary: "Plan study funding.",
        questions: [{ id: "q-home-currency", kind: "currency", prompt: "What is your home currency?" }],
      }),
    ]);
    const events = await collect(
      runAgent({ sessionId: "s-currency-options", message: "help me plan my study funding", tools: [PING_TOOL], provider })
    );
    expectValidEvents(events);
    const clarification = events.find((event) => event.type === "clarify");
    expect(clarification?.type).toBe("clarify");
    if (clarification?.type === "clarify") {
      expect(clarification.questions[0].options).toContain("BDT");
      expect(clarification.questions[0].options).toContain("EUR");
    }
  });
  it("runs understand → plan → tools → verify → outcome with exact event shapes", async () => {
    const provider = new ScriptedProvider([
      json(UNDERSTANDING),
      json(PLAN),
      toolTurn([{ id: "c1", name: "forecast_calc", args: { x: 21 } }]),
      textOnly("nothing more needed"),
      textOnly("Your runway is fine: 42."),
    ]);
    const events = await collect(
      runAgent({
        sessionId: "s-loop",
        message: "forecast my runway",
        tools: [PING_TOOL, calcTool()],
        provider,
        toolTimeoutMs: 2000,
      })
    );
    expectValidEvents(events);
    const types = events.map((e) => e.type);
    expect(types).toContain("status");
    expect(types).toContain("tool_call_start");
    expect(types).toContain("tool_call_end");
    expect(types).toContain("assistant_text");
    expect(types).toContain("result");
    // tool result surfaced
    const end = events.find((e) => e.type === "tool_call_end");
    expect(end).toMatchObject({ tool: "forecast_calc", ok: true });
    expect((end as { summary: string }).summary).toContain("42");
    // verification re-ran the computation independently
    const starts = events.filter((e) => e.type === "tool_call_start");
    expect(starts.some((s) => (s as { label: string }).label === "Verification re-run")).toBe(true);
    const result = events.find((e) => e.type === "result");
    expect(result).toMatchObject({ component: "financial_outcome" });
    expect(getTask("s-loop")?.status).toBe("done");
    // the model never saw the hidden __ping tool
    for (const call of provider.calls) {
      expect(call.tools.map((t) => t.name)).not.toContain("__ping");
    }
  });

  it("pauses on approval gates and never executes before approval", async () => {
    const handler = vi.fn(async (): Promise<ToolResult> => ({ ok: true, summary: "approved-run" }));
    const approvalTool: ToolDefinition = {
      name: "approval_tool",
      description: "Needs a human yes.",
      parameters: z.object({ x: z.number() }),
      requiresApproval: true,
      handler,
    };
    const provider = new ScriptedProvider([
      json(UNDERSTANDING),
      json(PLAN),
      toolTurn([{ id: "c1", name: "approval_tool", args: { x: 1 } }]),
    ]);
    const events = await collect(
      runAgent({
        sessionId: "s-appr",
        message: "run the risky thing",
        tools: [PING_TOOL, approvalTool],
        provider,
      })
    );
    expectValidEvents(events);
    const clarify = events.find((e) => e.type === "clarify");
    expect(clarify).toBeDefined();
    const q = (clarify as { questions: { kind: string; fields?: { name: string; options?: string[] }[] }[] }).questions[0];
    expect(q.kind).toBe("form");
    expect(q.fields?.[0]?.options).toContain("approve");
    expect(handler).not.toHaveBeenCalled();
    expect(getTask("s-appr")?.pendingApproval?.tool).toBe("approval_tool");

    // Deny → skipped, never executed.
    const deny = submitAnswers("s-appr", getTask("s-appr")!.pendingApproval!.id, {
      decision: "deny",
    });
    expect(deny.ok).toBe(true);
    expect(handler).not.toHaveBeenCalled();
    expect(getTask("s-appr")?.approvals[0]?.decision).toBe("denied");
  });

  it("resumes and executes after approval is granted", async () => {
    const handler = vi.fn(async (): Promise<ToolResult> => ({ ok: true, summary: "approved-run" }));
    const approvalTool: ToolDefinition = {
      name: "approval_tool",
      description: "Needs a human yes.",
      parameters: z.object({ x: z.number() }),
      requiresApproval: true,
      handler,
    };
    const provider = new ScriptedProvider([
      json(UNDERSTANDING),
      json(PLAN),
      toolTurn([{ id: "c1", name: "approval_tool", args: { x: 2 } }]),
      // second runAgent (resume): fresh understand/plan, no more tool calls
      json(UNDERSTANDING),
      json(PLAN),
      textOnly("all set"),
      textOnly("Done after your approval."),
    ]);
    await collect(
      runAgent({ sessionId: "s-appr2", message: "go", tools: [PING_TOOL, approvalTool], provider })
    );
    const approvalId = getTask("s-appr2")!.pendingApproval!.id;
    expect(submitAnswers("s-appr2", approvalId, { decision: "approve" }).ok).toBe(true);
    const events = await collect(
      runAgent({ sessionId: "s-appr2", message: "", tools: [PING_TOOL, approvalTool], provider })
    );
    expectValidEvents(events);
    // approved execution + verification re-run
    expect(handler).toHaveBeenCalledTimes(2);
    expect(getTask("s-appr2")?.status).toBe("done");
  });

  it("retries once on transient failure", async () => {
    let calls = 0;
    const flaky: ToolDefinition = {
      name: "flaky_tool",
      description: "Fails once, then works.",
      parameters: z.object({}),
      requiresApproval: false,
      handler: async (): Promise<ToolResult> => {
        calls += 1;
        if (calls === 1) throw new HttpError(500, "boom");
        return { ok: true, summary: "recovered" };
      },
    };
    const provider = new ScriptedProvider([
      json(UNDERSTANDING),
      json(PLAN),
      toolTurn([{ id: "c1", name: "flaky_tool", args: {} }]),
      textOnly("done"),
      textOnly("Recovered."),
    ]);
    const events = await collect(
      runAgent({
        sessionId: "s-retry",
        message: "try",
        tools: [PING_TOOL, flaky],
        provider,
        // maxToolCalls: 1 skips the verification re-run so the count below
        // measures exactly the execute path: 1 attempt + 1 retry
        maxToolCalls: 1,
      })
    );
    expectValidEvents(events);
    expect(calls).toBe(2);
    const end = events.find((e) => e.type === "tool_call_end" && (e as { tool: string }).tool === "flaky_tool");
    expect(end).toMatchObject({ ok: true, summary: "recovered" });
  });

  it("enforces the per-tool timeout", async () => {
    const slow: ToolDefinition = {
      name: "slow_tool",
      description: "Too slow.",
      parameters: z.object({}),
      requiresApproval: false,
      handler: async (): Promise<ToolResult> => {
        await new Promise((r) => setTimeout(r, 600));
        return { ok: true, summary: "too late" };
      },
    };
    const provider = new ScriptedProvider([
      json(UNDERSTANDING),
      json(PLAN),
      toolTurn([{ id: "c1", name: "slow_tool", args: {} }]),
      textOnly("done"),
      textOnly("Timed out, moving on."),
    ]);
    const events = await collect(
      runAgent({
        sessionId: "s-timeout",
        message: "go slow",
        tools: [PING_TOOL, slow],
        provider,
        toolTimeoutMs: 150,
      })
    );
    expectValidEvents(events);
    const end = events.find((e) => e.type === "tool_call_end");
    expect(end).toMatchObject({ ok: false });
    expect((end as { summary: string }).summary).toMatch(/timed out/i);
  });

  it("rejects bad tool args without executing the handler", async () => {
    const handler = vi.fn(async (): Promise<ToolResult> => ({ ok: true, summary: "ran" }));
    const strict: ToolDefinition = {
      name: "strict_tool",
      description: "Needs a number.",
      parameters: z.object({ amount: z.number() }),
      requiresApproval: false,
      handler,
    };
    const provider = new ScriptedProvider([
      json(UNDERSTANDING),
      json(PLAN),
      {
        text: "",
        toolCalls: [{ id: "c1", name: "strict_tool", arguments: '{"amount":"lots"}' }],
        stopReason: "tool_calls",
      },
      textOnly("done"),
      textOnly("Could not run with those args."),
    ]);
    const events = await collect(
      runAgent({ sessionId: "s-args", message: "go", tools: [PING_TOOL, strict], provider })
    );
    expectValidEvents(events);
    expect(handler).not.toHaveBeenCalled();
    const end = events.find((e) => e.type === "tool_call_end");
    expect(end).toMatchObject({ ok: false });
  });

  it("never executes tools that are not on the allow-list", async () => {
    const provider = new ScriptedProvider([
      json(UNDERSTANDING),
      json(PLAN),
      toolTurn([{ id: "c1", name: "evil_tool", args: {} }]),
      textOnly("done"),
      textOnly("Finished."),
    ]);
    const events = await collect(
      runAgent({ sessionId: "s-allow", message: "go", tools: [PING_TOOL, calcTool()], provider })
    );
    expectValidEvents(events);
    expect(events.filter((e) => e.type === "tool_call_start")).toHaveLength(0);
    // the model was told the call was refused
    const refused = provider.calls.some((c) =>
      c.messages.some(
        (m) => m.role === "tool" && m.content.includes("not on the allow-list")
      )
    );
    expect(refused).toBe(true);
  });

  it("pauses for clarification and resumes after /answer", async () => {
    const provider = new ScriptedProvider([
      {
        ...json(UNDERSTANDING),
        text: JSON.stringify({
          ...UNDERSTANDING,
          questions: [
            {
              id: "q_currency",
              kind: "currency",
              prompt: "Which currency should I plan in?",
              options: ["GBP", "USD"],
            },
          ],
        }),
      },
      json(UNDERSTANDING),
      json(PLAN),
      textOnly("done"),
      textOnly("Planned in GBP."),
    ]);
    const first = await collect(
      runAgent({ sessionId: "s-cl", message: "help me plan", tools: [PING_TOOL], provider })
    );
    expectValidEvents(first);
    expect(first.some((e) => e.type === "clarify")).toBe(true);
    expect(first.some((e) => e.type === "status" && e.phase === "done")).toBe(false);
    expect(getTask("s-cl")?.status).toBe("clarifying");

    expect(submitAnswers("s-cl", "q_currency", "GBP").ok).toBe(true);
    expect(getTask("s-cl")?.confirmedFacts.find((f) => f.key === "q_currency")).toMatchObject({
      value: "GBP",
      source: "user",
    });

    const second = await collect(
      runAgent({ sessionId: "s-cl", message: "", tools: [PING_TOOL], provider })
    );
    expectValidEvents(second);
    expect(getTask("s-cl")?.status).toBe("done");
    expect(second.find((e) => e.type === "result")).toBeDefined();
  });

  it("stops promptly when the client aborts", async () => {
    const provider = new ScriptedProvider([json(UNDERSTANDING)]);
    const controller = new AbortController();
    controller.abort();
    const events = await collect(
      runAgent({ sessionId: "s-abort", message: "go", tools: [PING_TOOL], provider, signal: controller.signal })
    );
    expect(events).toHaveLength(0);
    expect(provider.calls).toHaveLength(0);
  });

  it("sanitizes PII before it reaches the model", () => {
    const dirty = "mail me at jane.doe@example.com or +880 1712-345678 please";
    const clean = sanitizeForModel(dirty);
    expect(clean).not.toContain("jane.doe@example.com");
    expect(clean).not.toContain("1712-345678");
    expect(clean).toContain("[redacted-email]");
    expect(clean).toContain("[redacted-phone]");
  });

  it("redacts account-number-like and national-ID-like strings", () => {
    const dirty =
      "account 1234567890123456 and passport AB1234567, NID 1990123456789";
    const clean = sanitizeForModel(dirty);
    expect(clean).not.toContain("1234567890123456");
    expect(clean).not.toContain("AB1234567");
    expect(clean).not.toContain("1990123456789");
    expect(clean).toContain("[redacted-account-number]");
    expect(clean).toContain("[redacted-id]");
  });

  it("does not redact ordinary years, short numbers, or plain words", () => {
    const clean = sanitizeForModel("class of 2026, room 42, invoice INV-7");
    expect(clean).toBe("class of 2026, room 42, invoice INV-7");
  });

  it("redacts lowercase national-ID-like strings too", () => {
    const clean = sanitizeForModel("passport ab1234567, old nid x123456789");
    expect(clean).not.toContain("ab1234567");
    expect(clean).not.toContain("x123456789");
    expect(clean).toContain("[redacted-id]");
  });

  it("redacts PII in tool results before they reach the model", async () => {
    const provider = new ScriptedProvider([
      json(UNDERSTANDING),
      json(PLAN),
      toolTurn([{ id: "c1", name: "leaky_tool", args: {} }]),
      textOnly("nothing more needed"),
      textOnly("done."),
    ]);
    const leaky: ToolDefinition = {
      name: "leaky_tool",
      description: "Returns a summary containing PII.",
      parameters: z.object({}),
      requiresApproval: false,
      handler: async (): Promise<ToolResult> => ({
        ok: true,
        summary: "found passport ab1234567 on file",
        data: {},
        evidence: [],
      }),
    };
    const events = await collect(
      runAgent({
        sessionId: "s-redact-tool",
        message: "check the file",
        tools: [leaky],
        provider,
        toolTimeoutMs: 2000,
      })
    );
    expectValidEvents(events);
    // Every message the provider received must be free of the raw ID, and at
    // least one must carry the redaction marker (the tool result round-trip).
    let sawRedaction = false;
    for (const call of provider.calls) {
      for (const m of call.messages) {
        expect(m.content).not.toContain("ab1234567");
        if (m.content.includes("[redacted-id]")) sawRedaction = true;
      }
    }
    expect(sawRedaction).toBe(true);
  });
});

describe("demo mode (no provider key)", () => {
  function demoRun(sessionId: string, message: string, tools: ToolDefinition[]) {
    return runAgent({
      sessionId,
      message,
      tools,
      provider: null, // force demo mode
      toolTimeoutMs: 5000,
    });
  }

  const BUDGET_TOOLS = [PING_TOOL, buildLivingCostPlanTool];

  function expectAllLabelled(events: AgentEvent[]): void {
    for (const ev of events) {
      if (ev.type === "assistant_text") {
        expect(ev.text).toContain(DEMO_LABEL);
      }
      if (ev.type === "tool_call_end") {
        expect(ev.summary).toContain(DEMO_LABEL);
      }
      if (ev.type === "clarify") {
        for (const q of ev.questions) expect(q.prompt).toContain(DEMO_LABEL);
      }
      if (ev.type === "result") {
        expect(ev.data["demoMode"]).toBe(true);
        expect(String(ev.data["summary"])).toContain(DEMO_LABEL);
      }
    }
  }

  it("runs the REAL budget engine for the sample entry point — no hard-coded figures", async () => {
    const events = await collect(
      demoRun(
        "s-demo-budget",
        "Try the sample student budget — show me the Limerick sample",
        BUDGET_TOOLS
      )
    );
    expectValidEvents(events);
    expectAllLabelled(events);

    // The real tool ran through the real execute path (never __ping).
    const toolsCalled = events
      .filter((e) => e.type === "tool_call_start")
      .map((e) => (e as { tool: string }).tool);
    expect(toolsCalled).toContain("build_living_cost_plan");
    expect(toolsCalled).not.toContain("__ping");

    // The outcome is the interactive living-cost component.
    const result = events.find((e) => e.type === "result") as Extract<
      AgentEvent,
      { type: "result" }
    >;
    expect(result.component).toBe("living_cost_plan");
    expect(result.data["demoMode"]).toBe(true);

    // Figures come from the engine, not from hard-coded demo values.
    const expected = buildLivingCostPlan({ ...DEMO_SAMPLE_ARGS });
    const plan = result.data["plan"] as {
      monthlyTotals: { typicalMinor: number; lowMinor: number; highMinor: number };
      verdict: string;
    };
    expect(plan.monthlyTotals.typicalMinor).toBe(expected.monthlyTotals.typicalMinor);
    expect(plan.monthlyTotals.lowMinor).toBe(expected.monthlyTotals.lowMinor);
    expect(plan.monthlyTotals.highMinor).toBe(expected.monthlyTotals.highMinor);
    expect(plan.verdict).toBe(expected.verdict);

    // The sample case is source-backed: the destination id is real.
    expect(getDestination("ie-limerick").currency).toBe("EUR");

    const joined = events
      .filter((e) => e.type === "assistant_text")
      .map((e) => (e as { text: string }).text)
      .join("\n");
    expect(joined).not.toMatch(/model-driven reasoning happened|as an AI language model/i);
    // Demo-mode honesty: the assistant text explicitly labels the run as
    // demo mode with no model provider configured — never claims model
    // reasoning, never hides that the figures are deterministic engine output.
    expect(joined).toContain(DEMO_LABEL);
    expect(getTask("s-demo-budget")?.status).toBe("done");
  });

  it("offers the sample budget via a labelled clarification when the intent is unclear", async () => {
    const first = await collect(demoRun("s-demo-offer", "hello there", BUDGET_TOOLS));
    expectValidEvents(first);
    expectAllLabelled(first);
    const clarify = first.find((e) => e.type === "clarify") as Extract<
      AgentEvent,
      { type: "clarify" }
    >;
    expect(clarify).toBeDefined();
    expect(clarify.questions.map((q) => q.id)).toEqual(["demo_sample_budget"]);
    for (const q of getTask("s-demo-offer")!.pendingQuestions) {
      expect(submitAnswers("s-demo-offer", q.id, q.options?.[0] ?? "x").ok).toBe(true);
    }
    // Resume: the answered question routes straight into the real tool chain.
    const second = await collect(demoRun("s-demo-offer", "go", BUDGET_TOOLS));
    expectValidEvents(second);
    expectAllLabelled(second);
    const toolsCalled = second
      .filter((e) => e.type === "tool_call_start")
      .map((e) => (e as { tool: string }).tool);
    expect(toolsCalled).toContain("build_living_cost_plan");
    expect(toolsCalled).not.toContain("__ping");
    const result = second.find((e) => e.type === "result") as Extract<
      AgentEvent,
      { type: "result" }
    >;
    expect(result.component).toBe("living_cost_plan");
    expect(getTask("s-demo-offer")?.status).toBe("done");
  });

  it("emits a labelled error when the budget tool is not registered", async () => {
    const events = await collect(
      demoRun("s-demo-notool", "Try the sample student budget", [PING_TOOL])
    );
    const err = events.find((e) => e.type === "error");
    expect(err).toBeDefined();
    expect((err as { message: string }).message).toContain(DEMO_LABEL);
  });
});

describe("executeToolCall unit behaviour", () => {
  const ctx = { sessionId: "s", taskId: "t" };
  it("does not retry non-transient errors", async () => {
    let calls = 0;
    const bad = {
      name: "bad",
      description: "always fails",
      parameters: z.object({}),
      requiresApproval: false,
      handler: async () => {
        calls += 1;
        throw new Error("permanent failure");
      },
    };
    await expect(executeToolCall(bad, {}, ctx, 1000)).rejects.toThrow("permanent failure");
    expect(calls).toBe(1);
  });
});
