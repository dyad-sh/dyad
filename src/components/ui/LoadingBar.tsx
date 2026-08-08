import { cn } from "@/lib/utils";
import React from "react";

export const LoadingBar: React.FC<{ isVisible: boolean }> = ({ isVisible }) => {
  return (
    <div
      key="loading-bar"
      className={cn(
        "relative w-full h-1 bg-primary/20 overflow-hidden",
        isVisible ? "" : "invisible",
      )}
    >
      <div
        className={cn(
          "absolute top-0 left-0 h-full w-1/2 bg-primary animate-marquee",
        )}
      />
    </div>
  );
};
