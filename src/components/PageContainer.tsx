import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type PageContainerSize = "md" | "lg" | "xl";

const maxWidthClasses: Record<PageContainerSize, string> = {
  md: "max-w-4xl",
  lg: "max-w-5xl",
  xl: "max-w-6xl",
};

export function PageContainer({
  children,
  size = "lg",
  className,
  innerClassName,
}: {
  children: ReactNode;
  size?: PageContainerSize;
  className?: string;
  innerClassName?: string;
}) {
  return (
    <div
      className={cn("w-full min-h-full px-4 py-4 sm:px-6 lg:px-8", className)}
    >
      <div
        className={cn("mx-auto w-full", maxWidthClasses[size], innerClassName)}
      >
        {children}
      </div>
    </div>
  );
}
