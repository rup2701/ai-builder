import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs", {
  variants: {
    variant: {
      default: "bg-primary text-primary-foreground",
      secondary: "bg-foreground/[0.06] text-foreground",
      outline: "border border-border text-foreground/70",
    },
  },
  defaultVariants: { variant: "secondary" },
});

function Badge({ className, variant, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge };
