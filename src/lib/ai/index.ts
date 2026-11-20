import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { aiConfig, getEnv } from "@/lib/config/env";

import { ClaudeProvider } from "./claude";
import { AIError, type AIProvider, type UsageSink } from "./types";

/** Structured, content-free usage log (token counts and status only). */
const logUsage: UsageSink = (event) => {
  console.info(
    JSON.stringify({
      type: "ai_usage",
      agent: event.agent,
      model: event.model,
      status: event.status,
      error: event.errorCode ?? null,
      input_tokens: event.usage?.inputTokens ?? null,
      output_tokens: event.usage?.outputTokens ?? null,
      cache_read_tokens: event.usage?.cacheReadTokens ?? null,
      latency_ms: event.latencyMs,
    }),
  );
};

let provider: AIProvider | null = null;

/** The configured generation provider. Throws `not_configured` without an API key. */
export function getAIProvider(onUsage: UsageSink = logUsage): AIProvider {
  const config = aiConfig();
  if (!config.configured) {
    throw new AIError("not_configured", "ANTHROPIC_API_KEY is not set on the server.");
  }
  provider ??= new ClaudeProvider({
    client: new Anthropic({ apiKey: getEnv().ANTHROPIC_API_KEY, maxRetries: 2 }),
    model: config.model,
    effort: config.effort,
    onUsage,
  });
  return provider;
}

export { AIError } from "./types";
export type { AIProvider, AIResult, AgentName, StructuredRequest } from "./types";
