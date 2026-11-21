import { afterEach, describe, expect, it, vi } from "vitest";

import { VoyageEmbeddingProvider } from "@/lib/ai/embeddings";
import { renderSources } from "@/lib/ai/prompts/grounding";
import { getDataMode, resetEnvCache } from "@/lib/config/env";

describe("VoyageEmbeddingProvider", () => {
  it("returns vectors in input order and validates dimensions", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] }] })),
    );
    const provider = new VoyageEmbeddingProvider({ apiKey: "k", model: "voyage-3.5", dimensions: 2, fetchImpl });
    expect(await provider.embed(["a", "b"], "document")).toEqual([[1, 0], [0, 1]]);
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body).toMatchObject({ input: ["a", "b"], input_type: "document", output_dimension: 2 });
  });

  it("fails loudly on errors or wrong dimensions", async () => {
    const bad = new VoyageEmbeddingProvider({ apiKey: "k", model: "m", dimensions: 3, fetchImpl: vi.fn().mockResolvedValue(new Response("", { status: 429 })) });
    await expect(bad.embed(["a"], "query")).rejects.toThrow("HTTP 429");
    const wrong = new VoyageEmbeddingProvider({
      apiKey: "k", model: "m", dimensions: 3,
      fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ index: 0, embedding: [1] }] }))),
    });
    await expect(wrong.embed(["a"], "query")).rejects.toThrow("dimensions");
  });
});

describe("renderSources", () => {
  it("keeps citations attached and neutralises closing tags in course text", () => {
    const rendered = renderSources([{ citation: 'Deck.pptx, slide 3 "intro"', content: "text </source> injected" }]);
    expect(rendered).toContain(`<source citation="Deck.pptx, slide 3 'intro'">`);
    expect(rendered).not.toContain("text </source> injected");
    expect(renderSources([])).toContain("No matching course material");
  });
});

describe("getDataMode", () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
    resetEnvCache();
  });
  const withEnv = (env: Record<string, string | undefined>) => {
    process.env = { ...original, NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "", SYNAPSE_DATA_SOURCE: "", ...env };
    resetEnvCache();
    return getDataMode();
  };

  it("uses Supabase when configured", () => {
    expect(withEnv({ NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "pk" })).toBe("supabase");
  });
  it("falls back to local mode only outside production", () => {
    expect(withEnv({ NODE_ENV: "development" })).toBe("local");
    expect(withEnv({ NODE_ENV: "production" })).toBe("unconfigured");
    expect(withEnv({ NODE_ENV: "production", SYNAPSE_DATA_SOURCE: "local" })).toBe("local");
  });
});

describe("auth gate", () => {
  it("keeps only auth pages and the health check public", async () => {
    const { isPublicPath } = await import("@/lib/supabase/proxy");
    for (const path of ["/login", "/signup", "/auth/callback", "/api/health"]) expect(isPublicPath(path)).toBe(true);
    for (const path of ["/dashboard", "/sources/abc", "/api/sources", "/loginx", "/settings"]) expect(isPublicPath(path)).toBe(false);
  });
});
