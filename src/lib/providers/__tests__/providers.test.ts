/**
 * Tests for the provider adapters: wire-shape mapping (with a mocked HTTP
 * layer — no network), env-based selection priority, and the guarantee that
 * API keys never appear in labels or logs.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { z } from "zod";
import { createXaiProvider, readXaiConfig, DEFAULT_XAI_MODEL } from "../xai";
import { createOpenAiProvider, readOpenAiConfig } from "../openai";
import { createGeminiProvider, readGeminiConfig, DEFAULT_GEMINI_BASE_URL, DEFAULT_GEMINI_MODEL } from "../gemini";
import { createAnthropicProvider, readAnthropicConfig } from "../anthropic";
import { createVertexProvider } from "../vertex";
import { selectProvider } from "../index";
import { postJson } from "../http";
import { toJsonSchema } from "../zodjson";
import type { ChatMessage, ToolSchema } from "../types";

const MESSAGES: ChatMessage[] = [
  { role: "system", content: "You are helpful." },
  { role: "user", content: "Hi" },
];
const TOOLS: ToolSchema[] = [
  {
    name: "calc",
    description: "Calculate",
    parameters: { type: "object", properties: { x: { type: "number" } } },
  },
];

describe("Vertex adapter", () => {
  it("requests JSON mode for structured agent prompts", async () => {
    let gotBody: Record<string, unknown> = {};
    const fakePost = vi.fn(async (_url: string, opts: { body: unknown }) => {
      gotBody = opts.body as Record<string, unknown>;
      return { choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }] };
    });
    const provider = createVertexProvider(
      { projectId: "test-project-12345", location: "global", model: "google/gemini-3.5-flash" },
      fakePost as unknown as typeof postJson,
      async () => "test-token",
    );

    const result = await provider.chat(MESSAGES, [], { responseFormat: "json_object" });

    expect(gotBody.response_format).toEqual({ type: "json_object" });
    expect(result.text).toBe('{"ok":true}');
  });

  it("sends schema-constrained JSON responses to Vertex", async () => {
    let gotBody: Record<string, unknown> = {};
    const fakePost = vi.fn(async (_url: string, opts: { body: unknown }) => {
      gotBody = opts.body as Record<string, unknown>;
      return { choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }] };
    });
    const provider = createVertexProvider(
      { projectId: "test-project-12345", location: "global", model: "google/gemini-3.5-flash" },
      fakePost as unknown as typeof postJson,
      async () => "test-token",
    );
    const schema = {
      type: "object",
      properties: { ok: { type: "boolean" } },
      required: ["ok"],
      additionalProperties: false,
    };

    await provider.chat(MESSAGES, [], {
      responseFormat: { type: "json_schema", name: "test_response", schema },
    });

    expect(gotBody.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "test_response", schema },
    });
  });
});

const savedEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...savedEnv };
  delete process.env.AI_PROVIDER;
  delete process.env.XAI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_MODEL;
  delete process.env.GEMINI_BASE_URL;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_BASE_URL;
  delete process.env.ANTHROPIC_API_KEY;
});
afterEach(() => {
  process.env = { ...savedEnv };
  vi.restoreAllMocks();
});

describe("xai adapter", () => {
  it("posts OpenAI-compatible chat completions with Bearer <redacted> and parses tool calls", async () => {
    let gotUrl = "";
    let gotHeaders: Record<string, string> = {};
    let gotBody: Record<string, unknown> = {};
    const fakePost = vi.fn(async (url: string, opts: { headers: Record<string, string>; body: unknown }) => {
      gotUrl = url;
      gotHeaders = opts.headers;
      gotBody = opts.body as Record<string, unknown>;
      return {
        choices: [
          {
            message: {
              content: "here you go",
              tool_calls: [
                { id: "call_1", type: "function", function: { name: "calc", arguments: '{"x":2}' } },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      };
    });
    const provider = createXaiProvider(
      { apiKey: "xai-secret", baseUrl: "https://api.x.ai/v1", model: "grok-4.7" },
      fakePost as unknown as typeof postJson
    );
    const res = await provider.chat(MESSAGES, TOOLS);
    expect(gotUrl).toBe("https://api.x.ai/v1/chat/completions");
    expect(gotHeaders.Authorization).toBe("Bearer xai-secret");
    expect(gotBody["model"]).toBe("grok-4.7");
    const wireTools = gotBody["tools"] as { type: string; function: { name: string } }[];
    expect(wireTools[0]).toMatchObject({ type: "function", function: { name: "calc" } });
    expect(res.text).toBe("here you go");
    expect(res.toolCalls).toEqual([{ id: "call_1", name: "calc", arguments: '{"x":2}' }]);
    expect(res.stopReason).toBe("tool_calls");
  });

  it("uses the verified default model id", () => {
    expect(DEFAULT_XAI_MODEL).toBe("grok-4.7");
  });
});

describe("Gemini adapter", () => {
  it("uses Google's official OpenAI-compatible endpoint and parses tool calls", async () => {
    let gotUrl = "";
    let gotHeaders: Record<string, string> = {};
    let gotBody: Record<string, unknown> = {};
    const fakePost = vi.fn(async (url: string, opts: { headers: Record<string, string>; body: unknown }) => {
      gotUrl = url;
      gotHeaders = opts.headers;
      gotBody = opts.body as Record<string, unknown>;
      return {
        choices: [{
          message: {
            content: "Gemini response",
            tool_calls: [{ id: "gemini_call_1", type: "function", function: { name: "calc", arguments: '{"x":2}' } }],
          },
          finish_reason: "tool_calls",
        }],
      };
    });
    const provider = createGeminiProvider({
      apiKey: "google-ai-studio-test-key",
      baseUrl: DEFAULT_GEMINI_BASE_URL,
      model: DEFAULT_GEMINI_MODEL,
    }, fakePost as unknown as typeof postJson);
    const result = await provider.chat(MESSAGES, TOOLS);
    expect(provider.name).toBe("gemini");
    expect(gotUrl).toBe(`${DEFAULT_GEMINI_BASE_URL}/chat/completions`);
    expect(gotHeaders.Authorization).toBe("Bearer google-ai-studio-test-key");
    expect(gotBody.model).toBe(DEFAULT_GEMINI_MODEL);
    expect(gotBody.tools).toMatchObject([{ type: "function", function: { name: "calc" } }]);
    expect(result.text).toBe("Gemini response");
    expect(result.toolCalls).toEqual([{ id: "gemini_call_1", name: "calc", arguments: '{"x":2}' }]);
    expect(result.stopReason).toBe("tool_calls");
  });

  it("round-trips exact extra_content for sequential and parallel tool calls", async () => {
    const firstMetadata = {
      google: { thought_signature: "signature-from-google" },
      untouched: { nested: ["value", 2] },
    };
    const secondMetadata = { google: { other: "metadata-without-signature" } };
    const bodies: Record<string, unknown>[] = [];
    const fakePost = vi.fn(async (_url: string, opts: { body: unknown }) => {
      bodies.push(opts.body as Record<string, unknown>);
      if (bodies.length === 1) {
        return {
          choices: [{
            message: {
              content: null,
              tool_calls: [
                {
                  id: "parallel-1",
                  type: "function",
                  function: { name: "calc", arguments: '{"x":2}' },
                  extra_content: firstMetadata,
                },
                {
                  id: "parallel-2",
                  type: "function",
                  function: { name: "calc", arguments: '{"x":3}' },
                },
              ],
            },
            finish_reason: "tool_calls",
          }],
        };
      }
      return {
        choices: [{
          message: {
            content: "done",
            tool_calls: [{
              id: "sequential-1",
              type: "function",
              function: { name: "calc", arguments: '{"x":4}' },
              extra_content: secondMetadata,
            }],
          },
          finish_reason: "tool_calls",
        }],
      };
    });
    const provider = createGeminiProvider({
      apiKey: "google-ai-studio-test-key",
      baseUrl: DEFAULT_GEMINI_BASE_URL,
      model: DEFAULT_GEMINI_MODEL,
    }, fakePost as unknown as typeof postJson);

    const first = await provider.chat(MESSAGES, TOOLS);
    expect(first.toolCalls).toEqual([
      {
        id: "parallel-1",
        name: "calc",
        arguments: '{"x":2}',
        providerMetadata: firstMetadata,
      },
      { id: "parallel-2", name: "calc", arguments: '{"x":3}' },
    ]);

    const second = await provider.chat([
      ...MESSAGES,
      { role: "assistant", content: "", toolCalls: first.toolCalls },
      { role: "tool", toolCallId: "parallel-1", content: "2" },
      { role: "tool", toolCallId: "parallel-2", content: "3" },
    ], TOOLS);

    const wireMessages = bodies[1].messages as {
      role: string;
      tool_calls?: { extra_content?: Record<string, unknown> }[];
    }[];
    expect(wireMessages[2].tool_calls?.map((call) => call.extra_content)).toEqual([
      firstMetadata,
      undefined,
    ]);

    expect(second.toolCalls[0].providerMetadata).toEqual(secondMetadata);
  });

  it("reads Gemini key and model from env, and ignores placeholders", () => {
    process.env.GEMINI_API_KEY = "PLACEHOLDER";
    expect(readGeminiConfig()).toBeNull();
    process.env.GEMINI_API_KEY = "AIza-test-key";
    process.env.GEMINI_MODEL = "gemini-test-model";
    process.env.GEMINI_BASE_URL = `${DEFAULT_GEMINI_BASE_URL}/`;
    expect(readGeminiConfig()).toEqual({
      apiKey: "AIza-test-key",
      baseUrl: DEFAULT_GEMINI_BASE_URL,
      model: "gemini-test-model",
    });
  });

  it("refuses to send the key to a non-Google host or nonstandard port", () => {
    process.env.GEMINI_API_KEY = "AIza-test-key";
    process.env.GEMINI_BASE_URL = "https://example.com/v1beta/openai";
    expect(readGeminiConfig()).toBeNull();
    process.env.GEMINI_BASE_URL = "https://generativelanguage.googleapis.com:8443/v1beta/openai";
    expect(readGeminiConfig()).toBeNull();
  });
});

describe("openai adapter", () => {
  it("posts to api.openai.com/v1/chat/completions with Bearer <redacted>", async () => {
    let gotUrl = "";
    let gotHeaders: Record<string, string> = {};
    const fakePost = vi.fn(async (url: string, opts: { headers: Record<string, string>; body: unknown }) => {
      gotUrl = url;
      gotHeaders = opts.headers;
      return { choices: [{ message: { content: "ok" }, finish_reason: "stop" }] };
    });
    const provider = createOpenAiProvider(
      { apiKey: "sk-secret", baseUrl: "https://api.openai.com/v1", model: "gpt-5" },
      fakePost as unknown as typeof postJson
    );
    const res = await provider.chat(MESSAGES, []);
    expect(gotUrl).toBe("https://api.openai.com/v1/chat/completions");
    expect(gotHeaders.Authorization).toBe("Bearer sk-secret");
    expect(res.text).toBe("ok");
  });
});

describe("anthropic adapter", () => {
  it("posts to /v1/messages with x-api-key + anthropic-version and maps tool_use blocks", async () => {
    let gotUrl = "";
    let gotHeaders: Record<string, string> = {};
    let gotBody: Record<string, unknown> = {};
    const fakePost = vi.fn(async (url: string, opts: { headers: Record<string, string>; body: unknown }) => {
      gotUrl = url;
      gotHeaders = opts.headers;
      gotBody = opts.body as Record<string, unknown>;
      return {
        content: [
          { type: "text", text: "calculating" },
          { type: "tool_use", id: "tu_1", name: "calc", input: { x: 3 } },
        ],
        stop_reason: "tool_use",
      };
    });
    const provider = createAnthropicProvider(
      { apiKey: "sk-ant-secret", baseUrl: "https://api.anthropic.com", model: "claude-sonnet-4-6" },
      fakePost as unknown as typeof postJson
    );
    const res = await provider.chat(MESSAGES, TOOLS);
    expect(gotUrl).toBe("https://api.anthropic.com/v1/messages");
    expect(gotHeaders["x-api-key"]).toBe("sk-ant-secret");
    expect(gotHeaders["anthropic-version"]).toBe("2023-06-01");
    // system extracted to top level, input_schema used for tools
    expect(gotBody["system"]).toBe("You are helpful.");
    const wireTools = gotBody["tools"] as { name: string; input_schema: unknown }[];
    expect(wireTools[0].name).toBe("calc");
    expect(wireTools[0].input_schema).toBeDefined();
    expect(res.toolCalls).toEqual([{ id: "tu_1", name: "calc", arguments: '{"x":3}' }]);
    expect(res.text).toBe("calculating");
  });

  it("merges consecutive tool results into one user message (alternation rule)", async () => {
    let gotBody: Record<string, unknown> = {};
    const fakePost = vi.fn(async (_url: string, opts: { headers: Record<string, string>; body: unknown }) => {
      gotBody = opts.body as Record<string, unknown>;
      return { content: [{ type: "text", text: "done" }], stop_reason: "end_turn" };
    });
    const provider = createAnthropicProvider(
      { apiKey: "k", baseUrl: "https://api.anthropic.com", model: "m" },
      fakePost as unknown as typeof postJson
    );
    await provider.chat(
      [
        { role: "user", content: "go" },
        {
          role: "assistant",
          content: "",
          toolCalls: [
            { id: "a", name: "calc", arguments: "{}" },
            { id: "b", name: "calc", arguments: "{}" },
          ],
        },
        { role: "tool", toolCallId: "a", content: "1" },
        { role: "tool", toolCallId: "b", content: "2" },
      ],
      []
    );
    const wire = gotBody["messages"] as { role: string; content: unknown[] }[];
    const roles = wire.map((m) => m.role);
    expect(roles).toEqual(["user", "assistant", "user"]);
    const toolResults = (wire[2].content as { type: string }[]).filter(
      (b) => b.type === "tool_result"
    );
    expect(toolResults).toHaveLength(2);
  });
});

describe("provider selection", () => {
  it("uses documented default priority: xAI, Gemini, OpenAI, Anthropic, then demo", () => {
    expect(selectProvider().name).toBe("demo");

    process.env.ANTHROPIC_API_KEY = "sk-ant-x";
    expect(selectProvider().name).toBe("anthropic");

    process.env.OPENAI_API_KEY = "sk-x";
    expect(selectProvider().name).toBe("openai");

    process.env.GEMINI_API_KEY = "AIza-test-key";
    expect(selectProvider().name).toBe("gemini");

    process.env.XAI_API_KEY = "xai-x";
    expect(selectProvider().name).toBe("xai");
  });

  it("honours AI_PROVIDER=gemini and prefers it over an unrelated configured key", () => {
    process.env.AI_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "AIza-test-key";
    process.env.GEMINI_MODEL = "gemini-test-model";
    process.env.XAI_API_KEY = "xai-unrelated-key";
    const sel = selectProvider();
    expect(sel.name).toBe("gemini");
    expect(sel.label).toBe("Google Gemini · gemini-test-model");
    expect(sel.configured).toBe(true);
    expect(sel.label).not.toContain("AIza-test-key");
  });

  it("supports explicit demo mode even when real provider keys are present", () => {
    process.env.AI_PROVIDER = "demo";
    process.env.GEMINI_API_KEY = "AIza-test-key";
    expect(selectProvider().name).toBe("demo");
    expect(selectProvider().configured).toBe(false);
  });

  it("does not fall back to another model if the explicitly selected provider has no key", () => {
    process.env.AI_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "PLACEHOLDER";
    process.env.XAI_API_KEY = "xai-real-key";
    expect(selectProvider().name).toBe("demo");
  });

  it("treats placeholder values as unconfigured", () => {
    process.env.XAI_API_KEY = "<redacted>";
    process.env.XAI_MODEL = "PLACEHOLDER";
    const sel = selectProvider();
    expect(sel.name).toBe("demo");
    expect(sel.configured).toBe(false);
    expect(sel.model).toBeNull();
  });

  it("does not treat copied .env.example API key placeholders as real credentials", () => {
    process.env.XAI_API_KEY = "PLACEHOLDER";
    process.env.OPENAI_API_KEY = "PLACEHOLDER";
    process.env.ANTHROPIC_API_KEY = "PLACEHOLDER";
    expect(selectProvider().name).toBe("demo");
    expect(selectProvider().configured).toBe(false);
  });

  it("uses provider defaults when the copied .env.example model value is still a placeholder", () => {
    process.env.XAI_API_KEY = "xai-real-key";
    process.env.XAI_MODEL = "PLACEHOLDER";
    expect(selectProvider().model).toBe(DEFAULT_XAI_MODEL);
  });

  it("never puts the key in the label", () => {
    process.env.XAI_API_KEY = "xai-super-secret-key";
    const sel = selectProvider();
    expect(sel.label).not.toContain("xai-super-secret-key");
    expect(sel.label).toContain("grok-4.7");
  });

  it("demo selection is honest", () => {
    const sel = selectProvider();
    expect(sel.provider).toBeNull();
    expect(sel.label).toBe("Demo mode — no model provider configured");
  });
});

describe("config readers", () => {
  it("readXaiConfig honours env overrides", () => {
    process.env.XAI_API_KEY = "k";
    process.env.XAI_MODEL = "grok-custom";
    process.env.XAI_BASE_URL = "https://proxy.example/v1";
    expect(readXaiConfig()).toMatchObject({
      model: "grok-custom",
      baseUrl: "https://proxy.example/v1",
    });
    expect(readOpenAiConfig()).toBeNull();
    expect(readAnthropicConfig()).toBeNull();
  });
});

describe("zod to JSON schema", () => {
  it("converts common shapes for provider tool payloads", () => {
    const schema = z.object({
      name: z.string().describe("Who"),
      amount: z.number().int().positive(),
      currency: z.enum(["GBP", "USD"]),
      note: z.string().optional(),
      tags: z.array(z.string()),
    });
    const js = toJsonSchema(schema);
    expect(js).toMatchObject({
      type: "object",
      required: ["name", "amount", "currency", "tags"],
    });
    const props = js["properties"] as Record<string, { type?: string; enum?: string[]; description?: string }>;
    expect(props["amount"].type).toBe("integer");
    expect(props["currency"].enum).toEqual(["GBP", "USD"]);
    expect(props["name"].description).toBe("Who");
  });

  it("never throws on exotic schemas", () => {
    expect(() => toJsonSchema(z.custom(() => true))).not.toThrow();
  });
});
