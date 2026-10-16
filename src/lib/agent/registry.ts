/**
 * Tool registry — owned by the AGENT CORE workstream.
 *
 * Merges the hidden `__ping` self-test tool (used by the agent-core loop
 * tests and demo mode; NEVER shown to the model) with the financial tools
 * built by the financial-tools workstream, which export `TOOLS` from
 * `@/lib/tools`.
 *
 * The financial-tools import is dynamic with try/catch so the agent core
 * keeps working (tests, demo mode, typecheck) even if that module is absent.
 */
import { z } from "zod";
import type { ToolDefinition } from "./tools";

/**
 * Hidden self-test tool. Present in the full registry (so the orchestrator
 * and demo mode can exercise the real execute path) but excluded from
 * `getModelTools()` so the model never sees or calls it.
 */
export const PING_TOOL: ToolDefinition = {
  name: "__ping",
  description:
    "Hidden self-test tool for the agent-core test suite and demo mode. Not for model use.",
  parameters: z.object({
    message: z.string().min(1).max(200),
  }),
  requiresApproval: false,
  handler: async (args) => {
    const message = args["message"] as string;
    return {
      ok: true,
      summary: `pong: ${message}`,
      data: { echo: message },
      evidence: [{ label: "self-test", detail: "loop integrity check" }],
    };
  },
};

let cache: ToolDefinition[] | null = null;

/** Full registry: hidden test tool + financial tools (when available). */
export async function loadRegistry(): Promise<ToolDefinition[]> {
  if (cache) return cache;
  let extra: ToolDefinition[] = [];
  try {
    // Built by the financial-tools workstream. Absent until it lands.
    extra = (await import("@/lib/tools")).TOOLS ?? [];
  } catch {
    extra = [];
  }
  cache = [PING_TOOL, ...extra];
  return cache;
}

/** Tools the model is allowed to see and call (`__ping` excluded). */
export function getModelTools(all: ToolDefinition[]): ToolDefinition[] {
  return all.filter((t) => t.name !== "__ping" && !t.name.startsWith("__"));
}

/** Find a tool by name in a registry snapshot. */
export function findTool(
  all: ToolDefinition[],
  name: string
): ToolDefinition | undefined {
  return all.find((t) => t.name === name);
}

/** Reset the registry cache (tests). */
export function resetRegistryCache(): void {
  cache = null;
}
