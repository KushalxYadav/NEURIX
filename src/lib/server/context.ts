import "server-only";

import { cache } from "react";

import { getViewer } from "@/lib/auth/session";
import { getSourceRepository } from "@/modules/sources";

/**
 * Resolve the viewer first (authentication), then the repository that runs
 * as that viewer, then their active subject. Cached per request.
 */
export const getSubjectContext = cache(async () => {
  const viewer = await getViewer();
  const repo = await getSourceRepository();
  const subject = await repo.getActiveSubject();
  return { viewer, repo, subject };
});
