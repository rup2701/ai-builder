import * as React from "react";
import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "field-sizing-content min-h-10 w-full resize-none rounded-2xl border border-input bg-transparent px-3.5 py-2 text-base leading-snug outline-none placeholder:text-muted-foreground focus:border-foreground/60 disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
