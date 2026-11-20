import { Target } from "lucide-react";
import type { Metadata } from "next";

import { ModulePreview } from "@/components/common/module-preview";

export const metadata: Metadata = { title: "Practice Arena" };

export default function Page() {
  return (
    <ModulePreview
      icon={Target}
      eyebrow="Practice Arena"
      title="Test what you actually understand"
      description="Questions generated only from your course material, with feedback after every answer."
      phase={5}
      capabilities={[
        "Multiple-choice, multiple-select, fill-in-the-blank, short, long and numerical questions.",
        "Easy, medium, hard or mixed difficulty.",
        "Immediate correctness, explanation, common misconceptions and a link back to the topic.",
        "Every attempt is recorded and updates your verified mastery.",
      ]}
      requires={["sources", "curriculum", "ai", "account"]}
    />
  );
}
