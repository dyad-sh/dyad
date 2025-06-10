import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import { FileCode, InfoIcon, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";
import { useSettings } from "@/hooks/useSettings";
import { useContextPaths } from "@/hooks/useContextPaths";

export function ContextFilesPicker() {
  const { settings } = useSettings();
  const {
    contextPaths,
    smartContextAutoIncludes,
    updateContextPaths,
    updateSmartContextAutoIncludes,
  } = useContextPaths();
  const [isOpen, setIsOpen] = useState(false);
  const [newPath, setNewPath] = useState("");
  const [newAutoIncludePath, setNewAutoIncludePath] = useState("");

  const addPath = () => {
    if (
      newPath.trim() === "" ||
      contextPaths.find((p) => p.globPath === newPath)
    ) {
      setNewPath("");
      return;
    }
    const newPaths = [
      ...contextPaths.map(({ globPath }) => ({ globPath })),
      {
        globPath: newPath,
      },
    ];
    updateContextPaths(newPaths);
    setNewPath("");
  };

  const removePath = (pathToRemove: string) => {
    const newPaths = contextPaths
      .filter((p) => p.globPath !== pathToRemove)
      .map(({ globPath }) => ({ globPath }));
    updateContextPaths(newPaths);
  };

  const addAutoIncludePath = () => {
    if (
      newAutoIncludePath.trim() === "" ||
      smartContextAutoIncludes.find((p) => p.globPath === newAutoIncludePath)
    ) {
      setNewAutoIncludePath("");
      return;
    }
    const newPaths = [
      ...smartContextAutoIncludes.map(({ globPath }) => ({ globPath })),
      {
        globPath: newAutoIncludePath,
      },
    ];
    updateSmartContextAutoIncludes(newPaths);
    setNewAutoIncludePath("");
  };

  const removeAutoIncludePath = (pathToRemove: string) => {
    const newPaths = smartContextAutoIncludes
      .filter((p) => p.globPath !== pathToRemove)
      .map(({ globPath }) => ({ globPath }));
    updateSmartContextAutoIncludes(newPaths);
  };

  const isSmartContextEnabled =
    settings?.enableDyadPro && settings?.enableProSmartFilesContextMode;

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" className="gap-2">
          <FileCode className="size-4" />
          <span>Context</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96" align="start">
        <div className="relative space-y-4">
          <div>
            <h3 className="font-medium">Codebase Context</h3>
            <p className="text-sm text-muted-foreground">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="flex items-center gap-1 cursor-help">
                      Select the files to use as context.{" "}
                      <InfoIcon className="size-4" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[300px]">
                    {isSmartContextEnabled ? (
                      <p>
                        With Smart Context, Dyad uses the most relevant files as
                        context.
                      </p>
                    ) : (
                      <p>By default, Dyad uses your whole codebase.</p>
                    )}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </p>
          </div>

          <div className="flex w-full max-w-sm items-center space-x-2">
            <Input
              data-testid="manual-context-files-input"
              type="text"
              placeholder="src/**/*.tsx"
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  addPath();
                }
              }}
            />
            <Button
              type="submit"
              onClick={addPath}
              data-testid="manual-context-files-add-button"
            >
              Add
            </Button>
          </div>

          <TooltipProvider>
            {contextPaths.length > 0 ? (
              <div className="space-y-2">
                {contextPaths.map((p) => (
                  <div
                    key={p.globPath}
                    className="flex items-center justify-between gap-2 rounded-md border p-2"
                  >
                    <div className="flex flex-1 flex-col overflow-hidden">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="truncate font-mono text-sm">
                            {p.globPath}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>{p.globPath}</p>
                        </TooltipContent>
                      </Tooltip>
                      <span className="text-xs text-muted-foreground">
                        {p.files} files, ~{p.tokens} tokens
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removePath(p.globPath)}
                        data-testid="manual-context-files-remove-button"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-dashed p-4 text-center">
                <p className="text-sm text-muted-foreground">
                  {isSmartContextEnabled
                    ? "Dyad will use Smart Context to automatically find the most relevant files to use as context."
                    : "Dyad will use the entire codebase as context."}
                </p>
              </div>
            )}
          </TooltipProvider>

          {isSmartContextEnabled && (
            <div className="pt-2">
              <div>
                <h3 className="font-medium">Smart Context Auto-includes</h3>
                <p className="text-sm text-muted-foreground">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="flex items-center gap-1 cursor-help">
                          These files will always be included in the context.{" "}
                          <InfoIcon className="ml-2 size-4" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[300px]">
                        <p>
                          Auto-include files are always included in the context
                          in addition to the files selected as relevant by Smart
                          Context.
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </p>
              </div>

              <div className="flex w-full max-w-sm items-center space-x-2 mt-4">
                <Input
                  data-testid="auto-include-context-files-input"
                  type="text"
                  placeholder="src/**/*.config.ts"
                  value={newAutoIncludePath}
                  onChange={(e) => setNewAutoIncludePath(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      addAutoIncludePath();
                    }
                  }}
                />
                <Button
                  type="submit"
                  onClick={addAutoIncludePath}
                  data-testid="auto-include-context-files-add-button"
                >
                  Add
                </Button>
              </div>

              <TooltipProvider>
                {smartContextAutoIncludes.length > 0 && (
                  <div className="space-y-2 mt-4">
                    {smartContextAutoIncludes.map((p) => (
                      <div
                        key={p.globPath}
                        className="flex items-center justify-between gap-2 rounded-md border p-2"
                      >
                        <div className="flex flex-1 flex-col overflow-hidden">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="truncate font-mono text-sm">
                                {p.globPath}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>{p.globPath}</p>
                            </TooltipContent>
                          </Tooltip>
                          <span className="text-xs text-muted-foreground">
                            {p.files} files, ~{p.tokens} tokens
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeAutoIncludePath(p.globPath)}
                            data-testid="auto-include-context-files-remove-button"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </TooltipProvider>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
