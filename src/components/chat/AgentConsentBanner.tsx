import React from "react";
import { Button } from "../ui/button";
import { X, Bot, Info, ShieldCheck, Check, Ban } from "lucide-react";
import type { PendingAgentConsent } from "@/atoms/chatAtoms";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";

interface AgentConsentBannerProps {
  consent: PendingAgentConsent;
  onDecision: (decision: "accept-once" | "accept-always" | "decline") => void;
  onClose: () => void;
  /** Total number of consents in the queue */
  queueTotal?: number;
}

export function AgentConsentBanner({
  consent,
  onDecision,
  onClose,
  queueTotal = 1,
}: AgentConsentBannerProps) {
  const { toolName, toolDescription, inputPreview } = consent;

  // Collapsible input preview state
  const [isInputExpanded, setIsInputExpanded] = React.useState(false);
  const [inputCollapsedMaxHeight, setInputCollapsedMaxHeight] =
    React.useState<number>(0);
  const [inputHasOverflow, setInputHasOverflow] = React.useState(false);
  const inputRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!inputPreview) {
      setInputHasOverflow(false);
      return;
    }

    const element = inputRef.current;
    if (!element) return;

    const compute = () => {
      const computedStyle = window.getComputedStyle(element);
      const lineHeight = parseFloat(computedStyle.lineHeight || "16");
      const maxLines = 6;
      const maxHeightPx = Math.max(0, Math.round(lineHeight * maxLines));
      setInputCollapsedMaxHeight(maxHeightPx);
      setInputHasOverflow(element.scrollHeight > maxHeightPx + 1);
    };

    compute();
    const onResize = () => compute();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [inputPreview]);

  return (
    <div className="border-b border-border bg-muted/50">
      <div className="p-2">
        <div className="flex items-center gap-2 mb-1">
          <Bot className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <span className="text-sm font-medium">
            Allow <span className="font-mono">{toolName}</span> to run?
            {queueTotal > 1 && (
              <span className="ml-1.5 text-xs text-muted-foreground font-normal">
                (1 of {queueTotal})
              </span>
            )}
          </span>
          {toolDescription && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs">
                  <p className="text-xs">{toolDescription}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <button
            onClick={onClose}
            className="ml-auto flex-shrink-0 p-1 text-muted-foreground hover:text-foreground transition-colors rounded hover:bg-muted"
            aria-label="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        {inputPreview && (
          <div className="ml-6 mb-1.5">
            <div
              ref={inputRef}
              className="bg-muted p-1.5 rounded text-sm whitespace-pre-wrap"
              style={{
                maxHeight: isInputExpanded ? "40vh" : inputCollapsedMaxHeight,
                overflow: isInputExpanded ? "auto" : "hidden",
              }}
            >
              {inputPreview}
            </div>
            {inputHasOverflow && (
              <button
                type="button"
                className="mt-0.5 text-xs text-muted-foreground hover:text-foreground hover:underline"
                onClick={() => setIsInputExpanded((v) => !v)}
              >
                {isInputExpanded ? "Show less" : "Show more"}
              </button>
            )}
          </div>
        )}
        <div className="flex items-center gap-2 ml-6">
          <Button
            onClick={() => onDecision("accept-always")}
            size="sm"
            variant="outline"
            className="h-7 px-3 text-xs"
          >
            <ShieldCheck className="w-3.5 h-3.5 mr-1" />
            Always allow
          </Button>
          <Button
            onClick={() => onDecision("accept-once")}
            size="sm"
            variant="outline"
            className="h-7 px-3 text-xs"
          >
            <Check className="w-3.5 h-3.5 mr-1" />
            Allow once
          </Button>
          <Button
            onClick={() => onDecision("decline")}
            size="sm"
            variant="outline"
            className="h-7 px-3 text-xs"
          >
            <Ban className="w-3.5 h-3.5 mr-1" />
            Decline
          </Button>
        </div>
      </div>
    </div>
  );
}
