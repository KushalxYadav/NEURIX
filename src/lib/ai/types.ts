import type Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";

/** The specialised services from the product spec. Each owns its prompts and schemas. */
export type AgentName =
  | "curriculum"
  | "teaching"
  | "tutor"
  | "notes"
  | "assessment"
  | "revision"
  | "planner"
  | "health_check";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface AIRequestBase {
  agent: AgentName;
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  maxTokens?: number;
  effort?: Effort;
  /** For usage attribution only; never sent to the model provider. */
  userId?: string;
  subjectId?: string;
}

export interface StructuredRequest<T> extends AIRequestBase {
  schema: z.ZodType<T>;
}

export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

export interface AIResult<T> {
  data: T;
  model: string;
  usage: UsageInfo;
  latencyMs: number;
}

export interface AIProvider {
  readonly name: string;
  readonly model: string;
  generateStructured<T>(request: StructuredRequest<T>): Promise<AIResult<T>>;
  generateText(request: AIRequestBase): Promise<AIResult<string>>;
}

export type AIErrorCode =
  | "not_configured"
  | "authentication"
  | "rate_limited"
  | "refusal"
  | "truncated"
  | "invalid_output"
  | "bad_request"
  | "provider_unavailable";

export class AIError extends Error {
  constructor(
    readonly code: AIErrorCode,
    message: string,
    readonly retryable = false,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AIError";
  }
}

export interface UsageEvent {
  agent: AgentName;
  model: string;
  status: "ok" | "error" | "refusal";
  errorCode?: AIErrorCode;
  usage?: UsageInfo;
  latencyMs: number;
  userId?: string;
  subjectId?: string;
}

export type UsageSink = (event: UsageEvent) => void | Promise<void>;
