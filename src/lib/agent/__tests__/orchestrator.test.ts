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
  askModelJson,
  submitAnswers,
  executeToolCall,
  sanitizeForModel,
  DEMO_LABEL,
  DEMO_SAMPLE_ARGS,
  AgentEventSchemas,
  type AgentEvent,
} from "../orchestrator";
import { clearStore, createTask, getTask, updateTask } from "../state";
import { PING_TOOL } from "../registry";
import { buildLivingCostPlanTool } from "../../tools/buildLivingCostPlan";
import { extractDocumentTool } from "../../tools/extractDocument";
import { simulateScenarioTool } from "../../tools/simulateScenario";
import { draftEmailTool } from "../../tools/draftEmail";
import { compareTransfersTool } from "../../tools/compareTransfers";
import { analyzeFundingGapTool } from "../../tools/analyzeFundingGap";
import { buildActionPlanTool } from "../../tools/buildActionPlan";
import { loadSafeToSendScenarioTool, upsertSafeToSendDraftTool } from "../../tools/safeToSend";
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
  snapshots: { messages: ChatMessage[]; tools: ToolSchema[] }[] = [];
  constructor(private queue: ChatResult[]) {}
  async chat(messages: ChatMessage[], tools: ToolSchema[]): Promise<ChatResult> {
    this.calls.push({ messages, tools });
    this.snapshots.push({
      messages: messages.map((message) => ({
        ...message,
        ...(message.toolCalls ? { toolCalls: [...message.toolCalls] } : {}),
      })),
      tools,
    });
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
const toolTurn = (calls: {
  id: string;
  name: string;
  args: unknown;
  providerMetadata?: Record<string, unknown>;
}[]): ChatResult => ({
  text: "",
  toolCalls: calls.map((c) => ({
    id: c.id,
    name: c.name,
    arguments: JSON.stringify(c.args),
    ...(c.providerMetadata ? { providerMetadata: c.providerMetadata } : {}),
  })),
  stopReason: "tool_calls",
});

const UNDERSTANDING = {
  scope: "student_finance" as const,
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
    safeToReplayForVerification: true,
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

  it("answers a greeting plus a capability question without starting a model workflow", async () => {
    const provider = new ScriptedProvider([]);
    const events = await collect(runAgent({
      sessionId: "s-greeting-capabilities",
      message: "Hi! What can you help me with?",
      tools: [PING_TOOL],
      provider,
    }));
    expectValidEvents(events);
    expect(provider.calls).toHaveLength(0);
    expect(events.some((event) => event.type === "clarify")).toBe(false);
    expect(events.find((event) => event.type === "assistant_text")?.type).toBe("assistant_text");
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
    const clarification = events.find((event) => event.type === "clarify") as
      | Extract<AgentEvent, { type: "clarify" }>
      | undefined;
    const questions = clarification?.questions ?? getTask("s-currency-options")?.pendingQuestions ?? [];
    expect(questions.length).toBeGreaterThan(0);
    expect(questions[0]?.options).toContain("BDT");
    expect(questions[0]?.options).toContain("EUR");
  });

  it("asks for missing tuition timing figures before calling the provider", async () => {
    const provider: Provider = {
      name: "vertex",
      chat: vi.fn().mockRejectedValue(new Error("provider request timed out after 45000ms")),
    };
    const message = "My scholarship may arrive late. Can I still pay tuition on time?";
    const events = await collect(runAgent({
      sessionId: "s-tuition-timeout",
      message,
      tools: [PING_TOOL],
      provider,
    }));

    expectValidEvents(events);
    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(events.find((event) => event.type === "assistant_text")).toMatchObject({
      text: expect.stringContaining("I can check whether it will be paid on time"),
    });
    const clarification = events.find((event) => event.type === "clarify");
    expect(clarification?.type).toBe("clarify");
    if (clarification?.type === "clarify") {
      expect(clarification.questions[0]?.fields?.map((field) => field.name)).toEqual([
        "tuitionAmount",
        "currency",
        "dueDate",
        "availableFunds",
        "scholarshipAmount",
        "scholarshipArrivalDate",
      ]);
      expect(clarification.questions[0]?.fields?.find((field) => field.name === "scholarshipArrivalDate")?.required).toBe(false);
    }
    expect(getTask("s-tuition-timeout")).toMatchObject({
      status: "clarifying",
      originalRequest: message,
      userGoal: expect.stringContaining("Check whether the listed tuition"),
    });
    expect(provider.chat).not.toHaveBeenCalled();
  });

  it("defaults the tuition clarification currency to USD when the request uses $", async () => {
    const provider: Provider = {
      name: "vertex",
      chat: vi.fn().mockRejectedValue(new Error("provider request timed out after 45000ms")),
    };
    const message = "I have $500 available. My scholarship may arrive late. Can I still pay tuition on time?";
    const events = await collect(runAgent({
      sessionId: "s-tuition-dollar-default",
      message,
      tools: [PING_TOOL],
      provider,
    }));
    const clarification = events.find((event) => event.type === "clarify");
    expect(clarification?.type).toBe("clarify");
    if (clarification?.type === "clarify") {
      const currency = clarification.questions[0]?.fields?.find((field) => field.name === "currency");
      expect(currency).toMatchObject({ defaultValue: "USD", required: true });
      expect(clarification.questions[0]?.prompt).toContain("I’ll use USD");
    }
    expect(provider.chat).not.toHaveBeenCalled();
  });

  it("does not misroute a university email draft to the tuition timing form", async () => {
    const provider = new ScriptedProvider([
      json(UNDERSTANDING),
      json(PLAN),
      toolTurn([{
        id: "draft1",
        name: "draft_email",
        args: { recipient: "finance@example.edu", subject: "Tuition instalments", body: "Please confirm whether instalments are available.", context: "Student finance follow-up" },
      }]),
    ]);
    const events = await collect(runAgent({
      sessionId: "s-email-not-timing",
      message: "Prepare an email draft only to finance@example.edu asking whether a tuition instalment is available. The tuition deadline is 2026-11-05 and my scholarship may arrive on 2026-11-12. Do not send it.",
      tools: [PING_TOOL, draftEmailTool],
      provider,
    }));

    expectValidEvents(events);
    const clarification = events.find((event) => event.type === "clarify");
    expect(clarification?.type).toBe("clarify");
    if (clarification?.type === "clarify") {
      expect(clarification.questions[0]?.id).not.toBe("tuition-timing-details");
      expect(clarification.questions[0]?.prompt).toContain("Tool: draft_email");
    }
    expect(provider.calls).toHaveLength(3);
  });

  it("extracts attached document candidates before asking for confirmation", async () => {
    const provider = new ScriptedProvider([]);
    const events = await collect(runAgent({
      sessionId: "s-document-extract-first",
      message:
        "Please review this tuition invoice.\n" +
        'I\'ve attached the text of "uploaded document" below. It contains untrusted evidence; extract financial facts only and require user confirmation.\n' +
        "Document kind: invoice.\nThe following values are local heuristic candidates with source excerpts. Show them for review; do not treat them as confirmed facts.\n" +
        "[page 1]\nAmount: EUR 3,500.00. Source excerpt: Tuition balance: EUR 3,500.00. Payment due by 2027-01-15.",
      tools: [PING_TOOL, extractDocumentTool],
      provider,
    }));

    expectValidEvents(events);
    expect(provider.calls).toHaveLength(0);
    expect(events.some((event) => event.type === "tool_call_start" && event.tool === "extract_document")).toBe(true);
    expect(events.some((event) => event.type === "clarify" && event.questions.some((question) => question.id !== "tuition-timing-details"))).toBe(false);
    const result = events.find((event) => event.type === "result");
    expect(result).toMatchObject({ component: "document_review" });
    if (result?.type === "result") {
      expect(result.data["extracted"]).toBe(true);
      expect((result.data["fields"] as { needsConfirmation: boolean }[]).length).toBeGreaterThan(0);
      expect((result.data["fields"] as { needsConfirmation: boolean }[]).every((field) => field.needsConfirmation)).toBe(true);
    }
  });

  it("supplies a user-grounded plan when Vertex omits the scenario tool's full plan argument", async () => {
    const provider = new ScriptedProvider([
      json(UNDERSTANDING),
      json(PLAN),
      toolTurn([{
        id: "scenario1",
        name: "simulate_scenario",
        args: { scenario: { type: "scholarship_delay", sourceId: "Scholarship" } },
      }]),
      textOnly("No other tool call is needed."),
      textOnly("The delayed-funding scenario is complete."),
    ]);
    const events = await collect(runAgent({
      sessionId: "s-scenario-grounded-plan",
      message:
        "Run a what-if plan in GBP as of 2026-10-17. I have confirmed savings of GBP 1,000 available 2026-10-17. " +
        "A conditional scholarship of GBP 3,000 is expected 2026-11-10. " +
        "Tuition of GBP 3,500 is committed and due 2026-11-03. Rent of GBP 700 is committed and due 2026-11-05. " +
        "Simulate the scholarship arriving 14 days late. Compare only these hypothetical options: " +
        "family support GBP 1,000 available 2026-10-25; proposed tuition instalment GBP 1,000 first due 2026-11-03 with the remainder due 2026-11-25.",
      tools: [PING_TOOL, simulateScenarioTool],
      provider,
      toolTimeoutMs: 5000,
    }));

    expectValidEvents(events);
    expect(events.some((event) => event.type === "tool_call_end" && event.tool === "simulate_scenario" && event.ok)).toBe(true);
    const result = events.find((event) => event.type === "result" && event.component === "scenario_comparison");
    expect(result).toBeDefined();
    if (result?.type === "result") {
      expect(result.data["scenarioType"]).toBe("scholarship_delay");
      expect((result.data["recoveryOptions"] as unknown[]).length).toBe(2);
    }
  });

  it("normalizes explicit destination and monthly-budget facts before running the budget tool", async () => {
    const provider = new ScriptedProvider([
      json(UNDERSTANDING),
      json(PLAN),
      toolTurn([{ id: "budget1", name: "build_living_cost_plan", args: {} }]),
      textOnly("No other tool call is needed."),
      textOnly("The sourced budget comparison is complete."),
    ]);
    const events = await collect(runAgent({
      sessionId: "s-budget-grounded-inputs",
      message: "I am an international student planning to study in Limerick, Ireland. My monthly living budget is $900. Build a realistic sourced monthly budget, compare typical costs against my budget, and keep tuition separate.",
      tools: [PING_TOOL, buildLivingCostPlanTool],
      provider,
      toolTimeoutMs: 5000,
    }));

    expectValidEvents(events);
    expect(events.find((event) => event.type === "tool_call_end" && event.tool === "build_living_cost_plan")).toMatchObject({ ok: true });
    const result = events.find((event) => event.type === "result");
    expect(result).toMatchObject({ component: "living_cost_plan" });
    if (result?.type === "result") {
      expect(result.data["inputs"]).toMatchObject({ destinationId: "ie-limerick", monthlyBudgetMinor: 90000, budgetCurrency: "USD", insuranceCovered: false });
    }
  });

  it("normalizes explicit corridor, amount, deadline, and ranking objective before comparing transfers", async () => {
    let normalizedArgs: Record<string, unknown> | undefined;
    const captureTransferTool = {
      ...compareTransfersTool,
      handler: async (args: Record<string, unknown>, context: Parameters<typeof compareTransfersTool.handler>[1]) => {
        normalizedArgs = args;
        return compareTransfersTool.handler(args, context);
      },
    };
    const provider = new ScriptedProvider([
      json(UNDERSTANDING),
      json(PLAN),
      toolTurn([{ id: "transfer1", name: "compare_transfers", args: {} }]),
      textOnly("No other tool call is needed."),
      textOnly("The reference options have been compared."),
    ]);
    const events = await collect(runAgent({
      sessionId: "s-transfer-grounded-inputs",
      message: "Compare reference options for sending $1,200 to GBP by 2026-10-20. Prioritize options that arrive before the deadline and show fees and amount received.",
      tools: [PING_TOOL, captureTransferTool],
      provider,
      toolTimeoutMs: 5000,
    }));

    expectValidEvents(events);
    expect(events.find((event) => event.type === "tool_call_end" && event.tool === "compare_transfers")).toMatchObject({ ok: true });
    const result = events.find((event) => event.type === "result");
    expect(result).toMatchObject({ component: "transfer_comparison" });
    if (result?.type === "result") {
      expect(result.data["corridor"]).toBe("USD>GBP");
      expect(result.data["objective"]).toBe("balanced");
      expect(result.data["figureLabel"]).toContain("not a live quote");
    }
    expect(normalizedArgs).toMatchObject({ fromCurrency: "USD", toCurrency: "GBP", amountMinor: 120000, deadlineIso: "2026-10-20", objective: "balanced" });
  });

  it("preserves stated Safe-to-Send facts and leaves unknown approval facts missing", async () => {
    const provider = new ScriptedProvider([
      json(UNDERSTANDING),
      json(PLAN),
      toolTurn([{ id: "safe1", name: "upsert_safe_to_send_draft", args: { patch: {} } }]),
      textOnly("The analysis-only review is ready."),
      textOnly("Some official route facts still need confirmation."),
    ]);
    const events = await collect(runAgent({
      sessionId: "s-safe-to-send-grounded-inputs",
      message:
        "Please do an analysis-only Safe-to-Send readiness review for this hypothetical tuition transfer. " +
        "Institution Sample University of Limerick, Ireland. Tuition EUR 3,000 due 2027-09-10. " +
        "Funding country Bangladesh; available funds BDT 720,000; tuition reserve BDT 530,000; " +
        "other obligations BDT 50,000; living reserve BDT 90,000; emergency reserve BDT 30,000. " +
        'Use the student-provided planning assumption 1 BDT = 0.008 EUR, dated 2027-09-01, source "fictional test assumption". ' +
        "User-entered unverified transfer quote: send BDT 400,000, fee BDT 1,000, receive EUR 3,150 by 2027-09-08. " +
        "Assess risks and missing facts; do not apply or simulate anything.",
      tools: [PING_TOOL, upsertSafeToSendDraftTool],
      provider,
      toolTimeoutMs: 5000,
    }));

    expectValidEvents(events);
    expect(events.some((event) => event.type === "tool_call_end" && event.tool === "upsert_safe_to_send_draft" && event.ok)).toBe(true);
    expect(events.some((event) => event.type === "tool_call_start" && event.tool === "simulate_safe_to_send_payment")).toBe(false);
    expect(events.filter((event) => event.type === "assistant_text").map((event) => event.text).join(" ")).toContain("2027-09-10");
    const result = events.find((event) => event.type === "result" && event.component === "safe_to_send_decision");
    expect(result).toBeDefined();
    if (result?.type === "result") {
      const draft = result.data["draft"] as Record<string, unknown>;
      expect(draft).toMatchObject({
        institutionName: "Sample University of Limerick",
        destinationCountry: "Ireland",
        tuitionAmountMinor: 300000,
        tuitionCurrency: "EUR",
        tuitionDueDate: "2027-09-10",
        fundingSourceCountry: "Bangladesh",
        availableFundsMinor: 72000000,
        fundingCurrency: "BDT",
        fundsReservedForTuitionMinor: 53000000,
        knownObligationsMinor: 5000000,
        requiredLivingReserveMinor: 9000000,
        desiredEmergencyReserveMinor: 3000000,
        sendPerFundingRate: 0.008,
      });
      expect(draft["officialInstructionsProvided"]).toBeUndefined();
      expect(draft["quotes"]).toHaveLength(1);
      expect(draft["fundingRecords"]).toHaveLength(1);
    }
  });

  it("does not allow a failed policy lookup to fall back to unsourced advice", async () => {
    const researchPolicy: ToolDefinition = {
      name: "research_policy",
      description: "Research official policy sources.",
      parameters: z.object({ query: z.string().optional() }),
      requiresApproval: false,
      handler: async (): Promise<ToolResult> => ({
        ok: true,
        summary: "No verified policy answer returned. No claim-level citations were available.",
        data: { answer: null, sources: [], supportedClaims: [], checkedAt: "2026-10-18T00:00:00.000Z" },
      }),
    };
    const provider = new ScriptedProvider([
      json(UNDERSTANDING),
      json(PLAN),
      toolTurn([{ id: "research1", name: "research_policy", args: { query: "credit building in Canada" } }]),
      textOnly("Try these Canadian banks and this government agency."),
    ]);
    const events = await collect(runAgent({
      sessionId: "s-policy-fallback-blocked",
      message: "How can an international student build credit in Canada?",
      tools: [PING_TOOL, researchPolicy],
      provider,
      maxToolCalls: 1,
    }));

    expectValidEvents(events);
    expect(events.filter((event) => event.type === "assistant_text").map((event) => event.text).join(" "))
      .not.toContain("Canadian banks");
    expect(events.some((event) => event.type === "assistant_text" && event.text.includes("No verified policy answer"))).toBe(true);
    expect(events.some((event) => event.type === "assistant_text" && event.text.includes("Retry the search"))).toBe(true);
    expect(provider.calls).toHaveLength(3);
  });

  it("keeps verified policy responses available when official claims are cited", async () => {
    const researchPolicy: ToolDefinition = {
      name: "research_policy",
      description: "Research official policy sources.",
      parameters: z.object({ query: z.string().optional() }),
      requiresApproval: false,
      handler: async (): Promise<ToolResult> => ({
        ok: true,
        summary: "Official policy research checked one source page.",
        data: {
          answer: "The official authority describes how students can check their credit file.",
          sources: [{ title: "Official authority", uri: "https://example.gov/credit", domain: "example.gov" }],
          supportedClaims: [{ text: "Students can check their credit file.", sources: [{ uri: "https://example.gov/credit" }] }],
          checkedAt: "2026-10-18T00:00:00.000Z",
        },
      }),
    };
    const provider = new ScriptedProvider([
      json(UNDERSTANDING),
      json(PLAN),
      toolTurn([{ id: "research2", name: "research_policy", args: { query: "credit building" } }]),
      textOnly("The cited authority explains how students can check their credit file."),
    ]);
    const events = await collect(runAgent({
      sessionId: "s-policy-success-grounded",
      message: "How can an international student build credit in Canada?",
      tools: [PING_TOOL, researchPolicy],
      provider,
      maxToolCalls: 1,
    }));

    expectValidEvents(events);
    expect(events.some((event) => event.type === "assistant_text" && event.text.includes("cited authority"))).toBe(true);
    const result = events.find((event) => event.type === "result");
    expect(result).toMatchObject({ component: "policy_research" });
    if (result?.type === "result") {
      expect(result.data["checkedAt"]).toBe("2026-10-18T00:00:00.000Z");
      expect(result.data["sources"]).toEqual([{ title: "Official authority", uri: "https://example.gov/credit", domain: "example.gov" }]);
    }
  });

  it("uses the structured Safe-to-Send summary instead of inventing a due date", async () => {
    const safeToSend: ToolDefinition = {
      name: "upsert_safe_to_send_draft",
      description: "Update the structured Safe-to-Send draft.",
      parameters: z.object({ patch: z.record(z.unknown()) }),
      requiresApproval: false,
      handler: async (): Promise<ToolResult> => ({
        ok: true,
        summary: "Saved Safe-to-Send draft. Safe-to-Send: more information required (1 required input(s) missing).",
        data: {
          draft: { tuitionAmountMinor: 100000, tuitionCurrency: "USD", tuitionDueDate: null },
          decision: { status: "MORE_INFORMATION_REQUIRED", payment: { tuitionAmountMinor: 100000, tuitionCurrency: "USD", dueDate: null } },
        },
      }),
    };
    const provider = new ScriptedProvider([
      json(UNDERSTANDING),
      json(PLAN),
      toolTurn([{ id: "safe2", name: "upsert_safe_to_send_draft", args: { patch: {} } }]),
      textOnly("The tuition is due tomorrow, October 19, 2026."),
    ]);
    const events = await collect(runAgent({
      sessionId: "s-safe-summary-authoritative",
      message: "Run a Safe-to-Send review for my tuition payment.",
      tools: [PING_TOOL, safeToSend],
      provider,
      maxToolCalls: 1,
    }));

    expectValidEvents(events);
    const assistantText = events.filter((event) => event.type === "assistant_text").map((event) => event.text).join(" ");
    expect(assistantText).not.toContain("October 19, 2026");
    expect(assistantText).toContain("more information required");
    const result = events.find((event) => event.type === "result");
    expect(result?.type === "result" && (result.data["decision"] as Record<string, unknown>)["payment"]).toMatchObject({ dueDate: null });
  });

  it("continues with grounded tuition figures after a transient provider timeout", async () => {
    const responses = [json(PLAN), textOnly("The check is complete.")];
    let firstCall = true;
    const provider: Provider = {
      name: "vertex",
      chat: vi.fn(async () => {
        if (firstCall) {
          firstCall = false;
          throw new Error("provider request timed out after 45000ms");
        }
        const next = responses.shift();
        if (!next) throw new Error("scripted provider: response queue exhausted");
        return next;
      }),
    };
    const events = await collect(runAgent({
      sessionId: "s-grounded-timeout",
      message: "My scholarship of USD 3,000 is expected to arrive 2026-11-03. I have USD 2,000 available. My committed tuition bill of USD 5,000 is due 2026-11-01. Can I still pay on time?",
      tools: [PING_TOOL],
      provider,
    }));

    expectValidEvents(events);
    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(events.some((event) => event.type === "clarify")).toBe(false);
    expect(events.some((event) => event.type === "assistant_text" && event.text.includes("timed out during request classification"))).toBe(true);
    expect(getTask("s-grounded-timeout")?.status).toBe("done");
  });

  it("supplies a grounded plan when the model requests an action plan without passing plan arguments", async () => {
    const provider = new ScriptedProvider([
      json(UNDERSTANDING),
      json(PLAN),
      toolTurn([{ id: "gap", name: "analyze_funding_gap", args: {} }]),
      toolTurn([{ id: "actions", name: "build_action_plan", args: {} }]),
      textOnly("No more tools are needed."),
    ]);
    const events = await collect(runAgent({
      sessionId: "s-grounded-action-plan",
      message:
        "As of 2026-10-18. I have savings of USD 500 available 2026-10-18. " +
        "Tuition of USD 1,200 is committed and due 2026-10-30. Can I still pay tuition on time?",
      tools: [PING_TOOL, analyzeFundingGapTool, buildActionPlanTool],
      provider,
      toolTimeoutMs: 5000,
    }));

    expectValidEvents(events);
    expect(events.find((event) => event.type === "tool_call_end" && event.tool === "build_action_plan")).toMatchObject({ ok: true });
    expect(events.some((event) => event.type === "tool_call_end" && event.tool === "build_action_plan" && !event.ok)).toBe(false);
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

  it("retains provider metadata on assistant tool calls across model rounds", async () => {
    const provider = new ScriptedProvider([
      json(UNDERSTANDING),
      json(PLAN),
      toolTurn([{
        id: "gemini-call-1",
        name: "forecast_calc",
        args: { x: 21 },
        providerMetadata: { google: { thought_signature: "from-google" } },
      }]),
      toolTurn([{ id: "gemini-call-2", name: "forecast_calc", args: { x: 22 } }]),
      textOnly("The calculation is complete."),
      textOnly("Your runway is fine: 42."),
    ]);
    const events = await collect(runAgent({
      sessionId: "s-provider-metadata-history",
      message: "forecast my runway",
      tools: [PING_TOOL, calcTool()],
      provider,
      maxToolCalls: 2,
    }));

    expectValidEvents(events);
    const assistantWithToolCall = provider.snapshots
      .slice(1)
      .flatMap((call) => call.messages)
      .find((message) => message.role === "assistant" && message.toolCalls?.length);
    expect(assistantWithToolCall?.toolCalls).toEqual([
      {
        id: "gemini-call-1",
        name: "forecast_calc",
        arguments: '{"x":21}',
        providerMetadata: { google: { thought_signature: "from-google" } },
      },
    ]);
    expect(provider.calls.length).toBeGreaterThan(1);
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

  it("resumes an approved action once and does not replay it during verification", async () => {
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
      // second runAgent resumes after the approval gate without re-understanding or re-planning
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
    expect(handler).toHaveBeenCalledTimes(1);
    expect(events.some((event) => event.type === "tool_call_start" && event.label === "Verification re-run")).toBe(false);
    const result = events.find((event) => event.type === "result");
    expect(result?.type === "result" && result.data).toMatchObject({
      verified: null,
      verifyNote: expect.stringContaining("not independently re-run"),
    });
    expect(getTask("s-appr2")?.status).toBe("done");
  });

  it("does not replay live policy research as an independent verification", async () => {
    const handler = vi.fn(async (): Promise<ToolResult> => ({ ok: true, summary: "Official policy claim with citation." }));
    const researchTool: ToolDefinition = {
      name: "research_policy",
      description: "Looks up current policy pages.",
      parameters: z.object({ query: z.string() }),
      requiresApproval: false,
      handler,
    };
    const provider = new ScriptedProvider([
      json(UNDERSTANDING),
      json(PLAN),
      toolTurn([{ id: "c1", name: "research_policy", args: { query: "tuition deadlines" } }]),
      textOnly("No further research needed."),
      textOnly("The official page says to confirm the current deadline."),
    ]);
    const events = await collect(runAgent({
      sessionId: "s-live-research-no-replay",
      message: "Find the university's tuition instalment policy",
      tools: [PING_TOOL, researchTool],
      provider,
    }));

    expectValidEvents(events);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(events.some((event) => event.type === "tool_call_start" && event.label === "Verification re-run")).toBe(false);
    const result = events.find((event) => event.type === "result");
    expect(result?.type === "result" && result.data).toMatchObject({
      verified: null,
      verifyNote: expect.stringContaining("live data"),
    });
  });

  it("extracts a country phrased as 'in the United States' for official policy research", async () => {
    let researchedArgs: Record<string, unknown> | undefined;
    const researchTool: ToolDefinition = {
      name: "research_policy",
      description: "Looks up official student-finance rules.",
      parameters: z.object({ query: z.string(), topic: z.string(), country: z.string() }),
      requiresApproval: false,
      handler: async (args) => {
        researchedArgs = args;
        return { ok: true, summary: "Official policy source checked." };
      },
    };
    const provider = new ScriptedProvider([
      json(UNDERSTANDING),
      json(PLAN),
      toolTurn([{ id: "policy", name: "research_policy", args: { query: "proof of funds", topic: "general", country: "" } }]),
      textOnly("No further research needed."),
    ]);
    const events = await collect(runAgent({
      sessionId: "s-policy-country-article",
      message: "Find the official proof of funds rules for international students in the United States.",
      tools: [PING_TOOL, researchTool],
      provider,
    }));

    expectValidEvents(events);
    expect(researchedArgs).toMatchObject({ topic: "proof_of_funds", country: "United States" });
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
      json(PLAN),
      textOnly("I can use GBP for the student-finance plan."),
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
      question: "Which currency should I plan in?",
      source: "user",
    });

    const second = await collect(
      runAgent({ sessionId: "s-cl", message: "", tools: [PING_TOOL], provider })
    );
    expectValidEvents(second);
    expect(getTask("s-cl")?.status).toBe("done");
    expect(second.find((e) => e.type === "assistant_text")?.type).toBe("assistant_text");
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

  it("resolves relative clarification dates against the explicit UTC reference date", () => {
    const state = createTask("s-relative-date");
    updateTask("s-relative-date", {
      pendingQuestions: [{
        id: "due-date",
        kind: "form",
        prompt: "When is tuition due?",
        fields: [{ name: "dueDate", label: "Tuition due date", type: "date", required: true }],
      }],
    });
    expect(submitAnswers("s-relative-date", "due-date", { dueDate: "tomorrow" }).ok).toBe(true);
    const fact = getTask(state.sessionId)?.confirmedFacts.at(-1);
    expect(JSON.parse(fact?.value ?? "{}").dueDate).toBe(
      new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    );
  });

  it("rejects ambiguous clarification dates instead of saving a guess", () => {
    createTask("s-ambiguous-date");
    updateTask("s-ambiguous-date", {
      pendingQuestions: [{
        id: "due-date",
        kind: "date",
        prompt: "When is tuition due?",
      }],
    });
    const result = submitAnswers("s-ambiguous-date", "due-date", { date: "next Friday" });
    expect(result.ok).toBe(false);
    expect(getTask("s-ambiguous-date")?.confirmedFacts).toHaveLength(0);
    expect(getTask("s-ambiguous-date")?.pendingQuestions).toHaveLength(1);
  });
});

describe("explicit deterministic demos", () => {
  it("runs the real sample budget when every model call fails", async () => {
    const provider = new ScriptedProvider([]);
    const events = await collect(runAgent({
      sessionId: "s-configured-sample-budget",
      message: "Try the sample student budget — show me the Limerick sample",
      tools: [PING_TOOL, buildLivingCostPlanTool],
      provider,
    }));

    expectValidEvents(events);
    expect(provider.calls).toHaveLength(0);
    const result = events.find((event) => event.type === "result");
    expect(result).toMatchObject({ component: "living_cost_plan" });
    if (result?.type === "result") {
      const plan = result.data["plan"] as { destinationId?: string; verdict?: string; sources?: unknown[] };
      expect(plan.destinationId).toBe("ie-limerick");
      expect(plan.verdict).toBe("shortfall");
      expect(plan.sources?.length).toBeGreaterThan(0);
    }
  });

  it("runs the real Safe-to-Send scenario when every model call fails", async () => {
    const provider = new ScriptedProvider([]);
    const events = await collect(runAgent({
      sessionId: "s-configured-safe-demo",
      message: "Try the Safe-to-Send tuition demo scenario",
      tools: [PING_TOOL, loadSafeToSendScenarioTool],
      provider,
    }));

    expectValidEvents(events);
    expect(provider.calls).toHaveLength(0);
    const result = events.find((event) => event.type === "result");
    expect(result).toMatchObject({ component: "safe_to_send_decision" });
    expect(events.some((event) => event.type === "tool_call_start" && event.tool === "simulate_safe_to_send_payment")).toBe(false);
    if (result?.type === "result") {
      expect(result.data["status"]).toBe("READY_TO_SIMULATE");
      expect(result.data["simulationApproval"]).toBeTruthy();
    }
  });
});

describe("structured model output", () => {
  const schema = z.object({ answer: z.string().min(1) });
  const output = (text: string, stopReason = "stop"): ChatResult => ({
    text,
    toolCalls: [],
    stopReason,
  });

  it("accepts valid JSON and the supported fenced JSON form", async () => {
    const valid = new ScriptedProvider([output('{"answer":"ok"}')]);
    await expect(askModelJson(valid, "Return an answer.", "request", schema)).resolves.toEqual({ answer: "ok" });
    const fenced = new ScriptedProvider([output("```json\n{\"answer\":\"ok\"}\n```")]);
    await expect(askModelJson(fenced, "Return an answer.", "request", schema)).resolves.toEqual({ answer: "ok" });
  });

  it.each([
    ["invalid JSON", output("not json"), "not valid JSON"],
    ["schema-invalid JSON", output('{"answer":3}'), "did not match the required schema"],
    ["truncated JSON", output('{"answer":"incomplete"}', "length"), "stopped with length"],
  ])("reports %s and recovers on the bounded retry", async (_label, first, expectedPrompt) => {
    const provider = new ScriptedProvider([first, output('{"answer":"recovered"}')]);
    await expect(askModelJson(provider, "Return an answer.", "request", schema)).resolves.toEqual({ answer: "recovered" });
    expect(provider.calls[1]?.messages.at(-1)?.content).toContain(expectedPrompt);
  });

  it("surfaces provider failures and failures after both attempts", async () => {
    const providerFailure: Provider = {
      name: "vertex",
      chat: vi.fn().mockRejectedValue(new Error("provider unavailable")),
    };
    await expect(askModelJson(providerFailure, "Return an answer.", "request", schema)).rejects.toThrow("provider unavailable");
    const invalid = new ScriptedProvider([output("not json"), output("still not json")]);
    await expect(askModelJson(invalid, "Return an answer.", "request", schema)).rejects.toThrow("after retry: the response was not valid JSON");
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
    const first = await collect(demoRun("s-demo-offer", "can you help with planning", BUDGET_TOOLS));
    expectValidEvents(first);
    expectAllLabelled(first);
    const clarify = first.find((e) => e.type === "clarify") as Extract<
      AgentEvent,
      { type: "clarify" }
    >;
    expect(clarify).toBeDefined();
    expect(clarify.questions.map((q) => q.id)).toEqual(["demo_mode_choice"]);
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

  it("answers greetings without starting the demo workflow", async () => {
    const events = await collect(demoRun("s-demo-greeting", "hello there", BUDGET_TOOLS));
    expectValidEvents(events);
    expect(events.some((event) => event.type === "clarify")).toBe(false);
    expect(events.find((event) => event.type === "assistant_text")).toMatchObject({
      text: expect.stringContaining(DEMO_LABEL),
    });
    expect(getTask("s-demo-greeting")).toBeUndefined();
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
  it("gives Google Search policy research enough time to return citations", async () => {
    const research: ToolDefinition = {
      name: "research_policy",
      description: "scripted grounded research",
      parameters: z.object({}),
      requiresApproval: false,
      handler: async () => {
        await new Promise((resolve) => setTimeout(resolve, 25));
        return { ok: true, summary: "verified" };
      },
    };
    const executed = await executeToolCall(research, {}, ctx, 5);
    expect(executed.result.summary).toBe("verified");
    expect(executed.attempts).toBe(1);
  });

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
