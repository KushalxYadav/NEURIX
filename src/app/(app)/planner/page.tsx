import { CalendarCheck2 } from "lucide-react";
import type { Metadata } from "next";

import { ModulePreview } from "@/components/common/module-preview";

export const metadata: Metadata = { title: "Study Planner" };

export default function Page() {
  return (
    <ModulePreview
      icon={CalendarCheck2}
      eyebrow="Study Planner"
      title="A realistic plan to your exam"
      description="A schedule built from your real curriculum, exam date, available time and actual progress."
      phase={6}
      capabilities={[
        "Prioritises incomplete essentials, difficult topics, weak assessment results, revision and mock exams.",
        "Daily tasks with time estimates that you can reschedule.",
        "Adapts future days to what you actually completed.",
      ]}
      requires={["sources", "curriculum", "account"]}
    />
  );
}
