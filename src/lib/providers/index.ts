/**
 * Provider selection — owned by the AGENT CORE workstream.
 *
 * AI_BACKEND or AI_PROVIDER explicitly selects a provider. Without either, priority
 * is xAI → Vertex AI → Gemini → OpenAI → Anthropic → demo mode. Vertex AI
 * uses the Google Cloud OpenAI-compatible endpoint and Application Default
 * Credentials. AI Studio Gemini uses its separate API-key endpoint. All
 * adapters run server-side only.
 * Server-side only: never import this module (or any provider) into client
 * components. Keys are never logged — the label carries only the provider
 * and model names.
 */
import { createXaiProvider, readXaiConfig } from "./xai";
import { createGeminiProvider, readGeminiConfig } from "./gemini";
import { createVertexProvider, readVertexConfig } from "./vertex";
import { createOpenAiProvider, readOpenAiConfig } from "./openai";
import { createAnthropicProvider, readAnthropicConfig } from "./anthropic";
import type { Provider, ProviderName } from "./types";

export type { Provider, ProviderName };
export type {
  ChatMessage,
  ChatResult,
  ToolCallRequest,
  ToolSchema,
} from "./types";

export type SelectionName = ProviderName | "demo";

export interface ProviderSelection {
  /** Which provider (or 'demo' when no key is configured). */
  name: SelectionName;
  /** Instantiated adapter, or null in demo mode. */
  provider: Provider | null;
  /** Model id in use, or null in demo mode. */
  model: string | null;
  /** True when provider settings are configured (ADC itself is resolved on request for Vertex). */
  configured: boolean;
  /** Human label for the UI status endpoint. Never contains a key. */
  label: string;
}

/** Pick the provider from env. Pure function of process.env — safe per request. */
export function selectProvider(): ProviderSelection {
  const selectedBackend = (
    process.env.AI_BACKEND?.trim() || process.env.AI_PROVIDER?.trim() || ""
  ).toLowerCase();
  const forced = selectedBackend === "vertex-adc" ? "vertex" : selectedBackend;
  const validNames: ProviderName[] = ["xai", "vertex", "gemini", "openai", "anthropic"];
  const demoSelection: ProviderSelection = {
    name: "demo", provider: null, model: null, configured: false,
    label: "Demo mode — no model provider configured",
  };

  const makeSelection = (name: ProviderName): ProviderSelection | null => {
    if (name === "xai") {
      const config = readXaiConfig();
      return config ? {
        name, provider: createXaiProvider(config), model: config.model,
        configured: true, label: `xAI Grok · ${config.model}`,
      } : null;
    }
    if (name === "gemini") {
      const config = readGeminiConfig();
      return config ? {
        name, provider: createGeminiProvider(config), model: config.model,
        configured: true, label: `Google Gemini · ${config.model}`,
      } : null;
    }
    if (name === "vertex") {
      const config = readVertexConfig();
      return config ? {
        name, provider: createVertexProvider(config), model: config.model,
        configured: true, label: `Google Vertex AI · ${config.model}`,
      } : null;
    }
    if (name === "openai") {
      const config = readOpenAiConfig();
      return config ? {
        name, provider: createOpenAiProvider(config), model: config.model,
        configured: true, label: `OpenAI · ${config.model}`,
      } : null;
    }
    const config = readAnthropicConfig();
    return config ? {
      name, provider: createAnthropicProvider(config), model: config.model,
      configured: true, label: `Anthropic Claude · ${config.model}`,
    } : null;
  };

  // Explicit selection prevents a leftover key for another provider from
  // silently taking precedence over the provider the developer chose.
  if (forced && !/^(?:placeholder|your[_ -].*)$/i.test(forced)) {
    if (forced === "demo") return demoSelection;
    if (validNames.includes(forced as ProviderName)) {
      const selection = makeSelection(forced as ProviderName);
      if (selection) return selection;
      if (forced === "vertex") {
        return {
          ...demoSelection,
          label: "Demo mode — set VERTEX_AI_PROJECT and configure Google Cloud ADC",
        };
      }
      return demoSelection;
    }
    return {
      ...demoSelection,
      label: "Demo mode — AI_BACKEND must be vertex-adc, or AI_PROVIDER must be demo, xai, vertex, gemini, openai, or anthropic",
    };
  }

  for (const name of validNames) {
    const selection = makeSelection(name);
    if (selection) return selection;
  }

  return demoSelection;
}
