import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { ClaudeProvider, toAIError } from "@/lib/ai/claude";
import { AIError, type UsageEvent } from "@/lib/ai/types";

const Schema = z.object({ answer: z.string() });

function fakeClient(response: Record<string, unknown>) {
  const parse = vi.fn().mockResolvedValue(response);
  const finalMessage = vi.fn().mockResolvedValue(response);
  const stream = vi.fn().mockReturnValue({ finalMessage });
  return { client: { beta: { messages: { parse, stream } } } as unknown as Anthropic, parse, stream };
}

const baseResponse = {
  model: "claude-opus-5-5",
  stop_reason: "end_turn",
  usage: { input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 100 },
};

const request = {
  agent: "tutor" as const,
  system: "SYSTEM PROMPT WITH PRIVATE COURSE TEXT",
  messages: [{ role: "user" as const, content: "What is a subnet?" }],
};

describe("ClaudeProvider", () => {
  it("returns validated structured output and logs content-free usage", async () => {
    const events: UsageEvent[] = [];
    const { client, parse } = fakeClient({ ...baseResponse, parsed_output: { answer: "A subdivision of a network" } });
    const provider = new ClaudeProvider({ client, model: "claude-opus-5-5", effort: "medium", onUsage: (e) => void events.push(e) });
    const result = await provider.generateStructured({ ...request, schema: Schema });
    expect(result.data.answer).toBe("A subdivision of a network");
    const params = parse.mock.calls[0][0];
    expect(params).toMatchObject({ model: "claude-opus-5-5", fallbacks: "default", output_config: { effort: "medium" } });
    expect(params.betas).toContain("server-side-fallback-2026-07-01");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ agent: "tutor", status: "ok", usage: { inputTokens: 120, outputTokens: 30, cacheReadTokens: 100 } });
    expect(JSON.stringify(events[0])).not.toContain("PRIVATE COURSE TEXT");
  });

  it("re-validates output and rejects schema mismatches", async () => {
    const { client } = fakeClient({ ...baseResponse, parsed_output: { wrong: true } });
    const provider = new ClaudeProvider({ client, model: "m", effort: "low" });
    await expect(provider.generateStructured({ ...request, schema: Schema })).rejects.toMatchObject({ code: "invalid_output" });
  });

  it("maps refusals and truncation to explicit errors", async () => {
    const refusal = new ClaudeProvider({ client: fakeClient({ ...baseResponse, stop_reason: "refusal", parsed_output: null }).client, model: "m", effort: "low" });
    await expect(refusal.generateStructured({ ...request, schema: Schema })).rejects.toMatchObject({ code: "refusal", retryable: false });
    const truncated = new ClaudeProvider({ client: fakeClient({ ...baseResponse, stop_reason: "max_tokens", content: [] }).client, model: "m", effort: "low" });
    await expect(truncated.generateText(request)).rejects.toMatchObject({ code: "truncated", retryable: true });
  });

  it("joins streamed text blocks", async () => {
    const { client } = fakeClient({ ...baseResponse, content: [{ type: "thinking", thinking: "" }, { type: "text", text: "Hello " }, { type: "text", text: "world" }] });
    const result = await new ClaudeProvider({ client, model: "m", effort: "low" }).generateText(request);
    expect(result.data).toBe("Hello world");
  });

  it("never lets a failing usage sink break a request", async () => {
    const { client } = fakeClient({ ...baseResponse, parsed_output: { answer: "ok" } });
    const provider = new ClaudeProvider({ client, model: "m", effort: "low", onUsage: () => { throw new Error("db down"); } });
    await expect(provider.generateStructured({ ...request, schema: Schema })).resolves.toMatchObject({ data: { answer: "ok" } });
  });
});

describe("toAIError", () => {
  it("classifies SDK errors from most to least specific", () => {
    const headers = new Headers();
    expect(toAIError(new Anthropic.RateLimitError(429, undefined, "slow down", headers))).toMatchObject({ code: "rate_limited", retryable: true });
    expect(toAIError(new Anthropic.AuthenticationError(401, undefined, "bad key", headers))).toMatchObject({ code: "authentication" });
    expect(toAIError(new Anthropic.InternalServerError(500, undefined, "oops", headers))).toMatchObject({ code: "provider_unavailable", retryable: true });
    const existing = new AIError("refusal", "no");
    expect(toAIError(existing)).toBe(existing);
  });
});
