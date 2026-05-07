import React, { useMemo, useState } from "react";
import { FolderOpen, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

export const DyadScript: React.FC<DyadScriptProps> = ({ node, children }) => {
  const description: string = node?.properties?.description || "Ran a script";
  const truncated = node?.properties?.truncated === "true";
  const executionMs: string = node?.properties?.executionMs || "";
  const fullOutputPath: string = node?.properties?.fullOutputPath || "";
  const [expanded, setExpanded] = useState(false);

  const raw = typeof children === "string" ? children : String(children ?? "");
  const payload = useMemo<ScriptPayload>(() => {
    try {
      return JSON.parse(raw) as ScriptPayload;
    } catch {
      return { output: raw };
    }
  }, [raw]);

  return (
    <DyadCard
      showAccent
      accentColor="amber"
      isExpanded={expanded}
      onClick={() => setExpanded((value) => !value)}
      data-testid="dyad-script-card"
    >
      <DyadCardHeader icon={<ScrollText size={15} />} accentColor="amber">
        <DyadBadge color="amber">Script</DyadBadge>
        <span className="text-sm text-foreground truncate">{description}</span>
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
        <div
          className="text-xs cursor-text"
          onClick={(event) => event.stopPropagation()}
        >
          <Tabs
            defaultValue={payload.script ? "script" : "output"}
            className="gap-2"
          >
            <div className="flex items-center justify-between gap-2">
              <TabsList className="h-8 p-0.5">
                {payload.script && (
                  <TabsTrigger value="script" className="h-7 px-2.5 text-xs">
                    Script
                  </TabsTrigger>
                )}
                <TabsTrigger value="output" className="h-7 px-2.5 text-xs">
                  Output
                </TabsTrigger>
              </TabsList>
              {fullOutputPath && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={(event) => {
                    event.stopPropagation();
                    ipc.system.showItemInFolder(fullOutputPath);
                  }}
                >
                  <FolderOpen className="size-3.5 mr-1.5" />
                  Open full output
                </Button>
              )}
            </div>
            <TabsContent value="output" className="mt-0">
              {payload.output?.trim() ? (
                <CodeHighlight className="language-text">
                  {payload.output}
                </CodeHighlight>
              ) : (
                <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
                  Script produced no output. The model may try a different
                  approach.
                </div>
              )}
            </TabsContent>
            {payload.script && (
              <TabsContent value="script" className="mt-0">
                <CodeHighlight className="language-js">
                  {payload.script}
                </CodeHighlight>
              </TabsContent>
            )}
          </Tabs>
        </div>
      </DyadCardContent>
    </DyadCard>
  );
};
