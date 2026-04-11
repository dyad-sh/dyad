import { Copy, Check } from "lucide-react";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

interface CopyButtonProps {
  value: string;
  ariaLabel: string;
  displayText: string;
  tooltipText: string;
}

export function CopyButton({
  value,
  ariaLabel,
  displayText,
  tooltipText,
}: CopyButtonProps) {
  const { copyMessageContent, copied } = useCopyToClipboard();

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            onClick={() => {
              if (!value) return;
              copyMessageContent(value);
            }}
            aria-label={ariaLabel}
            className="flex items-center space-x-1 px-1 py-0.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors duration-200 cursor-pointer"
          />
        }
      >
        <span className="font-mono text-xs text-gray-500 dark:text-gray-400">
          {copied ? "Copied" : displayText}
        </span>
        {copied ? (
          <Check className="h-3 w-3 text-green-500 ml-1" />
        ) : (
          <Copy className="h-3 w-3 ml-1" />
        )}
      </TooltipTrigger>
      <TooltipContent>{copied ? "Copied!" : tooltipText}</TooltipContent>
    </Tooltip>
  );
}
