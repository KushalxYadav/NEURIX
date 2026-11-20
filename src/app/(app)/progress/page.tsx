import { TrendingUp } from "lucide-react";
import type { Metadata } from "next";

import { ModulePreview } from "@/components/common/module-preview";

export const metadata: Metadata = { title: "Progress" };

export default function Page() {
  return (
    <ModulePreview
      icon={TrendingUp}
      eyebrow="Progress"
      title="Mastery you can trust"
      description="Topic-wise analytics built only from learning evidence — never from pages opened."
      phase={5}
      capabilities={[
        "Tracks lessons completed, checkpoint results, quiz accuracy, repeated mistakes, revision and study time.",
        "A transparent mastery formula that keeps estimated mastery separate from verified assessment performance.",
        "Weak-topic detection that feeds the planner and revision.",
      ]}
      requires={["curriculum", "account"]}
    />
  );
}
