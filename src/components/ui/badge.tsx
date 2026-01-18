import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-lg border px-2.5 py-0.5 text-xs font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary/90 text-primary-foreground shadow-sm hover:bg-primary hover:shadow-md hover:shadow-primary/20",
        secondary:
          "border-border/40 bg-secondary/60 backdrop-blur-sm text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive/90 text-destructive-foreground shadow-sm hover:bg-destructive",
        outline: "text-foreground border-border/50 hover:bg-muted/50 hover:border-border/70",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
