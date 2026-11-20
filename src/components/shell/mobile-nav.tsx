"use client";

import { Menu, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useState, type ReactNode } from "react";

import { NavLinks } from "./nav-links";

export function MobileNav({ header, footer }: { header: ReactNode; footer?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        aria-label="Open navigation"
        className="inline-flex size-10 items-center justify-center rounded-xl text-muted hover:bg-surface-strong hover:text-foreground lg:hidden"
      >
        <Menu className="size-5" />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in" />
        <Dialog.Content className="scrollbar-thin fixed inset-y-0 left-0 z-50 flex w-[86vw] max-w-[300px] flex-col gap-6 overflow-y-auto border-r border-border bg-background-raised p-4 shadow-2xl focus:outline-none">
          <div className="flex items-center justify-between">
            {header}
            <Dialog.Close
              aria-label="Close navigation"
              className="inline-flex size-9 items-center justify-center rounded-xl text-muted hover:bg-surface-strong hover:text-foreground"
            >
              <X className="size-5" />
            </Dialog.Close>
          </div>
          <Dialog.Title className="sr-only">Navigation</Dialog.Title>
          <Dialog.Description className="sr-only">Move between SYNAPSE sections</Dialog.Description>
          <NavLinks onNavigate={() => setOpen(false)} />
          {footer && <div className="mt-auto">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
