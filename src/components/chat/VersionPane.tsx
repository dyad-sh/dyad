import { useAtom, useAtomValue } from "jotai";
import { selectedAppIdAtom, selectedVersionIdAtom } from "@/atoms/appAtoms";
import { useVersions } from "@/hooks/useVersions";
import { formatDistanceToNow } from "date-fns";
import { RotateCcw, X, Database, Loader2, Search } from "lucide-react";
import type { Version } from "@/ipc/types";
import { ipc } from "@/ipc/types";
import { cn } from "@/lib/utils";
import { queryKeys } from "@/lib/queryKeys";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCheckoutVersion } from "@/hooks/useCheckoutVersion";
import { useLoadApp } from "@/hooks/useLoadApp";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { useRunApp } from "@/hooks/useRunApp";

function HighlightMatch({
  text,
  query,
}: {
  text: string;
  query: string;
}): React.ReactNode {
  if (!query) return text;
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index === -1) return text;
  return (
    <>
      {text.slice(0, index)}
      <mark className="bg-yellow-200 dark:bg-yellow-800 rounded-sm">
        {text.slice(index, index + query.length)}
      </mark>
      {text.slice(index + query.length)}
    </>
  );
}

interface VersionPaneProps {
  isVisible: boolean;
  onClose: () => void;
}

