import { HardDrive } from "lucide-react";

export function LocalModeBanner() {
  return (
    <div className="border-b border-warning/20 bg-warning-soft/60 px-4 py-2 text-center text-[12.5px] text-warning sm:px-6">
      <HardDrive aria-hidden className="mr-1.5 inline size-3.5 align-[-2px]" />
      Local mode — showing <code className="font-mono">data/processed/</code> from your machine. Sign-in, saved
      progress and AI features need Supabase and an API key (see Settings).
    </div>
  );
}
