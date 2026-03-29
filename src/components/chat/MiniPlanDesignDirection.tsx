import React from "react";
import { Compass } from "lucide-react";
import { VanillaMarkdownParser } from "./DyadMarkdownParser";

interface MiniPlanDesignDirectionProps {
  direction: string;
}

export const MiniPlanDesignDirection: React.FC<
  MiniPlanDesignDirectionProps
> = ({ direction }) => {
  return (
    <div className="flex items-start gap-2">
      <Compass size={14} className="text-muted-foreground mt-0.5 shrink-0" />
      <div className="text-sm text-foreground/80 [&_p]:m-0 [&_p]:leading-relaxed">
        <VanillaMarkdownParser content={direction} />
      </div>
    </div>
  );
};
