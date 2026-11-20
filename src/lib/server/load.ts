import "server-only";

import { unstable_rethrow } from "next/navigation";

/**
 * Run a data loader and return either its value or the error, while letting
 * Next.js control-flow errors (redirect, notFound, prerender signals) through.
 */
export async function attempt<T>(loader: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  try {
    return { ok: true, value: await loader() };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error };
  }
}
