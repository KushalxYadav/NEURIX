import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils/cn";

export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-[color,background,border,box-shadow,transform] duration-150 disabled:pointer-events-none disabled:opacity-45 active:translate-y-px [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-primary-strong text-white shadow-[0_0_0_1px_rgb(143_128_255/0.4),0_8px_24px_-10px_rgb(122_105_245/0.7)] hover:bg-primary",
        secondary: "glass text-foreground hover:bg-surface-strong hover:border-border-strong",
        ghost: "text-muted hover:bg-surface-strong hover:text-foreground",
        outline: "border border-border-strong text-foreground hover:bg-surface-strong",
        danger: "bg-danger-soft text-danger border border-danger/30 hover:bg-danger/20",
      },
      size: {
        sm: "h-8 px-3 text-[13px]",
        md: "h-10 px-4",
        lg: "h-11 px-5 text-[15px]",
        icon: "size-10",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps extends ComponentProps<"button">, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Component = asChild ? Slot.Root : "button";
  return <Component className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
