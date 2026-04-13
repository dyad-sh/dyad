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
  mono?: boolean;
  raw?: boolean;
}

export function CopyButton({
  value,
  ariaLabel,
  displayText,
  tooltipText,
  mono = false,
  raw = false,
}: CopyButtonProps) {
  const { copyMessageContent, copyRawText, copied } = useCopyToClipboard();

  const handleCopy = () => {
    if (!value) return;
    if (raw) {
      copyRawText(value);
    } else {
      copyMessageContent(value);
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            onClick={handleCopy}
            aria-label={ariaLabel}
            className="flex items-center space-x-1 px-1 py-0.5 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors duration-200 cursor-pointer"
          />
        }
      >
        {copied ? (
          <Check className="h-3 w-3 text-green-500" />
        ) : (
          <Copy className="h-3 w-3" />
        )}
        <span className={`${mono ? "font-mono" : ""} text-xs`}>
          {copied ? "Copied" : displayText}
        </span>
      </TooltipTrigger>
      <TooltipContent>{copied ? "Copied!" : tooltipText}</TooltipContent>
    </Tooltip>
  );
}
