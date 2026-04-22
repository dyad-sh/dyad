import React, { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { FolderOpen, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ipc } from "@/ipc/types";
import { CodeHighlight } from "./CodeHighlight";
import {
  DyadBadge,
  DyadCard,
  DyadCardContent,
  DyadCardHeader,
  DyadExpandIcon,
} from "./DyadCardPrimitives";

interface DyadScriptProps {
  node?: any;
  children?: React.ReactNode;
}

interface ScriptPayload {
  script?: string;
  output?: string;
}

const SCRIPT_TIP_STORAGE_KEY = "dyad-script-card-tip-dismissed";
let scriptTipShownThisSession = false;

export const DyadScript: React.FC<DyadScriptProps> = ({ node, children }) => {
  const navigate = useNavigate();
  const description: string = node?.properties?.description || "Ran a script";
  const truncated = node?.properties?.truncated === "true";
  const executionMs: string = node?.properties?.executionMs || "";
  const fullOutputPath: string = node?.properties?.fullOutputPath || "";
  const [expanded, setExpanded] = useState(false);
  const [showTip, setShowTip] = useState(() => {
    if (
      typeof window === "undefined" ||
      window.localStorage.getItem(SCRIPT_TIP_STORAGE_KEY) === "true" ||
      scriptTipShownThisSession
    ) {
      return false;
    }
    scriptTipShownThisSession = true;
    return true;
  });

  const raw = typeof children === "string" ? children : String(children ?? "");
  const payload = useMemo<ScriptPayload>(() => {
    try {
      return JSON.parse(raw) as ScriptPayload;
    } catch {
      return { output: raw };
    }
  }, [raw]);

  const dismissTip = () => {
    window.localStorage.setItem(SCRIPT_TIP_STORAGE_KEY, "true");
    setShowTip(false);
  };

  return (
    <>
      {showTip && (
        <div className="mb-2 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex-1">
              Dyad just ran a small script to read your file. You'll see each
              one here.
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  dismissTip();
                  navigate({ to: "/settings" });
                }}
              >
                Settings
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={dismissTip}
              >
                Got it
              </Button>
            </div>
          </div>
        </div>
      )}
      <DyadCard
        showAccent
        accentColor="amber"
        isExpanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        data-testid="dyad-script-card"
      >
        <DyadCardHeader icon={<ScrollText size={15} />} accentColor="amber">
          <DyadBadge color="amber">Script</DyadBadge>
          <span className="text-sm text-foreground truncate">
            {description}
          </span>
          {executionMs && (
            <span className="text-xs text-muted-foreground shrink-0">
              {executionMs}ms
            </span>
          )}
          {truncated && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 ring-1 ring-inset ring-amber-200 dark:ring-amber-800 shrink-0">
              Truncated
            </span>
          )}
          <div className="ml-auto">
            <DyadExpandIcon isExpanded={expanded} />
          </div>
        </DyadCardHeader>
        <DyadCardContent isExpanded={expanded}>
          <div className="space-y-3">
            {payload.script && (
              <div className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground">
                  Script
                </div>
                <CodeHighlight className="language-js">
                  {payload.script}
                </CodeHighlight>
              </div>
            )}
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">
                Output
              </div>
              {payload.output?.trim() ? (
                <CodeHighlight className="language-text">
                  {payload.output}
                </CodeHighlight>
              ) : (
                <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
                  Script returned empty - Dyad will try again.
                </div>
              )}
            </div>
            {fullOutputPath && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={(event) => {
                  event.stopPropagation();
                  ipc.system.showItemInFolder(fullOutputPath);
                }}
              >
                <FolderOpen className="size-4 mr-2" />
                Open full output
              </Button>
            )}
          </div>
        </DyadCardContent>
      </DyadCard>
    </>
  );
};
