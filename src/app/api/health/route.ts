import { NextResponse } from "next/server";

import { aiConfig, embeddingsConfig, getDataMode } from "@/lib/config/env";

/** Liveness + configuration summary for deployments. Never exposes secret values. */
export function GET() {
  const ai = aiConfig();
  return NextResponse.json(
    {
      status: "ok",
      dataMode: getDataMode(),
      ai: { configured: ai.configured, model: ai.model },
      embeddings: { provider: embeddingsConfig().provider, configured: embeddingsConfig().configured },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
