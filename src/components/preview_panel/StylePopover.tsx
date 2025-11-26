import { ReactNode } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface StylePopoverProps {
  icon: ReactNode;
  title: string;
  tooltip: string;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
}

export function StylePopover({
  icon,
  title,
  tooltip,
  children,
  side = "bottom",
}: StylePopoverProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-[#7f22fe] dark:text-gray-200"
          aria-label={tooltip}
        >
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>{icon}</TooltipTrigger>
              <TooltipContent side={side}>
                <p>{tooltip}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </button>
      </PopoverTrigger>
      <PopoverContent side={side} className="w-64">
        <div className="space-y-3">
          <h4 className="font-medium text-sm" style={{ color: "#7f22fe" }}>
            {title}
          </h4>
          {children}
        </div>
      </PopoverContent>
    </Popover>
  );
}