export function VersionPane({ isVisible, onClose }: VersionPaneProps) {
  const appId = useAtomValue(selectedAppIdAtom);
  const { refreshApp, app } = useLoadApp(appId);
  const { restartApp } = useRunApp();
  const {
    versions: liveVersions,
    refreshVersions,
    revertVersion,
    isRevertingVersion,
  } = useVersions(appId);

  const [selectedVersionId, setSelectedVersionId] = useAtom(
    selectedVersionIdAtom,
  );
  const { checkoutVersion, isCheckingOutVersion } = useCheckoutVersion();
  const wasVisibleRef = useRef(false);
  const [cachedVersions, setCachedVersions] = useState<Version[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const { data: screenshotsData } = useQuery({
    queryKey: queryKeys.apps.screenshots({ appId }),
    queryFn: () => ipc.app.listAppScreenshots({ appId: appId! }),
    enabled: isVisible && !!appId,
  });
  const screenshotByHash = useMemo(
    () =>
      new Map(
        screenshotsData?.screenshots.map((s) => [s.commitHash, s.url]) ?? [],
      ),
    [screenshotsData],
  );

  useEffect(() => {
    async function updatePaneState() {
      // When pane becomes visible after being closed
      if (isVisible && !wasVisibleRef.current) {
        if (appId) {
          await refreshVersions();
          setCachedVersions(liveVersions);
        }
      }

      // Reset when closing
      if (!isVisible && selectedVersionId) {
        setSelectedVersionId(null);
        setSearchQuery("");
        if (appId) {
          await checkoutVersion({ appId, versionId: "main" });
          if (app?.neonProjectId) {
            await restartApp();
          }
        }
      }

      wasVisibleRef.current = isVisible;
    }
    updatePaneState();
  }, [
    isVisible,
    selectedVersionId,
    setSelectedVersionId,
    appId,
    checkoutVersion,
    refreshVersions,
    liveVersions,
  ]);

  // Initial load of cached versions when live versions become available
  useEffect(() => {
    if (isVisible && liveVersions.length > 0 && cachedVersions.length === 0) {
      setCachedVersions(liveVersions);
    }
  }, [isVisible, liveVersions, cachedVersions.length]);

  if (!isVisible) {
    return null;
  }

  const handleVersionClick = async (version: Version) => {
    if (appId) {
      setSelectedVersionId(version.oid);
      try {
        await checkoutVersion({ appId, versionId: version.oid });
      } catch (error) {
        console.error("Could not checkout version, unselecting version", error);
        setSelectedVersionId(null);
      }
      await refreshApp();
      if (version.dbTimestamp) {
        await restartApp();
      }
    }
  };

  const versions = cachedVersions.length > 0 ? cachedVersions : liveVersions;

  const filteredVersions = searchQuery.trim()
    ? versions.filter((v, index) => {
        const query = searchQuery.toLowerCase();
        const versionNumber = String(versions.length - index);
        return (
          v.oid.toLowerCase().includes(query) ||
          (v.message && v.message.toLowerCase().includes(query)) ||
          versionNumber.includes(query)
        );
      })
    : versions;

  return (
    <div className="h-full border-t border-2 border-border w-full flex flex-col">
      <div className="p-2 border-b border-border flex items-center justify-between">
        <h2 className="text-base font-medium pl-2">Version History</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="p-1 hover:bg-(--background-lightest) rounded-md  "
            aria-label="Close version pane"
          >
            <X size={20} />
          </button>
        </div>
      </div>
      <div className="px-3 py-2 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search versions..."
            aria-label="Search versions"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-md border border-input bg-transparent pl-8 pr-8 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          {searchQuery && (
            <button
              onClick={() => {
                setSearchQuery("");
                searchInputRef.current?.focus();
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
        {versions.length === 0 ? (
          <div className="p-4">No versions available</div>
        ) : filteredVersions.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">
            No matching versions
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filteredVersions.map((version: Version) => {
              const thumbnailUrl = screenshotByHash.get(version.oid);
              return (
                <div
                  key={version.oid}
                  className={cn(
                    "px-4 py-2 hover:bg-(--background-lightest) cursor-pointer flex gap-3",
                    selectedVersionId === version.oid &&
                      "bg-(--background-lightest)",
                    isCheckingOutVersion &&
                      selectedVersionId === version.oid &&
                      "opacity-50 cursor-not-allowed",
                  )}
                  onClick={() => {
                    if (!isCheckingOutVersion) {
                      handleVersionClick(version);
                    }
                  }}
                >
                  <div
                    className="flex-shrink-0 w-16 h-10 rounded border border-border bg-muted overflow-hidden flex items-center justify-center"
                    aria-hidden="true"
                  >
                    {thumbnailUrl ? (
                      <img
                        src={thumbnailUrl}
                        alt=""
                        loading="lazy"
                        className="w-full h-full object-cover object-top"
                      />
                    ) : (
                      <span className="text-[10px] font-mono text-muted-foreground">
                        {version.oid.slice(0, 4)}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-xs">
                          Version{" "}
                          <HighlightMatch
                            text={String(
                              versions.length - versions.indexOf(version),
                            )}
                            query={searchQuery.trim()}
                          />{" "}
                          (
                          <HighlightMatch
                            text={version.oid.slice(0, 7)}
                            query={searchQuery.trim()}
                          />
                          )
                        </span>
                        {/* example format: '2025-07-25T21:52:01Z' */}
                        {version.dbTimestamp &&
                          (() => {
                            const timestampMs = new Date(
                              version.dbTimestamp,
                            ).getTime();
                            const isExpired =
                              Date.now() - timestampMs > 24 * 60 * 60 * 1000;
                            return (
                              <Tooltip>
                                <TooltipTrigger>
                                  <div
                                    className={cn(
                                      "inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded-md",
                                      isExpired
                                        ? "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                                        : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
                                    )}
                                  >
                                    <Database size={10} />
                                    <span>DB</span>
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {isExpired
                                    ? "DB snapshot may have expired (older than 24 hours)"
                                    : `Database snapshot available at timestamp ${version.dbTimestamp}`}
                                </TooltipContent>
                              </Tooltip>
                            );
                          })()}
                      </div>
                      <div className="flex items-center gap-2">
                        {isCheckingOutVersion &&
                          selectedVersionId === version.oid && (
                            <Loader2
                              size={12}
                              className="animate-spin text-primary"
                            />
                          )}
                        <span className="text-xs opacity-90">
                          {isCheckingOutVersion &&
                          selectedVersionId === version.oid
                            ? "Loading..."
                            : formatDistanceToNow(
                                new Date(version.timestamp * 1000),
                                {
                                  addSuffix: true,
                                },
                              )}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      {version.message && (
                        <p className="mt-1 text-sm">
                          <HighlightMatch
                            text={
                              version.message.startsWith(
                                "Reverted all changes back to version ",
                              )
                                ? version.message.replace(
                                    /Reverted all changes back to version ([a-f0-9]+)/,
                                    (_, hash) => {
                                      const targetIndex = versions.findIndex(
                                        (v) => v.oid === hash,
                                      );
                                      return targetIndex !== -1
                                        ? `Reverted all changes back to version ${
                                            versions.length - targetIndex
                                          }`
                                        : version.message;
                                    },
                                  )
                                : version.message
                            }
                            query={searchQuery.trim()}
                          />
                        </p>
                      )}

                      <div className="flex items-center gap-1">
                        {/* Restore button */}
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();

                            await revertVersion({
                              versionId: version.oid,
                            });
                            setSelectedVersionId(null);
                            // Close the pane after revert to force a refresh on next open
                            onClose();
                            if (version.dbTimestamp) {
                              await restartApp();
                            }
                          }}
                          disabled={isRevertingVersion}
                          className={cn(
                            "invisible mt-1 flex items-center gap-1 px-2 py-0.5 text-sm font-medium bg-(--primary) text-(--primary-foreground) hover:bg-background-lightest rounded-md transition-colors",
                            selectedVersionId === version.oid && "visible",
                            isRevertingVersion &&
                              "opacity-50 cursor-not-allowed",
                          )}
                          aria-label="Restore to this version"
                          title={
                            isRevertingVersion
                              ? "Restoring to this version..."
                              : "Restore to this version"
                          }
                        >
                          {isRevertingVersion ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <RotateCcw size={12} />
                          )}
                          <span>
                            {isRevertingVersion ? "Restoring..." : "Restore"}
                          </span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
