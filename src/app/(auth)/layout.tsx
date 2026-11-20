import type { ReactNode } from "react";

import { Wordmark } from "@/components/shell/logo";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="mb-8">
        <Wordmark />
      </div>
      <div className="w-full max-w-[400px]">{children}</div>
    </main>
  );
}
