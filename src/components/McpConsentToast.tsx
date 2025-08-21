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
                <p className="text-muted-foreground">{toolDescription}</p>
              )}
              {inputPreview && (
                <pre className="bg-amber-100/60 dark:bg-slate-700/60 p-2 rounded text-xs whitespace-pre-wrap max-h-40 overflow-auto">
                  {inputPreview}
                </pre>
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
