import "server-only";

import { z } from "zod";

/**
 * Server configuration, validated once. Secrets (API keys, service role)
 * never leave the server: nothing here is passed to client components.
 */
const optionalString = z
  .string()
  .trim()
  .transform((value) => (value === "" ? undefined : value))
  .optional();

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  NEXT_PUBLIC_SITE_URL: optionalString,
  NEXT_PUBLIC_SUPABASE_URL: optionalString,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: optionalString,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalString,
  SYNAPSE_DATA_SOURCE: z.enum(["local", "supabase"]).optional().catch(undefined),
  SYNAPSE_DATA_DIR: optionalString,
  ANTHROPIC_API_KEY: optionalString,
  ANTHROPIC_MODEL: optionalString,
  ANTHROPIC_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).optional().catch(undefined),
  EMBEDDINGS_PROVIDER: z.enum(["none", "voyage"]).optional().catch(undefined),
  VOYAGE_API_KEY: optionalString,
  VOYAGE_EMBEDDING_MODEL: optionalString,
});

export type ServerEnv = z.infer<typeof EnvSchema>;

let cached: ServerEnv | null = null;

export function getEnv(): ServerEnv {
  cached ??= EnvSchema.parse(process.env);
  return cached;
}

/** Test helper: forget the cached environment. */
export function resetEnvCache(): void {
  cached = null;
}

export const DEFAULT_MODEL = "claude-opus-5-5";

export function supabaseConfig(env: ServerEnv = getEnv()) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && key ? { url, key } : null;
}

export type DataMode = "local" | "supabase" | "unconfigured";

/**
 * Where source data comes from:
 * - `supabase`: signed-in users, data scoped by RLS (production default)
 * - `local`: read-only view of `data/processed/` produced by the local
 *   ingestion pipeline, no authentication (development default when
 *   Supabase is not configured; production only when explicitly requested)
 */
export function getDataMode(env: ServerEnv = getEnv()): DataMode {
  if (env.SYNAPSE_DATA_SOURCE === "local") return "local";
  if (env.SYNAPSE_DATA_SOURCE === "supabase") return supabaseConfig(env) ? "supabase" : "unconfigured";
  if (supabaseConfig(env)) return "supabase";
  return env.NODE_ENV === "production" ? "unconfigured" : "local";
}

export function aiConfig(env: ServerEnv = getEnv()) {
  return {
    configured: Boolean(env.ANTHROPIC_API_KEY),
    model: env.ANTHROPIC_MODEL ?? DEFAULT_MODEL,
    effort: env.ANTHROPIC_EFFORT ?? "medium",
  } as const;
}

export function embeddingsConfig(env: ServerEnv = getEnv()) {
  const provider = env.EMBEDDINGS_PROVIDER ?? "none";
  return {
    provider,
    configured: provider === "voyage" && Boolean(env.VOYAGE_API_KEY),
    model: env.VOYAGE_EMBEDDING_MODEL ?? "voyage-3.5",
  } as const;
}
