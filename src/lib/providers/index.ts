/**
 * Provider selection — owned by the AGENT CORE workstream.
 *
 * An optional AI_PROVIDER explicitly selects a provider. Without it, priority
 * is xAI → Gemini → OpenAI → Anthropic → demo mode. Gemini uses Google's
 * OpenAI-compatible endpoint and GEMINI_API_KEY / GEMINI_MODEL /
 * GEMINI_BASE_URL. All adapters run server-side only.
 * Server-side only: never import this module (or any provider) into client
 * components. Keys are never logged — the label carries only the provider
 * and model names.
 */
import { createXaiProvider, readXaiConfig } from "./xai";
import { createGeminiProvider, readGeminiConfig } from "./gemini";
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
  /** True when a real provider key is configured. */
  configured: boolean;
  /** Human label for the UI status endpoint. Never contains a key. */
  label: string;
}

/** Pick the provider from env. Pure function of process.env — safe per request. */
export function selectProvider(): ProviderSelection {
  const forced = (process.env.AI_PROVIDER ?? "").trim().toLowerCase();
  const validNames: ProviderName[] = ["xai", "gemini", "openai", "anthropic"];
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
      return makeSelection(forced as ProviderName) ?? demoSelection;
    }
    return {
      ...demoSelection,
      label: "Demo mode — AI_PROVIDER must be demo, xai, gemini, openai, or anthropic",
    };
  }

  for (const name of validNames) {
    const selection = makeSelection(name);
    if (selection) return selection;
  }

  return demoSelection;
}
