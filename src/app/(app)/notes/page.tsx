import { NotebookPen } from "lucide-react";
import type { Metadata } from "next";

import { ModulePreview } from "@/components/common/module-preview";

export const metadata: Metadata = { title: "My Notes" };

export default function Page() {
  return (
    <ModulePreview
      icon={NotebookPen}
      eyebrow="My Notes"
      title="Structured notes for every topic"
      description="Topic-wise notes generated from your sources, which you can edit, bookmark, search and export."
      phase={4}
      capabilities={[
        "Notes with simple and detailed explanations, definitions, examples, formulas and exam-oriented summaries.",
        "Every note keeps links to its original slides and textbook pages.",
        "Edit, bookmark, full-text search, and export to Markdown or PDF.",
      ]}
      requires={["sources", "curriculum", "ai", "account"]}
    />
  );
}
