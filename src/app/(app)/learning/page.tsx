import { BookOpenText } from "lucide-react";
import type { Metadata } from "next";

import { ModulePreview } from "@/components/common/module-preview";

export const metadata: Metadata = { title: "Learning Room" };

export default function Page() {
  return (
    <ModulePreview
      icon={BookOpenText}
      eyebrow="Learning Room"
      title="Learn any topic from zero to exam level"
      description="An interactive textbook with a personal teacher: lessons are split into short sections with checkpoint questions, and every explanation cites your slides and textbook pages."
      phase={4}
      capabilities={[
        "Five learning modes per topic: Start From Zero, Detailed Explanation, Visual Learning, Exam Preparation and Quick Revision.",
        "Short sections with checkpoint questions; your answers are evaluated and the lesson adapts (simpler, another example, more detail, a diagram).",
        "Diagrams, flowcharts, concept maps and formula breakdowns generated from the topic — not decorative images.",
        "Every statement labelled as coming from your material (with slide/page citation) or as AI supplementary explanation.",
        "Lesson history and checkpoint results feed your topic mastery.",
      ]}
      requires={["sources", "curriculum", "ai", "account"]}
    />
  );
}
