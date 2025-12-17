import React from "react";
import { Button } from "./ui/button";
import { X, Bot } from "lucide-react";
import { toast } from "sonner";

interface AgentConsentToastProps {
  toastId: string | number;
  toolName: string;
  toolDescription?: string | null;
  inputPreview?: string | null;
  onDecision: (decision: "accept-once" | "accept-always" | "decline") => void;
}

export function AgentConsentToast({
  toastId,
  toolName,
  toolDescription,
  inputPreview,
  onDecision,
}: AgentConsentToastProps) {
  const handleClose = () => toast.dismiss(toastId);

  const handle = (d: "accept-once" | "accept-always" | "decline") => {
    onDecision(d);
    toast.dismiss(toastId);
  };

  // Collapsible input preview state
  const [isInputExpanded, setIsInputExpanded] = React.useState(false);
  const [inputCollapsedMaxHeight, setInputCollapsedMaxHeight] =
    React.useState<number>(0);
  const [inputHasOverflow, setInputHasOverflow] = React.useState(false);
  const inputRef = React.useRef<HTMLPreElement | null>(null);

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
    <div className="relative bg-blue-50/95 dark:bg-slate-800/95 backdrop-blur-sm border border-blue-200 dark:border-slate-600 rounded-xl shadow-lg min-w-[420px] max-w-[560px] overflow-hidden">
      <div className="p-5">
        <div className="flex items-start">
          <div className="flex-1">
            <div className="flex items-center mb-4">
              <div className="flex-shrink-0">
                <div className="w-6 h-6 bg-gradient-to-br from-blue-500 to-blue-600 dark:from-blue-400 dark:to-blue-500 rounded-full flex items-center justify-center shadow-sm">
                  <Bot className="w-3.5 h-3.5 text-white" />
                </div>
              </div>
              <h3 className="ml-3 text-base font-semibold text-blue-900 dark:text-blue-100">
                Agent v2 tool wants to run
              </h3>
              <button
                onClick={handleClose}
                className="ml-auto flex-shrink-0 p-1.5 text-blue-500 dark:text-slate-400 hover:text-blue-700 dark:hover:text-slate-200 transition-colors duration-200 rounded-md hover:bg-blue-100/50 dark:hover:bg-slate-700/50"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2 text-sm">
              <p>
                <span className="font-semibold font-mono">{toolName}</span>{" "}
                requests your consent.
              </p>
              {toolDescription && (
                <p className="text-muted-foreground">{toolDescription}</p>
              )}
              {inputPreview && (
                <div>
                  <pre
                    ref={inputRef}
                    className="bg-blue-100/60 dark:bg-slate-700/60 p-2 rounded text-xs whitespace-pre-wrap"
                    style={{
                      maxHeight: isInputExpanded
                        ? "40vh"
                        : inputCollapsedMaxHeight,
                      overflow: isInputExpanded ? "auto" : "hidden",
                    }}
                  >
                    {inputPreview}
                  </pre>
                  {inputHasOverflow && (
                    <button
                      type="button"
                      className="mt-1 text-xs font-medium text-blue-700 hover:underline dark:text-blue-300"
                      onClick={() => setIsInputExpanded((v) => !v)}
                    >
                      {isInputExpanded ? "Show less" : "Show more"}
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center gap-3 mt-4">
              <Button
                onClick={() => handle("accept-once")}
                size="sm"
                className="px-6"
              >
                Allow once
              </Button>
              <Button
                onClick={() => handle("accept-always")}
                size="sm"
                variant="secondary"
                className="px-6"
              >
                Always allow
              </Button>
              <Button
                onClick={() => handle("decline")}
                size="sm"
                variant="outline"
                className="px-6"
              >
                Decline
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
