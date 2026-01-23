import React from "react";
import { Button } from "./ui/button";
import { X, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

interface McpConsentToastProps {
  toastId: string | number;
  serverName: string;
  toolName: string;
  toolDescription?: string | null;
  inputPreview?: string | null;
  onDecision: (decision: "accept-once" | "accept-always" | "decline") => void;
}

export function McpConsentToast({
  toastId,
  serverName,
  toolName,
  toolDescription,
  inputPreview,
  onDecision,
}: McpConsentToastProps) {
  const handleClose = () => toast.dismiss(toastId);

  const handle = (d: "accept-once" | "accept-always" | "decline") => {
    onDecision(d);
    toast.dismiss(toastId);
  };

  // Collapsible tool description state
  const [isExpanded, setIsExpanded] = React.useState(false);
  const [collapsedMaxHeight, setCollapsedMaxHeight] = React.useState<number>(0);
  const [hasOverflow, setHasOverflow] = React.useState(false);
  const descRef = React.useRef<HTMLParagraphElement | null>(null);

  // Collapsible input preview state
  const [isInputExpanded, setIsInputExpanded] = React.useState(false);
  const [inputCollapsedMaxHeight, setInputCollapsedMaxHeight] =
    React.useState<number>(0);
  const [inputHasOverflow, setInputHasOverflow] = React.useState(false);
  const inputRef = React.useRef<HTMLPreElement | null>(null);

  React.useEffect(() => {
    if (!toolDescription) {
      setHasOverflow(false);
      return;
    }

    const element = descRef.current;
    if (!element) return;

    const compute = () => {
      const computedStyle = window.getComputedStyle(element);
      const lineHeight = parseFloat(computedStyle.lineHeight || "20");
      const maxLines = 4; // show first few lines by default
      const maxHeightPx = Math.max(0, Math.round(lineHeight * maxLines));
      setCollapsedMaxHeight(maxHeightPx);
      // Overflow if full height exceeds our collapsed height
      setHasOverflow(element.scrollHeight > maxHeightPx + 1);
    };

    // Compute initially and on resize
    compute();
    const onResize = () => compute();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [toolDescription]);

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
      const maxLines = 6; // show first few lines by default
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
    <div className="relative bg-amber-50/95 dark:bg-slate-800/95 backdrop-blur-sm border border-amber-200 dark:border-slate-600 rounded-xl shadow-lg min-w-[420px] max-w-[560px] overflow-hidden">
      <div className="p-5">
        <div className="flex items-start">
          <div className="flex-1">
            <div className="flex items-center mb-4">
              <div className="flex-shrink-0">
                <div className="w-6 h-6 bg-gradient-to-br from-amber-500 to-amber-600 dark:from-amber-400 dark:to-amber-500 rounded-full flex items-center justify-center shadow-sm">
                  <ShieldAlert className="w-3.5 h-3.5 text-white" />
                </div>
              </div>
              <h3 className="ml-3 text-base font-semibold text-amber-900 dark:text-amber-100">
                Tool wants to run
              </h3>
              <button
                onClick={handleClose}
                className="ml-auto flex-shrink-0 p-1.5 text-amber-500 dark:text-slate-400 hover:text-amber-700 dark:hover:text-slate-200 transition-colors duration-200 rounded-md hover:bg-amber-100/50 dark:hover:bg-slate-700/50"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2 text-sm">
              <p>
                <span className="font-semibold">{toolName}</span> from
                <span className="font-semibold"> {serverName}</span> requests
                your consent.
              </p>
              {toolDescription && (
                <div>
                  <p
                    ref={descRef}
                    className="text-muted-foreground whitespace-pre-wrap"
                    style={{
                      maxHeight: isExpanded ? "40vh" : collapsedMaxHeight,
                      overflow: isExpanded ? "auto" : "hidden",
                    }}
                  >
                    {toolDescription}
                  </p>
                  {hasOverflow && (
                    <button
                      type="button"
                      className="mt-1 text-xs font-medium text-amber-700 hover:underline dark:text-amber-300"
                      onClick={() => setIsExpanded((v) => !v)}
                    >
                      {isExpanded ? "Show less" : "Show more"}
                    </button>
                  )}
                </div>
              )}
              {inputPreview && (
                <div>
                  <pre
                    ref={inputRef}
                    className="bg-amber-100/60 dark:bg-slate-700/60 p-2 rounded text-xs whitespace-pre-wrap"
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
                      className="mt-1 text-xs font-medium text-amber-700 hover:underline dark:text-amber-300"
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
