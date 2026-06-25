import React from "react";
import { Button } from "../ui/button";
import {
  X,
  Bot,
  Info,
  ShieldCheck,
  Check,
  Ban,
  AlertTriangle,
} from "lucide-react";
import type { PendingAgentConsent } from "@/atoms/chatAtoms";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { useTranslation } from "react-i18next";

const INPUT_PREVIEW_COLLAPSED_LINES = 6;
const INPUT_PREVIEW_EXPANDED_MAX_HEIGHT = "40vh";

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
  const { t } = useTranslation("chat");
  const {
    toolName,
    toolDescription,
    inputPreview,
    serverName,
    classifierReason,
  } = consent;
  const sqlMutatesSchema = consent.metadata?.sqlMutatesSchema === true;

  // Collapsible input preview state
  const [isInputExpanded, setIsInputExpanded] = React.useState(false);
  const [inputCollapsedMaxHeight, setInputCollapsedMaxHeight] =
    React.useState<number>();
  const [inputHasOverflow, setInputHasOverflow] = React.useState(false);
  const inputRef = React.useRef<HTMLDivElement | null>(null);

  React.useLayoutEffect(() => {
    if (!inputPreview) {
      setInputHasOverflow(false);
      return;
    }

    const element = inputRef.current;
    if (!element) return;

    const compute = () => {
      const computedStyle = window.getComputedStyle(element);
      const parsedLineHeight = Number.parseFloat(computedStyle.lineHeight);
      const lineHeight = Number.isFinite(parsedLineHeight)
        ? parsedLineHeight
        : 20;
      const collapsedMaxHeight = Math.round(
        lineHeight * INPUT_PREVIEW_COLLAPSED_LINES,
      );

      setInputCollapsedMaxHeight(collapsedMaxHeight);
      setInputHasOverflow(element.scrollHeight > collapsedMaxHeight + 1);
    };

    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, [inputPreview]);

  return (
    <div className="border-b border-border bg-muted/50">
      <div className="p-2">
        <div className="flex items-center gap-2 mb-1">
          <Bot className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <span className="text-sm font-medium">
            Allow <span className="font-mono">{toolName}</span>
            {serverName && (
              <>
                {" "}
                from <span className="font-mono">{serverName}</span>
              </>
            )}{" "}
            to run?
            {queueTotal > 1 && (
              <span className="ml-1.5 text-xs text-muted-foreground font-normal">
                (1 of {queueTotal})
              </span>
            )}
          </span>
          {toolDescription && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger className="cursor-help">
                  <Info className="w-3.5 h-3.5 text-muted-foreground" />
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
        {classifierReason && (
          <div className="ml-6 mb-1.5 text-xs text-muted-foreground">
            Flagged for review: {classifierReason}
          </div>
        )}
        {inputPreview && (
          <div className="ml-6 mb-1.5">
            {sqlMutatesSchema && (
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                <span>{t("changesDatabaseSchema")}</span>
              </div>
            )}
            <div className="rounded bg-muted p-1.5">
              <div
                ref={inputRef}
                className={`text-sm whitespace-pre-wrap break-words transition-[max-height] duration-200 ease-out motion-reduce:transition-none ${
                  isInputExpanded ? "overflow-auto" : "overflow-hidden"
                }`}
                style={{
                  maxHeight: isInputExpanded
                    ? INPUT_PREVIEW_EXPANDED_MAX_HEIGHT
                    : inputCollapsedMaxHeight,
                }}
              >
                {inputPreview}
              </div>
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
