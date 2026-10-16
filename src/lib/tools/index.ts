/**
 * Financial tools for the StudyRunway agent.
 *
 * Eight tools, all built on the deterministic financial engine. The tools
 * compute; the model interprets. No tool invents financial figures.
 *
 * NOTE on the ToolDefinition type: it is owned by the agent-core workstream
 * (src/lib/agent/tools.ts) and re-exported via ./types.ts. The interface
 * matches the workstream brief exactly, so the TOOLS array below satisfies
 * the agent-core contract without modification.
 */

import { analyzeFundingGapTool } from "./analyzeFundingGap";
import { compareTransfersTool } from "./compareTransfers";
import { extractDocumentTool } from "./extractDocument";
import { simulateScenarioTool } from "./simulateScenario";
import { researchPolicyTool } from "./researchPolicy";
import { buildActionPlanTool } from "./buildActionPlan";
import { draftEmailTool } from "./draftEmail";
import { buildLivingCostPlanTool } from "./buildLivingCostPlan";
import { safeToSendTools } from "./safeToSend";
import type { ToolDefinition, ToolContext, ToolResult } from "./types";

export const TOOLS: ToolDefinition[] = [
  analyzeFundingGapTool,
  compareTransfersTool,
  extractDocumentTool,
  simulateScenarioTool,
  researchPolicyTool,
  buildActionPlanTool,
  draftEmailTool,
  buildLivingCostPlanTool,
  ...safeToSendTools,
];

export {
  analyzeFundingGapTool,
  compareTransfersTool,
  extractDocumentTool,
  simulateScenarioTool,
  researchPolicyTool,
  buildActionPlanTool,
  draftEmailTool,
  buildLivingCostPlanTool,
  safeToSendTools,
};
export type { ToolDefinition, ToolContext, ToolResult };
