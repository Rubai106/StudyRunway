/**
 * Tool interface for the model-driven StudyRunway agent.
 *
 * Re-exported from the agent-core workstream's contract
 * (src/lib/agent/tools.ts). Financial tools code against that interface;
 * this module exists so src/lib/tools/** has one local import point.
 * Do not redefine the interfaces here — the agent-core file is canonical.
 */

export type { ToolContext, ToolResult, ToolDefinition } from "@/lib/agent/tools";
