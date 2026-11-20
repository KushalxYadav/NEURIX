import { MessageSquareText } from "lucide-react";
import type { Metadata } from "next";

import { ModulePreview } from "@/components/common/module-preview";

export const metadata: Metadata = { title: "AI Tutor" };

export default function Page() {
  return (
    <ModulePreview
      icon={MessageSquareText}
      eyebrow="AI Tutor"
      title="Ask anything about your subject"
      description="A tutor that knows your current week, topic, weak areas and course material, and answers with citations."
      phase={4}
      capabilities={[
        "Natural-language questions answered from retrieved passages of your lectures and textbook, with exact slide/page citations.",
        "Explain a selected slide or paragraph, compare concepts, explain formulas, prepare exam answers, summarise a week.",
        "Clearly separates what your teacher’s material says from supplementary AI explanation.",
        "Remembers the conversation and your identified weak topics.",
      ]}
      requires={["sources", "ai", "account"]}
    />
  );
}
