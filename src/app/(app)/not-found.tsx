import { SearchX } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <EmptyState icon={SearchX} title="Not found" actions={<Button asChild variant="secondary"><Link href="/dashboard">Back to dashboard</Link></Button>}>
      This item does not exist in your processed material. If you re-ran the pipeline, links from before may have changed.
    </EmptyState>
  );
}
