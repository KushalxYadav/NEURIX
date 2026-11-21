import "server-only";

import path from "node:path";
import { cache } from "react";

import { getDataMode, getEnv } from "@/lib/config/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { LocalSourceRepository } from "./local-repository";
import { SupabaseSourceRepository } from "./supabase-repository";
import type { SourceRepository } from "./types";

let localRepository: LocalSourceRepository | null = null;

export function localDataDir(): string {
  // turbopackIgnore: local study material must never be traced into a deployment bundle.
  const configured = getEnv().SYNAPSE_DATA_DIR;
  return configured
    ? path.resolve(/*turbopackIgnore: true*/ configured)
    : path.join(/*turbopackIgnore: true*/ process.cwd(), "data");
}

/**
 * The repository for the current request. Call it only after the viewer has
 * been resolved (see getViewer), so Supabase queries run as that user and
 * Row Level Security scopes every row.
 */
export const getSourceRepository = cache(async (): Promise<SourceRepository> => {
  const mode = getDataMode();
  if (mode === "local") {
    localRepository ??= new LocalSourceRepository(localDataDir());
    return localRepository;
  }
  if (mode === "supabase") {
    return new SupabaseSourceRepository(await createSupabaseServerClient());
  }
  throw new Error("SYNAPSE is not configured: set the Supabase environment variables.");
});

export type { SourceRepository } from "./types";
