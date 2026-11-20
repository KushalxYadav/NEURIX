import { GalleryVerticalEnd } from "lucide-react";
import type { Metadata } from "next";

import { ModulePreview } from "@/components/common/module-preview";

export const metadata: Metadata = { title: "Flashcards" };

export default function Page() {
  return (
    <ModulePreview
      icon={GalleryVerticalEnd}
      eyebrow="Flashcards"
      title="Active recall with spaced revision"
      description="Definition, concept and formula cards scheduled by how well you remember them."
      phase={5}
      capabilities={[
        "Topic-wise cards for definitions, key concepts and formulas, each citing its source.",
        "Rate cards Again, Difficult, Good or Easy; ratings drive the spaced-repetition schedule.",
        "Revision history and a list of difficult cards.",
      ]}
      requires={["sources", "curriculum", "account"]}
    />
  );
}
