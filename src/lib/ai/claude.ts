import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";

import {
  AIError,
  type AIProvider,
  type AIRequestBase,
  type AIResult,
  type Effort,
  type StructuredRequest,
  type UsageInfo,
  type UsageSink,
} from "./types";

/** Server-side refusal fallback: the API re-runs a declined request on a fallback model. */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

type BetaMessage = Anthropic.Beta.BetaMessage;

export interface ClaudeProviderOptions {
  client: Anthropic;
  model: string;
  effort: Effort;
  onUsage?: UsageSink;
}

/**
 * Claude implementation of the provider abstraction. Only server code may use
 * it: the API key stays in the server environment.
 */
export class ClaudeProvider implements AIProvider {
  readonly name = "anthropic";
  readonly model: string;
  private readonly client: Anthropic;
  private readonly effort: Effort;
  private readonly onUsage?: UsageSink;

  constructor(options: ClaudeProviderOptions) {
    this.client = options.client;
    this.model = options.model;
    this.effort = options.effort;
    this.onUsage = options.onUsage;
  }

  async generateStructured<T>(request: StructuredRequest<T>): Promise<AIResult<T>> {
    const started = performance.now();
    try {
      const response = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: request.maxTokens ?? 16_000,
        system: request.system,
        messages: request.messages,
        betas: [FALLBACK_BETA],
        fallbacks: "default",
        output_config: { effort: request.effort ?? this.effort, format: betaZodOutputFormat(request.schema) },
      });
      this.assertUsable(response);
      // Defence in depth: validate again with our own schema before anything uses it.
      const validated = request.schema.safeParse(response.parsed_output);
      if (!validated.success) {
        throw new AIError("invalid_output", `Model output failed validation: ${validated.error.issues[0]?.message}`);
      }
      return this.finish(request, response, validated.data, started);
    } catch (error) {
      throw await this.fail(request, error, started);
    }
  }

  async generateText(request: AIRequestBase): Promise<AIResult<string>> {
    const started = performance.now();
    try {
      const stream = this.client.beta.messages.stream({
        model: this.model,
        max_tokens: request.maxTokens ?? 32_000,
        system: request.system,
        messages: request.messages,
        betas: [FALLBACK_BETA],
        fallbacks: "default",
        output_config: { effort: request.effort ?? this.effort },
      });
      const response = await stream.finalMessage();
      this.assertUsable(response);
      const text = response.content
        .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
        .map((block) => block.text)
        .join("");
      return this.finish(request, response, text, started);
    } catch (error) {
      throw await this.fail(request, error, started);
    }
  }

  private assertUsable(response: BetaMessage): void {
    if (response.stop_reason === "refusal") {
      throw new AIError("refusal", "The model declined this request.");
    }
    if (response.stop_reason === "max_tokens") {
      throw new AIError("truncated", "The response hit the output limit before finishing.", true);
    }
  }

  private async finish<T>(request: AIRequestBase, response: BetaMessage, data: T, started: number): Promise<AIResult<T>> {
    const usage: UsageInfo = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    };
    const latencyMs = Math.round(performance.now() - started);
    await this.report({ request, status: "ok", usage, latencyMs, model: response.model });
    return { data, model: response.model, usage, latencyMs };
  }

  private async fail(request: AIRequestBase, error: unknown, started: number): Promise<AIError> {
    const mapped = toAIError(error);
    await this.report({
      request,
      status: mapped.code === "refusal" ? "refusal" : "error",
      errorCode: mapped.code,
      latencyMs: Math.round(performance.now() - started),
      model: this.model,
    });
    return mapped;
  }

  private async report(event: {
    request: AIRequestBase;
    status: "ok" | "error" | "refusal";
    usage?: UsageInfo;
    errorCode?: AIError["code"];
    latencyMs: number;
    model: string;
  }): Promise<void> {
    if (!this.onUsage) return;
    try {
      await this.onUsage({
        agent: event.request.agent,
        model: event.model,
        status: event.status,
        errorCode: event.errorCode,
        usage: event.usage,
        latencyMs: event.latencyMs,
        userId: event.request.userId,
        subjectId: event.request.subjectId,
      });
    } catch {
      // Usage logging must never break a learning request.
    }
  }
}

/** Map SDK errors (most specific first) to stable application error codes. */
export function toAIError(error: unknown): AIError {
  if (error instanceof AIError) return error;
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new AIError("authentication", "The Claude API key was rejected.", false, error);
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new AIError("rate_limited", "Claude is rate limited right now. Try again shortly.", true, error);
  }
  if (error instanceof Anthropic.BadRequestError || error instanceof Anthropic.NotFoundError) {
    return new AIError("bad_request", `Claude rejected the request: ${error.message}`, false, error);
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new AIError("provider_unavailable", "Could not reach the Claude API.", true, error);
  }
  if (error instanceof Anthropic.APIError) {
    const retryable = (error.status ?? 500) >= 500;
    return new AIError("provider_unavailable", `Claude API error (${error.status ?? "unknown"}).`, retryable, error);
  }
  return new AIError("provider_unavailable", error instanceof Error ? error.message : "Unknown AI error", false, error);
}
