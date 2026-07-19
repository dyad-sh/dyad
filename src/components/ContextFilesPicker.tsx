import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";

import { InfoIcon, Settings2, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";
import { useSettings } from "@/hooks/useSettings";
import { useContextPaths } from "@/hooks/useContextPaths";
import type { ContextPathResult } from "@/lib/schemas";

export function ContextFilesPicker() {
  const { t } = useTranslation("home");
  const { settings } = useSettings();
  const {
    contextPaths,
    smartContextAutoIncludes,
    excludePaths,
    updateContextPaths,
    updateSmartContextAutoIncludes,
    updateExcludePaths,
  } = useContextPaths();
  const [isOpen, setIsOpen] = useState(false);
  const [newPath, setNewPath] = useState("");
  const [newAutoIncludePath, setNewAutoIncludePath] = useState("");
  const [newExcludePath, setNewExcludePath] = useState("");

  const addPath = () => {
    if (
      newPath.trim() === "" ||
      contextPaths.find((p: ContextPathResult) => p.globPath === newPath)
    ) {
      setNewPath("");
      return;
    }
    const newPaths = [
      ...contextPaths.map(({ globPath }: ContextPathResult) => ({ globPath })),
      {
        globPath: newPath,
      },
    ];
    updateContextPaths(newPaths);
    setNewPath("");
  };

  const removePath = (pathToRemove: string) => {
    const newPaths = contextPaths
      .filter((p: ContextPathResult) => p.globPath !== pathToRemove)
      .map(({ globPath }: ContextPathResult) => ({ globPath }));
    updateContextPaths(newPaths);
  };

  const addAutoIncludePath = () => {
    if (
      newAutoIncludePath.trim() === "" ||
      smartContextAutoIncludes.find(
        (p: ContextPathResult) => p.globPath === newAutoIncludePath,
      )
    ) {
      setNewAutoIncludePath("");
      return;
    }
    const newPaths = [
      ...smartContextAutoIncludes.map(({ globPath }: ContextPathResult) => ({
        globPath,
      })),
      {
        globPath: newAutoIncludePath,
      },
    ];
    updateSmartContextAutoIncludes(newPaths);
    setNewAutoIncludePath("");
  };

  const removeAutoIncludePath = (pathToRemove: string) => {
    const newPaths = smartContextAutoIncludes
      .filter((p: ContextPathResult) => p.globPath !== pathToRemove)
      .map(({ globPath }: ContextPathResult) => ({ globPath }));
    updateSmartContextAutoIncludes(newPaths);
  };

  const addExcludePath = () => {
    if (
      newExcludePath.trim() === "" ||
      excludePaths.find((p: ContextPathResult) => p.globPath === newExcludePath)
    ) {
      setNewExcludePath("");
      return;
    }
    const newPaths = [
      ...excludePaths.map(({ globPath }: ContextPathResult) => ({ globPath })),
      {
        globPath: newExcludePath,
      },
    ];
    updateExcludePaths(newPaths);
    setNewExcludePath("");
  };

  const removeExcludePath = (pathToRemove: string) => {
    const newPaths = excludePaths
      .filter((p: ContextPathResult) => p.globPath !== pathToRemove)
      .map(({ globPath }: ContextPathResult) => ({ globPath }));
    updateExcludePaths(newPaths);
  };

  const isSmartContextEnabled =
    settings?.enableDyadPro && settings?.enableProSmartFilesContextMode;

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger
        className="flex items-center py-2 px-3 hover:bg-accent hover:text-accent-foreground rounded-sm cursor-pointer text-sm"
        data-testid="codebase-context-trigger"
      >
        <Settings2 className="size-4 mr-2" />
        {t("context.trigger")}
      </DialogTrigger>

      <DialogContent
        className="max-w-md max-h-[80vh] overflow-y-auto"
        onKeyDown={(e) => e.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle>{t("context.title")}</DialogTitle>
          <DialogDescription>
            <span className="flex items-center gap-1">
              {t("context.selectFiles")}{" "}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger className="cursor-help">
                    <InfoIcon className="size-4" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[300px]">
                    {isSmartContextEnabled ? (
                      <p>{t("context.smartDescription")}</p>
                    ) : (
                      <p>{t("context.defaultDescription")}</p>
                    )}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </span>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
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
              {t("context.add")}
            </Button>
          </div>

          <TooltipProvider>
            {contextPaths.length > 0 ? (
              <div className="space-y-2">
                {contextPaths.map((p: ContextPathResult) => (
                  <div
                    key={p.globPath}
                    className="flex items-center justify-between gap-2 rounded-md border p-2"
                  >
                    <div className="flex flex-1 flex-col overflow-hidden">
                      <Tooltip>
                        <TooltipTrigger className="truncate font-mono text-sm text-left">
                          {p.globPath}
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>{p.globPath}</p>
                        </TooltipContent>
                      </Tooltip>
                      <span className="text-xs text-muted-foreground">
                        {t("context.fileStats", {
                          files: p.files,
                          tokens: p.tokens,
                        })}
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
                    ? t("context.smartEmpty")
                    : t("context.wholeCodebaseEmpty")}
                </p>
              </div>
            )}
          </TooltipProvider>

          <div className="pt-2">
            <div>
              <h3 className="font-medium">{t("context.excludePaths")}</h3>
              <p className="text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  {t("context.excludeDescription")}{" "}
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger className="cursor-help">
                        <InfoIcon className="size-4" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[300px]">
                        <p>{t("context.excludePriority")}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </span>
              </p>
            </div>

            <div className="flex w-full max-w-sm items-center space-x-2 mt-4">
              <Input
                data-testid="exclude-context-files-input"
                type="text"
                placeholder="node_modules/**/*"
                value={newExcludePath}
                onChange={(e) => setNewExcludePath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    addExcludePath();
                  }
                }}
              />
              <Button
                type="submit"
                onClick={addExcludePath}
                data-testid="exclude-context-files-add-button"
              >
                {t("context.add")}
              </Button>
            </div>

            <TooltipProvider>
              {excludePaths.length > 0 && (
                <div className="space-y-2 mt-4">
                  {excludePaths.map((p: ContextPathResult) => (
                    <div
                      key={p.globPath}
                      className="flex items-center justify-between gap-2 rounded-md border p-2 border-red-200"
                    >
                      <div className="flex flex-1 flex-col overflow-hidden">
                        <Tooltip>
                          <TooltipTrigger className="truncate font-mono text-sm text-red-600 text-left">
                            {p.globPath}
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{p.globPath}</p>
                          </TooltipContent>
                        </Tooltip>
                        <span className="text-xs text-muted-foreground">
                          {t("context.fileStats", {
                            files: p.files,
                            tokens: p.tokens,
                          })}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeExcludePath(p.globPath)}
                          data-testid="exclude-context-files-remove-button"
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

          {isSmartContextEnabled && (
            <div className="pt-2">
              <div>
                <h3 className="font-medium">
                  {t("context.smartAutoIncludes")}
                </h3>
                <p className="text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    {t("context.autoIncludeDescription")}{" "}
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger className="cursor-help">
                          <InfoIcon className="size-4" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-[300px]">
                          <p>{t("context.autoIncludePriority")}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </span>
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
                  {t("context.add")}
                </Button>
              </div>

              <TooltipProvider>
                {smartContextAutoIncludes.length > 0 && (
                  <div className="space-y-2 mt-4">
                    {smartContextAutoIncludes.map((p: ContextPathResult) => (
                      <div
                        key={p.globPath}
                        className="flex items-center justify-between gap-2 rounded-md border p-2"
                      >
                        <div className="flex flex-1 flex-col overflow-hidden">
                          <Tooltip>
                            <TooltipTrigger className="truncate font-mono text-sm text-left">
                              {p.globPath}
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>{p.globPath}</p>
                            </TooltipContent>
                          </Tooltip>
                          <span className="text-xs text-muted-foreground">
                            {t("context.fileStats", {
                              files: p.files,
                              tokens: p.tokens,
                            })}
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
      </DialogContent>
    </Dialog>
  );
}
